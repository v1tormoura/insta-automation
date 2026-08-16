"""
Per-account instagrapi client pool.

Each account gets exactly one Client instance and one asyncio.Lock.
The pool lives for the process lifetime; clients are evicted when
invalidated or the process restarts (Node.js reloads sessions from MongoDB).

SECURITY GUARANTEES:
- Each account's Client, session, cookies, device UUID, and proxy are fully isolated.
- No client data is ever shared between accounts.
- Per-account asyncio.Lock prevents concurrent Instagram requests for the same account.
- Passwords are never stored — the pending-2FA dict stores only the username and
  two_factor_identifier required to complete a challenge, never the password itself.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Optional

# ── Instagrapi exceptions — imported at module level (fail fast) ──────────────
# If instagrapi is not properly installed, the service will fail to start.
# This is intentional: we MUST NOT silently create stub exception classes, as
# that would cause real Instagram exceptions to fall through the wrong handler.
from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword,
    ChallengeRequired,
    FeedbackRequired,
    LoginRequired,
    TwoFactorRequired,
)

# Optional extras not available in all instagrapi 2.x minor versions.
# Absence is fine — classify_error() covers these via message content.
try:
    from instagrapi.exceptions import PleaseWaitFewMinutes as _PleaseWait
except ImportError:
    _PleaseWait = None

try:
    from instagrapi.exceptions import RateLimitError as _RateLimit
except ImportError:
    _RateLimit = None

try:
    from instagrapi.exceptions import ClientThrottledError as _ClientThrottled
except ImportError:
    _ClientThrottled = None

# Combined tuple of all rate-limit exception types known to instagrapi.
# None values are excluded (optional imports that may be missing in some versions).
_RATE_LIMIT_EXC = tuple(e for e in (_PleaseWait, _RateLimit, _ClientThrottled) if e is not None)


class _PreLoginRateLimited(Exception):
    """Sentinel raised when pre_login_flow() is rate-limited.

    Using a custom type (not PleaseWaitFewMinutes or ClientThrottledError) ensures
    that login() does NOT swallow it — its except handler only catches those two
    library types. classify_error() maps _PreLoginRateLimited explicitly to
    RATE_LIMITED without any message-content parsing.
    """
    pass


# urllib3 retry suppression + HTTP request logging
try:
    from urllib3.util.retry import Retry as _Retry
    from requests.adapters import HTTPAdapter as _HTTPAdapter
    _HAS_REQUESTS_RETRY = True

    class _LoggingHTTPAdapter(_HTTPAdapter):
        """[TEMP-DEBUG] Logs every Instagram HTTP request/response for investigation.
        Logs ONLY: method, host, path, status_code, error type. Never logs credentials."""
        _seq = 0  # class-level counter — safe under Python GIL for simple int increment

        def send(self, request, **kwargs):
            import urllib.parse
            _LoggingHTTPAdapter._seq += 1
            n = _LoggingHTTPAdapter._seq
            u = urllib.parse.urlparse(request.url)
            logger.info("[IG-HTTP] #%d → %s %s%s", n, request.method, u.netloc, u.path)
            try:
                resp = super().send(request, **kwargs)
                logger.info("[IG-HTTP] #%d ← status=%d", n, resp.status_code)
                return resp
            except Exception as exc:
                logger.info("[IG-HTTP] #%d ✗ %s — %s", n, type(exc).__name__, str(exc)[:150])
                raise

except ImportError:
    _HAS_REQUESTS_RETRY = False
    _LoggingHTTPAdapter = None

logger = logging.getLogger(__name__)

# ── In-memory pool ────────────────────────────────────────────────────────────

# pool: account_id → { "client": Client, "lock": asyncio.Lock }
_pool: Dict[str, dict] = {}
_pool_lock = asyncio.Lock()

# Pending two-factor challenges: account_id → {username, two_factor_identifier, expires_at}
# Stored in-memory only — never written to disk or database.
# Cleared on verification (success or failure) or after TTL expires.
_PENDING_2FA_TTL = 300  # 5 minutes
_pending_2fa: Dict[str, dict] = {}


def _patch_client_retries(client: Client) -> None:
    """
    Disable urllib3's automatic HTTP retry on the instagrapi private session.

    By default instagrapi/urllib3 may retry on 429 responses, turning one login
    click into 3-4 Instagram requests and accelerating the rate-limit window.
    Setting total=0 makes every 429 raise immediately so classify_error() handles
    it as RATE_LIMITED without amplifying requests to Instagram.

    Compatibility: works with urllib3 1.x and 2.x — avoids raise_on_status which
    has different semantics across minor versions and is not needed with total=0.
    """
    if not _HAS_REQUESTS_RETRY:
        return
    private = getattr(client, 'private', None)
    if private is None or not hasattr(private, 'mount'):
        return  # httpx-based client (future instagrapi versions) — no-op
    adapter_cls = _LoggingHTTPAdapter if _LoggingHTTPAdapter is not None else _HTTPAdapter
    adapter = adapter_cls(max_retries=_Retry(total=0))
    private.mount('https://', adapter)
    private.mount('http://', adapter)


def _patch_client_fail_fast(client: Client) -> None:
    """Override pre_login_flow to raise _PreLoginRateLimited on 429 instead of ignoring it.

    instagrapi's login() catches PleaseWaitFewMinutes/ClientThrottledError from
    pre_login_flow() and silently continues to call accounts/login/ — wasting one
    Instagram request per blocked attempt.

    This patch wraps pre_login_flow so any 429 raises _PreLoginRateLimited (a type
    that login() does NOT catch) → classify_error() maps it to RATE_LIMITED, and
    the accounts/login/ call is never made.

    Effect: each IP-blocked login attempt uses 1 Instagram request instead of 2.
    """
    if not _RATE_LIMIT_EXC:
        return  # no rate-limit exceptions importable — safe no-op
    _orig = client.pre_login_flow

    def _fail_fast_pre_login_flow():
        try:
            return _orig()
        except _RATE_LIMIT_EXC as exc:
            raise _PreLoginRateLimited(
                "pre_login_flow rate-limited — aborting to avoid spending accounts/login/ request"
            ) from exc

    client.pre_login_flow = _fail_fast_pre_login_flow


async def get_entry(account_id: str) -> dict:
    """Get or create a pool entry for this account (creates isolated Client + Lock)."""
    async with _pool_lock:
        if account_id not in _pool:
            client = Client()
            _patch_client_retries(client)
            _patch_client_fail_fast(client)
            _pool[account_id] = {
                "client": client,
                "lock":   asyncio.Lock(),
            }
        return _pool[account_id]


async def remove_entry(account_id: str) -> None:
    """Evict an account's client from the pool (called after session invalidation)."""
    async with _pool_lock:
        _pool.pop(account_id, None)
    _pending_2fa.pop(account_id, None)


def is_loaded(account_id: str) -> bool:
    """Return True if this account has a client in the pool (sync — pool check only)."""
    return account_id in _pool


# ── Structured logging ────────────────────────────────────────────────────────

# Fields that must never appear in logs.
_REDACT = frozenset({
    "password", "verification_code", "totp", "session",
    "cookies", "settings", "access_token", "token",
})


def _slog(event: str, account_id: str, **kwargs) -> None:
    """Emit a structured JSON log line. Strips secrets before logging."""
    safe = {k: v for k, v in kwargs.items() if k not in _REDACT}
    logger.info("%s", json.dumps({"event": event, "account": account_id, **safe}))


# ── Pending 2FA store ─────────────────────────────────────────────────────────

def store_pending_2fa(account_id: str, username: str, identifier: str) -> None:
    """
    Store the two_factor_identifier needed to complete a pending 2FA challenge.
    The password is deliberately NOT stored here.
    TTL: 5 minutes — after that the challenge must be restarted.
    """
    _pending_2fa[account_id] = {
        "username":              username,
        "two_factor_identifier": identifier,
        "expires_at":            time.time() + _PENDING_2FA_TTL,
    }
    _slog("LOGIN_2FA_PENDING", account_id, ttl_s=_PENDING_2FA_TTL)


def get_pending_2fa(account_id: str) -> Optional[dict]:
    """Return pending 2FA state, or None if not found / expired."""
    entry = _pending_2fa.get(account_id)
    if not entry:
        return None
    if time.time() > entry["expires_at"]:
        _pending_2fa.pop(account_id, None)
        return None
    return entry


def clear_pending_2fa(account_id: str) -> None:
    """Clear pending 2FA state after verification (success or failure)."""
    _pending_2fa.pop(account_id, None)


# ── Error classification ──────────────────────────────────────────────────────

def classify_error(e: Exception) -> str:
    """
    Map an instagrapi / httpx / urllib3 exception to a stable error code string.

    Strategy:
    1. isinstance checks against known instagrapi exception classes (most precise —
       catches subclasses and works even when the exception is re-raised or wrapped).
    2. Type name substring checks (handles wrapped exceptions from older versions).
    3. Message content checks (last resort for exceptions we can't import).

    Invariants:
    - RATE_LIMITED is never confused with TWO_FACTOR_REQUIRED.
    - PROXY_ERROR is checked before generic NETWORK_ERROR.
    - The "too many 429 error responses" MaxRetryError is always RATE_LIMITED.
    """
    # ── Sentinel: pre_login_flow was rate-limited — explicit, no message parsing ──
    if isinstance(e, _PreLoginRateLimited):
        return "RATE_LIMITED"

    # ── isinstance (primary — most reliable) ─────────────────────────────────
    if isinstance(e, TwoFactorRequired):
        return "TWO_FACTOR_REQUIRED"
    if isinstance(e, ChallengeRequired):
        return "CHALLENGE_REQUIRED"
    if isinstance(e, BadPassword):
        return "BAD_PASSWORD"
    if isinstance(e, LoginRequired):
        return "SESSION_EXPIRED"
    if isinstance(e, FeedbackRequired):
        return "FEEDBACK_REQUIRED"
    if _PleaseWait is not None and isinstance(e, _PleaseWait):
        return "RATE_LIMITED"
    if _RateLimit is not None and isinstance(e, _RateLimit):
        return "RATE_LIMITED"

    type_name = type(e).__name__.lower()
    msg       = str(e).lower()

    # ── Proxy errors (before generic network) ────────────────────────────────
    if any(x in type_name for x in ("proxyerror", "socks5", "socks4")):
        return "PROXY_ERROR"
    if "proxy" in msg or ("tunnel" in msg and ("connect" in msg or "refused" in msg)):
        return "PROXY_ERROR"

    # ── Rate limit ────────────────────────────────────────────────────────────
    # "too many 429 error responses" — urllib3 MaxRetryError after exhausting retries
    if "429" in msg or "too many" in msg or "please wait" in msg:
        return "RATE_LIMITED"
    if "ratelimit" in type_name or "rate_limit" in msg or "rate limit" in msg:
        return "RATE_LIMITED"

    # ── Specific type name fallbacks ──────────────────────────────────────────
    if "twofactorrequired" in type_name:
        return "TWO_FACTOR_REQUIRED"
    if "challengerequired" in type_name or "challenge_required" in type_name:
        return "CHALLENGE_REQUIRED"
    if "badpassword" in type_name or "bad_password" in type_name:
        return "BAD_PASSWORD"
    if "loginrequired" in type_name or "login_required" in type_name:
        return "SESSION_EXPIRED"
    if "feedbackrequired" in type_name or "feedback_required" in type_name:
        return "FEEDBACK_REQUIRED"

    # ── Message-based fallbacks ───────────────────────────────────────────────
    if "challenge" in msg:
        return "CHALLENGE_REQUIRED"
    if "two_factor" in msg or "two factor" in msg or "2fa" in msg:
        return "TWO_FACTOR_REQUIRED"
    if "bad password" in msg or "wrong password" in msg:
        return "BAD_PASSWORD"
    if "login" in msg and ("required" in msg or "needed" in msg):
        return "SESSION_EXPIRED"

    # ── Timeouts ──────────────────────────────────────────────────────────────
    if "timeout" in type_name or "timed out" in msg or "timeout" in msg:
        return "TIMEOUT"

    # ── Network / connection (checked after RATE_LIMITED so MaxRetryError
    #    with 429 message doesn't land here) ───────────────────────────────────
    if any(x in type_name for x in ("connectionerror", "connecttimeout",
                                     "connectionreset", "networkxexception")):
        return "NETWORK_ERROR"
    if any(x in msg for x in ("connection refused", "connection reset",
                               "unreachable", "eof occurred", "broken pipe",
                               "name or service not known")):
        return "NETWORK_ERROR"

    return "UNKNOWN_ERROR"

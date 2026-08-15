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
import time
from typing import Dict, Optional
from instagrapi import Client

# pool: account_id → { "client": Client, "lock": asyncio.Lock }
_pool: Dict[str, dict] = {}
_pool_lock = asyncio.Lock()

# Pending two-factor challenges: account_id → {username, two_factor_identifier, expires_at}
# Stored in-memory only — never written to disk or database.
# Cleared on verification (success or failure) or after TTL expires.
_PENDING_2FA_TTL = 300  # 5 minutes
_pending_2fa: Dict[str, dict] = {}


async def get_entry(account_id: str) -> dict:
    """Get or create a pool entry for this account (creates isolated Client + Lock)."""
    async with _pool_lock:
        if account_id not in _pool:
            _pool[account_id] = {
                "client": Client(),
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


# ── Pending 2FA store ─────────────────────────────────────────────────────────

def store_pending_2fa(account_id: str, username: str, identifier: str) -> None:
    """
    Store the two_factor_identifier needed to complete a pending 2FA challenge.
    The password is deliberately NOT stored here.
    TTL: 5 minutes — after that the challenge must be restarted.
    """
    _pending_2fa[account_id] = {
        "username":            username,
        "two_factor_identifier": identifier,
        "expires_at":          time.time() + _PENDING_2FA_TTL,
    }


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

    IMPORTANT: check substrings in both the type name AND the message, because
    instagrapi sometimes wraps lower-level exceptions and the original type is
    lost. The message is lowercased for case-insensitive matching.
    """
    type_name = type(e).__name__.lower()
    msg       = str(e).lower()

    # ── Specific instagrapi exception types (most precise — check first) ──────
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

    # ── Fallback: classify by message content ─────────────────────────────────
    # 429 / rate-limiting — must appear before generic checks
    # The message "too many 429 error responses" contains "429" and "too many"
    if "429" in msg or "too many" in msg or "ratelimit" in type_name or "rate_limit" in msg:
        return "RATE_LIMITED"

    if "challenge" in msg:
        return "CHALLENGE_REQUIRED"
    if "two_factor" in msg or "two factor" in msg or "2fa" in msg:
        return "TWO_FACTOR_REQUIRED"
    if "bad password" in msg or "password" in msg:
        return "BAD_PASSWORD"
    if "login" in msg and ("required" in msg or "needed" in msg):
        return "SESSION_EXPIRED"

    if "timeout" in type_name or "timed out" in msg or "timeout" in msg:
        return "TIMEOUT"

    return "UNKNOWN_ERROR"

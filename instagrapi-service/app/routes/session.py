import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

# ── Instagrapi exceptions — module-level import (fail fast on startup) ────────
# Do NOT use a try/except ImportError fallback here. If instagrapi is not
# properly installed, the service must refuse to start — creating stub exception
# classes would silently swallow real Instagram exceptions in the wrong handler.
from instagrapi.exceptions import (
    BadPassword,
    ChallengeRequired,
    FeedbackRequired,
    LoginRequired,
    TwoFactorRequired,
)

from ..models import LoadRequest, EvictRequest, LoginRequest, TwoFactorVerifyRequest
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/session")


# ── /session/load ──────────────────────────────────────────────────────────────

@router.post("/load")
async def load_session(body: LoadRequest):
    """
    Load a previously-saved session (fetched from MongoDB by Node.js) into the in-memory pool.
    Idempotent — safe to call again after a Python service restart.
    """
    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            client.set_settings(body.settings)
            if body.proxy:
                client.set_proxy(body.proxy)
        except Exception as e:
            logger.exception("load_session: set_settings failed for %s", body.account_id)
            raise HTTPException(status_code=422, detail=f"Configurações de sessão inválidas: {e}")
    return {"ok": True}


# ── /session/status ────────────────────────────────────────────────────────────

@router.get("/status")
async def session_status(account_id: str):
    """Return whether this account has a client loaded in the in-memory pool."""
    return {"loaded": session_pool.is_loaded(account_id)}


# ── /session/login ─────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest):
    """
    Perform a fresh login with username + password.

    Returns:
    - HTTP 200 {"status": "AUTHENTICATED", "settings": {...}} on success
    - HTTP 202 {"status": "TWO_FACTOR_REQUIRED"}  — user must supply the 2FA code
    - HTTP 429 {"code": "RATE_LIMITED", ...}       — Instagram rate-limited this IP
    - HTTP 428 {"code": "CHALLENGE_REQUIRED", ...} — challenge required in the app
    - HTTP 422 {"code": "BAD_PASSWORD", ...}       — wrong credentials
    - HTTP 403 {"code": "FEEDBACK_REQUIRED", ...}  — Instagram action block

    SECURITY: the password travels in-memory only — it is NEVER stored or logged.
    Only account_id and error type/code are written to logs.
    """
    session_pool._slog("LOGIN_ATTEMPT", body.account_id, username=body.username)

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        if body.proxy:
            client.set_proxy(body.proxy)
        try:
            client.login(
                body.username,
                body.password,
                verification_code=body.verification_code or "",
            )
        except TwoFactorRequired as e:
            identifier = getattr(e, "two_factor_identifier", "") or ""
            # Store the identifier (NOT the password) for the verify-2fa step
            session_pool.store_pending_2fa(body.account_id, body.username, identifier)
            logger.info(
                "login: TWO_FACTOR_REQUIRED for account %s (type=%s)",
                body.account_id, type(e).__name__,
            )
            return JSONResponse(status_code=202, content={
                "status":  "TWO_FACTOR_REQUIRED",
                "message": "Digite o código enviado pelo seu método de autenticação.",
            })
        except Exception as e:
            code = session_pool.classify_error(e)
            # Log only the error code and type — never the full message (may contain credentials)
            logger.warning(
                "login: %s for account %s (type=%s)",
                code, body.account_id, type(e).__name__,
            )
            _raise_for_code(code)

        settings = client.get_settings()

    session_pool._slog("LOGIN_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/verify-2fa ────────────────────────────────────────────────────────

@router.post("/verify-2fa")
async def verify_2fa(body: TwoFactorVerifyRequest):
    """
    Complete a pending two-factor-authentication challenge.

    Must be called after /session/login returned TWO_FACTOR_REQUIRED.
    The pending challenge expires after 5 minutes — if expired, restart the login.
    Returns the same shape as a successful /session/login.
    """
    pending = session_pool.get_pending_2fa(body.account_id)
    if not pending:
        raise HTTPException(status_code=400, detail={
            "code":    "NO_PENDING_2FA",
            "message": "Nenhum desafio 2FA pendente. Faça o login novamente.",
        })

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            identifier = pending.get("two_factor_identifier", "") or ""
            # Use keyword arguments — positional order varies between instagrapi versions.
            # identifier defaults to "" when not available; instagrapi handles the empty case.
            client.two_factor_login(
                verification_code=body.verification_code,
                two_factor_identifier=identifier,
            )
        except HTTPException:
            raise
        except Exception as e:
            code = session_pool.classify_error(e)
            logger.warning(
                "verify-2fa: %s for account %s (type=%s)",
                code, body.account_id, type(e).__name__,
            )
            session_pool.clear_pending_2fa(body.account_id)
            _raise_for_code(code)
        finally:
            session_pool.clear_pending_2fa(body.account_id)

        settings = client.get_settings()

    session_pool._slog("VERIFY_2FA_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/evict ─────────────────────────────────────────────────────────────

@router.post("/evict")
async def evict_session(body: EvictRequest):
    """Evict an account's client from the pool after Node.js calls SessionManager.invalidate()."""
    await session_pool.remove_entry(body.account_id)
    return {"ok": True}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _raise_for_code(code: str) -> None:
    """Raise the appropriate HTTPException for a given error code."""
    _STATUS = {
        "RATE_LIMITED":       429,
        "CHALLENGE_REQUIRED": 428,
        "BAD_PASSWORD":       422,
        "FEEDBACK_REQUIRED":  403,
        "SESSION_EXPIRED":    422,
        "TIMEOUT":            504,
        "PROXY_ERROR":        502,
        "NETWORK_ERROR":      503,
        "LOGIN_IN_PROGRESS":  409,
        # TWO_FACTOR_REQUIRED is handled before this function is called — 202 is not an error
    }
    http_status = _STATUS.get(code, 422)  # fallback 422, not 401 (401 triggers SaaS logout)
    raise HTTPException(status_code=http_status, detail={"code": code, "message": ""})

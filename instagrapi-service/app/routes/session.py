import logging
from fastapi import APIRouter, HTTPException
from ..models import LoadRequest, EvictRequest, LoginRequest
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/session")


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


@router.get("/status")
async def session_status(account_id: str):
    """Return whether this account has a client loaded in the in-memory pool."""
    return {"loaded": session_pool.is_loaded(account_id)}


@router.post("/login")
async def login(body: LoginRequest):
    """
    Perform a fresh login with username + password.
    Returns the resulting session settings so Node.js can persist them to MongoDB.
    The password is NEVER stored or logged — it travels in-memory only.
    """
    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        if body.proxy:
            client.set_proxy(body.proxy)
        try:
            client.login(body.username, body.password)
        except Exception as e:
            logger.error("login: failed for account %s — %s: %s", body.account_id, type(e).__name__, e)
            error_msg = str(e)
            code = session_pool.classify_error(e)
            status = 428 if code == "CHALLENGE_REQUIRED" else 401
            raise HTTPException(status_code=status, detail={"code": code, "message": error_msg})
        settings = client.get_settings()
    return {"settings": settings}


@router.post("/evict")
async def evict_session(body: EvictRequest):
    """Evict an account's client from the pool after Node.js calls SessionManager.invalidate()."""
    await session_pool.remove_entry(body.account_id)
    return {"ok": True}

import inspect
import logging
from fastapi import FastAPI
from .routes import session, publish

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="InstagrapiService",
    # Disable Swagger/ReDoc — internal service, not externally exposed
    docs_url=None,
    redoc_url=None,
)

app.include_router(session.router)
app.include_router(publish.router)


@app.on_event("startup")
async def _startup_diagnostics():
    """Log instagrapi version and two_factor_login signature for container verification."""
    try:
        import instagrapi
        version = getattr(instagrapi, "__version__", "unknown")
        logger.info("STARTUP instagrapi version=%s", version)
    except Exception as e:
        logger.error("STARTUP could not read instagrapi version: %s", e)

    try:
        from instagrapi import Client
        sig = inspect.signature(Client.two_factor_login)
        logger.info("STARTUP two_factor_login signature: %s", sig)
    except Exception as e:
        logger.error("STARTUP could not inspect two_factor_login: %s", e)

    try:
        from instagrapi.exceptions import (
            TwoFactorRequired, ChallengeRequired, BadPassword,
            FeedbackRequired, LoginRequired,
        )
        logger.info(
            "STARTUP exceptions OK: TwoFactorRequired=%s ChallengeRequired=%s"
            " BadPassword=%s FeedbackRequired=%s LoginRequired=%s",
            TwoFactorRequired.__module__, ChallengeRequired.__module__,
            BadPassword.__module__, FeedbackRequired.__module__,
            LoginRequired.__module__,
        )
    except ImportError as e:
        logger.critical("STARTUP exception import failed — service will not function correctly: %s", e)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

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
    # instagrapi não expõe __version__ de forma confiável — os metadados do pacote
    # sim. Saber a versão instalada importa: assinaturas de métodos e a string de
    # versão do app Instagram mudam entre releases, e é isso que decide se o
    # payload de login é aceito.
    try:
        from importlib.metadata import version as _pkg_version
        logger.info("STARTUP instagrapi version=%s", _pkg_version("instagrapi"))
    except Exception:
        try:
            import instagrapi
            logger.info(
                "STARTUP instagrapi version=%s (via __version__)",
                getattr(instagrapi, "__version__", "unknown"),
            )
        except Exception as e:
            logger.error("STARTUP could not read instagrapi version: %s", e)

    # Versão do app Instagram que vai no payload de login. Se o Instagram
    # descontinuar essa build, o login por senha é recusado enquanto o site segue
    # funcionando — sintoma que se confunde com senha incorreta.
    try:
        from instagrapi import config as _ig_config
        dev = getattr(_ig_config, "DEVICE_SETTINGS", {}) or {}
        logger.info(
            "STARTUP app_version=%s version_code=%s device=%s/%s",
            dev.get("app_version"), dev.get("version_code"),
            dev.get("manufacturer"), dev.get("model"),
        )
    except Exception as e:
        logger.warning("STARTUP could not read DEVICE_SETTINGS: %s", e)

    try:
        from instagrapi import Client
        sig = inspect.signature(Client._login_with_bloks_two_factor)
        logger.info("STARTUP _login_with_bloks_two_factor signature: %s", sig)
    except Exception as e:
        logger.error("STARTUP could not inspect _login_with_bloks_two_factor: %s", e)

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

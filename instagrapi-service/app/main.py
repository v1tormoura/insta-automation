import inspect
import logging
from fastapi import FastAPI
from .routes import session, publish, profile, insights, warmup

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
app.include_router(profile.router)
app.include_router(insights.router)
app.include_router(warmup.router)


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

    # Build do app Instagram que vai no payload de login. Se o Instagram
    # descontinuar essa build, o login por senha é recusado enquanto o site segue
    # funcionando — sintoma que se confunde com senha incorreta.
    # app_version não está em config.DEVICE_SETTINGS: entra em device_settings do
    # client via set_app(), então lemos de um client real.
    try:
        from instagrapi import Client as _C
        from instagrapi import config as _ig_config
        from . import session_pool as _sp

        _probe = _C()
        efetiva = _sp.apply_app_version(_probe)
        dev = getattr(_probe, "device_settings", {}) or {}
        logger.info(
            "STARTUP app_version=%s version_code=%s device=%s %s",
            efetiva, dev.get("version_code"), dev.get("manufacturer"), dev.get("model"),
        )
        # O contexto regional entra no log porque a divergência entre ele e a
        # origem real do IP é invisível no código e decisiva no login: um
        # cliente en_US/US saindo de um IP brasileiro para uma conta
        # brasileira é recusado com bad_password mesmo com a senha certa.
        regiao = _sp.aplicar_regiao(_probe)
        logger.info(
            "STARTUP regiao country=%s ddi=%s locale=%s tz=%s (%s)",
            regiao["country"], regiao["country_code"], regiao["locale"],
            regiao["timezone_offset"], regiao["timezone_name"],
        )
        logger.info("STARTUP user_agent=%s", getattr(_probe, "user_agent", None))
        logger.info(
            "STARTUP builds disponiveis=%s",
            ",".join((getattr(_ig_config, "APP_SETTINGS", {}) or {}).keys()),
        )
    except Exception as e:
        logger.warning("STARTUP could not read app build: %s", e)

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

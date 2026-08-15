import logging
from fastapi import FastAPI
from .routes import session, publish

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

app = FastAPI(
    title="InstagrapiService",
    # Disable Swagger/ReDoc — internal service, not externally exposed
    docs_url=None,
    redoc_url=None,
)

app.include_router(session.router)
app.include_router(publish.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

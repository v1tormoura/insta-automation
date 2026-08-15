import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException
from ..models import PublishReelRequest, PublishPostRequest
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publish")


def _resolve_file(raw_path: str) -> Path:
    p = Path(raw_path)
    if not p.exists():
        raise HTTPException(status_code=422, detail=f"Arquivo de mídia não encontrado: {raw_path}")
    return p


@router.post("/reel")
async def publish_reel(body: PublishReelRequest):
    """
    Upload a video as a Reel.
    Requires the session to be loaded first via POST /session/load.
    Returns { media_id, settings } — Node.js persists the updated settings to MongoDB.
    """
    if not session_pool.is_loaded(body.account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de publicar"},
        )

    media_path = _resolve_file(body.media_path)
    cover_path: Path | None = None
    if body.cover_path:
        cp = Path(body.cover_path)
        cover_path = cp if cp.exists() else None  # cover is optional — ignored if missing

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            media = client.clip_upload(
                path=media_path,
                caption=body.caption or "",
                thumbnail=cover_path,
            )
        except Exception as e:
            logger.exception("publish_reel: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)})
        settings = client.get_settings()

    return {"media_id": str(media.pk), "settings": settings}


@router.post("/post")
async def publish_post(body: PublishPostRequest):
    """
    Upload an image as a feed Post.
    Requires the session to be loaded first via POST /session/load.
    Returns { media_id, settings } — Node.js persists the updated settings to MongoDB.
    """
    if not session_pool.is_loaded(body.account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de publicar"},
        )

    media_path = _resolve_file(body.media_path)

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            media = client.photo_upload(path=media_path, caption=body.caption or "")
        except Exception as e:
            logger.exception("publish_post: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)})
        settings = client.get_settings()

    return {"media_id": str(media.pk), "settings": settings}

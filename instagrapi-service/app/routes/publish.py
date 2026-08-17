import asyncio
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException

from instagrapi.types import StoryLink

from ..models import PublishReelRequest, PublishPostRequest, PublishStoryRequest
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


_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm"}


@router.post("/story")
async def publish_story(body: PublishStoryRequest):
    """
    Publica um story — foto ou vídeo — opcionalmente com link sticker.

    O tipo é decidido pela extensão do arquivo. O link vira um StorySticker do
    tipo "story_link", montado pela própria biblioteca a partir de StoryLink.

    O Instagram exige elegibilidade da conta para o link sticker (em geral 10 mil
    seguidores ou verificação). Sem isso ele recusa — o erro é propagado em vez de
    publicar silenciosamente sem o link, para o usuário saber o que aconteceu.

    Requer sessão carregada via POST /session/load.
    Devolve { media_id, with_link, settings }.
    """
    if not session_pool.is_loaded(body.account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de publicar"},
        )

    media_path = _resolve_file(body.media_path)
    is_video   = media_path.suffix.lower() in _VIDEO_SUFFIXES

    links: list[StoryLink] = []
    if body.link_url:
        try:
            links = [StoryLink(webUri=body.link_url)]
        except Exception as e:
            raise HTTPException(
                status_code=422,
                detail={"code": "INVALID_LINK", "message": f"URL de link inválida: {e}"},
            )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop   = asyncio.get_running_loop()

        def _upload():
            # Upload é I/O de rede longo — vai para thread, senão congela o event
            # loop e o serviço para de responder durante a publicação.
            if is_video:
                return client.video_upload_to_story(
                    path=media_path, caption=body.caption or "", links=links
                )
            return client.photo_upload_to_story(
                path=media_path, caption=body.caption or "", links=links
            )

        try:
            media = await loop.run_in_executor(None, _upload)
        except Exception as e:
            logger.exception("publish_story: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)[:300]})
        settings = client.get_settings()

    return {"media_id": str(media.pk), "with_link": bool(links), "settings": settings}


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

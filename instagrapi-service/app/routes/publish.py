import asyncio
import logging
from contextlib import contextmanager
from pathlib import Path
from fastapi import APIRouter, HTTPException

from instagrapi.types import StoryLink

from ..models import (
    PublishReelRequest,
    PublishPostRequest,
    PublishStoryRequest,
    PublishCommentRequest,
)
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publish")


def _resolve_file(raw_path: str) -> Path:
    p = Path(raw_path)
    if not p.exists():
        raise HTTPException(status_code=422, detail=f"Arquivo de mídia não encontrado: {raw_path}")
    return p


def _identificacao(media) -> dict:
    """
    Identificação da mídia publicada.

    `media_id` continua sendo o pk puro — é o que os chamadores atuais leem, e
    mudá-lo quebraria compatibilidade. `media_full_id` é a forma "pk_userid",
    que é o que media_comment() precisa: recebendo só o pk, a biblioteca chama
    media_user() para descobrir o dono e gasta uma requisição a mais.

    `media_code` é o shortcode da URL pública, útil para o painel.
    """
    return {
        "media_id":      str(media.pk),
        "media_full_id": str(getattr(media, "id", "") or media.pk),
        "media_code":    str(getattr(media, "code", "") or ""),
    }


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

    return {**_identificacao(media), "settings": settings}


_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm"}


@contextmanager
def _tolerate_link_validation(client):
    """
    Impede que a validação de URL do link sticker aborte o story.

    Antes de montar o sticker, a biblioteca chama media/validate_reel_url/ e
    DESCARTA a resposta — mas uma exceção ali propaga e derruba o upload inteiro.
    Efeito: conta que o Instagram não deixa validar URL não consegue postar o
    story de jeito nenhum, nem sem o link.

    Como a resposta é ignorada de qualquer forma, tratamos a falha dessa chamada
    específica como não-fatal e seguimos com o sticker. Isso não burla permissão:
    se o Instagram realmente recusar o link, a recusa vem no configure seguinte,
    com erro real, e é propagada normalmente.

    O patch é restrito a esse endpoint e revertido no finally.
    """
    original = client.private_request

    def _wrapper(endpoint, *args, **kwargs):
        if isinstance(endpoint, str) and "validate_reel_url" in endpoint:
            try:
                return original(endpoint, *args, **kwargs)
            except Exception as e:  # noqa: BLE001
                logger.info(
                    "story link: validate_reel_url falhou (%s) — seguindo, resposta é descartada",
                    type(e).__name__,
                )
                return {}
        return original(endpoint, *args, **kwargs)

    client.private_request = _wrapper
    try:
        yield
    finally:
        client.private_request = original


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
        # A posição do sticker vem do próprio StoryLink: photo_configure_to_story
        # monta a StorySticker com x/y/z/width/height/rotation lidos daqui.
        # Campos ausentes ficam com o padrão do modelo (sticker centralizado).
        posicao = {
            chave: valor
            for chave, valor in (
                ("x",        body.link_x),
                ("y",        body.link_y),
                ("width",    body.link_width),
                ("height",   body.link_height),
                ("rotation", body.link_rotation),
            )
            if valor is not None
        }
        try:
            links = [StoryLink(webUri=body.link_url, **posicao)]
        except Exception as e:
            raise HTTPException(
                status_code=422,
                detail={"code": "INVALID_LINK", "message": f"Link inválido: {e}"},
            )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop   = asyncio.get_running_loop()

        def _upload():
            # Upload é I/O de rede longo — vai para thread, senão congela o event
            # loop e o serviço para de responder durante a publicação.
            with _tolerate_link_validation(client):
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

    return {**_identificacao(media), "settings": settings}


@router.post("/comment")
async def publish_comment(body: PublishCommentRequest):
    """
    Comenta em uma mídia específica.

    A mídia é identificada pelo id que a própria publicação devolveu — nunca
    por "a mais recente da conta". Com várias publicações da mesma conta numa
    campanha, procurar a mais recente comentaria no post errado sempre que duas
    saíssem próximas.

    Usa o MESMO lock por conta do publish (entry["lock"]), então comentário e
    publicação nunca disputam o mesmo Client. O atraso do comentário não é
    esperado aqui: quem segura o tempo é o delay do job no BullMQ.

    Método: Client.media_comment(media_id, text) — instagrapi 2.18.16.
    Devolve { status, comment_id, media_id, settings }.
    """
    if not session_pool.is_loaded(body.account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de comentar"},
        )

    texto = (body.text or "").strip()
    if not texto:
        raise HTTPException(
            status_code=422,
            detail={"code": "COMMENT_EMPTY", "message": "Texto do comentário vazio"},
        )

    media_id = (body.media_id or "").strip()
    if not media_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "COMMENT_MEDIA_NOT_FOUND", "message": "media_id ausente"},
        )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            comment = client.media_comment(media_id, texto)
        except Exception as e:
            logger.exception("publish_comment: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            # A mídia pode ter sido apagada entre publicar e comentar. Isso é um
            # estado do conteúdo, não da sessão — separar evita que o painel
            # mande reconectar uma conta que está perfeitamente saudável.
            msg = str(e)
            if code in ("UNKNOWN_ERROR", "BAD_REQUEST") and _midia_ausente(msg):
                code = "COMMENT_MEDIA_NOT_FOUND"
            raise HTTPException(status_code=422, detail={"code": code, "message": msg[:300]})
        settings = client.get_settings()

    session_pool._slog(
        "COMMENT_PUBLISHED",
        body.account_id,
        media_id=media_id,
        comment_id=str(getattr(comment, "pk", "") or ""),
    )

    return {
        "status":     "COMMENT_PUBLISHED",
        "comment_id": str(getattr(comment, "pk", "") or ""),
        "media_id":   media_id,
        "settings":   settings,
    }


def _midia_ausente(msg: str) -> bool:
    """Reconhece a mídia apagada/indisponível a partir da mensagem do Instagram."""
    m = msg.lower()
    return any(x in m for x in (
        "media not found", "media_not_found", "does not exist",
        "unable to find", "invalid media_id", "media has been deleted",
    ))

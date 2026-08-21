import asyncio
import logging
from contextlib import contextmanager
from json import dumps
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


def _normalizar_url(bruta: str) -> str:
    if not bruta.startswith("http://") and not bruta.startswith("https://"):
        return "https://" + bruta
    return bruta


def _geometria_link(body) -> dict:
    """
    Caixa do link em coordenadas normalizadas (x/y = centro), como o Instagram usa.

    Quando o Node queima a figurinha na mídia, manda aqui a caixa exata que
    desenhou — assim a área de toque cai em cima da pílula que aparece.
    """
    return {
        "x":        body.link_x      if body.link_x      is not None else 0.5,
        "y":        body.link_y      if body.link_y      is not None else 0.8,
        "width":    body.link_width  if body.link_width  is not None else 0.5,
        "height":   body.link_height if body.link_height is not None else 0.06,
        "rotation": body.link_rotation if body.link_rotation is not None else 0.0,
    }


def _payload_sticker_nativo(link_url: str, link_text: str | None, caixa: dict) -> dict:
    """
    Figurinha de link no formato que o PRÓPRIO Instagram devolve ao ler um story.

    A instagrapi 2.18.16 escreve o link só em `tap_models` (mixins/photo.py,
    bloco `if links:`) — isso cria a área clicável, mas não é o campo que o app
    de quem assiste usa para desenhar. O campo de leitura é `story_link_stickers`
    (extractors.py:640, `sticker["story_link"]["url"]`), e é ele que montamos
    aqui, com a mesma forma do modelo StorySticker/StoryStickerLink.

    Só é enviado nos modos "native"/"both" — em "burned" a pílula já está nos
    pixels e mandar isto renderizaria uma segunda figurinha por cima.
    """
    display = link_url.split("://", 1)[-1].split("/", 1)[0]
    return {
        "x": caixa["x"],
        "y": caixa["y"],
        "z": 0,
        "width": caixa["width"],
        "height": caixa["height"],
        "rotation": caixa["rotation"],
        "type": "story_link",
        "is_sticker": True,
        "tap_state": 0,
        "tap_state_str_id": "link_sticker_default",
        "story_link": {
            "url": link_url,
            "link_title": (link_text or display)[:35],
            "link_type": "web",
            "display_url": display,
        },
    }


_SINAIS_DE_LINK = (
    "link", "sticker", "url", "cta", "not eligible", "swipe",
)
_SINAIS_DE_CONTA = (
    "challenge", "checkpoint", "login_required", "feedback_required",
    "please wait", "rate limit", "too many", "spam", "consent",
)


def _falha_por_causa_do_link(erro: Exception) -> bool:
    """
    Diz se vale republicar sem o metadado do link.

    Republicar é um upload a mais na conta — só compensa quando o problema foi
    o link. Bloqueio de conta, desafio ou limite de ação vão falhar de novo e
    ainda contam como mais uma ação para o Instagram, então esses propagam.
    """
    msg = str(erro).lower()
    if any(s in msg for s in _SINAIS_DE_CONTA):
        return False
    return any(s in msg for s in _SINAIS_DE_LINK)


def _conferir_link_nativo(client, media_pk: str) -> bool | None:
    """
    Relê o story publicado e diz se o Instagram registrou uma figurinha de link
    de verdade (`story_link_stickers`) ou só a área de toque.

    É diagnóstico: nunca derruba a publicação. `None` = não deu para conferir.
    """
    try:
        resposta = client.private_request(f"media/{media_pk}/info/")
        itens = (resposta or {}).get("items") or []
        if not itens:
            return None
        item = itens[0]
        stickers = item.get("story_link_stickers") or []
        logger.info(
            "publish_story: releitura de %s — story_link_stickers=%d, story_cta=%d",
            media_pk, len(stickers), len(item.get("story_cta") or []),
        )
        return bool(stickers)
    except Exception as e:  # noqa: BLE001
        logger.info("publish_story: não foi possível reler o story (%s)", type(e).__name__)
        return None


@router.post("/story")
async def publish_story(body: PublishStoryRequest):
    """
    Publica um story — foto ou vídeo — opcionalmente com figurinha de link.

    Modos (`link_sticker_mode`):
      • burned (padrão) — a pílula já vem queimada nos pixels pelo Node; aqui só
        vai a área de toque nativa (`tap_models` da instagrapi). Visível e
        clicável, sem depender de o Instagram desenhar coisa alguma.
      • native — não há pílula queimada; mandamos `story_link_stickers` para o
        Instagram desenhar a figurinha dele.
      • both — os dois, para comparar. Pode sair figurinha duplicada.
    """
    if not session_pool.is_loaded(body.account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de publicar"},
        )

    media_path = _resolve_file(body.media_path)
    is_video   = media_path.suffix.lower() in _VIDEO_SUFFIXES

    modo  = (body.link_sticker_mode or "burned").strip().lower()
    if modo not in ("burned", "native", "both"):
        modo = "burned"

    links: list[StoryLink] = []
    extra_data: dict = {}
    if body.link_url:
        link_url = _normalizar_url(body.link_url)
        caixa    = _geometria_link(body)

        links.append(StoryLink(
            webUri=link_url,
            x=caixa["x"],
            y=caixa["y"],
            z=0,
            width=caixa["width"],
            height=caixa["height"],
            rotation=caixa["rotation"],
        ))

        if modo in ("native", "both"):
            extra_data["story_link_stickers"] = dumps(
                [_payload_sticker_nativo(link_url, body.link_text, caixa)]
            )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop   = asyncio.get_running_loop()

        def _enviar(com_link: bool):
            usar_links = links if com_link else []
            usar_extra = extra_data if com_link else {}
            if is_video:
                return client.video_upload_to_story(
                    path=media_path, caption=body.caption or "",
                    links=usar_links, extra_data=usar_extra,
                )
            return client.photo_upload_to_story(
                path=media_path, caption=body.caption or "",
                links=usar_links, extra_data=usar_extra,
            )

        def _upload():
            # A validação de URL do Instagram não pode derrubar o story: a
            # resposta é descartada pela biblioteca de qualquer forma.
            with _tolerate_link_validation(client):
                try:
                    return _enviar(com_link=True), True
                except Exception as erro_link:  # noqa: BLE001
                    if not links or not _falha_por_causa_do_link(erro_link):
                        raise
                    # A pílula queimada continua na imagem — publicar sem o
                    # metadado é melhor do que perder o story inteiro.
                    logger.warning(
                        "publish_story: envio com link falhou (%s) — republicando sem o metadado do link",
                        erro_link,
                    )
                    return _enviar(com_link=False), False

        try:
            media, com_link = await loop.run_in_executor(None, _upload)
        except Exception as e:
            logger.exception("publish_story: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)[:300]})

        link_nativo = None
        if com_link and links:
            link_nativo = await loop.run_in_executor(
                None, _conferir_link_nativo, client, str(media.pk)
            )

        settings = client.get_settings()

    return {
        "media_id":    str(media.pk),
        "with_link":   bool(links) and com_link,
        "link_mode":   modo,
        "link_native": link_nativo,
        "settings":    settings,
    }


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


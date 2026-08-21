import asyncio
import logging
from fastapi import APIRouter, HTTPException

from ..models import StoryInsightsRequest
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/insights")


# ── Por que este endpoint existe ─────────────────────────────────────────────
#
# A contagem de visualizações do story NÃO chega pelo caminho normal da
# biblioteca. `client.user_stories()` devolve objetos `Story`, e o modelo Story
# (types.py) não tem campo de audiência — o extractor (`extract_story_v1`) lê o
# item cru, monta o objeto e DESCARTA os contadores que vieram junto.
#
# Então lemos o endpoint privado direto e pegamos os campos que o extractor
# joga fora. São dois caminhos, do mais barato para o mais caro:
#
#   1. `feed/user/{user_id}/story/` — UMA requisição traz todos os stories
#      ativos da conta. Nos stories do PRÓPRIO usuário, cada item carrega a
#      audiência (`viewer_count` / `total_viewer_count`).
#
#   2. `media/{pk}/list_reel_media_viewer/` — a lista de quem viu. Uma
#      requisição POR story, então só é usada quando (1) não trouxe o número.
#      A primeira página já contém o total (`user_count`/`total_viewer_count`),
#      não é preciso paginar a lista inteira.
#
# O nome do campo varia entre versões do app do Instagram, por isso a leitura é
# por lista de candidatos e o resultado diz de onde veio (`fonte`) — assim dá
# para saber, pelo log de produção, qual caminho está realmente funcionando em
# vez de supor.

_CAMPOS_AUDIENCIA = (
    "viewer_count",
    "total_viewer_count",
    "seen_count",
    "view_count",
)

_CAMPOS_TOTAL_VIEWERS = (
    "user_count",
    "total_viewer_count",
    "viewer_count",
)


def _primeiro_numero(dados: dict, campos) -> int | None:
    """Primeiro campo presente com valor numérico não negativo."""
    for campo in campos:
        valor = dados.get(campo)
        if isinstance(valor, bool):
            continue
        if isinstance(valor, (int, float)) and valor >= 0:
            return int(valor)
        if isinstance(valor, str) and valor.isdigit():
            return int(valor)
    return None


def _audiencia_pela_lista(client, story_pk: str) -> int | None:
    """
    Total de espectadores pela lista de quem viu.

    Só a PRIMEIRA página é lida: o total vem no corpo da resposta, e paginar a
    lista inteira gastaria uma requisição por página para chegar ao mesmo
    número. `len(viewers)` é o último recurso, e só vale quando não há próxima
    página — senão contaria só a primeira fatia.
    """
    try:
        resposta = client.private_request(f"media/{story_pk}/list_reel_media_viewer/")
    except Exception as e:  # noqa: BLE001
        logger.info("story_insights: list_reel_media_viewer falhou em %s (%s)", story_pk, type(e).__name__)
        return None

    if not isinstance(resposta, dict):
        return None

    total = _primeiro_numero(resposta, _CAMPOS_TOTAL_VIEWERS)
    if total is not None:
        return total

    viewers = resposta.get("viewers")
    if isinstance(viewers, list) and not resposta.get("next_max_id"):
        return len(viewers)
    return None


@router.post("/stories")
async def story_insights(body: StoryInsightsRequest):
    """
    Audiência dos stories ATIVOS da conta (janela de 24h do Instagram).

    Story publicado há mais de 24h não existe mais para o Instagram — não há
    endpoint que devolva o histórico. Por isso quem chama precisa persistir o
    número: este endpoint é uma fotografia do momento, e a contagem só cresce
    enquanto o story está no ar.
    """
    if not session_pool.is_loaded(body.account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de ler insights"},
        )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop = asyncio.get_running_loop()

        def _coletar():
            user_id = client.user_id
            if not user_id:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "NO_USER_ID", "message": "Sessão sem user_id — refaça o login da conta."},
                )

            reel = client.private_request(f"feed/user/{user_id}/story/").get("reel") or {}
            itens = reel.get("items") or []

            saida = []
            for item in itens:
                pk = str(item.get("pk") or "")
                if not pk:
                    continue

                audiencia = _primeiro_numero(item, _CAMPOS_AUDIENCIA)
                fonte = "reel" if audiencia is not None else None

                # Só cai para a lista de espectadores quando o feed não trouxe o
                # número — é uma requisição a mais por story.
                if audiencia is None and body.detalhar_faltantes:
                    audiencia = _audiencia_pela_lista(client, pk)
                    if audiencia is not None:
                        fonte = "viewer_list"

                saida.append({
                    "story_id":      pk,
                    "code":          str(item.get("code") or ""),
                    "taken_at":      item.get("taken_at"),
                    "media_type":    item.get("media_type"),
                    "thumbnail_url": _melhor_thumb(item),
                    "viewers":       audiencia,
                    "fonte":         fonte,
                })

            return saida, reel

        try:
            stories, reel = await loop.run_in_executor(None, _coletar)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("story_insights: falhou para a conta %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)[:300]})

        settings = client.get_settings()

    com_numero = [s for s in stories if s["viewers"] is not None]
    logger.info(
        "story_insights: conta=%s stories=%d com_audiencia=%d fontes=%s",
        body.account_id, len(stories), len(com_numero),
        sorted({s["fonte"] for s in com_numero if s["fonte"]}),
    )

    return {
        "stories":  stories,
        "total":    len(stories),
        # Soma só o que tem número: contar story sem audiência como zero
        # rebaixaria o total e pareceria queda de alcance.
        "viewers":  sum(s["viewers"] for s in com_numero),
        "settings": settings,
    }


def _melhor_thumb(item: dict) -> str:
    """Maior candidata de imagem do item, ou vazio."""
    try:
        candidatas = (item.get("image_versions2") or {}).get("candidates") or []
        if not candidatas:
            return ""
        melhor = sorted(candidatas, key=lambda c: (c.get("height", 0) * c.get("width", 0)))[-1]
        return str(melhor.get("url") or "")
    except Exception:  # noqa: BLE001
        return ""

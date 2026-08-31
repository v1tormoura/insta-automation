import asyncio
import logging
from fastapi import APIRouter, HTTPException

from ..models import StoryInsightsRequest, MediaInsightsRequest
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


# ── Insight de PUBLICAÇÃO ─────────────────────────────────────────────────────
#
# ── Por que este endpoint existe
#
# Story e post tinham fontes diferentes, e só a de story funcionava sem token
# da Meta. O serviço de métricas de post exige `accessToken` + `igUserId`, o
# caminho Graph API — numa base só instagrapi ele encontrava zero contas e não
# fazia nada, para sempre. O painel mostrava "visualizações de post: LIGADO", e
# a opção não tinha como funcionar.
#
# ── Dois caminhos, e por que os dois
#
# 1. `insights_media(pk)` devolve ALCANCE e IMPRESSÕES de verdade, que é o que
#    o Instagram mostra ao dono do post. Só existe em conta profissional
#    (comercial ou criador de conteúdo) — numa conta pessoal a chamada falha, e
#    falhar é o comportamento correto dela.
#
# 2. Os contadores públicos do próprio objeto de mídia — curtidas, comentários
#    e reproduções — existem em qualquer conta.
#
# Tentamos (1) e caímos em (2). Cada item diz de onde veio cada número, porque
# a diferença importa: alcance ausente não é alcance zero, e tratar os dois
# como iguais faria o painel afirmar que ninguém viu a publicação.

_TIPO_POR_CODIGO = {1: "IMAGE", 2: "VIDEO", 8: "CAROUSEL_ALBUM"}


def _numero(*candidatos) -> int:
    """Primeiro candidato que seja número não nulo. Zero e None são diferentes:
    zero é medição, None é ausência, e a ordem dos candidatos existe para não
    confundir os dois."""
    for c in candidatos:
        if isinstance(c, (int, float)) and c is not None:
            return int(c)
    return 0


def _insights_da_midia(client, pk: str) -> dict | None:
    """Alcance e impressões reais. Devolve None quando a conta não é profissional."""
    fn = getattr(client, "insights_media", None)
    if not callable(fn):
        return None
    try:
        bruto = fn(pk) or {}
    except Exception as e:  # noqa: BLE001
        # Conta pessoal, post antigo demais ou endpoint mudado. Nenhum dos três
        # é erro nosso, e nenhum deve derrubar a leitura dos contadores.
        logger.info("insights_media indisponível em %s (%s)", pk, type(e).__name__)
        return None

    # A resposta aninha os números em `inline_insights_node.metrics`, e o
    # formato variou entre versões — por isso a busca é tolerante.
    no = bruto.get("inline_insights_node") or bruto
    metricas = no.get("metrics") if isinstance(no, dict) else None
    if not isinstance(metricas, dict):
        metricas = bruto if isinstance(bruto, dict) else {}

    alcance = _numero(metricas.get("reach_count"), metricas.get("reach"))
    impressoes = _numero(metricas.get("impression_count"), metricas.get("impressions"))
    salvos = _numero(metricas.get("save_count"), metricas.get("saved"))
    compart = _numero(metricas.get("share_count"), metricas.get("shares"))

    if not (alcance or impressoes):
        return None
    return {"reach": alcance, "impressions": impressoes, "saved": salvos, "shares": compart}


@router.post("/media")
async def media_insights(body: MediaInsightsRequest):
    """Métricas das publicações recentes da conta."""
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

            quantas = max(1, min(50, int(body.quantidade or 12)))
            midias = client.user_medias(user_id, amount=quantas)

            saida = []
            for m in midias:
                pk = str(getattr(m, "pk", "") or "")
                if not pk:
                    continue

                tipo = _TIPO_POR_CODIGO.get(getattr(m, "media_type", 1), "IMAGE")
                produto = str(getattr(m, "product_type", "") or "")
                # Reel é vídeo para efeito de métrica, mesmo quando o código do
                # tipo diz outra coisa — é o que a pessoa espera ver no painel.
                if produto in ("clips", "igtv"):
                    tipo = "VIDEO"

                reproducoes = _numero(getattr(m, "play_count", None), getattr(m, "view_count", None))
                curtidas = _numero(getattr(m, "like_count", None))
                comentarios = _numero(getattr(m, "comment_count", None))

                item = {
                    "media_id": pk,
                    "media_type": tipo,
                    "product_type": produto,
                    "code": str(getattr(m, "code", "") or ""),
                    "caption": (getattr(m, "caption_text", "") or "")[:2200],
                    "thumbnail_url": str(getattr(m, "thumbnail_url", "") or ""),
                    "taken_at": getattr(m, "taken_at", None).isoformat() if getattr(m, "taken_at", None) else None,
                    "like_count": curtidas,
                    "comment_count": comentarios,
                    "video_views": reproducoes,
                    "reach": 0,
                    "impressions": 0,
                    "saved_count": 0,
                    "share_count": 0,
                    "fonte": "contadores",
                }

                if body.tentar_insights:
                    extra = _insights_da_midia(client, pk)
                    if extra:
                        item.update({
                            "reach": extra["reach"],
                            "impressions": extra["impressions"],
                            "saved_count": extra["saved"],
                            "share_count": extra["shares"],
                            "fonte": "insights",
                        })

                saida.append(item)
            return saida

        try:
            itens = await loop.run_in_executor(None, _coletar)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            code = session_pool.classify_error(e)
            logger.warning("media_insights: %s para conta %s (%s)", code, body.account_id, type(e).__name__)
            raise HTTPException(status_code=502, detail={"code": code, "message": str(e)[:200]})

    comInsights = sum(1 for i in itens if i["fonte"] == "insights")
    logger.info(
        "media_insights: %s publicação(ões) da conta %s — %s com alcance real",
        len(itens), body.account_id, comInsights,
    )
    return {"itens": itens, "total": len(itens), "com_insights": comInsights}

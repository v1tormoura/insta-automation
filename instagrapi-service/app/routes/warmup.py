"""
Aquecimento pela API mobile.

── Por que estas rotas existem

O aquecimento nasceu preso à API oficial, e ali ele só alcança um lugar: os
comentários dos posts DA PRÓPRIA CONTA. Curtir a resposta de alguém no seu
próprio feed não é atividade orgânica — é a conta conversando consigo mesma, e
não se parece nem de longe com uma pessoa usando o aplicativo.

As duas ações que pareciam mobile — rolar Reels e curtir no Explorar — usavam a
biblioteca antiga do Node (`instagram-private-api`), que exige uma sessão que
quase nenhuma conta tem. Na prática caíam no `catch` e escreviam "requer sessão
privada" no log. O painel mostrava o aquecimento "ativo" com zero ação por
ciclo, indefinidamente.

── O que muda

Aqui estão as PRIMITIVAS: descobrir mídia, curtir, marcar como vista, seguir,
ver stories. Cada chamada faz uma coisa e volta.

O ritmo NÃO mora aqui. Quem decide quantas curtidas, com que intervalo e em que
ordem é o job do Node, que já tem os limites por intensidade, o registro no log
e a parada por duração. Um "ciclo completo" implementado neste serviço seria uma
segunda cópia dessa decisão, e duas cópias divergem — foi assim que o caminho
agendado de story ficou sem saber publicar.

── Sobre marcar como visto

`media_seen` e `story_seen` não são enfeite. Uma conta que curte sem nunca ter
visualizado nada tem um padrão de uso que nenhuma pessoa produz. Elas são a
parte barata e mais segura do aquecimento, e por isso entram sempre — inclusive
quando nenhuma curtida é pedida.
"""

import logging

from fastapi import APIRouter, HTTPException

from ..models import (
    WarmupDescobrirRequest,
    WarmupCurtirRequest,
    WarmupVistoRequest,
    WarmupSeguirRequest,
    WarmupStoriesRequest,
)
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/warmup")


def _exigir_sessao(account_id: str) -> None:
    if not session_pool.is_loaded(account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de aquecer"},
        )


def _erro(e: Exception, acao: str) -> HTTPException:
    code = session_pool.classify_error(e)
    return HTTPException(status_code=422, detail={"code": code, "message": f"{acao}: {str(e)[:300]}"})


def _resumir(media) -> dict:
    """
    O mínimo que o Node precisa para agir sobre uma mídia.

    Devolver o objeto inteiro da biblioteca traria dezenas de campos que
    ninguém lê e que mudam de versão para versão — o Node passaria a depender
    de um formato que não é contrato de ninguém.
    """
    usuario = getattr(media, "user", None)
    return {
        "media_id":   str(getattr(media, "id", "") or getattr(media, "pk", "")),
        "media_pk":   str(getattr(media, "pk", "")),
        "code":       str(getattr(media, "code", "") or ""),
        "media_type": int(getattr(media, "media_type", 0) or 0),
        "user_id":    str(getattr(usuario, "pk", "") or ""),
        "username":   str(getattr(usuario, "username", "") or ""),
        "like_count": int(getattr(media, "like_count", 0) or 0),
    }


@router.post("/descobrir")
async def descobrir(body: WarmupDescobrirRequest):
    """
    Devolve mídias para o ciclo agir sobre elas.

    Três fontes, e a escolha entre elas não é indiferente:

      reels    — `explore_reels`, o que o aplicativo mostraria a esta conta.
                 É o padrão porque não exige configuração nenhuma.
      hashtag  — `hashtag_medias_top`, quando você quer que o aquecimento
                 aconteça dentro de um assunto. Uma conta de moda curtindo
                 conteúdo de moda constrói um sinal; curtindo o que calhar,
                 não constrói nada.
      feed     — o próprio feed da conta, para contas que já seguem gente.

    A quantidade é limitada aqui também, e não só no Node: um `amount` grande
    vira uma varredura longa no Instagram, que é exatamente o que uma conta em
    aquecimento não deve fazer.
    """
    _exigir_sessao(body.account_id)
    quantidade = max(1, min(int(body.amount or 10), 30))

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            if body.fonte == "hashtag":
                nome = (body.hashtag or "").lstrip("#").strip()
                if not nome:
                    raise HTTPException(
                        status_code=422,
                        detail={"code": "WARMUP_SEM_HASHTAG",
                                "message": "A fonte 'hashtag' precisa de um assunto"},
                    )
                itens = client.hashtag_medias_top(nome, quantidade)

            elif body.fonte == "feed":
                cru = client.get_timeline_feed()
                itens = []
                for item in (cru.get("feed_items") or [])[: quantidade * 2]:
                    m = item.get("media_or_ad")
                    if not m or not m.get("pk"):
                        continue
                    dono = m.get("user") or {}
                    itens.append({
                        "media_id":   str(m.get("id") or m.get("pk")),
                        "media_pk":   str(m.get("pk")),
                        "code":       str(m.get("code") or ""),
                        "media_type": int(m.get("media_type") or 0),
                        "user_id":    str(dono.get("pk") or ""),
                        "username":   str(dono.get("username") or ""),
                        "like_count": int(m.get("like_count") or 0),
                    })
                    if len(itens) >= quantidade:
                        break
                settings = client.get_settings()
                return {"itens": itens, "fonte": "feed", "settings": settings}

            else:
                itens = client.explore_reels(quantidade)

        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception("warmup/descobrir falhou para a conta %s", body.account_id)
            raise _erro(e, "descobrir")

        settings = client.get_settings()

    return {
        "itens": [_resumir(m) for m in itens],
        "fonte": body.fonte or "reels",
        "settings": settings,
    }


@router.post("/curtir")
async def curtir(body: WarmupCurtirRequest):
    """Curte uma mídia. `media_id` vem do /descobrir."""
    _exigir_sessao(body.account_id)

    media_id = (body.media_id or "").strip()
    if not media_id:
        raise HTTPException(status_code=422,
                            detail={"code": "WARMUP_SEM_MIDIA", "message": "media_id ausente"})

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            ok = client.media_like(media_id)
        except Exception as e:  # noqa: BLE001
            logger.exception("warmup/curtir falhou para a conta %s", body.account_id)
            raise _erro(e, "curtir")
        settings = client.get_settings()

    session_pool._slog("WARMUP_LIKE", body.account_id, media_id=media_id, ok=bool(ok))
    return {"ok": bool(ok), "media_id": media_id, "settings": settings}


@router.post("/visto")
async def visto(body: WarmupVistoRequest):
    """
    Marca mídias como vistas.

    Barato e sem efeito visível para terceiros — ninguém recebe notificação de
    que você viu um post. É o que torna esta a ação mais segura do aquecimento,
    e a razão de ela valer a pena mesmo sozinha.
    """
    _exigir_sessao(body.account_id)

    ids = [str(m).strip() for m in (body.media_ids or []) if str(m).strip()]
    if not ids:
        return {"ok": True, "vistas": 0}

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            client.media_seen(ids[:30])
        except Exception as e:  # noqa: BLE001
            logger.exception("warmup/visto falhou para a conta %s", body.account_id)
            raise _erro(e, "marcar como visto")
        settings = client.get_settings()

    return {"ok": True, "vistas": len(ids[:30]), "settings": settings}


@router.post("/seguir")
async def seguir(body: WarmupSeguirRequest):
    """
    Segue um perfil.

    A ação mais arriscada do conjunto: é pública, é a que o Instagram mais
    vigia, e é irreversível sem outra ação. O limite de quantas por ciclo é
    decidido pelo Node — aqui só se executa uma de cada vez, de propósito, para
    que não exista um caminho que siga vinte perfis numa chamada só.
    """
    _exigir_sessao(body.account_id)

    user_id = (body.user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=422,
                            detail={"code": "WARMUP_SEM_USUARIO", "message": "user_id ausente"})

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            ok = client.user_follow(user_id)
        except Exception as e:  # noqa: BLE001
            logger.exception("warmup/seguir falhou para a conta %s", body.account_id)
            raise _erro(e, "seguir")
        settings = client.get_settings()

    session_pool._slog("WARMUP_FOLLOW", body.account_id, user_id=user_id, ok=bool(ok))
    return {"ok": bool(ok), "user_id": user_id, "settings": settings}


@router.post("/stories")
async def stories(body: WarmupStoriesRequest):
    """
    Vê os stories de um perfil.

    Duas etapas de propósito: buscar os stories e marcá-los como vistos. Sem a
    segunda, nada aconteceu do ponto de vista do Instagram — a busca sozinha não
    registra visualização, e o aquecimento pareceria estar rodando sem produzir
    o sinal que justifica rodá-lo.

    Um perfil sem stories no ar não é erro: é o caso mais comum. Devolve zero e
    o ciclo segue para o próximo.
    """
    _exigir_sessao(body.account_id)

    user_id = (body.user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=422,
                            detail={"code": "WARMUP_SEM_USUARIO", "message": "user_id ausente"})

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            lista = client.user_stories(user_id, int(body.amount or 5))
            pks = [int(s.pk) for s in lista][:10]
            if pks:
                client.story_seen(pks)
        except Exception as e:  # noqa: BLE001
            logger.exception("warmup/stories falhou para a conta %s", body.account_id)
            raise _erro(e, "ver stories")
        settings = client.get_settings()

    return {"ok": True, "vistos": len(pks), "user_id": user_id, "settings": settings}

"""
Audiência dos stories.

Contexto: `client.user_stories()` devolve objetos `Story`, e o modelo Story
(types.py) não tem campo de audiência — `extract_story_v1` lê o item cru e
DESCARTA os contadores. Por isso lemos o endpoint privado direto.

Verifica:
- a audiência sai do item do feed de stories, sem requisição extra
- o nome do campo varia entre versões do app, então a leitura é por candidatos
- quando o feed não traz o número, cai para a lista de quem viu (1 requisição
  por story) e lê o total do corpo, sem paginar a lista inteira
- story sem audiência conhecida vai como None, nunca como zero — zero rebaixaria
  o total no painel e pareceria queda de alcance
- falha na lista de espectadores não derruba a coleta dos outros stories
"""
import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


# ── Helpers ───────────────────────────────────────────────────────────────────

def _body(account_id="acc1", detalhar=True):
    from app.models import StoryInsightsRequest
    return StoryInsightsRequest(account_id=account_id, detalhar_faltantes=detalhar)


def _client(itens, user_id=12345, viewer_resposta=None, viewer_erro=None):
    client = MagicMock()
    client.user_id = user_id
    client.get_settings.return_value = {"uuids": {}}

    def _private_request(endpoint, *a, **kw):
        if "story" in endpoint and "feed/user" in endpoint:
            return {"reel": {"items": itens}}
        if "list_reel_media_viewer" in endpoint:
            if viewer_erro:
                raise viewer_erro
            return viewer_resposta or {}
        return {}

    client.private_request.side_effect = _private_request
    return client


def _rodar(body, client):
    from app.routes import insights as rota
    entry = {"client": client, "lock": asyncio.Lock()}
    with patch.object(rota.session_pool, "is_loaded", return_value=True), \
         patch.object(rota.session_pool, "get_entry", return_value=entry), \
         patch.object(rota.session_pool, "classify_error", return_value="UNKNOWN_ERROR"):
        return asyncio.run(rota.story_insights(body))


def _item(pk="111", **extra):
    base = {"pk": pk, "code": "ABC", "taken_at": 1787000000, "media_type": 1}
    base.update(extra)
    return base


# ── Leitura pelo feed ─────────────────────────────────────────────────────────

def test_audiencia_vem_do_feed_sem_requisicao_extra():
    client = _client([_item(viewer_count=57)])
    r = _rodar(_body(), client)

    assert r["stories"][0]["viewers"] == 57
    assert r["stories"][0]["fonte"] == "reel"
    assert r["viewers"] == 57
    # Nenhuma chamada à lista de espectadores.
    chamadas = [c.args[0] for c in client.private_request.call_args_list]
    assert not any("list_reel_media_viewer" in c for c in chamadas)


def test_nome_alternativo_do_campo_e_reconhecido():
    """O nome muda entre versões do app — ler só `viewer_count` perderia o dado."""
    for campo in ("viewer_count", "total_viewer_count", "seen_count", "view_count"):
        client = _client([_item(**{campo: 33})])
        r = _rodar(_body(), client)
        assert r["stories"][0]["viewers"] == 33, campo


def test_varios_stories_sao_somados():
    client = _client([
        _item("1", viewer_count=10),
        _item("2", viewer_count=25),
        _item("3", viewer_count=5),
    ])
    r = _rodar(_body(), client)
    assert r["total"] == 3
    assert r["viewers"] == 40


def test_conta_sem_story_ativo_nao_e_erro():
    r = _rodar(_body(), _client([]))
    assert r["total"] == 0
    assert r["viewers"] == 0
    assert r["stories"] == []


def test_item_sem_pk_e_descartado():
    client = _client([{"taken_at": 1, "viewer_count": 9}, _item("2", viewer_count=4)])
    r = _rodar(_body(), client)
    assert r["total"] == 1
    assert r["stories"][0]["story_id"] == "2"


def test_booleano_nao_e_lido_como_audiencia():
    """`viewer_count: True` viraria 1 numa conversão ingênua."""
    client = _client([_item(viewer_count=True)])
    r = _rodar(_body(), client)
    assert r["stories"][0]["viewers"] is None


def test_thumbnail_e_a_maior_candidata():
    client = _client([_item(viewer_count=1, image_versions2={"candidates": [
        {"url": "peq.jpg", "width": 100, "height": 100},
        {"url": "grande.jpg", "width": 1080, "height": 1920},
    ]})])
    r = _rodar(_body(), client)
    assert r["stories"][0]["thumbnail_url"] == "grande.jpg"


# ── Fallback pela lista de quem viu ───────────────────────────────────────────

def test_sem_numero_no_feed_cai_para_a_lista_de_espectadores():
    client = _client([_item()], viewer_resposta={"user_count": 91, "viewers": []})
    r = _rodar(_body(), client)

    assert r["stories"][0]["viewers"] == 91
    assert r["stories"][0]["fonte"] == "viewer_list"


def test_total_da_lista_e_lido_do_corpo_sem_paginar():
    """O total vem na primeira página — paginar gastaria requisições à toa."""
    client = _client(
        [_item()],
        viewer_resposta={"total_viewer_count": 120, "viewers": [{"pk": "1"}], "next_max_id": "pag2"},
    )
    r = _rodar(_body(), client)
    assert r["stories"][0]["viewers"] == 120
    # Uma chamada só à lista, mesmo havendo próxima página.
    chamadas = [c.args[0] for c in client.private_request.call_args_list]
    assert sum("list_reel_media_viewer" in c for c in chamadas) == 1


def test_contagem_pelo_tamanho_da_lista_so_sem_proxima_pagina():
    client = _client([_item()], viewer_resposta={"viewers": [{"pk": "1"}, {"pk": "2"}]})
    r = _rodar(_body(), client)
    assert r["stories"][0]["viewers"] == 2


def test_lista_paginada_sem_total_nao_conta_so_a_primeira_fatia():
    client = _client([_item()], viewer_resposta={"viewers": [{"pk": "1"}], "next_max_id": "pag2"})
    r = _rodar(_body(), client)
    # Contar 1 seria pior do que admitir que não se sabe.
    assert r["stories"][0]["viewers"] is None


def test_falha_na_lista_nao_derruba_a_coleta():
    client = _client([_item("1"), _item("2", viewer_count=8)], viewer_erro=Exception("403"))
    r = _rodar(_body(), client)

    assert r["total"] == 2
    assert r["stories"][0]["viewers"] is None
    assert r["stories"][1]["viewers"] == 8
    # Só o que tem número entra na soma.
    assert r["viewers"] == 8


def test_detalhar_desligado_nao_consulta_a_lista():
    client = _client([_item()], viewer_resposta={"user_count": 50})
    r = _rodar(_body(detalhar=False), client)

    assert r["stories"][0]["viewers"] is None
    chamadas = [c.args[0] for c in client.private_request.call_args_list]
    assert not any("list_reel_media_viewer" in c for c in chamadas)


# ── Erros ─────────────────────────────────────────────────────────────────────

def test_sessao_nao_carregada_devolve_400():
    from app.routes import insights as rota
    with patch.object(rota.session_pool, "is_loaded", return_value=False):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(rota.story_insights(_body()))
    assert exc.value.status_code == 400


def test_sessao_sem_user_id_e_erro_acionavel():
    client = _client([], user_id=None)
    with pytest.raises(HTTPException) as exc:
        _rodar(_body(), client)
    assert exc.value.detail["code"] == "NO_USER_ID"


def test_falha_no_feed_e_classificada():
    client = MagicMock()
    client.user_id = 1
    client.private_request.side_effect = Exception("login_required")
    with pytest.raises(HTTPException) as exc:
        _rodar(_body(), client)
    assert exc.value.status_code == 422

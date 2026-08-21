"""
Tests da figurinha de link do story.

Contexto: a instagrapi 2.18.16 escreve o link só em `tap_models`
(mixins/photo.py, bloco `if links:`), que é a área clicável. O campo que o app
de quem assiste usa para DESENHAR a figurinha é `story_link_stickers` — é o
mesmo que a própria biblioteca lê de volta em extractors.py:640. Daí o link
"invisível".

Verifica:
- modo burned (padrão): nada de `story_link_stickers` — a pílula já está nos
  pixels e o metadado extra desenharia uma segunda figurinha por cima
- modo native/both: `story_link_stickers` vai no payload, no formato que o
  Instagram devolve (story_link.url / link_title / link_type)
- a geometria recebida do Node é repassada intacta (área de toque em cima da
  pílula desenhada)
- falha no envio com link não perde o story: republica sem o metadado
- a validação de URL do Instagram não derruba a publicação
- a releitura do story é diagnóstico e nunca quebra o publish
"""
import asyncio
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


# ── Helpers ───────────────────────────────────────────────────────────────────

def _body(**kwargs):
    from app.models import PublishStoryRequest
    dados = dict(account_id="acc1", media_path="/app/uploads/stories/1.jpg")
    dados.update(kwargs)
    return PublishStoryRequest(**dados)


def _client(media_pk="123", info=None):
    client = MagicMock()
    client.photo_upload_to_story.return_value = MagicMock(pk=media_pk)
    client.video_upload_to_story.return_value = MagicMock(pk=media_pk)
    client.get_settings.return_value = {"uuids": {}}
    client.private_request.return_value = info if info is not None else {"items": [{}]}
    return client


def _rodar(body, client, tmp_path):
    """Executa a rota com sessão carregada e arquivo existente."""
    from app.routes import publish as rota

    arquivo = tmp_path / "1.jpg"
    arquivo.write_bytes(b"x")
    body.media_path = str(arquivo)

    entry = {"client": client, "lock": asyncio.Lock()}
    with patch.object(rota.session_pool, "is_loaded", return_value=True), \
         patch.object(rota.session_pool, "get_entry", return_value=entry), \
         patch.object(rota.session_pool, "classify_error", return_value="UNKNOWN_ERROR"):
        return asyncio.run(rota.publish_story(body))


def _extra_do_upload(client):
    return client.photo_upload_to_story.call_args.kwargs["extra_data"]


# ── Montagem do payload ───────────────────────────────────────────────────────

def test_url_sem_esquema_recebe_https():
    from app.routes.publish import _normalizar_url
    assert _normalizar_url("meusite.com/oferta") == "https://meusite.com/oferta"
    assert _normalizar_url("http://x.com") == "http://x.com"
    assert _normalizar_url("https://x.com") == "https://x.com"


def test_geometria_usa_o_que_o_node_mandou():
    from app.routes.publish import _geometria_link
    caixa = _geometria_link(_body(
        link_url="https://x.com", link_x=0.37, link_y=0.62,
        link_width=0.4, link_height=0.05,
    ))
    assert caixa == {"x": 0.37, "y": 0.62, "width": 0.4, "height": 0.05, "rotation": 0.0}


def test_geometria_sem_posicao_cai_no_rodape():
    from app.routes.publish import _geometria_link
    caixa = _geometria_link(_body(link_url="https://x.com"))
    assert (caixa["x"], caixa["y"]) == (0.5, 0.8)


def test_sticker_nativo_tem_o_formato_que_o_instagram_devolve():
    from app.routes.publish import _payload_sticker_nativo
    caixa = {"x": 0.5, "y": 0.8, "width": 0.37, "height": 0.05, "rotation": 0.0}
    p = _payload_sticker_nativo("https://meusite.com/oferta", "Ver oferta", caixa)

    # É este o campo que extractors.py lê de volta: story_link.url
    assert p["story_link"]["url"] == "https://meusite.com/oferta"
    assert p["story_link"]["link_title"] == "Ver oferta"
    assert p["story_link"]["link_type"] == "web"
    assert p["story_link"]["display_url"] == "meusite.com"
    assert p["type"] == "story_link"
    assert p["is_sticker"] is True
    assert p["tap_state_str_id"] == "link_sticker_default"
    assert (p["x"], p["y"], p["width"], p["height"]) == (0.5, 0.8, 0.37, 0.05)


def test_sticker_nativo_sem_texto_usa_o_dominio():
    from app.routes.publish import _payload_sticker_nativo
    p = _payload_sticker_nativo("https://www.meusite.com/a", None,
                                {"x": 0.5, "y": 0.8, "width": 0.4, "height": 0.05, "rotation": 0.0})
    assert p["story_link"]["link_title"] == "www.meusite.com"


# ── Modos ─────────────────────────────────────────────────────────────────────

def test_modo_burned_nao_manda_story_link_stickers(tmp_path):
    """A pílula já está nos pixels — o metadado desenharia uma segunda."""
    client = _client()
    r = _rodar(_body(link_url="https://meusite.com", link_x=0.5, link_y=0.8), client, tmp_path)

    assert "story_link_stickers" not in _extra_do_upload(client)
    assert r["link_mode"] == "burned"
    assert r["with_link"] is True
    # A área de toque continua indo — é ela que torna a pílula clicável.
    links = client.photo_upload_to_story.call_args.kwargs["links"]
    assert len(links) == 1
    assert str(links[0].webUri).startswith("https://meusite.com")


def test_modo_native_manda_story_link_stickers(tmp_path):
    client = _client()
    r = _rodar(_body(
        link_url="meusite.com", link_text="Ver oferta",
        link_x=0.5, link_y=0.75, link_width=0.4, link_height=0.05,
        link_sticker_mode="native",
    ), client, tmp_path)

    stickers = json.loads(_extra_do_upload(client)["story_link_stickers"])
    assert len(stickers) == 1
    assert stickers[0]["story_link"]["url"] == "https://meusite.com"
    assert stickers[0]["y"] == 0.75
    assert r["link_mode"] == "native"


def test_modo_desconhecido_cai_no_burned(tmp_path):
    client = _client()
    r = _rodar(_body(link_url="https://x.com", link_sticker_mode="qualquer"), client, tmp_path)
    assert r["link_mode"] == "burned"
    assert "story_link_stickers" not in _extra_do_upload(client)


def test_story_sem_link_nao_manda_nada_de_link(tmp_path):
    client = _client()
    r = _rodar(_body(), client, tmp_path)
    assert client.photo_upload_to_story.call_args.kwargs["links"] == []
    assert r["with_link"] is False
    assert r["link_native"] is None


# ── Resiliência ───────────────────────────────────────────────────────────────

def test_falha_com_link_republica_sem_o_metadado(tmp_path):
    """Story publicado sem o link é melhor do que story nenhum — a pílula
    queimada continua visível na imagem de qualquer forma."""
    client = _client()
    client.photo_upload_to_story.side_effect = [
        Exception("link sticker recusado"),
        MagicMock(pk="777"),
    ]
    r = _rodar(_body(link_url="https://meusite.com"), client, tmp_path)

    assert r["media_id"] == "777"
    assert r["with_link"] is False
    assert client.photo_upload_to_story.call_count == 2
    assert client.photo_upload_to_story.call_args.kwargs["links"] == []


def test_bloqueio_de_conta_nao_gera_segundo_upload(tmp_path):
    """Republicar custa mais uma ação na conta. Em desafio/limite o erro sobe:
    a segunda tentativa falharia igual e só aproximaria o bloqueio."""
    client = _client()
    client.photo_upload_to_story.side_effect = Exception(
        "feedback_required: please wait a few minutes before you try again"
    )
    with pytest.raises(HTTPException):
        _rodar(_body(link_url="https://meusite.com"), client, tmp_path)
    assert client.photo_upload_to_story.call_count == 1


def test_erro_generico_nao_gera_segundo_upload(tmp_path):
    client = _client()
    client.photo_upload_to_story.side_effect = Exception("connection reset by peer")
    with pytest.raises(HTTPException):
        _rodar(_body(link_url="https://meusite.com"), client, tmp_path)
    assert client.photo_upload_to_story.call_count == 1


def test_falha_sem_link_propaga_erro(tmp_path):
    client = _client()
    client.photo_upload_to_story.side_effect = Exception("upload quebrou")
    with pytest.raises(HTTPException) as exc:
        _rodar(_body(), client, tmp_path)
    assert exc.value.status_code == 422


def test_validacao_de_url_falhando_nao_derruba_o_story(tmp_path):
    """media/validate_reel_url/ tem a resposta descartada pela biblioteca —
    deixar a exceção subir mataria a publicação inteira sem motivo."""
    from app.routes import publish as rota

    client = _client()
    chamadas = []

    def _private_request(endpoint, *a, **kw):
        chamadas.append(endpoint)
        if "validate_reel_url" in endpoint:
            raise Exception("403")
        return {"items": [{}]}

    client.private_request.side_effect = _private_request

    def _upload(**kwargs):
        client.private_request("media/validate_reel_url/", {})
        return MagicMock(pk="555")

    client.photo_upload_to_story.side_effect = _upload
    r = _rodar(_body(link_url="https://meusite.com"), client, tmp_path)

    assert r["media_id"] == "555"
    assert r["with_link"] is True
    assert any("validate_reel_url" in c for c in chamadas)


# ── Releitura (diagnóstico) ───────────────────────────────────────────────────

def test_releitura_detecta_figurinha_nativa(tmp_path):
    client = _client(info={"items": [{"story_link_stickers": [{"story_link": {"url": "https://x"}}]}]})
    r = _rodar(_body(link_url="https://meusite.com"), client, tmp_path)
    assert r["link_native"] is True


def test_releitura_sem_figurinha_nativa(tmp_path):
    client = _client(info={"items": [{"story_link_stickers": []}]})
    r = _rodar(_body(link_url="https://meusite.com"), client, tmp_path)
    assert r["link_native"] is False


def test_releitura_quebrada_nao_derruba_a_publicacao(tmp_path):
    client = _client()
    client.private_request.side_effect = Exception("timeout")
    r = _rodar(_body(link_url="https://meusite.com"), client, tmp_path)
    assert r["media_id"] == "123"
    assert r["link_native"] is None

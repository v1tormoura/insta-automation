"""
Tests for the /publish/comment route and the media identification helper.

Verifies:
- comment uses the media_id it was GIVEN — never "the account's latest media"
- the per-account lock is held while commenting (same lock the publish uses)
- session not loaded → 400 SESSION_NOT_LOADED
- empty text → 422 COMMENT_EMPTY
- missing media_id → 422 COMMENT_MEDIA_NOT_FOUND
- instagrapi errors are classified, not swallowed
- a deleted media is reported as COMMENT_MEDIA_NOT_FOUND, not as a session problem
- publish returns the full "pk_userid" id, which is what media_comment needs
"""
import asyncio
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException


# ── Helpers ───────────────────────────────────────────────────────────────────

def _body(account_id="acc1", media_id="123_456", text="olá"):
    from app.models import PublishCommentRequest
    return PublishCommentRequest(account_id=account_id, media_id=media_id, text=text)


def _entry(client):
    return {"client": client, "lock": asyncio.Lock()}


def _client_ok(comment_pk="99887766"):
    client = MagicMock()
    client.media_comment.return_value = MagicMock(pk=comment_pk)
    client.get_settings.return_value = {"uuids": {}}
    return client


def _chamar(body, client, loaded=True):
    from app.routes import publish
    with patch.object(publish.session_pool, "is_loaded", return_value=loaded), \
         patch.object(publish.session_pool, "get_entry", return_value=_entry(client)) as ge:
        ge.return_value = _entry(client)

        async def _fake_get_entry(account_id):
            return _entry(client)

        with patch.object(publish.session_pool, "get_entry", _fake_get_entry):
            return asyncio.run(publish.publish_comment(body))


# ── Media id: o ponto crítico ────────────────────────────────────────────────

def test_comments_on_the_given_media_id():
    """O comentário vai para o id recebido — nada de 'mídia mais recente'."""
    client = _client_ok()
    r = _chamar(_body(media_id="777_888"), client)

    client.media_comment.assert_called_once_with("777_888", "olá")
    assert r["media_id"] == "777_888"
    assert r["status"] == "COMMENT_PUBLISHED"


def test_never_looks_up_the_latest_media():
    """
    Nenhuma busca por mídias da conta.

    Se um dia alguém trocar media_comment por uma busca de "última mídia", este
    teste quebra: user_medias/media_info não podem ser tocados.
    """
    client = _client_ok()
    _chamar(_body(media_id="111_222"), client)

    client.user_medias.assert_not_called()
    client.user_medias_v1.assert_not_called()
    client.media_info.assert_not_called()


def test_comment_id_is_returned():
    client = _client_ok(comment_pk="55443322")
    r = _chamar(_body(), client)
    assert r["comment_id"] == "55443322"


def test_text_is_stripped_but_preserved():
    client = _client_ok()
    _chamar(_body(text="  comentário com espaços  "), client)
    assert client.media_comment.call_args[0][1] == "comentário com espaços"


# ── Lock por conta ────────────────────────────────────────────────────────────

def test_holds_the_account_lock_while_commenting():
    """O comentário usa o MESMO lock do publish — nunca concorrem na conta."""
    from app.routes import publish

    client = _client_ok()
    entry = _entry(client)
    segurava = {}

    def _comentar(media_id, text):
        segurava["locked"] = entry["lock"].locked()
        return MagicMock(pk="1")

    client.media_comment.side_effect = _comentar

    async def _fake_get_entry(account_id):
        return entry

    with patch.object(publish.session_pool, "is_loaded", return_value=True), \
         patch.object(publish.session_pool, "get_entry", _fake_get_entry):
        asyncio.run(publish.publish_comment(_body()))

    assert segurava["locked"] is True
    assert entry["lock"].locked() is False      # liberado ao sair


# ── Validação de entrada ──────────────────────────────────────────────────────

def test_session_not_loaded_returns_400():
    from app.routes import publish
    with patch.object(publish.session_pool, "is_loaded", return_value=False):
        with pytest.raises(HTTPException) as e:
            asyncio.run(publish.publish_comment(_body()))
    assert e.value.status_code == 400
    assert e.value.detail["code"] == "SESSION_NOT_LOADED"


def test_empty_text_returns_422():
    from app.routes import publish
    with patch.object(publish.session_pool, "is_loaded", return_value=True):
        with pytest.raises(HTTPException) as e:
            asyncio.run(publish.publish_comment(_body(text="   ")))
    assert e.value.status_code == 422
    assert e.value.detail["code"] == "COMMENT_EMPTY"


def test_missing_media_id_returns_422():
    from app.routes import publish
    with patch.object(publish.session_pool, "is_loaded", return_value=True):
        with pytest.raises(HTTPException) as e:
            asyncio.run(publish.publish_comment(_body(media_id="  ")))
    assert e.value.status_code == 422
    assert e.value.detail["code"] == "COMMENT_MEDIA_NOT_FOUND"


# ── Erros ─────────────────────────────────────────────────────────────────────

def test_session_expired_is_classified():
    from app.routes import publish
    from instagrapi.exceptions import LoginRequired

    client = _client_ok()
    client.media_comment.side_effect = LoginRequired("login_required")

    with pytest.raises(HTTPException) as e:
        _chamar(_body(), client)
    assert e.value.detail["code"] == "SESSION_EXPIRED"


def test_rate_limit_is_classified():
    from app.routes import publish

    client = _client_ok()
    client.media_comment.side_effect = Exception("Please wait a few minutes before you try again")

    with pytest.raises(HTTPException) as e:
        _chamar(_body(), client)
    assert e.value.detail["code"] == "RATE_LIMITED"


def test_deleted_media_is_not_reported_as_a_session_problem():
    """
    Mídia apagada é estado do CONTEÚDO.

    Classificar como sessão mandaria o painel pedir reconexão de uma conta
    perfeitamente saudável.
    """
    client = _client_ok()
    client.media_comment.side_effect = Exception("Media not found or unavailable")

    with pytest.raises(HTTPException) as e:
        _chamar(_body(), client)
    assert e.value.detail["code"] == "COMMENT_MEDIA_NOT_FOUND"


def test_media_ausente_reconhece_variantes():
    from app.routes.publish import _midia_ausente
    for msg in ("Media not found", "media_not_found", "Unable to find media",
                "This media does not exist", "invalid media_id"):
        assert _midia_ausente(msg) is True
    assert _midia_ausente("Please wait a few minutes") is False


# ── Identificação da mídia devolvida pelo publish ────────────────────────────

def test_identificacao_prefers_full_id():
    """
    A forma "pk_userid" evita uma requisição extra.

    media_comment() chama media_id(), que só devolve direto quando o id tem "_";
    sem isso ele consulta media_user() para descobrir o dono.
    """
    from app.routes.publish import _identificacao

    media = MagicMock(pk=123, id="123_456", code="Abc123")
    r = _identificacao(media)

    assert r["media_id"] == "123"            # compatibilidade com chamadores atuais
    assert r["media_full_id"] == "123_456"   # o que o comentário usa
    assert r["media_code"] == "Abc123"


def test_identificacao_falls_back_to_pk():
    """Sem id completo, o pk ainda serve — media_comment resolve o resto."""
    from app.routes.publish import _identificacao

    media = MagicMock(pk=999, code="")
    del media.id
    r = _identificacao(media)

    assert r["media_id"] == "999"
    assert r["media_full_id"] == "999"


def test_secrets_never_logged():
    """settings/cookies estão na lista de redação do _slog."""
    from app.session_pool import _REDACT
    for campo in ("password", "verification_code", "session", "cookies", "settings", "token"):
        assert campo in _REDACT

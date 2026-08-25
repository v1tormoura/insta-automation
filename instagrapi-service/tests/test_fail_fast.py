"""
Tests for _patch_client_fail_fast and _PreLoginRateLimited (session_pool.py).

Verifies:
- _PreLoginRateLimited always classifies as RATE_LIMITED without message parsing
- Patched pre_login_flow raises _PreLoginRateLimited on rate-limit exceptions
- Patched pre_login_flow lets non-rate-limit errors propagate unchanged
- Patched pre_login_flow passes through successful calls unchanged
- _patch_client_fail_fast is a no-op when _RATE_LIMIT_EXC is empty
- Client from get_entry() has the fail-fast patch active
"""
import asyncio
import pytest
from unittest.mock import MagicMock, patch


# ── classify_error + _PreLoginRateLimited ─────────────────────────────────────

def test_pre_login_rate_limited_classifies_as_rate_limited():
    """_PreLoginRateLimited must be RATE_LIMITED — no message-content check."""
    from app.session_pool import _PreLoginRateLimited, classify_error
    assert classify_error(_PreLoginRateLimited("pre_login_flow rate-limited")) == "RATE_LIMITED"


def test_pre_login_rate_limited_empty_message_still_rate_limited():
    """_PreLoginRateLimited with no message still classifies as RATE_LIMITED."""
    from app.session_pool import _PreLoginRateLimited, classify_error
    assert classify_error(_PreLoginRateLimited()) == "RATE_LIMITED"


def test_pre_login_rate_limited_takes_priority_over_message_check():
    """_PreLoginRateLimited is matched by isinstance before any message-content check."""
    from app.session_pool import _PreLoginRateLimited, classify_error
    # Deliberately ambiguous message — classified by type, not content
    exc = _PreLoginRateLimited("some unrelated message with no 429 keywords")
    assert classify_error(exc) == "RATE_LIMITED"


# ── preparação antes do login ────────────────────────────────────────────────
#
# O `pre_login_flow` da instagrapi tem três das cinco chamadas COMENTADAS na
# própria biblioteca — sobra só o `launcher/sync/`. O app real faz as cinco, e
# uma delas, `get_prefill_candidates`, anuncia ao Instagram qual conta vai
# entrar deste aparelho ANTES de mandar a senha. Sem esse aviso o
# `accounts/login/` chega sem contexto nenhum atrás dele.
#
# Estes testes fixam três decisões:
#   1. os cinco passos são tentados, na ordem do app;
#   2. um 429 em qualquer passo aborta antes de gastar o accounts/login/;
#   3. falha de UM passo não impede o login, mas transporte quebrado sim.


def _cliente_espiao(falhas=None):
    """Cliente com os passos de pre-login trocados por espiões."""
    from instagrapi import Client
    falhas = falhas or {}
    c = Client()
    c.username = "conta_teste"
    chamados = []

    def _passo(nome):
        def _fn(*a, **k):
            chamados.append(nome)
            if nome in falhas:
                raise falhas[nome]
            return {}
        return _fn

    c.set_contact_point_prefill = _passo("prefill")
    c.get_prefill_candidates    = _passo("candidates")
    c.sync_launcher             = _passo("launcher")
    c.sync_device_features      = _passo("device_features")
    c._chamados = chamados
    return c


def test_preparacao_executa_os_cinco_passos_do_app():
    from app.session_pool import _patch_client_fail_fast
    c = _cliente_espiao()
    _patch_client_fail_fast(c)
    c.pre_login_flow()
    assert c._chamados == [
        "prefill", "candidates", "prefill", "launcher", "device_features"
    ]


def test_anuncia_o_usuario_antes_da_senha():
    """
    `get_prefill_candidates` é o passo que diz ao Instagram qual conta vai
    entrar. Sem username definido ele não faz sentido e é pulado.
    """
    from app.session_pool import _patch_client_fail_fast
    c = _cliente_espiao()
    _patch_client_fail_fast(c)
    c.pre_login_flow()
    assert "candidates" in c._chamados

    sem_usuario = _cliente_espiao()
    sem_usuario.username = None
    _patch_client_fail_fast(sem_usuario)
    sem_usuario.pre_login_flow()
    assert "candidates" not in sem_usuario._chamados


def test_429_em_qualquer_passo_aborta():
    """Insistir depois de um 429 queima o IP e o login seria recusado igual."""
    from instagrapi.exceptions import PleaseWaitFewMinutes
    from app.session_pool import _patch_client_fail_fast, _PreLoginRateLimited

    for passo in ("prefill", "candidates", "launcher"):
        c = _cliente_espiao({passo: PleaseWaitFewMinutes("Please wait")})
        _patch_client_fail_fast(c)
        with pytest.raises(_PreLoginRateLimited):
            c.pre_login_flow()


def test_429_classifica_como_rate_limited():
    from instagrapi.exceptions import PleaseWaitFewMinutes
    from app.session_pool import _patch_client_fail_fast, classify_error

    c = _cliente_espiao({"launcher": PleaseWaitFewMinutes("Please wait")})
    _patch_client_fail_fast(c)
    try:
        c.pre_login_flow()
        pego = None
    except Exception as e:
        pego = e
    assert pego is not None
    assert classify_error(pego) == "RATE_LIMITED"


def test_falha_de_um_passo_nao_impede_o_login():
    """
    Estes passos são de melhor esforço no app real. Tratá-los como
    obrigatórios trocaria um login recusado por um login não tentado.
    """
    from app.session_pool import _patch_client_fail_fast
    c = _cliente_espiao({"candidates": ValueError("resposta inesperada")})
    _patch_client_fail_fast(c)
    assert c.pre_login_flow() is True
    # os passos seguintes continuaram
    assert "launcher" in c._chamados
    assert "device_features" in c._chamados


def test_transporte_quebrado_sobe():
    """
    Rede ou proxy fora do ar não é "um passo não respondeu", é o caminho
    inteiro. Seguir gastaria uma requisição de login que falharia igual.
    """
    from app.session_pool import _patch_client_fail_fast
    import requests

    for erro in (ConnectionError("rede caiu"),
                 requests.exceptions.ProxyError("proxy fora"),
                 requests.exceptions.Timeout("estourou")):
        c = _cliente_espiao({"launcher": erro})
        _patch_client_fail_fast(c)
        with pytest.raises(type(erro)):
            c.pre_login_flow()


def test_patch_aplica_no_objeto_nao_na_classe():
    """Um cliente por conta: patch na classe vazaria entre contas."""
    from instagrapi import Client
    from app.session_pool import _patch_client_fail_fast
    c = Client()
    _patch_client_fail_fast(c)
    assert 'pre_login_flow' in c.__dict__


def test_sem_tipos_de_429_mantem_o_fluxo_original():
    """
    Sem os tipos de 429 importáveis o corte rápido é impossível, e aí o
    original da biblioteca é mais seguro que uma versão pela metade.
    """
    from instagrapi import Client
    from app import session_pool
    from app.session_pool import _patch_client_fail_fast

    c = Client()
    original = c.pre_login_flow
    with patch.object(session_pool, '_RATE_LIMIT_EXC', ()):
        _patch_client_fail_fast(c)
    assert c.pre_login_flow == original


# ── get_entry() integration ───────────────────────────────────────────────────

def test_get_entry_client_has_fail_fast_patch():
    """Client created by get_entry() has pre_login_flow patched to fail fast on 429."""
    from instagrapi.exceptions import PleaseWaitFewMinutes
    from app.session_pool import get_entry, remove_entry, _PreLoginRateLimited

    test_id = "test-fail-fast-integration"

    async def run():
        await remove_entry(test_id)
        entry = await get_entry(test_id)
        client = entry["client"]

        # Mock sync_launcher (what the original pre_login_flow calls internally).
        # Mocking pre_login_flow directly would replace the fail-fast wrapper, bypassing it.
        client.sync_launcher = MagicMock(side_effect=PleaseWaitFewMinutes("wait"))

        try:
            client.pre_login_flow()  # wrapper → _orig() → sync_launcher → PleaseWait → _PreLoginRateLimited
            return "no_exception"
        except _PreLoginRateLimited:
            return "correct"
        except Exception as exc:
            return f"wrong_type:{type(exc).__name__}"
        finally:
            await remove_entry(test_id)

    result = asyncio.run(run())
    assert result == "correct", f"Expected _PreLoginRateLimited, got: {result}"


def test_get_entry_client_has_retry_zero_and_fail_fast():
    """Client from get_entry() has BOTH retry=0 and fail-fast patches active."""
    from app.session_pool import get_entry, remove_entry

    test_id = "test-both-patches"

    async def run():
        await remove_entry(test_id)
        entry = await get_entry(test_id)
        client = entry["client"]

        # Check retry patch
        adapter = client.private.get_adapter("https://i.instagram.com/")
        # read=0/status=0 é a proteção real (ver _build_retry); total=0 era a
        # política antiga, trocada na correção do login por TLS EOF.
        retry_ok = adapter.max_retries.read == 0 and adapter.max_retries.status == 0

        # Check fail-fast patch
        fail_fast_ok = 'pre_login_flow' in client.__dict__

        await remove_entry(test_id)
        return retry_ok, fail_fast_ok

    retry_ok, fail_fast_ok = asyncio.run(run())
    assert retry_ok, "retry total should be 0 (urllib3 no-retry patch)"
    assert fail_fast_ok, "pre_login_flow should be patched (fail-fast patch)"

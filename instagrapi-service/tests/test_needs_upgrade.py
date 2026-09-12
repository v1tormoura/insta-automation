# -*- coding: utf-8 -*-
"""
`needs_upgrade` → login pelo CAA.

── O que aconteceu em 11/09/2026

O endpoint clássico de login passou a recusar a build da biblioteca com
`error_type=needs_upgrade` ("Sua versão do Instagram está desatualizada"),
para todo mundo. Medido com usuário falso: trocar a versão no User-Agent não
muda nada — e a biblioteca não tem build mais nova. O fluxo CAA/Bloks, que é o
do app atual, NÃO tem esse portão (também medido). `login_com_desvio_caa`
refaz o login por ele quando o clássico responde `needs_upgrade`.

── O que estes testes protegem

  • que o desvio aconteça SÓ em `needs_upgrade` — outro UnknownError sobe
    intacto, senão um erro de rede viraria uma tentativa a mais de login;
  • que o pós-login (`login_flow`, carimbo) rode depois do CAA, como o
    `login()` da biblioteca faria;
  • que o CAA sem sessão preserve o erro original — a pessoa precisa ver
    "versão desatualizada", não "login falhou".
"""
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from instagrapi.exceptions import UnknownError, TwoFactorRequired  # noqa: E402
from app import session_pool  # noqa: E402


def _cliente(erro_do_login, caa):
    c = Mock()
    c.login = Mock(side_effect=erro_do_login)
    c._try_caa_login = Mock(side_effect=caa) if isinstance(caa, Exception) else Mock(return_value=caa)
    c.login_flow = Mock()
    c.last_json = {}
    c.device_settings = {"app_version": "428.0.0.47.67"}
    return c


def test_needs_upgrade_desvia_para_o_caa_e_conclui_o_login():
    erro = UnknownError("Sua versão do Instagram está desatualizada.", error_type="needs_upgrade")
    c = _cliente(erro, caa=True)

    assert session_pool.login_com_desvio_caa(c, "conta", "senha", verification_code="123456") is True
    c._try_caa_login.assert_called_once_with(erro, verification_code="123456")
    c.login_flow.assert_called_once_with()
    assert c.relogin_attempt == 0
    assert c.last_login > 0


def test_needs_upgrade_lido_do_last_json_quando_a_excecao_nao_traz():
    """A biblioteca nem sempre põe `error_type` na exceção; o `last_json` tem."""
    erro = UnknownError("Sua versão do Instagram está desatualizada.")
    c = _cliente(erro, caa=True)
    c.last_json = {"error_type": "needs_upgrade", "status": "fail"}

    assert session_pool.login_com_desvio_caa(c, "conta", "senha") is True
    c._try_caa_login.assert_called_once()


def test_outro_unknown_error_sobe_intacto_sem_tentar_o_caa():
    erro = UnknownError("Tempo esgotado", error_type="timeout")
    c = _cliente(erro, caa=True)

    with pytest.raises(UnknownError):
        session_pool.login_com_desvio_caa(c, "conta", "senha")
    c._try_caa_login.assert_not_called()
    c.login_flow.assert_not_called()


def test_caa_sem_sessao_preserva_o_erro_original():
    erro = UnknownError("Sua versão do Instagram está desatualizada.", error_type="needs_upgrade")
    c = _cliente(erro, caa=False)

    with pytest.raises(UnknownError) as info:
        session_pool.login_com_desvio_caa(c, "conta", "senha")
    assert "desatualizada" in str(info.value)
    c.login_flow.assert_not_called()


def test_2fa_vindo_do_caa_sobe_como_two_factor_required():
    """O `/login` já trata TwoFactorRequired; o desvio não pode engoli-lo."""
    erro = UnknownError("x", error_type="needs_upgrade")
    c = _cliente(erro, caa=TwoFactorRequired("código necessário"))

    with pytest.raises(TwoFactorRequired):
        session_pool.login_com_desvio_caa(c, "conta", "senha")


def test_login_normal_nem_passa_pelo_desvio():
    c = Mock()
    c.login = Mock(return_value=True)
    c._try_caa_login = Mock()

    assert session_pool.login_com_desvio_caa(c, "conta", "senha") is True
    c._try_caa_login.assert_not_called()

# -*- coding: utf-8 -*-
"""
O molde de sessão que se desliga sozinho.

── O que aconteceu

Para fixar o IP por conta, o serviço acrescenta um sufixo ao nome de usuário do
proxy: `chave__cr.br;state.saopaulo` vira `...;session.a1b2c3`. Fornecedor que
não reconhece esse parâmetro não o ignora — recusa a credencial INTEIRA e
responde 407 NO_USER.

Nesse estado nenhuma conta loga. E o teste de proxy do painel PASSA, porque ele
usa a URL crua: quem investiga conclui que o proxy está bom e vai procurar o
defeito na conta, na senha, no @. Foram dias assim.

── Por que não basta o padrão vazio

Porque o padrão só vale para quem não configurou nada. Variável escrita no
`.env` ganha do padrão, e imagem não reconstruída mantém o código antigo — as
duas coisas deixam o produto parado esperando alguém acertar um arquivo no
servidor.

Então o serviço mede e decide: leva 407, tenta a URL crua, e se ela funciona a
conclusão é única — o sufixo é o problema. Desliga e refaz.

── O que estes testes protegem

Sobretudo o caso em que ele NÃO deve desligar. Um proxy sem cota também dá 407,
e desligar o molde ali trocaria um diagnóstico correto por um palpite — o
sintoma some de vista sem a causa ter sido tocada.
"""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import session_pool  # noqa: E402


PROXY = "http://cliente__cr.br;state.saopaulo:SENHA@host.exemplo.io:11000"


@pytest.fixture(autouse=True)
def limpo(monkeypatch):
    """Cada teste começa com o molde ligado e sem proxies lembrados."""
    session_pool.esquecer_recusa_do_molde()
    session_pool._proxies.clear()
    session_pool._proxies_crus.clear()
    monkeypatch.setenv("PROXY_SESSAO_MOLDE", ";session.{sessao}")
    yield
    session_pool.esquecer_recusa_do_molde()


def _resposta(status):
    r = MagicMock()
    r.status_code = status
    return r


class TestDesligaQuandoDeve:
    def test_url_crua_funciona_entao_o_sufixo_e_o_problema(self):
        """A única diferença entre as duas URLs é o sufixo. Se uma passa e a
        outra não, não sobra outra explicação."""
        session_pool.lembrar_proxy("conta-1", PROXY)
        assert ";session." in session_pool.proxy_lembrado("conta-1")

        with patch("requests.get", return_value=_resposta(200)):
            assert session_pool.conferir_molde_recusado("conta-1") is True

        assert session_pool.molde_ativo() is False
        # A conta já volta a usar a crua, sem uma segunda viagem.
        assert session_pool.proxy_lembrado("conta-1") == PROXY

    def test_desliga_para_TODAS_as_contas(self):
        """É uma característica do fornecedor, não daquela conta. Sem isto, as
        outras oito repetiriam o mesmo 407 uma a uma."""
        session_pool.lembrar_proxy("conta-1", PROXY)
        with patch("requests.get", return_value=_resposta(200)):
            session_pool.conferir_molde_recusado("conta-1")

        session_pool.lembrar_proxy("conta-2", PROXY)
        assert session_pool.proxy_lembrado("conta-2") == PROXY   # sem sufixo


class TestNaoDesligaQuandoNaoDeve:
    def test_proxy_ruim_de_verdade_mantem_o_molde(self):
        """Cota esgotada também dá 407. Desligar o molde ali esconderia a causa
        real atrás de uma mudança que não tem nada a ver com ela."""
        session_pool.lembrar_proxy("conta-1", PROXY)
        with patch("requests.get", return_value=_resposta(407)):
            assert session_pool.conferir_molde_recusado("conta-1") is False
        assert session_pool.molde_ativo() is True

    def test_rede_fora_mantem_o_molde(self):
        """Sem conseguir medir, não se conclui. A ausência de resposta não é
        evidência a favor de nenhuma das hipóteses."""
        session_pool.lembrar_proxy("conta-1", PROXY)
        with patch("requests.get", side_effect=OSError("sem rede")):
            assert session_pool.conferir_molde_recusado("conta-1") is False
        assert session_pool.molde_ativo() is True

    def test_sem_molde_aplicado_nao_ha_o_que_desligar(self, monkeypatch):
        """Com o molde já vazio, um 407 é do proxy. Medir aqui seria gastar uma
        requisição para responder uma pergunta que não foi feita."""
        monkeypatch.setenv("PROXY_SESSAO_MOLDE", "")
        session_pool.lembrar_proxy("conta-1", PROXY)
        with patch("requests.get", return_value=_resposta(200)) as g:
            assert session_pool.conferir_molde_recusado("conta-1") is False
            g.assert_not_called()

    def test_conta_sem_proxy_lembrado(self):
        with patch("requests.get", return_value=_resposta(200)):
            assert session_pool.conferir_molde_recusado("conta-desconhecida") is False


class TestNaoRepete:
    def test_segunda_chamada_nao_mede_de_novo(self):
        """Depois de desligado não há o que refazer, e devolver True faria quem
        chamou repetir um login que já foi refeito."""
        session_pool.lembrar_proxy("conta-1", PROXY)
        with patch("requests.get", return_value=_resposta(200)) as g:
            assert session_pool.conferir_molde_recusado("conta-1") is True
            assert g.call_count == 1
            assert session_pool.conferir_molde_recusado("conta-1") is False
            assert g.call_count == 1     # não mediu de novo


class TestVoltaAtras:
    def test_esquecer_religa_o_molde(self):
        """Trocar de fornecedor precisa refazer a medição — a observação era
        sobre o proxy anterior."""
        session_pool.lembrar_proxy("conta-1", PROXY)
        with patch("requests.get", return_value=_resposta(200)):
            session_pool.conferir_molde_recusado("conta-1")
        assert session_pool.molde_ativo() is False

        session_pool.esquecer_recusa_do_molde()
        assert session_pool.molde_ativo() is True
        session_pool.lembrar_proxy("conta-3", PROXY)
        assert ";session." in session_pool.proxy_lembrado("conta-3")

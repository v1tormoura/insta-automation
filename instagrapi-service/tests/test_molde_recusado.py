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


class TestUrlJaMoldadaPeloChamador:
    """
    O defeito que deixou o auto-conserto inerte em produção.

    As rotas fazem isto:

        proxy = moldar_proxy_por_conta(proxy, account_id)   # reatribui!
        client.set_proxy(proxy)
        lembrar_proxy(account_id, proxy)                    # já moldada

    E `lembrar_proxy` guardava a URL recebida como se fosse a crua. O resultado
    era `_proxies_crus == _proxies`, e todo código que compara os dois para
    perguntar "houve molde aqui?" respondia que não.

    Duas funcionalidades ficaram inertes por causa disso — a explicação do 407
    e o desligamento automático do molde. Ambas escritas, ambas com teste de
    unidade passando, ambas sem efeito nenhum na tela.
    """

    def test_lembrar_recupera_a_crua_mesmo_recebendo_a_moldada(self):
        moldada = session_pool.moldar_proxy_por_conta(PROXY, "conta-1")
        assert moldada != PROXY                      # o molde de fato aplicou

        session_pool.lembrar_proxy("conta-1", moldada)   # como a rota faz

        assert session_pool._proxies_crus["conta-1"] == PROXY
        assert session_pool._proxies["conta-1"] == moldada

    def test_e_por_isso_o_auto_conserto_volta_a_funcionar(self):
        """O teste que fecha o buraco: com a URL já moldada, o desligamento
        automático precisa disparar do mesmo jeito."""
        moldada = session_pool.moldar_proxy_por_conta(PROXY, "conta-1")
        session_pool.lembrar_proxy("conta-1", moldada)

        with patch("requests.get", return_value=_resposta(200)):
            assert session_pool.conferir_molde_recusado("conta-1") is True

        assert session_pool.molde_ativo() is False
        assert session_pool.proxy_lembrado("conta-1") == PROXY

    def test_url_crua_continua_passando_intacta(self):
        """Quem já passa a crua não pode ser penalizado."""
        session_pool.lembrar_proxy("conta-2", PROXY)
        assert session_pool._proxies_crus["conta-2"] == PROXY

    def test_desmoldar_nao_toca_no_que_nao_e_nosso(self):
        """`;state.saopaulo` é do fornecedor e precisa sobreviver — perdê-lo
        faria o IP sair de outro estado, que é pior que não fixar."""
        r = session_pool.desmoldar(PROXY, "conta-1")
        assert r == PROXY
        assert ";state.saopaulo" in r

    def test_desmoldar_com_molde_desligado(self, monkeypatch):
        monkeypatch.setenv("PROXY_SESSAO_MOLDE", "")
        moldada = PROXY + ";session.xyz"
        # Sem molde configurado não há sufixo conhecido para remover, e remover
        # por palpite arriscaria cortar um parâmetro do fornecedor.
        assert session_pool.desmoldar(moldada, "conta-1") == moldada


class TestProxyDaContaVersusGlobal:
    """
    O caso que o log não sabia explicar.

    O painel mostra o proxy GLOBAL "ativo e funcionando", com IP de saída e
    tudo, e a conta não conecta. Não é contradição: a conta tem proxy PRÓPRIO,
    outro endereço e outra credencial. Quem lê o painel conclui que o proxy
    está bom — e está. Só não é o que a conta usa.

    Os dois casos dão o mesmo 407 na tela e têm consertos opostos: um é "troque
    o proxy desta conta", o outro é "fale com o fornecedor".
    """

    DA_CONTA = "http://usuario_ruim:SENHA@host.exemplo.io:11000"
    GLOBAL = "http://usuario_bom:SENHA@host.exemplo.io:823"

    def test_proxy_da_conta_ruim_e_global_bom(self, monkeypatch):
        monkeypatch.setenv("GLOBAL_PROXY", self.GLOBAL)
        monkeypatch.setenv("PROXY_SESSAO_MOLDE", "")
        session_pool.lembrar_proxy("conta-1", self.DA_CONTA)

        with patch("requests.get", return_value=_resposta(200)):
            texto = session_pool.explicar_recusa_de_proxy("conta-1")

        assert "PR\u00d3PRIO desta conta" in texto
        assert "global" in texto.lower()

    def test_fornecedor_inteiro_fora(self, monkeypatch):
        """Global também não responde: o conserto não é trocar o proxy da
        conta, e mandar trocar faria perder tempo no lugar errado."""
        monkeypatch.setenv("GLOBAL_PROXY", self.GLOBAL)
        monkeypatch.setenv("PROXY_SESSAO_MOLDE", "")
        session_pool.lembrar_proxy("conta-1", self.DA_CONTA)

        with patch("requests.get", return_value=_resposta(407)):
            texto = session_pool.explicar_recusa_de_proxy("conta-1")

        assert "fornecedor ou do plano" in texto

    def test_conta_usando_o_proprio_global_nao_compara(self, monkeypatch):
        """Sem dois endereços não há comparação a fazer, e sondar de novo o
        mesmo proxy só gastaria uma requisição para não dizer nada."""
        monkeypatch.setenv("GLOBAL_PROXY", self.GLOBAL)
        monkeypatch.setenv("PROXY_SESSAO_MOLDE", "")
        session_pool.lembrar_proxy("conta-1", self.GLOBAL)

        with patch("requests.get", return_value=_resposta(200)) as g:
            assert session_pool.explicar_recusa_de_proxy("conta-1") == ""
            g.assert_not_called()

    def test_sem_global_configurado(self, monkeypatch):
        monkeypatch.delenv("GLOBAL_PROXY", raising=False)
        monkeypatch.setenv("PROXY_SESSAO_MOLDE", "")
        session_pool.lembrar_proxy("conta-1", self.DA_CONTA)
        assert session_pool.explicar_recusa_de_proxy("conta-1") == ""

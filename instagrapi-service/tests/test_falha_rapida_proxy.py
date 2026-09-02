# -*- coding: utf-8 -*-
"""
Falhar rápido quando o proxy recusa a credencial.

── O custo que isto tira

O log de um login com proxy recusado:

    22:40:26  primeira tentativa  → 407 NO_USER
    22:40:39  sondagem do IP desiste (13s depois)
    22:41:11  login desiste       (duration_ms=31643)

Trinta e um segundos para chegar ao mesmo 407 que a PRIMEIRA requisição já
tinha dado. A política de retentativa repete falha de conexão — o que é certo
para um túnel TLS que cai, e errado para uma credencial recusada: o proxy não
vai mudar de ideia em três segundos.

Seis requisições de pré-login, três tentativas cada, espera crescente entre
elas. A resposta existia no primeiro segundo.

── O que estes testes protegem

Que o 407 pare na primeira, e que TODO o resto continue sendo repetido. Deixar
de repetir um túnel que cai levaria o login a falhar por uma instabilidade de
rede de meio segundo — que é o motivo de `connect=2` existir.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import session_pool as sp  # noqa: E402


class TestReconhecerARecusa:
    def test_407_do_tunel(self):
        e = Exception("ProxyError('Unable to connect to proxy', "
                      "OSError('Tunnel connection failed: 407 NO_USER'))")
        assert sp._e_recusa_de_proxy(e) is True

    def test_407_com_outro_motivo_do_fornecedor(self):
        e = Exception("Tunnel connection failed: 407 TRAFFIC_EXHAUSTED")
        assert sp._e_recusa_de_proxy(e) is True

    def test_tunel_que_cai_NAO_e_recusa(self):
        """É exatamente o caso que `connect=2` existe para cobrir. Classificar
        como recusa faria o login morrer por meio segundo de instabilidade."""
        for msg in ["UNEXPECTED_EOF_WHILE_READING",
                    "Connection aborted",
                    "Read timed out",
                    "Max retries exceeded"]:
            assert sp._e_recusa_de_proxy(Exception(msg)) is False

    def test_407_sem_contexto_de_proxy_nao_conta(self):
        """Um 407 solto pode ser qualquer coisa — inclusive um número dentro de
        outra mensagem. Sem a frase do túnel, não se conclui."""
        assert sp._e_recusa_de_proxy(Exception("erro 407 em algum lugar")) is False


class TestPoliticaDeRetentativa:
    def test_a_politica_e_a_que_nao_insiste(self):
        assert type(sp._build_retry()).__name__ == "_RetrySemInsistirNo407"

    def test_recusa_de_proxy_levanta_na_hora(self):
        """Sem esperar o backoff nem consumir as tentativas restantes."""
        r = sp._build_retry()
        erro = OSError("Tunnel connection failed: 407 NO_USER")
        try:
            r.increment(method="POST", url="https://i.instagram.com/", error=erro)
        except OSError as e:
            assert "407" in str(e)
        else:
            raise AssertionError("deveria ter levantado em vez de repetir")

    def test_falha_comum_continua_repetindo(self):
        """O contrato antigo tem de sobreviver: queda de conexão repete."""
        r = sp._build_retry()
        novo = r.increment(method="POST", url="https://i.instagram.com/",
                           error=OSError("Connection aborted"))
        assert novo.total < r.total          # consumiu uma tentativa, não levantou

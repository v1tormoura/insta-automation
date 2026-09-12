# -*- coding: utf-8 -*-
"""
A descoberta automática do molde de sessão.

── O que aconteceu

A sonda que testa a sintaxe de sessão fixa de cada fornecedor existia desde o
começo — como rota e como script. O que ela pedia era que alguém a rodasse,
lesse a resposta, editasse `PROXY_SESSAO_MOLDE` no `.env` e recriasse o
serviço. Ninguém fez. Por meses o produto rodou proxy rotativo SEM sessão
fixa: contas diferentes caindo no mesmo IP, e a MESMA conta trocando de IP
entre uma requisição e a seguinte — o padrão de conta invadida.

Agora o serviço descobre sozinho, uma vez por fornecedor, na primeira vez que
vê aquele proxy. `PROXY_SESSAO_MOLDE` continua mandando quando definido.

── O que estes testes protegem

  • que a descoberta se aplique de fato ao proxy da conta, no login E no
    restore — o restore aplicava a URL crua e desfazia a fixação a cada
    reinício;
  • que rode UMA vez por fornecedor, não uma por conta — dez contas do mesmo
    fornecedor não podem ser dez sondagens;
  • que `.env` continue mandando, e que a sonda quebrada não impeça o login.
"""
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import session_pool  # noqa: E402


PROXY = "http://cliente__cr.br:SENHA@host.exemplo.io:11000"
OUTRO = "http://cliente:SENHA@outro.exemplo.io:9000"


@pytest.fixture(autouse=True)
def _limpo(monkeypatch):
    session_pool.esquecer_moldes_descobertos()
    session_pool._molde_recusado = False
    monkeypatch.delenv("PROXY_SESSAO_MOLDE", raising=False)
    yield
    session_pool.esquecer_moldes_descobertos()
    session_pool._molde_recusado = False


def _fornecedor_que_fixa_com(molde_aceito):
    """Dublê da sonda: IP igual nas duas medições só para o molde certo."""
    def sonda(proxy, preflight=None):
        return {
            "linha_de_base": {"ips": ["1.1.1.1", "2.2.2.2"], "estavel": False},
            "candidatos": [{"molde": molde_aceito, "fixou": True}],
            "molde_aceito": molde_aceito,
            "conclusao": "fixou",
        }
    return sonda


def test_molde_descoberto_entra_na_url_da_conta():
    with patch.object(session_pool, "sondar_moldes", _fornecedor_que_fixa_com("-session-{sessao}")):
        session_pool.descobrir_molde(PROXY)

    moldado = session_pool.moldar_proxy_por_conta(PROXY, "conta-a")
    sessao = session_pool.sessao_da_conta("conta-a")
    assert f"-session-{sessao}" in moldado
    # Só o usuário muda: host, porta e senha continuam os mesmos.
    assert moldado.endswith(":SENHA@host.exemplo.io:11000")


def test_contas_diferentes_recebem_sessoes_diferentes():
    """É o ponto de tudo isto: cada conta com o seu identificador — e o seu IP."""
    with patch.object(session_pool, "sondar_moldes", _fornecedor_que_fixa_com(";session.{sessao}")):
        session_pool.descobrir_molde(PROXY)

    a = session_pool.moldar_proxy_por_conta(PROXY, "conta-a")
    b = session_pool.moldar_proxy_por_conta(PROXY, "conta-b")
    assert a != b
    assert session_pool.sessao_da_conta("conta-a") in a
    assert session_pool.sessao_da_conta("conta-b") in b


def test_sonda_roda_uma_vez_por_fornecedor():
    chamadas = []

    def sonda(proxy, preflight=None):
        chamadas.append(proxy)
        return {"molde_aceito": "-sid-{sessao}", "candidatos": [], "linha_de_base": {}}

    with patch.object(session_pool, "sondar_moldes", sonda):
        for conta in ("a", "b", "c", "d"):
            session_pool.descobrir_molde(PROXY)
            session_pool.moldar_proxy_por_conta(PROXY, conta)
        # Outro fornecedor é outra sondagem — e só uma.
        session_pool.descobrir_molde(OUTRO)
        session_pool.descobrir_molde(OUTRO)

    assert chamadas == [PROXY, OUTRO]


def test_ip_dedicado_nao_recebe_sufixo():
    """Linha de base estável = não há rotação a conter. URL intacta."""
    def sonda(proxy, preflight=None):
        return {"molde_aceito": "", "linha_de_base": {"estavel": True}, "candidatos": []}

    with patch.object(session_pool, "sondar_moldes", sonda):
        session_pool.descobrir_molde(PROXY)
    assert session_pool.moldar_proxy_por_conta(PROXY, "conta-a") == PROXY


def test_nenhum_molde_fixou_tambem_e_guardado():
    """Fornecedor que não fixa não pode ser sondado de novo a cada login."""
    chamadas = []

    def sonda(proxy, preflight=None):
        chamadas.append(1)
        return {"molde_aceito": None, "linha_de_base": {"estavel": False}, "candidatos": []}

    with patch.object(session_pool, "sondar_moldes", sonda):
        session_pool.descobrir_molde(PROXY)
        session_pool.descobrir_molde(PROXY)
    assert chamadas == [1]
    assert session_pool.moldar_proxy_por_conta(PROXY, "conta-a") == PROXY


def test_env_manda_e_a_sonda_nem_roda(monkeypatch):
    monkeypatch.setenv("PROXY_SESSAO_MOLDE", ";sticky.{sessao}")
    chamadas = []

    def sonda(proxy, preflight=None):
        chamadas.append(1)
        return {"molde_aceito": "-session-{sessao}", "candidatos": [], "linha_de_base": {}}

    with patch.object(session_pool, "sondar_moldes", sonda):
        assert session_pool.descobrir_molde(PROXY) == ";sticky.{sessao}"
    assert chamadas == []
    assert ";sticky." in session_pool.moldar_proxy_por_conta(PROXY, "conta-a")


def test_sonda_quebrada_nao_impede_o_login():
    def sonda(proxy, preflight=None):
        raise RuntimeError("ipify fora do ar")

    with patch.object(session_pool, "sondar_moldes", sonda):
        assert session_pool.descobrir_molde(PROXY) == ""
    # Segue sem molde — como antes — e a URL crua continua válida.
    assert session_pool.moldar_proxy_por_conta(PROXY, "conta-a") == PROXY


def test_desmoldar_reconhece_o_sufixo_descoberto():
    """`lembrar_proxy` recebe a URL já moldada e precisa recuperar a crua —
    com o molde descoberto, não só com o do `.env`."""
    with patch.object(session_pool, "sondar_moldes", _fornecedor_que_fixa_com("-session-{sessao}")):
        session_pool.descobrir_molde(PROXY)
    moldado = session_pool.moldar_proxy_por_conta(PROXY, "conta-a")
    assert moldado != PROXY
    assert session_pool.desmoldar(moldado, "conta-a") == PROXY

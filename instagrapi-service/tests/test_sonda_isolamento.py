# -*- coding: utf-8 -*-
"""
A sonda de molde testa ISOLAMENTO, não só stickiness.

── O que este teste protege

O bug que escondia o problema: a sonda aceitava um sufixo só por ele ser
sticky (mesma sessão → mesmo IP). Mas um fornecedor pode RECEBER o sufixo e
IGNORÁ-LO — aí toda sessão cai no mesmo IP fixo, sticky e inútil para separar
contas. Foi o caso do Axtron. A sonda agora exige as duas coisas: sticky E
sessões diferentes saindo por IPs diferentes. Sem a segunda, não adota.
"""
import re
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import session_pool  # noqa: E402

PROXY = "http://user__cr.br:pass@host.axtron.io:11000"


def _sessao_da_url(proxies):
    """O token mfsonda<n><a|b> que _com_sufixo embutiu no usuário."""
    url = proxies["http"]
    m = re.search(r"mfsonda\d+[ab]", url)
    return m.group(0) if m else "(base)"


def _resposta(texto):
    class R:
        pass
    r = R()
    r.text = texto
    return r


def test_fornecedor_que_isola_por_sessao_e_aceito():
    """Sessões diferentes → IPs diferentes. É o que deveria acontecer."""
    def fake_get(_url, proxies=None, timeout=None):
        sess = _sessao_da_url(proxies)
        # IP determinístico por sessão: mesma sessão = mesmo IP; sessão
        # diferente = IP diferente.
        ip = "10.0.0." + str(abs(hash(sess)) % 200 + 1)
        return _resposta(ip)

    with patch("requests.get", side_effect=fake_get):
        r = session_pool.sondar_moldes(PROXY)

    assert r["molde_aceito"], f"deveria ter adotado um molde, deu {r['molde_aceito']!r}"
    # O primeiro candidato é o formato __ do Axtron.
    assert r["molde_aceito"].startswith("__"), r["molde_aceito"]


def test_fornecedor_que_ignora_o_sufixo_nao_e_aceito():
    """Sticky, mas um IP só para tudo — o caso Axtron. NÃO pode adotar."""
    def fake_get(_url, proxies=None, timeout=None):
        return _resposta("179.241.236.26")   # sempre o mesmo, ignore a sessão

    with patch("requests.get", side_effect=fake_get):
        r = session_pool.sondar_moldes(PROXY)

    assert r["molde_aceito"] == "", f"não podia adotar molde, deu {r['molde_aceito']!r}"
    assert r["linha_de_base"]["estavel"] is True
    # A conclusão tem que mandar gerar credencial por conta, não dizer "ok".
    assert "credencial" in r["conclusao"].lower() and "conta" in r["conclusao"].lower()


def test_rotativo_puro_sem_fixacao_avisa_sticky():
    """IP muda a cada request e nenhum sufixo fixa → pedir sticky."""
    contador = {"n": 0}
    def fake_get(_url, proxies=None, timeout=None):
        contador["n"] += 1
        return _resposta(f"200.1.1.{contador['n'] % 250}")   # muda sempre

    with patch("requests.get", side_effect=fake_get):
        r = session_pool.sondar_moldes(PROXY)

    assert r["molde_aceito"] == ""
    assert r["linha_de_base"]["estavel"] is False
    assert "sticky" in r["conclusao"].lower()

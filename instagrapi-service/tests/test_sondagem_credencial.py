# -*- coding: utf-8 -*-
"""
Sondagem da credencial do proxy.

── O caso real

Duas credenciais do mesmo fornecedor, uma passa e a outra dá 407 NO_USER:

    global:  4f9c623f…__cr.br;state.saopaulo                   :823
    conta:   b6f6d9ca…__cr.br;state.minasgerais;city.alpercata :11000

Três diferenças ao mesmo tempo — usuário, porta e geografia — e o erro não diz
qual é a culpada. Testar à mão é uma combinatória, e cada tentativa é um login
que falha e assusta.

── O que estes testes protegem

Sobretudo a ORDEM. A sondagem tira parâmetros da direita para a esquerda, do
mais específico para o mais geral, e para no primeiro que passa. Invertida, ela
recomendaria jogar fora `;state.minasgerais` quando bastava soltar
`;city.alpercata` — e o proxy passaria a sair de outro estado, que pode ser
exatamente o que se estava comprando.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import sondagem_credencial as sc  # noqa: E402


CONTA = "http://b6f6d9ca__cr.br;state.minasgerais;city.alpercata:SENHA@host.axtron.io:11000"


class TestVariantesDeUsuario:
    def test_tira_um_parametro_por_vez_da_direita_para_a_esquerda(self):
        """Cidade é mais restritiva que estado, que é mais que país. Soltar na
        ordem inversa jogaria fora mais do que o necessário."""
        v = sc.variantes_de_usuario("b6f6d9ca__cr.br;state.minasgerais;city.alpercata")
        assert v == [
            "b6f6d9ca__cr.br;state.minasgerais;city.alpercata",
            "b6f6d9ca__cr.br;state.minasgerais",
            "b6f6d9ca__cr.br",
            "b6f6d9ca",
        ]

    def test_usuario_sem_parametros(self):
        assert sc.variantes_de_usuario("simples") == ["simples"]

    def test_so_pais(self):
        assert sc.variantes_de_usuario("a__cr.br") == ["a__cr.br", "a"]


class TestSondar:
    def test_para_na_primeira_que_passa(self):
        """Não continua testando depois de achar: as seguintes só perderiam
        mais parâmetros, e o objetivo é preservar o máximo."""
        tentadas = []

        def testar(url):
            tentadas.append(url)
            return "city.alpercata" not in url      # a cidade é a culpada

        r = sc.sondar(CONTA, testar=testar)

        assert r["ok"] is True
        assert "state.minasgerais" in r["recomendado"]   # o estado sobreviveu
        assert "city.alpercata" not in r["recomendado"]
        assert r["perdeu"] == ["city.alpercata"]
        assert len(tentadas) == 2                        # não foi além

    def test_diz_o_que_foi_perdido(self):
        """"Funciona" e "funciona, mas sai de outro estado" são respostas
        diferentes, e quem paga por geografia precisa saber qual recebeu."""
        r = sc.sondar(CONTA, testar=lambda u: ";" not in u.split("@")[0])
        assert r["ok"] is True
        assert set(r["perdeu"]) >= {"state.minasgerais", "city.alpercata"}

    def test_a_porta_original_vem_primeiro(self):
        """Se a original funcionar com menos parâmetros, não há motivo para
        sugerir trocar de porta também — cada mudança recomendada é uma que
        alguém vai ter de conferir."""
        vistas = []

        def testar(url):
            vistas.append(url)
            return len(vistas) >= 2      # falha a primeira, passa a segunda

        sc.sondar(CONTA, portas_extra=["823"], testar=testar)
        assert ":11000" in vistas[0]
        assert ":823" in vistas[1]

    def test_porta_alternativa_quando_nenhuma_variante_passa_na_original(self):
        r = sc.sondar(CONTA, portas_extra=["823"], testar=lambda u: ":823" in u)
        assert r["ok"] is True
        assert r["porta"] == "823"
        assert r["perdeu"] == []          # não precisou perder nada

    def test_nenhuma_variante_aceita(self):
        """O usuário simplesmente não existe mais. Dizer isso é melhor que
        listar dez tentativas e deixar a conclusão para quem lê."""
        r = sc.sondar(CONTA, testar=lambda u: False)
        assert r["ok"] is False
        assert "não existe mais" in r["erro"]
        assert len(r["tentativas"]) >= 4

    def test_respeita_o_teto_de_tentativas(self):
        """Cada tentativa é uma ida à rede. Sem teto, uma matriz de variantes
        por portas deixaria a tela parada por minutos."""
        r = sc.sondar(CONTA, portas_extra=["1", "2", "3", "4", "5", "6"],
                      testar=lambda u: False)
        assert len(r["tentativas"]) <= sc.MAX_TENTATIVAS

    def test_url_sem_forma_nao_quebra(self):
        for ruim in ["", "isso não é url", "http://sem-credencial.com"]:
            r = sc.sondar(ruim, testar=lambda u: True)
            assert r["ok"] is False
            assert "forma" in r["erro"]

    def test_a_senha_atravessa_intacta(self):
        """Perder a senha ao remontar produziria um 407 novo, causado pela
        própria sondagem — e ela seria lida como mais uma variante recusada."""
        r = sc.sondar(CONTA, testar=lambda u: True)
        assert ":SENHA@" in r["recomendado"]

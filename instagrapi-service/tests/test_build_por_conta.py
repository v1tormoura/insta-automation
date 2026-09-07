"""
A build do app do Instagram, por conta.

── O eixo que faltava

Usuários reais não estão todos na mesma build: cada um atualiza quando quer.
Toda conta anunciando exatamente a mesma versão do app é um sinal de GRUPO — o
mesmo raciocínio que fez a versão do Android virar um eixo no pool de aparelhos.

── Por que é opt-in, e não ligado por padrão

Variar a build tem um risco que variar o Android não tem: o Instagram RECUSA
login quando a build do payload foi descontinuada, e recusa com `bad_password`
— a conta parece estar com a senha errada. Uma build velha sorteada para uma
conta a deixaria sem entrar, com o erro apontando para o lugar errado. Já
aconteceu neste projeto, e foi o que criou a variável `INSTAGRAPI_APP_VERSION`.

Então `INSTAGRAPI_APP_VERSIONS` (plural) recebe só as builds que o operador já
verificou. Sem ela, nada muda.

── O que estes testes protegem

  ligado sem pedir       → conta que entrava para de entrar, com erro de senha
  trio desmontado        → app_version, version_code e bloks_versioning_id
                           descrevem a MESMA build; misturados, o pedido se
                           contradiz e o Instagram trata como cliente forjado
  build inventada        → `999.0.0.0.0` não existe em APP_SETTINGS e não pode
                           virar payload
  escolha instável       → conta que troca de versão do app entre dois logins é
                           um sinal, igual a trocar de aparelho
  ordem da lista importa → a mesma lista digitada em outra ordem daria outra
                           build para a mesma conta

Nenhum destes testes toca a rede.
"""
import importlib

import pytest

from app import session_pool as sp
from instagrapi import config as ig_config


TRES_CAMPOS = {"app_version", "version_code", "bloks_versioning_id"}


@pytest.fixture(autouse=True)
def ambiente_limpo(monkeypatch):
    """Sem as variáveis, para cada teste declarar o que precisa."""
    monkeypatch.delenv("INSTAGRAPI_APP_VERSION", raising=False)
    monkeypatch.delenv("INSTAGRAPI_APP_VERSIONS", raising=False)


def builds_reais():
    return sorted((getattr(ig_config, "APP_SETTINGS", {}) or {}).keys())


def test_sem_a_variavel_nada_muda():
    """
    O comportamento de antes, intocado: uma build para todas as contas.

    É o teste que impede o eixo de ser ligado por acidente — e ligar por
    acidente significa conta que entrava parando de entrar.
    """
    a = sp._build_do_app("conta_a")
    b = sp._build_do_app("conta_b")
    assert a["app_version"] == b["app_version"]


def test_com_a_lista_a_build_varia_entre_contas(monkeypatch):
    disponiveis = builds_reais()
    if len(disponiveis) < 2:
        pytest.skip("a biblioteca instalada tem menos de duas builds")

    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", ", ".join(disponiveis))
    vistas = {sp._build_do_app(f"conta{i}")["app_version"] for i in range(40)}
    # Com 40 contas e N builds, todas as N devem aparecer.
    assert vistas == set(disponiveis)


def test_a_escolha_e_estavel_para_a_mesma_conta(monkeypatch):
    """
    Conta que troca de versão do app entre dois logins é um sinal por si só —
    do mesmo jeito que trocar de aparelho.
    """
    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", ", ".join(builds_reais()))
    primeira = sp._build_do_app("conta_x")["app_version"]
    for _ in range(5):
        assert sp._build_do_app("conta_x")["app_version"] == primeira


def test_a_ordem_da_lista_nao_muda_a_escolha(monkeypatch):
    """
    A lista é ordenada antes do sorteio. Sem isso, reordenar a variável de
    ambiente trocaria a build de todas as contas de uma vez — e o log não
    diria por quê.
    """
    disponiveis = builds_reais()
    if len(disponiveis) < 2:
        pytest.skip("a biblioteca instalada tem menos de duas builds")

    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", ", ".join(disponiveis))
    numa_ordem = sp._build_do_app("conta_y")["app_version"]
    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", ", ".join(reversed(disponiveis)))
    na_outra = sp._build_do_app("conta_y")["app_version"]
    assert numa_ordem == na_outra


def test_o_trio_sai_sempre_coerente(monkeypatch):
    """
    Os três campos descrevem a MESMA build e não podem ser escolhidos
    separadamente: `app_version` e `version_code` vão no User-Agent,
    `bloks_versioning_id` vai no corpo. Misturados, o pedido se contradiz.
    """
    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", ", ".join(builds_reais()))
    for i in range(20):
        build = sp._build_do_app(f"conta{i}")
        assert TRES_CAMPOS.issubset(build.keys())
        # O trio tem de ser exatamente o que APP_SETTINGS guarda para aquela
        # versão — não uma montagem nossa.
        oficial = ig_config.APP_SETTINGS[build["app_version"]]
        for campo in TRES_CAMPOS:
            assert build[campo] == oficial[campo]


def test_build_inventada_na_lista_e_ignorada(monkeypatch):
    """
    `999.0.0.0.0` não existe em APP_SETTINGS. Aceitá-la montaria um payload
    que o Instagram trata como cliente forjado.
    """
    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", "999.0.0.0.0, nao-existe")
    escolhida = sp._build_do_app("conta_a")["app_version"]
    assert escolhida in builds_reais()


def test_lista_mista_usa_so_as_conhecidas(monkeypatch):
    """Uma entrada errada no meio não pode derrubar as certas."""
    disponiveis = builds_reais()
    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", f"999.0.0.0.0, {disponiveis[0]}")
    for i in range(10):
        assert sp._build_do_app(f"conta{i}")["app_version"] == disponiveis[0]


def test_sem_account_id_nao_sorteia(monkeypatch):
    """
    O sorteio precisa de uma chave estável. Sem conta, cai na build única em
    vez de escolher qualquer uma — que mudaria de chamada em chamada.
    """
    monkeypatch.setenv("INSTAGRAPI_APP_VERSIONS", ", ".join(builds_reais()))
    a = sp._build_do_app("")
    b = sp._build_do_app("")
    assert a["app_version"] == b["app_version"]


def test_a_variavel_singular_continua_valendo(monkeypatch):
    """
    Quem fixou uma build porque era a única que entrava não pode ver a fixação
    ignorada.
    """
    alvo = builds_reais()[0]
    monkeypatch.setenv("INSTAGRAPI_APP_VERSION", alvo)
    assert sp._build_do_app("conta_a")["app_version"] == alvo
    assert sp._build_do_app("conta_b")["app_version"] == alvo


def test_o_aparelho_recebe_a_build_da_conta(monkeypatch):
    """
    Um módulo perfeito que ninguém chama com o id da conta continuaria dando a
    mesma build para todas. `apply_deterministic_device` é quem junta hardware
    e build antes do `set_device`.
    """
    import inspect
    fonte = inspect.getsource(sp.apply_deterministic_device)
    assert "_build_do_app(account_id)" in fonte

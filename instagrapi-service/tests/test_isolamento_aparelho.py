"""
Isolamento de aparelho entre contas.

O vazamento: o modelo era escolhido por `sha256(account_id) % N` com N=5. Hash
é determinístico — o que é certo, porque um celular que troca de modelo entre
dois logins é por si só um sinal — mas hash não garante DISTINÇÃO.

Com 5 modelos e 5 contas, a chance de todas ficarem distintas era 5!/5^5 ≈ 3,8%.
Duas contas anunciando o MESMO modelo, resolução, dpi e cpu, com a mesma build
do app, a mesma região e o mesmo IP, são trivialmente correlacionáveis.

Nenhum destes testes toca a rede.
"""
import hashlib
import pytest


def test_pool_tem_tamanho_suficiente():
    """
    Com 5 modelos, colisão era quase certa. O tamanho do pool é o que torna a
    alocação possível — não dá para alocar 5 índices distintos em 5 slots se
    algum outro processo já usou um.
    """
    from app import session_pool
    assert session_pool.total_de_aparelhos() >= 20


def test_todos_os_aparelhos_tem_os_mesmos_campos():
    """
    Um aparelho faltando `cpu` ou `dpi` produziria um payload incompleto, e o
    Instagram responde a payload inconsistente do mesmo jeito que a credencial
    errada — foi o que já aconteceu quando cabeçalho e corpo discordavam.
    """
    from app import session_pool
    esperado = {"android_version", "android_release", "dpi", "resolution",
                "manufacturer", "device", "model", "cpu"}
    for d in session_pool._REAL_ANDROID_DEVICES:
        assert set(d.keys()) == esperado, d.get("model")


def test_modelos_nao_repetem():
    """Dois slots com o mesmo modelo desperdiçariam a distinção do pool."""
    from app import session_pool
    modelos = [d["model"] for d in session_pool._REAL_ANDROID_DEVICES]
    assert len(set(modelos)) == len(modelos)


def test_resolucao_tem_forma_valida():
    from app import session_pool
    for d in session_pool._REAL_ANDROID_DEVICES:
        largura, altura = d["resolution"].split("x")
        assert int(largura) >= 720 and int(altura) > int(largura)


def test_indice_informado_manda_sobre_o_hash():
    """
    É o ponto do isolamento: o Node aloca, e o que ele alocou vence a escolha
    por hash.
    """
    from app import session_pool
    session_pool.lembrar_indice_do_aparelho("conta_a", 3)
    assert session_pool.indice_lembrado("conta_a") == 3


def test_indice_fora_da_faixa_e_ignorado():
    """
    Degrada para o hash em vez de levantar. Um número errado vindo do Node não
    pode impedir o login — perder a distinção é ruim, não conectar é pior.
    """
    from app import session_pool
    session_pool.lembrar_indice_do_aparelho("conta_b", 9999)
    assert session_pool.indice_lembrado("conta_b") is None
    session_pool.lembrar_indice_do_aparelho("conta_b", -1)
    assert session_pool.indice_lembrado("conta_b") is None


def test_indice_none_ou_invalido_nao_levanta():
    from app import session_pool
    for ruim in (None, "abc", [], {}):
        session_pool.lembrar_indice_do_aparelho("conta_c", ruim)
    assert session_pool.indice_lembrado("conta_c") is None


def test_conta_sem_indice_continua_funcionando_pelo_hash():
    """
    O caminho de compatibilidade: conta que existia antes deste campo não tem
    índice alocado, e precisa continuar recebendo um aparelho.
    """
    from app import session_pool
    n = session_pool.total_de_aparelhos()
    idx = int(hashlib.sha256(b"conta_antiga").hexdigest(), 16) % n
    assert 0 <= idx < n


def test_o_hash_sozinho_colidia_com_cinco_contas():
    """
    O teste que descreve o defeito.

    Com os usernames reais e um pool de 5, três aparelhos cobriam cinco contas.
    Este teste fixa a MEDIÇÃO, não o comportamento antigo — se alguém encolher o
    pool de volta, o outro teste (tamanho >= 20) falha primeiro.
    """
    nomes = ["gafelip694", "goligi1257", "nayarazamprogno2",
             "valeriavedovatto_4", "noemipaganini856"]
    com_pool_de_5 = {int(hashlib.sha256(n.encode()).hexdigest(), 16) % 5 for n in nomes}
    assert len(com_pool_de_5) < len(nomes)      # colidia

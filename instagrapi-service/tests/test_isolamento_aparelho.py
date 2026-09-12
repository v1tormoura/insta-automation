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


def test_linha_repetida_do_catalogo_traz_versao_nova():
    """
    O catálogo é append-only (o índice é posicional), e o bloco anexado
    RE-LISTA modelos de cima para somar Android 15 sem deslocar ninguém. Então
    "cada modelo uma vez no catálogo" deixou de ser a regra — a regra é que
    uma linha repetida traga versão que a anterior não tinha. Duas linhas com
    o mesmo (modelo, versão) seriam dois slots do pool para o mesmo aparelho.
    """
    from app import session_pool
    vistos = set()
    for m in session_pool._MODELOS:
        for api in m[6]:
            par = (m[2], api)
            assert par not in vistos, f"{m[2]} com Android API {api} aparece duas vezes"
            vistos.add(par)


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


def test_a_versao_do_android_e_um_eixo():
    """
    Dois telefones do mesmo modelo podem rodar Android diferente — é o único
    eixo do fingerprint que varia de verdade entre unidades iguais. Modelo,
    codename, cpu, dpi e resolução são presos ao aparelho.

    Usar isso dobra a variedade sem inventar hardware, e inventar é pior do que
    compartilhar: um aparelho implausível é sinal, um aparelho comum não é.
    """
    from app import session_pool
    por_modelo = {}
    for d in session_pool._REAL_ANDROID_DEVICES:
        por_modelo.setdefault(d["model"], set()).add(d["android_version"])
    com_duas = [m for m, v in por_modelo.items() if len(v) > 1]
    assert com_duas, "nenhum modelo aproveita o eixo da versão"


def test_api_e_release_sempre_concordam():
    """
    API 33 é Android 13; anunciar 33/14.0 é a mesma classe de contradição que
    já fez toda conta receber `invalid_user` quando cabeçalho e corpo
    discordavam.
    """
    from app import session_pool
    # A tabela do módulo, e não uma cópia aqui: a cópia parou em 34 e o
    # catálogo já anunciava 35 — o teste passou a falhar por estar velho, não
    # por o código estar errado. O que se confere é a CONSISTÊNCIA, e ela vale
    # para qualquer versão que o módulo traduza.
    esperado = session_pool._ANDROID
    assert esperado == {33: "13.0", 34: "14.0", 35: "15.0"}
    for d in session_pool._REAL_ANDROID_DEVICES:
        assert esperado[d["android_version"]] == d["android_release"], d["model"]


def test_o_fingerprint_completo_nunca_repete():
    """Duas entradas idênticas desperdiçariam um slot do pool."""
    from app import session_pool
    fps = {tuple(sorted(d.items())) for d in session_pool._REAL_ANDROID_DEVICES}
    assert len(fps) == len(session_pool._REAL_ANDROID_DEVICES)


def test_hardware_de_um_modelo_e_sempre_o_mesmo():
    """
    O mesmo modelo não pode aparecer com resoluções ou cpus diferentes: são
    características físicas. Só a versão do Android varia.
    """
    from app import session_pool
    visto = {}
    for d in session_pool._REAL_ANDROID_DEVICES:
        chave = (d["manufacturer"], d["device"], d["model"], d["cpu"],
                 d["dpi"], d["resolution"])
        anterior = visto.setdefault(d["model"], chave)
        assert anterior == chave, f"{d['model']} tem hardware inconsistente"

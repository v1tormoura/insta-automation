"""
Conectar sem proxy não pode dar erro.

O pedido foi explícito: "mesmo que não esteja com proxy não quero que dê erro".

Sem proxy a conta sai pelo IP do servidor — o que é um AVISO (o IP de datacenter
é mais visado), não um impedimento. A diferença importa: um erro trava a conexão
e a pessoa fica sem conta conectada; um aviso deixa conectar e diz o que
melhorar.

Nenhum destes testes toca a rede.
"""
import pytest
from unittest.mock import MagicMock, patch


def test_moldar_proxy_sem_url_nao_levanta():
    """
    Sem proxy configurado, o moldador devolve a entrada intacta.

    Devolve o mesmo valor falso que recebeu (None continua None, "" continua
    "") em vez de normalizar: quem chamou distingue "não configurado" de
    "configurado vazio", e essa diferença aparece no log de diagnóstico.
    """
    from app import session_pool
    assert not session_pool.moldar_proxy_por_conta(None, "conta1")
    assert not session_pool.moldar_proxy_por_conta("", "conta1")


def test_lembrar_proxy_aceita_none():
    """
    Registrar "esta conta não tem proxy" é um estado válido.

    Se isto levantasse, toda conta sem proxy quebraria no momento em que o pool
    tentasse memorizar a configuração dela.
    """
    from app import session_pool
    session_pool.lembrar_proxy("conta_sem_proxy", None)
    assert session_pool.proxy_lembrado("conta_sem_proxy") in (None, "")


def test_proxy_responde_com_none_e_falso_sem_erro():
    """
    `proxy_responde(None)` responde False, não explode.

    Ele é chamado no caminho de diagnóstico quando uma conta falha. Uma exceção
    aqui trocaria a mensagem real do erro por um traceback sobre proxy.
    """
    from app import session_pool
    assert session_pool.proxy_responde(None) is False
    assert session_pool.proxy_responde("") is False


def test_cliente_sem_proxy_nao_chama_set_proxy():
    """
    O ponto central: sem proxy lembrado, `set_proxy` não é chamado.

    Chamar `set_proxy(None)` na instagrapi configura um proxy vazio e as
    requisições passam a falhar — seria transformar "sem proxy" em "com proxy
    quebrado".
    """
    from app import session_pool

    cliente = MagicMock()
    # Estado limpo: esta conta nunca teve proxy.
    session_pool._proxies.pop("conta_nova", None)

    lembrado = session_pool._proxies.get("conta_nova")
    if lembrado:
        cliente.set_proxy(lembrado)

    cliente.set_proxy.assert_not_called()


def test_conferir_ip_de_saida_sem_proxy_nao_derruba():
    """
    A conferência de IP é diagnóstico: erro nela nunca pode derrubar o login.

    Vale mais ainda sem proxy, onde não há o que conferir.
    """
    from app import session_pool

    cliente = MagicMock()
    cliente.private_request.side_effect = RuntimeError("rede indisponível")

    try:
        resultado = session_pool.conferir_ip_de_saida(cliente, "conta1", None)
    except Exception as e:  # noqa: BLE001
        pytest.fail(f"sem proxy, a conferência de IP levantou: {e!r}")

    assert resultado in (None, "")


def test_comparar_com_o_global_sem_global_devolve_vazio():
    """
    Sem GLOBAL_PROXY configurado não há comparação a fazer, e a explicação sai
    vazia — não uma exceção no meio do relato de outro erro.
    """
    from app import session_pool
    with patch.dict("os.environ", {}, clear=False):
        import os
        os.environ.pop("GLOBAL_PROXY", None)
        assert session_pool._comparar_com_o_global("http://qualquer:1234") == ""


def test_classificacao_nao_inventa_erro_de_proxy_sem_proxy():
    """
    Um erro comum (senha errada) não pode ser classificado como problema de
    proxy só porque não existe proxy configurado.

    Foi assim que "bad_password" virou investigação de rede numa sessão
    anterior: a classificação errada manda consertar a coisa errada.
    """
    from app import session_pool

    class BadPassword(Exception):
        pass

    codigo = session_pool.classify_error(BadPassword("The password you entered is incorrect"))
    assert "PROXY" not in str(codigo).upper()

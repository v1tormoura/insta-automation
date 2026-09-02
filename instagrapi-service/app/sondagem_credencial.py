"""
Qual variante desta credencial de proxy o fornecedor aceita?

── A pergunta que isto responde

Duas credenciais do mesmo fornecedor, uma funciona e a outra dá 407 NO_USER:

    global:  4f9c623f…__cr.br;state.saopaulo            :823    ← passa
    conta:   b6f6d9ca…__cr.br;state.minasgerais;city.alpercata :11000  ← NO_USER

Três diferenças ao mesmo tempo — usuário, porta e parâmetros de geografia — e
`NO_USER` não diz qual delas é a culpada. Olhar não separa; medir separa.

── Como mede

Vai tirando os parâmetros do nome de usuário da direita para a esquerda, e
prova cada versão nas portas candidatas. O primeiro par que atravessa é a
resposta, e é uma URL pronta para colar — não um palpite sobre o que talvez
funcione.

A ordem importa: as variantes mais parecidas com a original vêm primeiro, para
a recomendação preservar o máximo do que foi pedido. Perder `;state.minasgerais`
troca o estado de saída, e isso pode ser exatamente o que se estava comprando.

── O que ela não faz

Não tenta login, não lê senha de conta, e não escreve o proxy em log. A
credencial volta na resposta porque quem pediu a sondagem é o dono dela e vai
precisar dela para colar — a mesma que a tela de Proxies já mostra.
"""

from __future__ import annotations

import logging
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

# Teto de tentativas. Cada uma é uma ida à rede; uma matriz de 5 variantes por
# 4 portas seriam vinte esperas de oito segundos numa tela travada.
MAX_TENTATIVAS = 12
TIMEOUT = 8.0


def _partes(url: str):
    """(esquema, usuario, senha, host, porta) — ou None se a URL não tem forma."""
    try:
        p = urlsplit(url)
        if not p.hostname or p.username is None:
            return None
        return (p.scheme or "http", p.username, p.password or "", p.hostname,
                str(p.port or ""))
    except ValueError:
        return None


def variantes_de_usuario(usuario: str) -> list[str]:
    """
    O usuário com um parâmetro a menos por vez, da direita para a esquerda.

    `b6f6d9ca__cr.br;state.minasgerais;city.alpercata` produz, nesta ordem:

        b6f6d9ca__cr.br;state.minasgerais;city.alpercata   (como veio)
        b6f6d9ca__cr.br;state.minasgerais                  (sem a cidade)
        b6f6d9ca__cr.br                                    (só o país)
        b6f6d9ca                                           (sem nada)

    Da direita porque é a ordem do específico para o geral: cidade é mais
    restritiva que estado, que é mais que país. Um fornecedor que não atende
    Alpercata recusa a cidade e aceita o estado — e é essa a granularidade que
    a pessoa quer descobrir sem perder mais do que precisa.
    """
    fora = [usuario]
    atual = usuario
    while ";" in atual:
        atual = atual.rsplit(";", 1)[0]
        fora.append(atual)
    # O separador de país é `__`, e não `;` — some por último.
    if "__" in atual:
        fora.append(atual.split("__", 1)[0])
    return fora


def montar(esquema, usuario, senha, host, porta) -> str:
    return f"{esquema}://{usuario}:{senha}@{host}:{porta}"


def sondar(proxy: str, portas_extra=None, testar=None) -> dict:
    """
    @param testar — injetado nos testes; recebe a URL e devolve True se passou.
    """
    if testar is None:
        testar = _responde

    partes = _partes(proxy)
    if not partes:
        return {"ok": False, "erro": "URL de proxy sem forma reconhecível.",
                "tentativas": []}

    esquema, usuario, senha, host, porta = partes

    # A porta original primeiro: se ela funcionar com menos parâmetros, não há
    # motivo para sugerir trocar de porta também.
    portas = [porta] + [p for p in (portas_extra or []) if p and p != porta]

    tentativas = []
    for usuario_v in variantes_de_usuario(usuario):
        for porta_v in portas:
            if len(tentativas) >= MAX_TENTATIVAS:
                break
            url = montar(esquema, usuario_v, senha, host, porta_v)
            passou = bool(testar(url))
            tentativas.append({
                "usuario": usuario_v,
                "porta": porta_v,
                "ok": passou,
                # O que foi perdido em relação ao original, para a pessoa
                # decidir se o preço vale: "funciona, mas sai de outro estado"
                # é uma resposta diferente de "funciona".
                "perdeu": _perdeu(usuario, usuario_v),
            })
            if passou:
                return {
                    "ok": True,
                    "recomendado": url,
                    "usuario": usuario_v,
                    "porta": porta_v,
                    "perdeu": _perdeu(usuario, usuario_v),
                    "tentativas": tentativas,
                }
        if len(tentativas) >= MAX_TENTATIVAS:
            break

    return {
        "ok": False,
        "erro": "Nenhuma variante desta credencial foi aceita. O usuário do "
                "proxy provavelmente não existe mais no fornecedor.",
        "tentativas": tentativas,
    }


def _perdeu(original: str, variante: str) -> list[str]:
    """Os parâmetros que a variante deixou de fora."""
    def params(u):
        corpo = u.split("__", 1)[1] if "__" in u else ""
        return [p for p in corpo.split(";") if p]
    faltando = [p for p in params(original) if p not in params(variante)]
    if "__" in original and "__" not in variante:
        faltando.append(original.split("__", 1)[1].split(";")[0])
    return faltando


def _responde(url: str) -> bool:
    try:
        import requests
        r = requests.get("https://api.ipify.org",
                         proxies={"http": url, "https": url}, timeout=TIMEOUT)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False

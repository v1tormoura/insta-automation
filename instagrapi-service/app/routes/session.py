import asyncio
import logging
import time
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

# ── Instagrapi exceptions — module-level import (fail fast on startup) ────────
# Do NOT use a try/except ImportError fallback here. If instagrapi is not
# properly installed, the service must refuse to start — creating stub exception
# classes would silently swallow real Instagram exceptions in the wrong handler.
from uuid import uuid4

from instagrapi.exceptions import (
    BadPassword,
    ChallengeRequired,
    FeedbackRequired,
    LoginRequired,
    TwoFactorRequired,
    UnknownError,
)

from ..models import (
    LoadRequest,
    EvictRequest,
    LoginRequest,
    TwoFactorVerifyRequest,
    SessionIdLoginRequest,
    ChallengeCodeRequest,
    DiagnosticoRequest,
    SondarCredencialRequest,
)
from .. import session_pool, sondagem_credencial

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/session")


# ── /session/load ──────────────────────────────────────────────────────────────

@router.post("/load")
async def load_session(body: LoadRequest):
    """
    Load a previously-saved session (fetched from MongoDB by Node.js) into the in-memory pool.
    Idempotent — safe to call again after a Python service restart.
    """
    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            client.set_settings(body.settings)
            if body.proxy:
                client.set_proxy(body.proxy)
            session_pool.lembrar_proxy(body.account_id, body.proxy)
        except Exception as e:
            logger.exception("load_session: set_settings failed for %s", body.account_id)
            raise HTTPException(status_code=422, detail=f"Configurações de sessão inválidas: {e}")
    return {"ok": True}


# ── /session/status ────────────────────────────────────────────────────────────

@router.get("/status")
async def session_status(account_id: str):
    """Return whether this account has a client loaded in the in-memory pool."""
    return {"loaded": session_pool.is_loaded(account_id)}


# ── /session/login ─────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest):
    """
    Perform a fresh login with username + password.

    Returns:
    - HTTP 200 {"status": "AUTHENTICATED", "settings": {...}} on success
    - HTTP 202 {"status": "TWO_FACTOR_REQUIRED"}  — user must supply the 2FA code
    - HTTP 429 {"code": "RATE_LIMITED", ...}       — Instagram rate-limited this IP
    - HTTP 428 {"code": "CHALLENGE_REQUIRED", ...} — challenge required in the app
    - HTTP 422 {"code": "BAD_PASSWORD", ...}       — wrong credentials
    - HTTP 403 {"code": "FEEDBACK_REQUIRED", ...}  — Instagram action block

    SECURITY: the password travels in-memory only — it is NEVER stored or logged.
    Only account_id and error type/code are written to logs.
    """
    # Comprimento e faixa de caracteres da senha — NUNCA a senha. Serve para
    # provar se ela chega íntegra do navegador até aqui: há .trim() no frontend e
    # no Node, e caractere fora de ASCII pode se perder na serialização. Se este
    # número diferir do que o Node registrou, o defeito é nosso, não do Instagram.
    session_pool._slog(
        "LOGIN_ATTEMPT",
        body.account_id,
        username=body.username,
        password_len=len(body.password),
        password_ascii=body.password.isascii(),
    )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        # Use account proxy if provided, otherwise fallback to global proxy
        proxy = body.proxy or os.getenv('GLOBAL_PROXY')
        if proxy:
            # Molda a sessão fixa antes de aplicar: o proxy é rotativo, e sem o
            # identificador por conta o IP mudaria a cada conexão.
            proxy = session_pool.moldar_proxy_por_conta(proxy, body.account_id)
            client.set_proxy(proxy)
        session_pool.lembrar_proxy(body.account_id, proxy)

        # De onde este login sai. O painel testa o proxy por um caminho e o
        # login usa outro — sem registrar aqui, "o proxy está ativo" e "o
        # login passou pelo proxy" viram a mesma frase, e não são.
        #
        # Só host e porta: usuário e senha do proxy são credenciais e não
        # entram em log. `origem` diz de qual configuração ele veio, porque
        # proxy por conta e proxy global falham por motivos diferentes.
        session_pool._slog(
            "LOGIN_ROTA",
            body.account_id,
            proxy=_mascarar_proxy(proxy),
            # A origem vem do Node, que é quem sabe: aqui só chega a URL.
            origem=(getattr(body, "proxy_origem", None)
                    or ("global_env" if proxy else "direto")),
            # Se o nosso sufixo de sessão está nesta URL. O `_mascarar_proxy`
            # esconde o usuário — corretamente, é credencial — e com isso o log
            # deixava de responder a pergunta mais frequente diante de um 407:
            # "o fornecedor recusou a credencial, ou recusou o que a gente
            # acrescentou nela?". Um booleano resolve sem expor nada.
            moldado=bool(proxy and session_pool._sufixo_do_molde(body.account_id)
                         and session_pool._sufixo_do_molde(body.account_id) in proxy),
        )

        # E de qual IP o Instagram vai enxergar esta sessão. A linha acima diz
        # o que pedimos; esta diz o que acontece — sai pela MESMA sessão que o
        # login usa, com os mesmos proxies. Um proxy que aceita a conexão e
        # ainda assim sai pelo IP do servidor falha em silêncio, e só a
        # medição separa isso de "configurado corretamente".
        # A sondagem agora LEVANTA quando o proxy recusa a credencial, em vez de
        # seguir sem a medição. Ela roda fora do `try` que classifica erros de
        # login, então a classificação precisa acontecer aqui — sem isto, a
        # recusa viraria um 500 sem diagnóstico, que é pior que os 31 segundos
        # que ela veio economizar.
        try:
            await loop_ip_de_saida(client, body.account_id, proxy)
        except Exception as e:  # noqa: BLE001
            if session_pool._e_recusa_de_proxy(e):
                session_pool._slog(
                    "LOGIN_ABORTADO_NA_SONDAGEM", body.account_id,
                    motivo="o proxy recusou a credencial; as seis requisicoes do "
                           "login receberiam a mesma resposta",
                )
                await session_pool.remove_entry(body.account_id)
                _raise_for_code("PROXY_ERROR", e, (body.password,),
                                account_id=body.account_id)
            raise

        # Run the blocking Instagram I/O in a thread so the asyncio event loop
        # stays responsive to other requests during the 20-90 s login round-trip.
        loop = asyncio.get_running_loop()
        session_pool._slog("LOGIN_FLOW_START", body.account_id)  # [TEMP-DEBUG]
        t0 = time.perf_counter()
        try:
            await loop.run_in_executor(None, lambda: client.login(
                body.username,
                body.password,
                verification_code=body.verification_code or "",
            ))
        except TwoFactorRequired as e:
            # Store the exception (not the password) — verify-2fa uses it to
            # extract two_step_verification_context via _login_with_bloks_two_factor.
            # Passa o client: o payload do 2FA vive em client.last_json, que é a
            # fonte que o próprio instagrapi.login() usa.
            session_pool.store_pending_2fa(body.account_id, body.username, e, client)
            logger.info(
                "login: TWO_FACTOR_REQUIRED for account %s (type=%s) duration_ms=%d",
                body.account_id, type(e).__name__, int((time.perf_counter() - t0) * 1000),
            )
            return JSONResponse(status_code=202, content={
                "status":  "TWO_FACTOR_REQUIRED",
                "message": "Digite o código enviado pelo seu método de autenticação.",
            })
        except ChallengeRequired as e:
            # Dois fluxos distintos, e tratar o errado deixa o usuário esperando
            # um código que nunca chega.
            # O payload vem da EXCEÇÃO, não de client.last_json: esse estado é
            # sobrescrito pela requisição seguinte, e ler dali classificava
            # desafio de aprovação como se fosse de código.
            payload = session_pool.payload_do_desafio(e, client)
            kind = session_pool.detect_challenge_kind(e, client)
            duration_ms = int((time.perf_counter() - t0) * 1000)

            if kind == "approval":
                # Bloks redirect: o app oficial mostra "tentativa de login" e o
                # usuário aprova ali. Nenhum código é enviado. O client é mantido
                # no pool e o payload guardado — o dismiss precisa dos dois.
                session_pool.store_pending_approval(body.account_id, client, body.username, payload)
                logger.info(
                    "login: CHALLENGE_REQUIRED (approval) for account %s duration_ms=%d",
                    body.account_id, duration_ms,
                )
                return JSONResponse(status_code=202, content={
                    "status":  "CHALLENGE_REQUIRED",
                    "kind":    "approval",
                    "channel": None,
                    "message": "Aprove a tentativa de login no app do Instagram e depois confirme aqui.",
                })

            # Contact form: o instagrapi escolhe o canal, dispara o código e fica
            # aguardando numa thread até /session/challenge-code entregar o valor.
            # Usa o payload da exceção pelo mesmo motivo da detecção acima.
            session_pool.start_challenge(body.account_id, client, payload, body.username)
            # wait_challenge_target faz polling com sleep — precisa sair do event
            # loop, senão congela o serviço inteiro enquanto espera o canal.
            canal = await loop.run_in_executor(
                None, lambda: session_pool.wait_challenge_target(body.account_id)
            )
            logger.info(
                "login: CHALLENGE_REQUIRED (code) for account %s — canal=%s duration_ms=%d",
                body.account_id, canal or "desconhecido", duration_ms,
            )
            return JSONResponse(status_code=202, content={
                "status":  "CHALLENGE_REQUIRED",
                "kind":    "code",
                "channel": canal,
                "message": (
                    f"O Instagram enviou um código por {canal}. Digite-o para concluir."
                    if canal else
                    "O Instagram enviou um código de verificação. Digite-o para concluir."
                ),
            })
        except Exception as e:
            code = session_pool.classify_error(e)

            # ── O 407 que era culpa nossa ────────────────────────────────
            #
            # Antes de declarar a falha, uma pergunta: o proxy recusou a
            # CREDENCIAL, ou recusou o sufixo de sessão que nós acrescentamos
            # ao nome de usuário? A resposta sai de uma medição — a URL crua
            # funciona? — e não de um palpite.
            #
            # Se foi o sufixo, o molde é desligado e o login é REFEITO aqui
            # mesmo. Sem isso, quem está conectando veria um erro de proxy,
            # iria conferir o proxy (que está bom), e voltaria para tentar de
            # novo com o mesmo sufixo — o laço que fez esta conta não conectar
            # por dias.
            if code == "PROXY_ERROR" and session_pool.conferir_molde_recusado(body.account_id):
                cru = session_pool.proxy_lembrado(body.account_id)
                client.set_proxy(cru)
                session_pool._slog("LOGIN_REFEITO_SEM_MOLDE", body.account_id)
                try:
                    await loop.run_in_executor(None, lambda: client.login(
                        body.username,
                        body.password,
                        verification_code=body.verification_code or "",
                    ))
                    settings = client.get_settings()
                    session_pool._slog("LOGIN_SUCCESS", body.account_id, sem_molde=True)
                    return {"status": "AUTHENTICATED", "settings": settings}
                except Exception as e2:  # noqa: BLE001
                    # A segunda tentativa manda. Insistir de novo repetiria o
                    # mesmo caminho, e o molde já está desligado para sempre.
                    e = e2
                    code = session_pool.classify_error(e2)

            duration_ms = int((time.perf_counter() - t0) * 1000)
            # exc_msg: safe to log — exception messages never contain the password,
            # they contain HTTP error details (status codes, URLs, response fragments).
            exc_msg = str(e)[:250]
            # Metadados da resposta do Instagram — error_type diferencia senha
            # realmente errada de bloqueio disfarçado de erro de credencial.
            meta = _login_error_metadata(e, client)
            logger.warning(
                "[TEMP-DEBUG] login: %s for account %s (type=%s) duration_ms=%d exc=%s%s",
                code, body.account_id, type(e).__name__, duration_ms, exc_msg, meta,
            )
            # Evict the failed client from the pool so ensureSession doesn't treat
            # this entry as a loaded session on subsequent restore attempts.
            await session_pool.remove_entry(body.account_id)
            _raise_for_code(code, e, (body.password,), extra=meta, account_id=body.account_id)

        settings = client.get_settings()

    session_pool._slog("LOGIN_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/diagnostico ───────────────────────────────────────────────────────

@router.post("/diagnostico")
async def diagnostico(body: DiagnosticoRequest):
    """
    De onde as nossas requisições estão saindo, e o Instagram fala com a gente?

    Existe para separar duas causas que produzem o MESMO erro na tela. Quando
    o login falha com `bad_password` em todas as contas ao mesmo tempo, ou as
    senhas estão erradas, ou o Instagram está recusando o nosso IP e
    disfarçando a recusa de erro de credencial. A mensagem é idêntica nos dois
    casos, então não dá para decidir olhando a tela — e depurar a hipótese
    errada custa horas.

    O que este endpoint responde, sem tocar em senha e sem gastar uma
    tentativa de login:

    - `ip_de_saida`: o IP que o Instagram enxerga. Se for o do servidor
      mesmo com proxy configurado, o proxy não está sendo aplicado.
    - `proxy_aplicado`: se o cliente desta conta está com proxy (mascarado).
    - `handshake`: se `qe/sync` devolve a chave de criptografia de senha. Sem
      ela o `enc_password` sai inválido e o Instagram responde `bad_password`
      com a senha certa.
    - `identidade`: build e aparelho que estamos anunciando, para conferir de
      fora que o User-Agent e o corpo concordam.

    Interpretação: handshake OK + IP do servidor + falha em todas as contas
    aponta para bloqueio de IP, e a saída é proxy por conta. Handshake OK +
    IP de proxy + falha só em algumas contas aponta para credencial.
    """
    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        proxy = body.proxy or os.getenv("GLOBAL_PROXY")
        if proxy:
            # Molda a sessão fixa antes de aplicar: o proxy é rotativo, e sem o
            # identificador por conta o IP mudaria a cada conexão.
            proxy = session_pool.moldar_proxy_por_conta(proxy, body.account_id)
            client.set_proxy(proxy)
        session_pool.lembrar_proxy(body.account_id, proxy)

        loop = asyncio.get_running_loop()
        resultado = await loop.run_in_executor(None, lambda: _coletar_diagnostico(client, proxy))

    session_pool._slog("DIAGNOSTICO", body.account_id, **{
        k: v for k, v in resultado.items() if k != "identidade"
    })
    return resultado


@router.post("/sondar-credencial")
async def sondar_credencial(body: SondarCredencialRequest):
    """
    Qual variante desta credencial o fornecedor aceita?

    Existe para um caso concreto: duas credenciais do mesmo fornecedor, uma
    passa e a outra dá 407 NO_USER, com tres diferencas ao mesmo tempo —
    usuario, porta e parametros de geografia. O erro nao diz qual delas e a
    culpada, e testar a mao e uma combinatoria.

    Nao tenta login e nao le senha de conta. A resposta traz a URL que
    funcionou, pronta para colar, e o que ela deixou pelo caminho.
    """
    resultado = sondagem_credencial.sondar(body.proxy, body.portas)
    # O proxy nao entra em log — nem o testado, nem o recomendado.
    session_pool._slog(
        "SONDAGEM_CREDENCIAL", "-",
        variantes=len(resultado.get("tentativas", [])),
        achou=resultado.get("ok", False),
    )
    return resultado


@router.post("/sondar-proxy")
async def sondar_proxy(body: DiagnosticoRequest):
    """
    Qual parâmetro faz ESTE fornecedor fixar o IP?

    ── Por que descobrir por medição

    Todo fornecedor residencial oferece sessão fixa, e cada um usa uma sintaxe
    diferente dentro do nome de usuário — `;session.`, `-sessid-`, `_session-`.
    A documentação nem sempre diz qual, e a errada é aceita em silêncio: o
    fornecedor ignora o parâmetro desconhecido e continua rotacionando. O
    sintoma aparece só no login, disfarçado de senha errada.

    Aqui cada candidato é medido: duas requisições com o mesmo identificador.
    IP igual nas duas significa que o parâmetro foi entendido e o IP ficou
    preso. IP diferente significa que o fornecedor ignorou.

    Nenhum login é tentado, nenhuma credencial é lida. O que sai na resposta é
    o molde a pôr em `PROXY_SESSAO_MOLDE` — o proxy em si nunca é impresso.
    """
    proxy = body.proxy or os.getenv("GLOBAL_PROXY")
    if not proxy:
        raise HTTPException(status_code=400, detail={
            "code": "SEM_PROXY",
            "message": "Nenhum proxy informado nem configurado.",
        })

    loop = asyncio.get_running_loop()
    resultado = await loop.run_in_executor(None, lambda: _sondar_moldes(proxy))
    session_pool._slog("SONDAR_PROXY", body.account_id or "-",
                       aceito=resultado.get("molde_aceito"),
                       testados=len(resultado.get("candidatos", [])))
    return resultado


# Sufixos que os fornecedores residenciais usam para fixar o IP. A ordem segue
# a frequência com que aparecem — o primeiro que fixar encerra a busca.
_MOLDES_CANDIDATOS = [
    ";session.{sessao}",
    "-session-{sessao}",
    "-sessid-{sessao}",
    "_session-{sessao}",
    ";sessid.{sessao}",
    ";sid.{sessao}",
    ";sticky.{sessao}",
    "-sid-{sessao}",
]


def _preflight_proxy(url: str) -> dict:
    """
    Separa REDE de CREDENCIAL de PARSING quando o proxy recusa.

    ── Por que em camadas

    "ProxyError" é uma palavra só para quatro coisas: o nome não resolve, a
    porta não abre, o fornecedor recusou a credencial, ou a biblioteca montou
    a requisição errado. As quatro têm soluções diferentes, e a mensagem
    "confira credencial e porta" manda investigar duas delas ignorando as
    outras duas.

    ── A quarta é a que ninguém procura

    O mesmo proxy funciona pelo Node e falha pelo Python. Quando isso acontece
    com uma credencial que tem `;` ou `_` no usuário — comum em fornecedor com
    parâmetro de geolocalização — a suspeita é como cada biblioteca monta o
    cabeçalho a partir da URL.

    Por isso o teste 3 monta o `Proxy-Authorization` À MÃO, com os mesmos bytes
    que o Node manda, e os testes 4 e 5 deixam o `requests` montar — cru e com
    o usuário percent-codificado. Se o 3 passa e o 4 falha, o problema não é o
    proxy nem a senha: é a tradução da URL.
    """
    import base64
    import socket
    from urllib.parse import urlsplit, quote

    r: dict = {}
    p = urlsplit(url if "://" in url else "http://" + url)
    host, porta = p.hostname, (p.port or 80)
    usuario = p.username or ""
    senha = p.password or ""
    r["destino"] = f"{host}:{porta}"

    # 1. O nome resolve?
    try:
        r["dns"] = socket.gethostbyname(host)
    except Exception as e:  # noqa: BLE001
        r["dns"] = f"FALHOU ({type(e).__name__})"
        r["conclusao"] = "O nome do proxy não resolve DNS de dentro do contêiner."
        return r

    # 2. A porta abre?
    try:
        with socket.create_connection((host, porta), timeout=10):
            r["tcp"] = "abre"
    except Exception as e:  # noqa: BLE001
        r["tcp"] = f"FALHOU ({type(e).__name__})"
        r["conclusao"] = "A porta não abre. Firewall, porta errada, ou fornecedor fora."
        return r

    # 3. CONNECT com o cabeçalho montado à mão — os mesmos bytes do Node.
    def _connect_manual() -> str:
        cred = base64.b64encode(f"{usuario}:{senha}".encode()).decode()
        pedido = (
            "CONNECT api.ipify.org:443 HTTP/1.1\r\n"
            "Host: api.ipify.org:443\r\n"
            f"Proxy-Authorization: Basic {cred}\r\n"
            "\r\n"
        ).encode()
        with socket.create_connection((host, porta), timeout=15) as sock:
            sock.sendall(pedido)
            resposta = sock.recv(256).decode("latin-1", "replace")
        return resposta.split("\r\n", 1)[0].strip()


    try:
        r["connect_manual"] = _connect_manual()
    except Exception as e:  # noqa: BLE001
        r["connect_manual"] = f"FALHOU ({type(e).__name__})"

    # 4 e 5. Deixando o `requests` montar: URL crua e com o usuário codificado.
    import requests

    def _via_requests(u: str) -> str:
        try:
            resp = requests.get("https://api.ipify.org", proxies={"http": u, "https": u}, timeout=20)
            return f"OK {resp.text.strip()}"
        except Exception as e:  # noqa: BLE001
            return f"FALHOU ({type(e).__name__})"

    r["requests_cru"] = _via_requests(url)
    url_codificada = f"{p.scheme}://{quote(usuario, safe='')}:{quote(senha, safe='')}@{host}:{porta}"
    r["requests_codificado"] = _via_requests(url_codificada)

    manual_ok = r["connect_manual"].startswith("HTTP/1.1 200") or r["connect_manual"].startswith("HTTP/1.0 200")
    cru_ok = r["requests_cru"].startswith("OK")
    cod_ok = r["requests_codificado"].startswith("OK")

    if cru_ok:
        r["conclusao"] = "O proxy responde normalmente pelo requests. O erro é outro."
    elif cod_ok:
        r["conclusao"] = (
            "Funciona SÓ com o usuário percent-codificado. A credencial tem "
            "caractere que o requests não traduz sozinho — é preciso codificar "
            "antes de entregar a URL à biblioteca."
        )
    elif manual_ok:
        r["conclusao"] = (
            "O proxy ACEITA a credencial no CONNECT montado à mão, e recusa "
            "quando o requests monta. O problema é a tradução da URL, não o "
            "proxy nem a senha."
        )
    else:
        r["conclusao"] = (
            "O proxy recusa a credencial em todas as formas. Aí é o fornecedor: "
            "senha trocada, assinatura vencida ou saldo zerado. Resposta ao "
            f"CONNECT: {r['connect_manual']}"
        )
    return r


def _sondar_moldes(proxy: str) -> dict:
    """Mede cada candidato duas vezes. IP igual = o fornecedor entendeu."""
    import requests

    def _ip(url: str) -> str | None:
        p = {"http": url, "https": url}
        return requests.get("https://api.ipify.org", proxies=p, timeout=25).text.strip()

    def _com_sufixo(url: str, sufixo: str) -> str:
        esquema, resto = url.split("://", 1)
        credenciais, destino = resto.rsplit("@", 1)
        usuario, senha = credenciais.split(":", 1)
        return f"{esquema}://{usuario}{sufixo}:{senha}@{destino}"

    saida = {"linha_de_base": None, "candidatos": [], "molde_aceito": None, "erros": []}

    # Linha de base: sem parâmetro nenhum. Se já for estável, o proxy é
    # dedicado e não há rotação para conter — nenhum molde é necessário.
    try:
        a, b = _ip(proxy), _ip(proxy)
        saida["linha_de_base"] = {"ips": sorted({a, b}), "estavel": a == b}
        if a == b:
            saida["molde_aceito"] = ""
            saida["conclusao"] = (
                "O proxy já entrega IP fixo sem parâmetro nenhum. "
                "Deixe PROXY_SESSAO_MOLDE vazio."
            )
            return saida
    except Exception as e:  # noqa: BLE001
        saida["erros"].append(f"linha de base: {type(e).__name__}"[:120])
        # Falhou sem molde nenhum, então não é o molde. Sondar em camadas é o
        # que separa rede de credencial de parsing — dizer "confira credencial
        # e porta" mandaria investigar duas causas ignorando as outras duas.
        saida["preflight"] = _preflight_proxy(proxy)
        saida["conclusao"] = saida["preflight"].get("conclusao", "O proxy não respondeu.")
        return saida

    for indice, molde in enumerate(_MOLDES_CANDIDATOS):
        # Identificador FIXO por candidato, não derivado de hash(): em Python o
        # hash de string é aleatorizado por processo, e a sondagem daria um
        # resultado diferente a cada execução — impossível de conferir duas
        # vezes. O que precisa ser igual são as DUAS medições do mesmo
        # candidato, e isso o sufixo calculado uma vez já garante.
        sufixo = molde.replace("{sessao}", f"mfsonda{indice}")
        try:
            url = _com_sufixo(proxy, sufixo)
            a, b = _ip(url), _ip(url)
            fixou = a == b
            saida["candidatos"].append({
                "molde": molde, "fixou": fixou, "ips": sorted({a, b}),
            })
            if fixou:
                saida["molde_aceito"] = molde
                saida["conclusao"] = (
                    "Ponha isto no .env e recrie o servico do instagrapi: "
                    f"PROXY_SESSAO_MOLDE={molde} — a partir dai cada conta "
                    "recebe um identificador proprio e um IP que nao muda "
                    "durante o login."
                )
                return saida
        except Exception as e:  # noqa: BLE001
            # Recusa também é informação: o fornecedor validou o parâmetro e
            # não gostou, o que ao menos diz que ele olha para esse campo.
            saida["candidatos"].append({
                "molde": molde, "fixou": False, "erro": type(e).__name__,
            })

    saida["conclusao"] = (
        "Nenhum dos moldes conhecidos fixou o IP. Pergunte ao fornecedor qual "
        "parâmetro ativa a sessão fixa — é um sufixo no nome de usuário — e "
        "ponha em PROXY_SESSAO_MOLDE com {sessao} no lugar do valor."
    )
    return saida


async def loop_ip_de_saida(client, account_id: str, proxy: str | None) -> None:
    """Mede o IP de saída fora do event loop — a chamada é bloqueante."""
    laco = asyncio.get_running_loop()
    await laco.run_in_executor(
        None, lambda: session_pool.conferir_ip_de_saida(client, account_id, proxy)
    )


def _mascarar_proxy(url: str | None) -> str | None:
    """Esconde usuário e senha, preserva host e porta — que é o que interessa."""
    if not url:
        return None
    try:
        autoridade = url.split("://", 1)[-1].split("/")[0]
        if "@" in autoridade:
            autoridade = autoridade[autoridade.rfind("@") + 1:]
        return autoridade
    except Exception:  # noqa: BLE001
        return "(ilegível)"


def _coletar_diagnostico(client, proxy: str | None) -> dict:
    import requests

    saida = {
        "proxy_aplicado": _mascarar_proxy(proxy),
        "ip_de_saida":    None,
        "handshake":      None,
        "identidade":     None,
        "erros":          [],
    }

    # IP visto de fora, pela MESMA sessão que o login usaria — não por uma
    # requisição solta. Uma sessão nova poderia sair por outra rota e a
    # resposta seria sobre um caminho que o login não percorre.
    #
    # E medido VÁRIAS VEZES, em sequência, porque uma medição só não responde a
    # pergunta que importa.
    #
    # ── Por que a estabilidade decide o diagnóstico
    #
    # Um login não é uma requisição: são cinco ou seis em sequência — sincronia
    # de experimentos, sincronia de lançamentos, a chave de criptografia, o
    # POST de credencial, e o carregamento inicial do feed. Se o proxy é
    # rotativo e troca de IP no meio disso, o Instagram vê uma sessão nascendo
    # espalhada por vários endereços e recusa — com `bad_password`, a mesma
    # mensagem de senha errada.
    #
    # Ou seja: proxy rotacionando e conta sinalizada produzem EXATAMENTE o
    # mesmo erro na tela, e a única forma de separá-los é medir se o IP se
    # mantém. Com IP instável, não há o que depurar na conta — o problema é o
    # proxy, e nenhuma troca de senha ou de método de login vai resolver.
    ips = []
    for _ in range(6):
        try:
            r = client.public.get("https://api.ipify.org?format=json", timeout=15)
            ips.append(r.json().get("ip"))
        except Exception as e:  # noqa: BLE001
            saida["erros"].append(f"ip: {type(e).__name__}: {e}"[:200])
            break

    distintos = sorted({i for i in ips if i})
    saida["ip_de_saida"] = ips[0] if ips else None
    saida["ip_estavel"] = len(distintos) <= 1
    saida["ips_observados"] = distintos
    saida["medicoes"] = len(ips)

    if len(distintos) > 1:
        saida["veredito_proxy"] = (
            f"INSTÁVEL — {len(distintos)} IPs em {len(ips)} requisições. "
            "O login usa cerca de seis chamadas em sequência; com o IP mudando "
            "no meio, o Instagram recusa mesmo com a senha certa. "
            "Configure sessão fixa (sticky) no fornecedor do proxy."
        )
    elif distintos:
        saida["veredito_proxy"] = f"estável em {distintos[0]}"
    else:
        saida["veredito_proxy"] = "não foi possível medir"

    # A chave de criptografia de senha. `qe/sync` responde 405 ao GET, mas os
    # cabeçalhos vêm junto — é deles que o instagrapi tira a chave, então 405
    # aqui é normal e o que importa é o par id/chave estar presente.
    try:
        r = client.public.get("https://i.instagram.com/api/v1/qe/sync/", timeout=15)
        kid = r.headers.get("ig-set-password-encryption-key-id")
        pub = r.headers.get("ig-set-password-encryption-pub-key")
        saida["handshake"] = {
            "status":        r.status_code,
            "key_id":        kid,
            "tem_chave":     bool(pub),
            "key_id_cabe_em_1_byte": (kid is not None and kid.isdigit() and int(kid) <= 255),
        }
    except Exception as e:  # noqa: BLE001
        saida["erros"].append(f"handshake: {type(e).__name__}: {e}"[:200])

    d = getattr(client, "device_settings", {}) or {}
    ua = getattr(client, "user_agent", "") or ""
    saida["identidade"] = {
        "app_version":  d.get("app_version"),
        "version_code": d.get("version_code"),
        "tem_bloks":    bool(d.get("bloks_versioning_id")),
        "modelo":       d.get("model"),
        "ua_concorda":  bool(d.get("app_version") and d["app_version"] in ua
                             and d.get("version_code") and d["version_code"] in ua),
    }
    return saida


# ── /session/verify-2fa ────────────────────────────────────────────────────────

@router.post("/verify-2fa")
async def verify_2fa(body: TwoFactorVerifyRequest):
    """
    Complete a pending two-factor-authentication challenge.

    Must be called after /session/login returned TWO_FACTOR_REQUIRED.
    The pending challenge expires after 10 minutes — if expired, restart the login.
    Returns the same shape as a successful /session/login.
    """
    pending = session_pool.get_pending_2fa(body.account_id)
    if not pending:
        raise HTTPException(status_code=400, detail={
            "code":    "NO_PENDING_2FA",
            "message": "Nenhum desafio 2FA pendente. Faça o login novamente.",
        })

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        # O proxy NÃO é redefinido aqui de propósito.
        #
        # Este client é o mesmo do /session/login que abriu o desafio — ele já
        # está com o proxy resolvido pelo painel (o da conta, ou o global).
        # Sobrescrever com GLOBAL_PROXY do ambiente, como se fazia antes,
        # trocava o IP no meio do fluxo justamente para as contas que TÊM proxy
        # próprio: o login saía por um IP e a confirmação do 2FA por outro.
        # Para o Instagram isso é sinal de sequestro de sessão, e a resposta
        # costuma ser recusar o código ou devolver bad_password.
        #
        # Se o serviço tivesse reiniciado entre uma etapa e outra, o desafio
        # pendente também teria sumido e o login recomeçaria do zero — então
        # aqui o client sempre carrega o proxy correto.

        loop = asyncio.get_running_loop()
        try:
            # login_json é o corpo da resposta 400 de accounts/login/ — é dele que
            # sai o two_factor_identifier exigido pelo endpoint do 2FA.
            login_json = pending.get("login_json", {})

            def _finish_two_factor() -> None:
                """
                Reproduz fielmente o ramo `except TwoFactorRequired` de
                instagrapi.login() para código de 6 dígitos (TOTP/SMS).

                O caminho correto é o endpoint accounts/two_factor_login/, usando
                o two_factor_identifier que vem em login_json["two_factor_info"].
                _login_with_bloks_two_factor é apenas o FALLBACK — a biblioteca só
                o usa para backup codes, ou quando o endpoint acima responde
                "invalid parameters". Chamá-lo direto para um código normal falha
                na primeira linha, procurando um two_step_verification_context que
                a resposta do 2FA comum não contém.

                Depois do login, login_flow() abre a sessão como o app faria
                (reels tray + timeline) — sem isso a sessão não se firma.

                Roda em thread: são várias requisições de rede e travariam o
                event loop do FastAPI.
                """
                code = body.verification_code.strip()

                # O client é o mesmo do login (vem do pool), então já traz device,
                # phone_id e uuid coerentes com a tentativa que gerou o desafio.
                if not getattr(client, "username", None):
                    client.username = pending.get("username") or ""

                two_factor_identifier = (
                    (login_json.get("two_factor_info") or {}).get("two_factor_identifier")
                )

                data = {
                    "verification_code":     code,
                    "phone_id":              client.phone_id,
                    "_csrftoken":            client.token,
                    "two_factor_identifier": two_factor_identifier,
                    "username":              client.username,
                    "trust_this_device":     "0",
                    "guid":                  client.uuid,
                    "device_id":             client.android_device_id,
                    "waterfall_id":          str(uuid4()),
                    "verification_method":   "3",
                }

                try:
                    logged = client.private_request(
                        "accounts/two_factor_login/", data, login=True
                    )
                except UnknownError as exc:
                    message = (getattr(exc, "message", "") or "").strip().lower()
                    if message == "invalid parameters":
                        # Só aqui o fluxo bloks é o correto.
                        logged = client._login_with_bloks_two_factor(code, login_json, exc)
                    else:
                        raise
                else:
                    client.authorization_data = client.parse_authorization(
                        client.last_response.headers.get("ig-set-authorization")
                    )

                if not logged:
                    raise RuntimeError(
                        "Instagram não concluiu o login após o código de verificação"
                    )

                client.login_flow()
                client.last_login      = time.time()
                client.relogin_attempt = 0

            await loop.run_in_executor(None, _finish_two_factor)
        except HTTPException:
            raise
        except Exception as e:
            code = session_pool.classify_error(e)
            logger.warning(
                "verify-2fa: %s for account %s (type=%s)",
                code, body.account_id, type(e).__name__,
            )
            session_pool.clear_pending_2fa(body.account_id)
            _raise_for_code(code, e, (body.verification_code,), account_id=body.account_id)
        finally:
            session_pool.clear_pending_2fa(body.account_id)

        # Confirma que existe sessão de fato antes de declarar sucesso. Sem esta
        # checagem, um 2FA que "passa" sem autenticar produz uma conta conectada
        # só na aparência — o painel mostra verde e o health check mostra
        # desconectada, porque um lê a flag e o outro lê a sessão.
        try:
            await loop.run_in_executor(None, client.account_info)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "verify-2fa: código aceito mas sessão inválida para %s (type=%s) exc=%s",
                body.account_id, type(e).__name__, str(e)[:200],
            )
            await session_pool.remove_entry(body.account_id)
            raise HTTPException(status_code=422, detail={
                "code":    "TWO_FACTOR_NO_SESSION",
                "message": "O código foi aceito mas a sessão não foi estabelecida. Faça o login novamente.",
            })

        settings = client.get_settings()

    session_pool._slog("VERIFY_2FA_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/ping ─────────────────────────────────────────────────────────────

@router.get("/ping")
async def session_ping(account_id: str):
    """
    Lightweight session validation — calls account_info() to check whether the
    session is still active with Instagram. No new login is attempted.

    Used by the Node.js health check to confirm a persisted session is valid
    without consuming the rate-limit budget of heavier endpoints.

    Returns { valid: true, username, full_name, pk } on success.
    Raises via _raise_for_code() on any Instagram-side error.
    """
    entry = await session_pool.get_entry(account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            info = client.account_info()
            # settings vai na resposta para o Node persistir: o Instagram rotaciona
            # cookies e tokens durante as requisições, e descartar essa atualização
            # faz o blob salvo divergir do que ele espera — a sessão morre antes do
            # tempo por desatualização, não por invalidação.
            return {
                "valid":     True,
                "username":  info.username or "",
                "full_name": info.full_name or "",
                "pk":        str(info.pk),
                "settings":  client.get_settings(),
            }
        except Exception as e:
            code = session_pool.classify_error(e)
            logger.warning(
                "session_ping: %s for account %s (type=%s)",
                code, account_id, type(e).__name__,
            )
            _raise_for_code(code, e, account_id=account_id)


# ── /session/userinfo ──────────────────────────────────────────────────────────

@router.get("/userinfo")
async def get_user_info(account_id: str, username: str):
    """
    Fetch a safe subset of public profile info for `username` using the
    account's existing session (no new Instagram login required).

    Called by Node.js immediately after a successful login to populate
    the account avatar, display name, and counters in MongoDB.

    Returns only non-sensitive fields — raw instagrapi User objects are
    never forwarded to the frontend or stored directly.
    """
    entry = await session_pool.get_entry(account_id)
    async with entry["lock"]:
        client = entry["client"]
        try:
            user = client.user_info_by_username_v1(username)
            return {
                "pk":              str(user.pk),
                "full_name":       user.full_name or "",
                "profile_pic_url": str(user.profile_pic_url) if user.profile_pic_url else "",
                "follower_count":  getattr(user, "follower_count", None) or 0,
                "following_count": getattr(user, "following_count", None) or 0,
                "media_count":     getattr(user, "media_count", None) or 0,
                # Mesmo motivo do /session/ping: o estado atualizado da sessão
                # precisa voltar ao banco, senão o blob envelhece.
                "settings":        client.get_settings(),
            }
        except Exception as e:
            code = session_pool.classify_error(e)
            logger.warning(
                "get_user_info: %s for account %s username %s (type=%s)",
                code, account_id, username, type(e).__name__,
            )
            _raise_for_code(code, e, account_id=account_id)


# ── /session/login-by-sessionid ────────────────────────────────────────────────

@router.post("/login-by-sessionid")
async def login_by_sessionid(body: SessionIdLoginRequest):
    """
    Authenticate using an existing Instagram session ID (from browser cookie).

    Does NOT call accounts/login/ — completely bypasses IP-level rate limits.
    The user copies the 'sessionid' cookie from instagram.com in their browser
    (F12 → Application → Cookies → sessionid) and pastes it here.

    SECURITY: sessionid is never logged — it is equivalent to a password.
    Returns { status: "AUTHENTICATED", settings: {...} } on success.
    """
    session_pool._slog("LOGIN_BY_SESSIONID_ATTEMPT", body.account_id)
    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        # Proxy resolvido pelo Node (proxy da conta ou proxy global do painel);
        # GLOBAL_PROXY do ambiente continua valendo como fallback.
        proxy = body.proxy or os.getenv('GLOBAL_PROXY')
        if proxy:
            # Molda a sessão fixa antes de aplicar: o proxy é rotativo, e sem o
            # identificador por conta o IP mudaria a cada conexão.
            proxy = session_pool.moldar_proxy_por_conta(proxy, body.account_id)
            client.set_proxy(proxy)
        session_pool.lembrar_proxy(body.account_id, proxy)
        loop = asyncio.get_running_loop()
        t0 = time.perf_counter()
        try:
            # login_by_sessionid sets the cookie and validates via account_info()
            # — no accounts/login/ call is made.
            await loop.run_in_executor(None, lambda: client.login_by_sessionid(body.sessionid))

            # O app carrega a bandeja de stories e a timeline assim que a
            # sessão se estabelece — é o "cold start". O login por SENHA da
            # instagrapi faz isso (login() chama login_flow no fim); o login
            # por sessionid NÃO faz, e a diferença é visível do outro lado:
            # uma sessão que autentica e vai direto publicar, sem nunca abrir
            # um feed, não se parece com nenhum usuário real.
            #
            # Melhor esforço de propósito. A sessão já está válida neste
            # ponto; falhar aqui e desistir trocaria uma conta conectada por
            # uma conta não conectada, o que é pior do que uma conta
            # conectada sem o aquecimento.
            try:
                await loop.run_in_executor(None, client.login_flow)
                session_pool._slog("COLD_START_OK", body.account_id)
            except Exception as e:  # noqa: BLE001
                logger.info(
                    "cold start não completou para %s (%s) — sessão segue válida",
                    body.account_id, type(e).__name__,
                )
        except Exception as e:
            code = session_pool.classify_error(e)
            duration_ms = int((time.perf_counter() - t0) * 1000)
            logger.warning(
                "login_by_sessionid: %s for account %s (type=%s) duration_ms=%d",
                code, body.account_id, type(e).__name__, duration_ms,
            )
            await session_pool.remove_entry(body.account_id)
            _raise_for_code(code, e, (body.sessionid,), account_id=body.account_id)

        settings = client.get_settings()

    session_pool._slog("LOGIN_BY_SESSIONID_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/challenge-code ────────────────────────────────────────────────────

@router.post("/challenge-code")
async def challenge_code(body: ChallengeCodeRequest):
    """
    Conclui um desafio de verificação enviando o código recebido por e-mail/SMS.

    Deve ser chamado depois de /session/login responder CHALLENGE_REQUIRED (202).
    O desafio expira em 10 minutos — depois disso é preciso refazer o login.

    Respostas:
    - HTTP 200 {"status": "AUTHENTICATED", "settings": {...}} — resolvido
    - HTTP 422 {"code": "CHALLENGE_CODE_REJECTED"} — código errado, pode tentar
      outro sem refazer o login (o desafio continua aberto)
    - HTTP 400 {"code": "NO_PENDING_CHALLENGE"} — nada pendente ou já expirou

    IMPORTANTE: este endpoint não adquire o lock da conta. A thread do desafio é
    dona do client até terminar; pegar o lock aqui causaria deadlock.
    """
    pending = session_pool.get_pending_challenge(body.account_id)
    if not pending:
        raise HTTPException(status_code=400, detail={
            "code":    "NO_PENDING_CHALLENGE",
            "message": "Nenhum desafio pendente ou o prazo expirou. Faça o login novamente.",
        })

    loop = asyncio.get_running_loop()
    # submit_challenge_code bloqueia esperando a thread — precisa do executor.
    result = await loop.run_in_executor(
        None, lambda: session_pool.submit_challenge_code(body.account_id, body.code.strip())
    )

    if result["status"] == "CODE_REJECTED":
        raise HTTPException(status_code=422, detail={
            "code":    "CHALLENGE_CODE_REJECTED",
            "message": "Código incorreto. Confira e digite novamente.",
        })

    if result["status"] != "AUTHENTICATED":
        session_pool.clear_pending_challenge(body.account_id)
        await session_pool.remove_entry(body.account_id)
        raise HTTPException(status_code=422, detail={
            "code":    "CHALLENGE_FAILED",
            "message": result.get("error") or "Não foi possível concluir a verificação.",
        })

    client = pending["client"]

    # challenge_resolve() limpa o checkpoint, mas NÃO conclui o login: a exceção
    # ChallengeRequired interrompeu client.login() antes de a sessão existir.
    # Sem esta verificação, salvaríamos um settings sem autorização e a conta
    # apareceria "conectada" com 0 seguidores e sem sincronizar nunca.
    try:
        await loop.run_in_executor(None, client.account_info)
        autenticado = True
    except Exception as e:  # noqa: BLE001
        autenticado = False
        logger.info(
            "challenge_code: checkpoint resolvido mas sessão ainda não válida para %s (%s)",
            body.account_id, type(e).__name__,
        )

    session_pool.clear_pending_challenge(body.account_id)

    if not autenticado:
        # O Node repete o login com a senha (que nunca é armazenada aqui) — agora
        # sem checkpoint no caminho, ele conclui.
        session_pool._slog("CHALLENGE_RESOLVED_RELOGIN", body.account_id)
        return {
            "status":  "RELOGIN_REQUIRED",
            "message": "Verificação concluída. Refazendo o login para concluir a conexão.",
        }

    settings = client.get_settings()
    session_pool._slog("CHALLENGE_RESOLVED", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/challenge-approved ────────────────────────────────────────────────

@router.post("/challenge-approved")
async def challenge_approved(body: EvictRequest):
    """
    Reconhece o checkpoint "aprove no app" depois da aprovação manual.

    Fluxo: /session/login devolve CHALLENGE_REQUIRED com kind='approval' → o
    usuário aprova a tentativa de login no app oficial → este endpoint chama
    challenge_bloks_redirect_dismiss() no mesmo client → o Node refaz o login,
    que agora passa.

    Não conclui a autenticação por si: o login precisa ser repetido com a senha,
    que nunca é armazenada aqui.

    Respostas:
    - HTTP 200 {"status": "DISMISSED"}       — reconhecido, refazer o login
    - HTTP 409 {"code": "NOT_APPROVED_YET"}  — aprovação ainda não registrada
    - HTTP 400 {"code": "NO_PENDING_CHALLENGE"}
    """
    pending = session_pool.get_pending_challenge(body.account_id)
    if not pending:
        raise HTTPException(status_code=400, detail={
            "code":    "NO_PENDING_CHALLENGE",
            "message": "Nenhum desafio pendente ou o prazo expirou. Faça o login novamente.",
        })

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, lambda: session_pool.dismiss_bloks_challenge(body.account_id)
    )

    if result["status"] == "DISMISSED":
        session_pool.clear_pending_challenge(body.account_id)
        return {"status": "DISMISSED", "message": "Verificação reconhecida. Refaça o login."}

    if result["status"] == "RETRY_LOGIN":
        # Era um desafio de código e o usuário aprovou no app: a thread parada
        # ainda é dona deste client, então descartamos a entrada do pool para
        # que o novo login comece com um client limpo.
        session_pool.clear_pending_challenge(body.account_id)
        await session_pool.remove_entry(body.account_id)
        return {"status": "DISMISSED", "message": "Refaça o login para concluir."}

    if result["status"] == "NOT_APPROVED_YET":
        raise HTTPException(status_code=409, detail={
            "code":    "NOT_APPROVED_YET",
            "message": "O Instagram ainda não registrou a aprovação. Aprove no app e tente de novo.",
        })

    if result["status"] == "UNSUPPORTED":
        # Sem o método na biblioteca, refazer o login após aprovar costuma bastar.
        session_pool.clear_pending_challenge(body.account_id)
        return {"status": "DISMISSED", "message": "Refaça o login para concluir."}

    session_pool.clear_pending_challenge(body.account_id)
    raise HTTPException(status_code=422, detail={
        "code":    "CHALLENGE_FAILED",
        "message": result.get("error") or "Não foi possível concluir a verificação.",
    })


# ── /session/evict ─────────────────────────────────────────────────────────────

@router.post("/evict")
async def evict_session(body: EvictRequest):
    """Evict an account's client from the pool after Node.js calls SessionManager.invalidate()."""
    await session_pool.remove_entry(body.account_id)
    return {"ok": True}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _safe_detail(exc: Exception | None, secrets: tuple = ()) -> str:
    """
    Mensagem técnica curta e higienizada de uma exceção, para diagnóstico.

    Só é usada quando o erro não pôde ser classificado (UNKNOWN_ERROR) — nesse
    caso o front não tem mensagem curada e, sem isso, mostra um palpite errado
    ("verifique suas credenciais") para qualquer falha desconhecida.

    SEGURANÇA: senha e sessionid são removidos antes de sair do serviço.
    """
    if exc is None:
        return ""
    msg = f"{type(exc).__name__}: {exc}"[:300]
    for secret in secrets:
        if secret:
            msg = msg.replace(str(secret), "***")
    return msg


_ERROR_META_FIELDS = ("error_type", "status", "two_factor_required", "checkpoint_url", "help_url")


def _login_error_metadata(exc: Exception | None, client) -> str:
    """
    Metadados de erro da resposta do Instagram — só nomes e valores de erro.

    `error_type` distingue de forma conclusiva senha realmente incorreta
    ("bad_password") de bloqueio disfarçado de erro de credencial.

    A fonte é a EXCEÇÃO, não client.last_json: o instagrapi levanta
    BadPassword(**last_json), então a exceção carrega os campos do momento da
    falha. Ler o client depois trazia estado já sobrescrito por outra requisição
    — foi o que fez aparecer "status: ok" numa falha de login.
    """
    presentes = {}
    if exc is not None:
        presentes = {f: getattr(exc, f) for f in _ERROR_META_FIELDS if hasattr(exc, f)}

    if not presentes:
        last = getattr(client, "last_json", None)
        if isinstance(last, dict):
            presentes = {f: last[f] for f in _ERROR_META_FIELDS if f in last}

    return f" [{presentes}]" if presentes else ""


def _raise_for_code(
    code: str,
    exc: Exception | None = None,
    secrets: tuple = (),
    extra: str = "",
    account_id: str | None = None,
) -> None:
    """Raise the appropriate HTTPException for a given error code."""
    _STATUS = {
        "RATE_LIMITED":       429,
        "CHALLENGE_REQUIRED": 428,
        "BAD_PASSWORD":       422,
        "USER_NOT_FOUND":     422,
        "FEEDBACK_REQUIRED":  403,
        "ACCOUNT_SUSPENDED":  403,
        "SESSION_EXPIRED":    422,
        "TIMEOUT":            504,
        "PROXY_ERROR":        502,
        "NETWORK_ERROR":      503,
        "LOGIN_IN_PROGRESS":  409,
        # TWO_FACTOR_REQUIRED is handled before this function is called — 202 is not an error
    }
    http_status = _STATUS.get(code, 422)  # fallback 422, not 401 (401 triggers SaaS logout)
    # A mensagem técnica acompanha TODOS os códigos, não só os desconhecidos.
    # Motivo: as mensagens curadas às vezes contradizem o que o Instagram disse
    # — BAD_PASSWORD, por exemplo, aparece quando ele recusa a tentativa por
    # padrão suspeito, e "usuário ou senha incorretos" manda depurar a coisa
    # errada. O Node decide como exibir; aqui garantimos que a verdade chegue.
    message = _safe_detail(exc, secrets)

    # PROXY_ERROR sozinho não distingue "credencial ruim" de "o fornecedor não
    # aceita o sufixo de sessão que nós acrescentamos". A diferença é decisiva:
    # na segunda, o teste do painel PASSA — ele usa a URL crua — e a
    # investigação vai inteira para o lado errado.
    if code == "PROXY_ERROR" and account_id:
        try:
            from ..session_pool import explicar_recusa_de_proxy
            extra = f"{extra}{explicar_recusa_de_proxy(account_id)}"
        except Exception:  # noqa: BLE001
            pass

    if extra:
        message = f"{message}{extra}" if message else extra.strip()
    raise HTTPException(status_code=http_status, detail={"code": code, "message": message})

"""
Per-account instagrapi client pool.

Each account gets exactly one Client instance and one asyncio.Lock.
The pool lives for the process lifetime; clients are evicted when
invalidated or the process restarts (Node.js reloads sessions from MongoDB).

SECURITY GUARANTEES:
- Each account's Client, session, cookies, device UUID, and proxy are fully isolated.
- No client data is ever shared between accounts.
- Per-account asyncio.Lock prevents concurrent Instagram requests for the same account.
- Passwords are never stored — the pending-2FA dict stores only the username and
  two_factor_identifier required to complete a challenge, never the password itself.
"""

import asyncio
import hashlib
import json
import logging
import os
import queue
import threading
import time
import uuid as _uuid
from typing import Dict, Optional

# ── Instagrapi exceptions — imported at module level (fail fast) ──────────────
# If instagrapi is not properly installed, the service will fail to start.
# This is intentional: we MUST NOT silently create stub exception classes, as
# that would cause real Instagram exceptions to fall through the wrong handler.
from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword,
    ChallengeRequired,
    FeedbackRequired,
    LoginRequired,
    TwoFactorRequired,
)

# Optional extras not available in all instagrapi 2.x minor versions.
# Absence is fine — classify_error() covers these via message content.
try:
    from instagrapi.exceptions import PleaseWaitFewMinutes as _PleaseWait
except ImportError:
    _PleaseWait = None

try:
    from instagrapi.exceptions import RateLimitError as _RateLimit
except ImportError:
    _RateLimit = None

try:
    from instagrapi.exceptions import ClientThrottledError as _ClientThrottled
except ImportError:
    _ClientThrottled = None

# Combined tuple of all rate-limit exception types known to instagrapi.
# None values are excluded (optional imports that may be missing in some versions).
_RATE_LIMIT_EXC = tuple(e for e in (_PleaseWait, _RateLimit, _ClientThrottled) if e is not None)


# Falhas que significam "o caminho está fora do ar", não "este passo não
# respondeu". Elas sobem: seguir para o accounts/login/ gastaria uma
# requisição que falharia pelo mesmo motivo, e num IP que queremos poupar.
_TRANSPORTE_QUEBRADO: tuple = tuple(
    e for e in (
        ConnectionError,
        TimeoutError,
        getattr(__import__("requests.exceptions", fromlist=["x"]), "ConnectionError", None),
        getattr(__import__("requests.exceptions", fromlist=["x"]), "Timeout", None),
        getattr(__import__("requests.exceptions", fromlist=["x"]), "ProxyError", None),
    ) if e is not None
)


class _PreLoginRateLimited(Exception):
    """Sentinel raised when pre_login_flow() is rate-limited.

    Using a custom type (not PleaseWaitFewMinutes or ClientThrottledError) ensures
    that login() does NOT swallow it — its except handler only catches those two
    library types. classify_error() maps _PreLoginRateLimited explicitly to
    RATE_LIMITED without any message-content parsing.
    """
    pass


# urllib3 retry suppression + HTTP request logging
try:
    from urllib3.util.retry import Retry as _Retry
    from requests.adapters import HTTPAdapter as _HTTPAdapter
    _HAS_REQUESTS_RETRY = True

    class _LoggingHTTPAdapter(_HTTPAdapter):
        """[TEMP-DEBUG] Logs every Instagram HTTP request/response for investigation.
        Logs ONLY: method, host, path, status_code, error type. Never logs credentials."""
        _seq = 0  # class-level counter — safe under Python GIL for simple int increment

        def send(self, request, **kwargs):
            import urllib.parse
            _LoggingHTTPAdapter._seq += 1
            n = _LoggingHTTPAdapter._seq
            u = urllib.parse.urlparse(request.url)
            logger.info("[IG-HTTP] #%d → %s %s%s", n, request.method, u.netloc, u.path)
            try:
                resp = super().send(request, **kwargs)
                logger.info("[IG-HTTP] #%d ← status=%d", n, resp.status_code)
                return resp
            except Exception as exc:
                logger.info("[IG-HTTP] #%d ✗ %s — %s", n, type(exc).__name__, str(exc)[:150])
                raise

except ImportError:
    _HAS_REQUESTS_RETRY = False
    _LoggingHTTPAdapter = None

logger = logging.getLogger(__name__)

# ── In-memory pool ────────────────────────────────────────────────────────────

# pool: account_id → { "client": Client, "lock": asyncio.Lock }
_pool: Dict[str, dict] = {}
_pool_lock = asyncio.Lock()

# Pending two-factor challenges: account_id → {username, two_factor_identifier, expires_at}
# Stored in-memory only — never written to disk or database.
# Cleared on verification (success or failure) or after TTL expires.
# 10 min — igual ao prazo do desafio. Com 5 min, o tempo de receber o SMS/e-mail,
# trocar de app e digitar estourava o prazo e o login reiniciava em loop.
_PENDING_2FA_TTL = 600
_pending_2fa: Dict[str, dict] = {}


def _build_retry():
    """
    Política de retentativa que separa falha de TRANSPORTE de resposta do Instagram.

    Antes era total=0 — nenhuma retentativa — para não amplificar rate limit: um
    clique de login virava 3-4 requisições e acelerava o bloqueio. A intenção
    estava certa, mas o efeito colateral era grave: qualquer falha momentânea de
    rede matava o login inteiro. Com proxy, isso é comum — o túnel TLS cai e o
    erro chega como "UNEXPECTED_EOF_WHILE_READING" já no launcher/sync.

    A separação:
      connect > 0  → repete quando a conexão/TLS falha. A requisição não chegou ao
                     servidor, então repetir é seguro e não gera ação duplicada.
      read = 0     → NÃO repete depois de enviar. Um POST já entregue pode ter sido
                     processado; repetir arriscaria publicar ou logar duas vezes.
      status = 0   → NÃO repete por código HTTP. 429 continua falhando de imediato,
                     preservando a proteção original contra rate limit.

    allowed_methods=None é necessário porque urllib3 só repete métodos idempotentes
    por padrão — e o login é POST.
    """
    comum = dict(total=2, connect=2, read=0, status=0, status_forcelist=[], backoff_factor=1.5)
    try:
        return _Retry(allowed_methods=None, **comum)
    except TypeError:
        # urllib3 < 1.26 usa o nome antigo
        try:
            return _Retry(method_whitelist=None, **comum)
        except TypeError:
            return _Retry(total=0)  # última reserva: comportamento anterior


def _patch_client_retries(client: Client) -> None:
    """
    Ajusta a política de retentativa da sessão privada do instagrapi.

    Ver _build_retry() para o racional: repete falha de conexão, nunca repete por
    status HTTP (429 falha na hora) e nunca repete um POST já entregue.

    Compatível com urllib3 1.x e 2.x — evita raise_on_status, cuja semântica muda
    entre versões menores.
    """
    if not _HAS_REQUESTS_RETRY:
        return
    private = getattr(client, 'private', None)
    if private is None or not hasattr(private, 'mount'):
        return  # httpx-based client (future instagrapi versions) — no-op
    adapter_cls = _LoggingHTTPAdapter if _LoggingHTTPAdapter is not None else _HTTPAdapter
    adapter = adapter_cls(max_retries=_build_retry())
    private.mount('https://', adapter)
    private.mount('http://', adapter)


def _patch_client_fail_fast(client: Client) -> None:
    """
    Refaz a preparação que antecede o login, e mantém o corte rápido no 429.

    ── Por que refazer

    O `pre_login_flow` da instagrapi 2.18.16 tem três das cinco chamadas
    COMENTADAS no código da própria biblioteca:

        # self.set_contact_point_prefill("prefill")
        # self.get_prefill_candidates(True)
        # self.set_contact_point_prefill("prefill")
        self.sync_launcher(True)
        # self.sync_device_features(True)

    Só `launcher/sync/` sobra. O app real faz as cinco antes de mandar a
    senha, e uma delas importa em particular: `get_prefill_candidates` envia

        client_contact_points: [{"type":"omnistring",
                                 "value":"<usuario>",
                                 "source":"last_login_attempt"}]

    ou seja, ANUNCIA ao Instagram qual conta está prestes a entrar, deste
    aparelho, antes de qualquer senha. Sem esse aviso o `accounts/login/`
    chega frio — o aparelho nunca se apresentou, e a tentativa não tem
    contexto nenhum atrás dela.

    É a explicação mais próxima que encontrei para `invalid_user` numa conta
    que existe e entra pelo navegador: não é que o Instagram não ache o
    usuário, é que ele não reconhece a conversa.

    ── Por que cada passo é tolerante a falha

    No app real essas chamadas são de melhor esforço: servem para preencher
    sugestões e registrar experimentos, e o login acontece mesmo quando
    alguma falha. Tratá-las como obrigatórias trocaria um login recusado por
    um login não tentado, que é pior. O 429 é a única exceção — ver abaixo.

    ── Por que o 429 continua cortando

    A instagrapi engole PleaseWaitFewMinutes e ClientThrottledError vindos do
    pre-login e segue para o `accounts/login/`, gastando uma segunda
    requisição num IP que já disse para esperar. `_PreLoginRateLimited` é de
    um tipo que o `login()` NÃO captura, então a tentativa para aqui.
    """
    _orig = client.pre_login_flow

    def _preparar():
        # Cada passo isolado: o que falhar não leva os outros junto.
        def _tentar(nome, fn):
            try:
                fn()
                return True
            except _RATE_LIMIT_EXC as exc:
                # 429 interrompe: insistir queima o IP, e o accounts/login/
                # seguinte seria recusado do mesmo jeito.
                raise _PreLoginRateLimited(
                    f"{nome} recebeu 429 — abortando antes de gastar o accounts/login/"
                ) from exc
            except _TRANSPORTE_QUEBRADO:
                # Rede, proxy ou tempo esgotado: não é o Instagram dizendo
                # não a UM passo, é o caminho inteiro fora do ar. Engolir só
                # adiaria o mesmo erro por mais uma requisição.
                raise
            except Exception as e:  # noqa: BLE001
                # O resto é melhor esforço, como no app real: estes passos
                # preenchem sugestões e registram experimentos, e o login
                # acontece mesmo quando um deles não responde.
                logger.info("pre-login: %s falhou (%s) — seguindo", nome, type(e).__name__)
                return False

        feitos = []

        # A ordem é a do app: apresenta o contato, pede as sugestões,
        # reapresenta, sincroniza o launcher e os experimentos do aparelho.
        if hasattr(client, "set_contact_point_prefill"):
            if _tentar("contact_point_prefill", lambda: client.set_contact_point_prefill("prefill")):
                feitos.append("prefill")

        if hasattr(client, "get_prefill_candidates") and getattr(client, "username", None):
            if _tentar("get_prefill_candidates", lambda: client.get_prefill_candidates(True)):
                feitos.append("candidates")

        if hasattr(client, "set_contact_point_prefill"):
            _tentar("contact_point_prefill#2", lambda: client.set_contact_point_prefill("prefill"))

        if _tentar("sync_launcher", lambda: client.sync_launcher(True)):
            feitos.append("launcher")

        if hasattr(client, "sync_device_features"):
            if _tentar("sync_device_features", lambda: client.sync_device_features(True)):
                feitos.append("device_features")

        logger.info("pre-login concluído — passos ok: %s", ",".join(feitos) or "nenhum")
        return True

    # Sem os tipos de 429 importáveis, o corte rápido não é possível; a
    # preparação completa continua valendo, que é o que mais importa aqui.
    client.pre_login_flow = _preparar if _RATE_LIMIT_EXC else _orig


def _device_uuids(account_id: str) -> dict:
    """
    Identidade de aparelho derivada do account_id — estável entre tentativas e
    entre restarts do serviço.

    O instagrapi gera esses valores aleatoriamente em cada Client():
    generate_uuid() é uuid4() e generate_android_device_id() é
    sha256(time())[:16]. Como um login falho remove a entrada do pool, cada
    retentativa criava um client novo — e, para o Instagram, a mesma conta
    tentando entrar de um APARELHO DIFERENTE a cada tentativa. Esse é o padrão de
    conta invadida, e a resposta dele é justamente "we can send you an email to
    help you get back into your account".

    Ficam estáveis apenas os ids que representam o aparelho. client_session_id,
    request_id e tray_session_id são omitidos de propósito: num app real eles
    rotacionam por sessão, e set_uuids() gera novos quando ausentes.

    Sessão já salva continua mandando — set_settings() sobrescreve estes valores.
    """
    def _as_uuid(tag: str) -> str:
        digest = hashlib.sha256(f"{account_id}:{tag}".encode()).hexdigest()
        return str(_uuid.UUID(digest[:32]))

    return {
        "phone_id":          _as_uuid("phone_id"),
        "uuid":              _as_uuid("uuid"),
        "advertising_id":    _as_uuid("advertising_id"),
        "android_device_id": "android-" + hashlib.sha256(
            f"{account_id}:android_device_id".encode()
        ).hexdigest()[:16],
    }


# Só HARDWARE aqui. A build do app (app_version + version_code +
# bloks_versioning_id) é um trio que precisa ser coerente entre si, e vem de
# `_build_do_app()` — ver o comentário lá para o porquê.
_REAL_ANDROID_DEVICES = [
    {
        "android_version": 33,
        "android_release": "13.0",
        "dpi": "480dpi",
        "resolution": "1080x2340",
        "manufacturer": "Samsung",
        "device": "dm1q",
        "model": "SM-S911B",
        "cpu": "qcom",
    },
    {
        "android_version": 34,
        "android_release": "14.0",
        "dpi": "480dpi",
        "resolution": "1080x2400",
        "manufacturer": "Google",
        "device": "panther",
        "model": "Pixel 7",
        "cpu": "tensor",
    },
    {
        "android_version": 33,
        "android_release": "13.0",
        "dpi": "480dpi",
        "resolution": "1080x2400",
        "manufacturer": "Xiaomi",
        "device": "fuxi",
        "model": "2211133G",
        "cpu": "qcom",
    },
    {
        "android_version": 33,
        "android_release": "13.0",
        "dpi": "560dpi",
        "resolution": "1440x3088",
        "manufacturer": "Samsung",
        "device": "dm3q",
        "model": "SM-S918B",
        "cpu": "qcom",
    },
    {
        "android_version": 34,
        "android_release": "14.0",
        "dpi": "480dpi",
        "resolution": "1080x2400",
        "manufacturer": "Motorola",
        "device": "eqs",
        "model": "motorola edge 40",
        "cpu": "mt6891",
    },
]


def _build_do_app() -> dict:
    """
    Trio coerente {app_version, version_code, bloks_versioning_id}.

    Os três descrevem a MESMA build do app do Instagram e não podem ser
    escolhidos separadamente. O `app_version` vai no User-Agent, o
    `version_code` vai no fim do mesmo User-Agent, e o `bloks_versioning_id`
    vai no corpo da requisição. Se não combinarem, o pedido de login se
    contradiz e o Instagram trata como cliente forjado.

    Por isso o valor sai sempre de `config.APP_SETTINGS`, que é o dicionário
    onde a biblioteca guarda as builds reais com os três campos casados.
    Inventar uma combinação é o que quebrou este login antes.
    """
    from instagrapi import config as ig_config
    disponiveis = getattr(ig_config, "APP_SETTINGS", {}) or {}

    desejada = (os.getenv("INSTAGRAPI_APP_VERSION") or "").strip()
    if desejada:
        if desejada in disponiveis:
            return dict(disponiveis[desejada])
        logger.warning(
            "INSTAGRAPI_APP_VERSION='%s' não existe em APP_SETTINGS (%s) — "
            "usando a build padrão da biblioteca",
            desejada, ", ".join(sorted(disponiveis)) or "vazio",
        )

    padrao = getattr(ig_config, "DEFAULT_APP_VERSION", None)
    if padrao and padrao in disponiveis:
        return dict(disponiveis[padrao])

    if disponiveis:
        # última linha de defesa: qualquer entrada serve, desde que completa
        return dict(next(iter(disponiveis.values())))

    raise RuntimeError(
        "instagrapi.config.APP_SETTINGS está vazio — não há build de app válida "
        "para montar o cliente"
    )


def aplicar_regiao(client: Client) -> dict:
    """
    Alinha país, idioma e fuso do cliente com a origem real da requisição.

    O padrão do instagrapi é os Estados Unidos: country US, country_code 1,
    locale en_US, timezone -14400 (leste americano). Rodando de um servidor
    brasileiro, com contas brasileiras, o pedido de login chegava ao Instagram
    dizendo três coisas que se contradizem — um aparelho americano, em inglês,
    no fuso de Nova York, entrando numa conta brasileira a partir de um IP
    brasileiro.

    Aparelho de gente de verdade não faz isso: idioma, fuso e geografia do IP
    concordam. A divergência é justamente o tipo de sinal que o Instagram usa
    para separar app de automação — e explica por que a MESMA credencial entra
    pelo navegador e é recusada por aqui com `bad_password`.

    Vem de variável de ambiente porque a resposta certa depende de onde o
    servidor está. O padrão é o Brasil por ser onde este roda; mudar de país
    é trocar quatro variáveis, não editar código.
    """
    pais   = (os.getenv("INSTAGRAPI_COUNTRY") or "BR").strip().upper()
    ddi    = int(os.getenv("INSTAGRAPI_COUNTRY_CODE") or 55)
    idioma = (os.getenv("INSTAGRAPI_LOCALE") or "pt_BR").strip()
    fuso_h = float(os.getenv("INSTAGRAPI_TZ_OFFSET_HOURS") or -3)
    fuso_nome = (os.getenv("INSTAGRAPI_TZ_NAME") or "America/Sao_Paulo").strip()

    try:
        client.set_country(pais)
        client.set_country_code(ddi)
        # set_locale reconstrói o User-Agent, que carrega o idioma no fim da
        # string. Sem isso o cabeçalho continuaria anunciando en_US enquanto o
        # corpo diria pt_BR — trocaríamos uma contradição por outra.
        client.set_locale(idioma)
        client.set_timezone_offset(int(fuso_h * 3600))
        if hasattr(client, "set_timezone_name"):
            client.set_timezone_name(fuso_nome)
    except Exception as e:  # noqa: BLE001
        logger.error("aplicar_regiao falhou (%s) — o login sai com contexto inconsistente", e)
        raise

    return {
        "country": pais, "country_code": ddi, "locale": idioma,
        "timezone_offset": int(fuso_h * 3600), "timezone_name": fuso_nome,
    }


def apply_deterministic_device(client: Client, account_id: str) -> None:
    """
    Associa deterministicamente cada conta a um modelo de smartphone Android real.
    Garante que a Meta identifique sempre o mesmo aparelho móvel para aquela conta.

    O perfil de hardware é combinado com a build do app antes de ir para
    `set_device()`. Isso importa porque `set_device()` SUBSTITUI o
    `device_settings` inteiro em vez de atualizar campo a campo: passar um
    dicionário sem `version_code` apagava o valor que a biblioteca tinha posto
    ali, e `set_user_agent()` logo em seguida estourava KeyError ao formatar o
    User-Agent. Como a exceção era engolida, o cliente seguia em frente
    anunciando um aparelho no cabeçalho e outro no corpo — e o Instagram
    respondia `invalid_user` para toda conta, como se ela não existisse.
    """
    idx = int(hashlib.sha256(account_id.encode()).hexdigest(), 16) % len(_REAL_ANDROID_DEVICES)
    escolhido = dict(_REAL_ANDROID_DEVICES[idx])
    escolhido.update(_build_do_app())

    # Sem `try` mudo aqui. Se esta montagem falhar, TODO login desta instância
    # sai com identidade inconsistente; falhar alto na criação do cliente é
    # muito melhor que descobrir isso conta por conta na tela do usuário.
    client.set_device(escolhido)
    client.set_user_agent()

    if escolhido.get("bloks_versioning_id"):
        client.bloks_versioning_id = escolhido["bloks_versioning_id"]


def apply_app_version(client: Client) -> str:
    """
    Aplica a build do app Instagram definida em INSTAGRAPI_APP_VERSION.

    O Instagram recusa login por API quando a build no payload foi descontinuada —
    e mantém o site funcionando, o que faz o erro parecer senha incorreta
    (error_type=bad_password com credencial válida).

    Só aceita valores presentes em config.APP_SETTINGS: são builds reais que a
    biblioteca mantém, com version_code e bloks_versioning_id correspondentes.
    Inventar combinação de versão piora a detecção em vez de melhorar.

    Sem a variável definida, mantém o padrão da biblioteca.
    Devolve a app_version efetiva, para registro.
    """
    settings = getattr(client, "device_settings", None)
    if not isinstance(settings, dict):
        return "desconhecida"

    # A build já foi aplicada por apply_deterministic_device(), inclusive a
    # preferência de INSTAGRAPI_APP_VERSION. O que resta aqui é conferir que os
    # três campos sobreviveram e que o User-Agent concorda com eles — foi
    # exatamente essa divergência que fez todo login ser recusado.
    faltando = [c for c in ("app_version", "version_code", "bloks_versioning_id")
                if not settings.get(c)]
    if faltando:
        logger.error(
            "device_settings incompleto (%s ausente) — o login vai sair com "
            "identidade inconsistente", ", ".join(faltando),
        )

    versao = settings.get("app_version") or "desconhecida"
    ua = getattr(client, "user_agent", "") or ""
    if versao != "desconhecida" and versao not in ua:
        logger.error(
            "User-Agent anuncia build diferente do device_settings "
            "(device=%s, ua=%r)", versao, ua,
        )

    return versao


# Proxy conhecido de cada conta, fora do pool.
#
# O pool guarda o cliente, e o cliente morre a cada restart do serviço. O
# proxy não pode morrer junto: um cliente recriado sem ele volta a falar com
# o Instagram pelo IP do servidor, e o IP é justamente o que o proxy existe
# para esconder. Como só login e load carregam o proxy na requisição, as
# publicações que viessem depois de um restart sairiam direto — sem erro
# nenhum, só pelo endereço errado.
#
# Fica aqui, ao lado do pool e não dentro dele, para sobreviver ao
# `remove_entry` que despeja o cliente após falha de sessão.
_proxies: dict[str, str] = {}

# A URL ANTES do molde. Guardada porque, quando o fornecedor recusa a
# credencial, a primeira pergunta é se ele recusa a credencial ou o sufixo que
# NÓS acrescentamos — e sem o original não há como responder.
_proxies_crus: dict[str, str] = {}


def sessao_da_conta(account_id: str) -> str:
    """
    Identificador de sessão estável para esta conta.

    Derivado do account_id, não sorteado: precisa sobreviver a restart do
    serviço. Um identificador novo a cada reinício pediria um IP novo ao
    fornecedor, e a conta apareceria saltando de endereço — que é o padrão
    que estamos tentando evitar.

    Doze caracteres hexadecimais: curto o bastante para caber em nome de
    usuário de proxy, longo o bastante para não colidir entre contas.
    """
    return hashlib.sha256(f"proxy-sessao:{account_id}".encode()).hexdigest()[:12]


def moldar_proxy_por_conta(url: str | None, account_id: str) -> str | None:
    """
    Fixa o IP do proxy rotativo por conta.

    Um proxy rotativo troca de IP a cada conexão. Para o Instagram, a mesma
    conta aparecendo de um endereço diferente a cada publicação é o padrão de
    conta invadida — exatamente o oposto do que queremos. Um celular real usa
    o mesmo IP por horas.

    Praticamente todo fornecedor residencial resolve isso do mesmo jeito: um
    identificador dentro do NOME DE USUÁRIO faz o IP ficar fixo enquanto
    aquele identificador for usado. O que muda entre fornecedores é só a
    sintaxe:

        Bright Data   usuario-session-abc123
        Smartproxy    usuario-session-abc123
        Oxylabs       usuario-sessid-abc123
        IPRoyal       usuario_session-abc123_lifetime-30m

    Daí o molde vir de variável de ambiente em vez de estar escrito no
    código: `PROXY_SESSAO_MOLDE` recebe o sufixo com `{sessao}` onde entra o
    identificador. O padrão segue a forma do proxy em uso aqui, cujo usuário
    já traz parâmetros separados por ponto-e-vírgula
    (`...__cr.br;state.saopaulo`).

    Molde vazio desliga a fixação e devolve a URL intacta — é o caminho para
    quem usa IP dedicado, onde não há rotação para conter.

    ── Por que o padrão é DESLIGADO

    Era ligado, com `;session.{sessao}`. O fornecedor que não reconhece esse
    parâmetro não o ignora: ele recusa a credencial INTEIRA e responde 407, o
    mesmo 407 de senha errada. Nesse estado NENHUMA conta loga — e o teste de
    proxy do painel passa, porque ele usa a URL crua, sem molde. Quem investiga
    conclui que o proxy está bom e vai procurar o defeito nas contas.

    Um padrão cuja falha é "o produto inteiro para de funcionar, apontando para
    o lugar errado" não pode ser o padrão. Ligado, o ganho é IP estável por
    conta; desligado, o IP rotaciona — pior para o Instagram, e ainda assim
    incomparavelmente melhor que não conseguir entrar.

    Então a fixação virou opt-in: quem confirmou que o fornecedor aceita põe
    `PROXY_SESSAO_MOLDE` com a sintaxe dele. `scripts/sondar-proxy.sh` e
    `scripts/descobrir-chave-de-sessao.sh` existem para descobrir qual é.
    """
    if not url:
        return url

    molde = os.getenv("PROXY_SESSAO_MOLDE") or ""
    if not molde.strip():
        return url

    try:
        esquema, resto = url.split("://", 1)
    except ValueError:
        logger.warning("proxy sem esquema — fixação de sessão ignorada")
        return url

    if "@" not in resto:
        # Sem credenciais não há onde pôr o identificador: a fixação depende
        # do nome de usuário, e proxy sem autenticação não tem um.
        return url

    credenciais, destino = resto.rsplit("@", 1)
    if ":" not in credenciais:
        return url

    usuario, senha = credenciais.split(":", 1)
    sufixo = molde.replace("{sessao}", sessao_da_conta(account_id))

    # Não duplica: chamar duas vezes para a mesma conta tem de dar o mesmo
    # resultado, senão o identificador se acumularia a cada login.
    if sufixo in usuario:
        return url

    return f"{esquema}://{usuario}{sufixo}:{senha}@{destino}"


def lembrar_proxy(account_id: str, proxy: str | None) -> None:
    """
    Guarda (ou esquece) o proxy desta conta para os clientes seguintes.

    A URL é moldada AQUI, num ponto só, e não em cada consumidor: login,
    load, publicação e cliente recriado leem todos daqui, e moldar em cada um
    seria quatro chances de esquecer — com o sintoma de a conta trocar de IP
    só em algumas operações, que é o defeito mais difícil de enxergar.
    """
    anterior = _proxies.get(account_id)
    if proxy:
        _proxies[account_id] = moldar_proxy_por_conta(proxy, account_id)
        _proxies_crus[account_id] = proxy
    else:
        _proxies.pop(account_id, None)
        _proxies_crus.pop(account_id, None)
    # Proxy trocado no painel invalida o IP medido: ele descreve um caminho
    # que não é mais usado, e mantê-lo faria o log afirmar algo falso.
    if anterior != proxy:
        _ips_confirmados.clear()


def proxy_lembrado(account_id: str) -> str | None:
    return _proxies.get(account_id)


def explicar_recusa_de_proxy(account_id: str) -> str:
    """
    Diz se quem o fornecedor recusou foi a credencial ou o molde de sessão.

    ── Por que isto existe

    Para fixar o IP por conta, o nome de usuário do proxy recebe um sufixo:

        chave__cr.br;state.bahia;session.a1b2c3d4e5f6
                                 └──── acrescentado aqui ────┘

    Fornecedor que não reconhece esse parâmetro recusa a credencial INTEIRA e
    responde 407 — o mesmo 407 de senha errada. E aí a investigação vai para o
    lugar errado com força total: o teste do painel usa a URL crua, sem molde,
    e PASSA. Quem olha conclui que o proxy está bom e o problema é a conta.

    A resposta sai de uma medição: tenta a URL crua. Se ela funciona, o que
    sobra é o sufixo.
    """
    cru = _proxies_crus.get(account_id)
    moldado = _proxies.get(account_id)
    if not cru or not moldado or cru == moldado:
        return ""

    # Sem `or` com o antigo padrão: aqui o molde só serve para NOMEAR o sufixo
    # na explicação, e esta função só chega aqui quando um molde foi de fato
    # aplicado. Um valor de reserva imprimiria um sufixo que não está em uso.
    molde = os.getenv("PROXY_SESSAO_MOLDE") or "(molde configurado)"

    try:
        import requests
        r = requests.get(
            "https://api.ipify.org",
            proxies={"http": cru, "https": cru},
            timeout=15,
        )
        cru_funciona = r.status_code == 200
    except Exception:  # noqa: BLE001
        cru_funciona = False

    if cru_funciona:
        return (
            f" — sem o molde de sessão o proxy FUNCIONA, então o fornecedor "
            f"recusa o sufixo '{molde}' que acrescentamos ao usuário. Rode "
            f"scripts/sondar-proxy.sh para descobrir a sintaxe que ele aceita e "
            f"ponha em PROXY_SESSAO_MOLDE (vazio desliga a fixação de IP)."
        )
    return (
        " — a credencial é recusada mesmo SEM o molde de sessão, então o "
        "problema é a própria credencial, não a fixação de IP."
    )


# IP de saída já confirmado para cada proxy. A chave é o proxy, não a conta:
# dez contas pelo mesmo proxy saem pelo mesmo IP, e perguntar dez vezes só
# gastaria requisição.
_ips_confirmados: dict[str, str] = {}


def conferir_ip_de_saida(client, account_id: str, proxy: str | None) -> str | None:
    """
    De qual IP o Instagram enxerga esta sessão — medido, não presumido.

    `set_proxy()` diz o que QUEREMOS que aconteça. Isto verifica o que
    ACONTECE: a pergunta sai pela mesma sessão `public` que o login usa, com
    os mesmos proxies aplicados, então a resposta é o endereço que o
    Instagram vai ver.

    A distinção importa porque as duas falhas mais prováveis são silenciosas:
    um proxy que aceita a conexão e sai pelo IP do servidor mesmo assim, e um
    proxy que não é aplicado por engano nosso. Nas duas, o log diria "proxy
    configurado" e o tráfego sairia pelo endereço errado.

    Mede uma vez por proxy e guarda. Erro aqui nunca derruba o login — sem a
    medição seguimos sem ela, com o aviso no log.
    """
    chave = proxy or "__direto__"
    if chave in _ips_confirmados:
        return _ips_confirmados[chave]

    try:
        resp = client.public.get("https://api.ipify.org", timeout=12)
        ip = (resp.text or "").strip()
        if not ip:
            raise ValueError("resposta vazia")
        _ips_confirmados[chave] = ip
        _slog(
            "IP_DE_SAIDA", account_id,
            ip=ip,
            via=("proxy" if proxy else "direto"),
        )
        return ip
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "não foi possível confirmar o IP de saída da conta %s (%s) — o login "
            "segue, mas sem saber por qual endereço", account_id, e,
        )
        return None


def esquecer_ips_confirmados() -> None:
    """Zera as medições. Necessário ao trocar de proxy: o IP guardado passa a
    descrever um caminho que não é mais usado."""
    _ips_confirmados.clear()


async def get_entry(account_id: str) -> dict:
    """Get or create a pool entry for this account (creates isolated Client + Lock)."""
    async with _pool_lock:
        if account_id not in _pool:
            client = Client()
            apply_deterministic_device(client, account_id)
            # Depois do aparelho, porque set_locale reconstrói o User-Agent a
            # partir do device_settings — invertido, o idioma seria sobrescrito.
            aplicar_regiao(client)
            client.set_uuids(_device_uuids(account_id))
            apply_app_version(client)
            _patch_client_retries(client)
            _patch_client_fail_fast(client)

            # Cliente novo herda o proxy que a conta já usava. Sem isto, todo
            # restart do serviço devolvia as publicações ao IP do servidor.
            lembrado = _proxies.get(account_id)
            if lembrado:
                try:
                    client.set_proxy(lembrado)
                    _slog("PROXY_REAPLICADO", account_id)
                except Exception as e:  # noqa: BLE001
                    logger.error(
                        "não foi possível reaplicar o proxy da conta %s — as "
                        "requisições vão sair pelo IP do servidor: %s", account_id, e,
                    )
            _pool[account_id] = {
                "client": client,
                "lock":   asyncio.Lock(),
            }
        return _pool[account_id]


async def remove_entry(account_id: str) -> None:
    """Evict an account's client from the pool (called after session invalidation)."""
    async with _pool_lock:
        _pool.pop(account_id, None)
    _pending_2fa.pop(account_id, None)


def is_loaded(account_id: str) -> bool:
    """Return True if this account has a client in the pool (sync — pool check only)."""
    return account_id in _pool


# ── Structured logging ────────────────────────────────────────────────────────

# Fields that must never appear in logs.
_REDACT = frozenset({
    "password", "verification_code", "totp", "session",
    "cookies", "settings", "access_token", "token",
})


def _slog(event: str, account_id: str, **kwargs) -> None:
    """Emit a structured JSON log line. Strips secrets before logging."""
    safe = {k: v for k, v in kwargs.items() if k not in _REDACT}
    logger.info("%s", json.dumps({"event": event, "account": account_id, **safe}))


# ── Pending 2FA store ─────────────────────────────────────────────────────────

def store_pending_2fa(
    account_id: str,
    username: str,
    exc: Exception,
    client: Optional[Client] = None,
) -> None:
    """
    Guarda o estado do 2FA pendente para a verificação em duas etapas.

    O fluxo 2FA do instagrapi 2.18.14 é baseado em bloks e
    _login_with_bloks_two_factor precisa do `login_json` — o corpo da resposta de
    accounts/login/ — para extrair o two_step_verification_context.

    A fonte correta desse corpo é `client.last_json`, que é o que o próprio
    instagrapi.login() passa adiante. Extrair de exc.response.json() não serve:
    o payload do 2FA não vem por ali, e o resultado era o método falhar logo na
    primeira linha com "the response did not include two_step_verification_context".
    A extração pela exceção fica como reserva.

    A senha deliberadamente NÃO é armazenada aqui.
    TTL: 10 minutos — depois disso o login precisa ser reiniciado.
    """
    login_json: dict = {}

    if client is not None:
        candidate = getattr(client, "last_json", None)
        if isinstance(candidate, dict):
            login_json = candidate

    if not login_json:
        # Reserva: alguns caminhos carregam o corpo na própria exceção.
        response = getattr(exc, "response", None)
        if response is not None and hasattr(response, "json") and callable(response.json):
            try:
                login_json = response.json()
            except Exception:
                login_json = {}
        elif isinstance(response, dict):
            login_json = response

    _pending_2fa[account_id] = {
        "username":   username,
        "login_json": login_json,
        "exc":        exc,        # kept in-memory; never serialised or logged
        "expires_at": time.time() + _PENDING_2FA_TTL,
    }
    # As chaves do payload são registradas (só os nomes, nunca os valores) porque
    # a ausência de two_step_verification_context é a falha mais provável aqui.
    _slog(
        "LOGIN_2FA_PENDING",
        account_id,
        ttl_s=_PENDING_2FA_TTL,
        payload_keys=",".join(sorted(login_json.keys()))[:200] or "vazio",
    )


def get_pending_2fa(account_id: str) -> Optional[dict]:
    """Return pending 2FA state, or None if not found / expired."""
    entry = _pending_2fa.get(account_id)
    if not entry:
        return None
    if time.time() > entry["expires_at"]:
        _pending_2fa.pop(account_id, None)
        return None
    return entry


def clear_pending_2fa(account_id: str) -> None:
    """Clear pending 2FA state after verification (success or failure)."""
    _pending_2fa.pop(account_id, None)


# ── Desafio de verificação (checkpoint por e-mail/SMS) ────────────────────────
#
# Diferente do 2FA: aqui o Instagram exige confirmação de identidade por código
# enviado ao e-mail ou telefone da conta. O instagrapi resolve esse fluxo por
# conta própria em challenge_resolve(), mas pede o código por um callback
# SÍNCRONO (challenge_code_handler), que bloqueia até receber a resposta.
#
# Para encaixar isso num fluxo HTTP de duas etapas, challenge_resolve roda numa
# thread e o callback bloqueia numa Queue. O endpoint que recebe o código do
# usuário coloca o valor na fila e a thread prossegue de onde parou.
#
# A thread é dona do client enquanto o desafio está em andamento — por isso o
# endpoint do código NÃO adquire o lock da conta (evita deadlock com a thread).

_PENDING_CHALLENGE_TTL = 600  # 10 min — e-mail/SMS pode demorar a chegar
_pending_challenge: Dict[str, dict] = {}

# instagrapi usa 1 para e-mail e 0 para SMS em challenge_resolve_contact_form
_CHOICE_LABEL = {"1": "e-mail", "0": "SMS"}

# Ação bloks do checkpoint "aprove no app" — o Instagram não envia código nenhum
# nesse fluxo; ele espera aprovação num dispositivo confiável. Importada da
# biblioteca quando disponível, com literal de reserva para versões que não expõem.
try:
    from instagrapi.mixins.challenge import BLOKS_REDIRECT_ACTION
except ImportError:  # pragma: no cover — depende da versão do instagrapi
    BLOKS_REDIRECT_ACTION = "com.bloks.www.ig.challenge.redirect.async"


def payload_do_desafio(exc: Optional[Exception], client: Client) -> dict:
    """
    Corpo da resposta que originou o desafio.

    A fonte primária é a EXCEÇÃO: o instagrapi levanta ChallengeRequired(**last_json),
    então ela carrega os campos do instante exato da falha. Ler client.last_json é
    reserva, porque esse estado é sobrescrito pela requisição seguinte — e entre a
    falha do login e o clique do usuário passam minutos, tempo de sobra para o
    health check pingar a conta e apagar o contexto do desafio.
    """
    campos = ("bloks_action", "challenge_context", "challenge", "status", "message",
              "step_name", "step_data", "user_id", "nonce_code", "flow_render_type")

    payload = {}
    if exc is not None:
        for campo in campos:
            if hasattr(exc, campo):
                payload[campo] = getattr(exc, campo)

    if not payload.get("bloks_action"):
        ultimo = getattr(client, "last_json", None)
        if isinstance(ultimo, dict):
            # Preserva o que já veio da exceção; completa com o do client.
            payload = {**ultimo, **payload}

    return payload


def detect_challenge_kind(exc: Optional[Exception], client: Client) -> str:
    """
    Distingue os dois tipos de checkpoint do Instagram.

    'approval' — bloks redirect: aparece "tentativa de login" no app oficial e o
                 usuário aprova ali. NÃO chega código por e-mail/SMS. Depois da
                 aprovação é preciso chamar challenge_bloks_redirect_dismiss()
                 no MESMO client para reconhecer o checkpoint.
    'code'     — contact form: o Instagram envia um código por e-mail ou SMS.

    Confundir os dois deixa o usuário esperando um código que nunca chega — foi
    o que aconteceu enquanto a detecção lia client.last_json, já sobrescrito.
    """
    payload = payload_do_desafio(exc, client)
    if payload.get("bloks_action") == BLOKS_REDIRECT_ACTION and payload.get("challenge_context"):
        return "approval"
    return "code"


def store_pending_approval(account_id: str, client: Client, username: str, payload: dict) -> dict:
    """
    Registra um checkpoint do tipo aprovação.

    Sem thread e sem fila: nada a aguardar aqui — o usuário aprova no app e só
    então chamamos o dismiss.

    O `payload` é guardado porque challenge_bloks_redirect_dismiss() lê
    self.last_json para achar bloks_action e challenge_context. Entre a falha e a
    aprovação o client atende outras requisições (health check, ping) e esse
    estado se perde; guardá-lo aqui permite restaurá-lo na hora do dismiss.
    """
    entry = {
        "kind":       "approval",
        "client":     client,
        "username":   username,
        "payload":    payload or {},
        "expires_at": time.time() + _PENDING_CHALLENGE_TTL,
    }
    _pending_challenge[account_id] = entry
    _slog("CHALLENGE_APPROVAL_PENDING", account_id, ttl_s=_PENDING_CHALLENGE_TTL)
    return entry


def dismiss_bloks_challenge(account_id: str) -> dict:
    """
    Reconhece o checkpoint depois que o usuário aprovou o login no app oficial.

    Devolve:
      {"status": "DISMISSED"}            — reconhecido; refazer o login conclui
      {"status": "RETRY_LOGIN"}          — não era desafio bloks; descartar e refazer
      {"status": "NOT_APPROVED_YET"}     — o Instagram ainda vê o desafio aberto
      {"status": "UNSUPPORTED"}          — versão do instagrapi sem o método
      {"status": "FAILED", "error": ...} — falha inesperada
    """
    entry = get_pending_challenge(account_id)
    if not entry:
        return {"status": "FAILED", "error": "Nenhum desafio pendente"}

    # Desafio de código em que o usuário diz ter aprovado no app: não existe
    # contexto bloks para reconhecer. Serve de escape quando a detecção do tipo
    # errou — descartamos o desafio e o login é refeito com um client limpo.
    if entry.get("kind") != "approval":
        _slog("CHALLENGE_KIND_FALLBACK", account_id)
        return {"status": "RETRY_LOGIN"}

    client = entry["client"]
    if not hasattr(client, "challenge_bloks_redirect_dismiss"):
        return {"status": "UNSUPPORTED"}

    # Restaura o contexto do desafio antes do dismiss: a biblioteca o procura em
    # self.last_json, e qualquer requisição feita pelo client desde a falha
    # (health check, ping, sync) já sobrescreveu esse estado. Sem isto o dismiss
    # falha com "No pending Bloks redirect challenge context found" mesmo depois
    # de o usuário ter aprovado corretamente no app.
    payload = entry.get("payload") or {}
    if payload.get("bloks_action") and payload.get("challenge_context"):
        atual = getattr(client, "last_json", None)
        if not (isinstance(atual, dict) and atual.get("challenge_context")):
            client.last_json = dict(payload)
            _slog("CHALLENGE_CONTEXT_RESTORED", account_id)

    try:
        ok = bool(client.challenge_bloks_redirect_dismiss())
    except ChallengeRequired as e:
        # A própria biblioteca sinaliza assim quando o desafio segue aberto —
        # normalmente porque a aprovação no app ainda não foi feita.
        _slog("CHALLENGE_NOT_APPROVED_YET", account_id)
        return {"status": "NOT_APPROVED_YET", "error": str(e)[:200]}
    except Exception as e:  # noqa: BLE001
        return {"status": "FAILED", "error": f"{type(e).__name__}: {e}"[:300]}

    if not ok:
        return {"status": "NOT_APPROVED_YET"}

    _slog("CHALLENGE_DISMISSED", account_id)
    return {"status": "DISMISSED"}


def start_challenge(account_id: str, client: Client, last_json: dict, username: str) -> dict:
    """
    Dispara challenge_resolve() em thread e devolve o registro pendente.

    O código de verificação nunca é armazenado — ele passa pela fila e é
    consumido imediatamente pelo callback.
    """
    code_q: queue.Queue = queue.Queue(maxsize=1)
    state = {"asked": 0, "done": False, "ok": False, "error": "", "choice": None}

    def code_handler(_uname: str, choice) -> str:
        """Chamado pelo instagrapi a cada tentativa de código."""
        state["choice"] = str(choice)
        state["asked"] += 1
        try:
            return code_q.get(timeout=_PENDING_CHALLENGE_TTL)
        except queue.Empty:
            raise TimeoutError("Tempo esgotado aguardando o código de verificação")

    client.challenge_code_handler = code_handler

    def run() -> None:
        try:
            state["ok"] = bool(client.challenge_resolve(last_json))
        except Exception as e:  # noqa: BLE001 — qualquer falha vira erro do desafio
            state["error"] = f"{type(e).__name__}: {e}"[:300]
        finally:
            state["done"] = True

    thread = threading.Thread(target=run, name=f"challenge-{account_id}", daemon=True)
    thread.start()

    entry = {
        "kind": "code",
        "queue": code_q,
        "state": state,
        "thread": thread,
        "client": client,
        "username": username,
        "sent": 0,  # quantos códigos já enviamos para a fila
        "expires_at": time.time() + _PENDING_CHALLENGE_TTL,
    }
    _pending_challenge[account_id] = entry
    _slog("CHALLENGE_PENDING", account_id, ttl_s=_PENDING_CHALLENGE_TTL)
    return entry


def wait_challenge_target(account_id: str, timeout: float = 20.0) -> Optional[str]:
    """
    Espera o instagrapi escolher o canal (e-mail/SMS) e disparar o código.

    Devolve 'e-mail', 'SMS' ou None se ainda não deu tempo — nesse caso o
    desafio continua válido, só não sabemos o canal para exibir na tela.
    """
    entry = _pending_challenge.get(account_id)
    if not entry:
        return None
    state = entry["state"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        if state["choice"] is not None:
            return _CHOICE_LABEL.get(state["choice"], state["choice"])
        if state["done"]:
            return None
        time.sleep(0.25)
    return None


def get_pending_challenge(account_id: str) -> Optional[dict]:
    """Registro do desafio pendente, ou None se inexistente/expirado."""
    entry = _pending_challenge.get(account_id)
    if not entry:
        return None
    if time.time() > entry["expires_at"]:
        _pending_challenge.pop(account_id, None)
        return None
    return entry


def submit_challenge_code(account_id: str, code: str, timeout: float = 120.0) -> dict:
    """
    Entrega o código à thread do desafio e aguarda o desfecho.

    Devolve um dos três resultados:
      {"status": "AUTHENTICATED"}   — desafio resolvido
      {"status": "CODE_REJECTED"}   — Instagram recusou; o desafio segue aberto
                                      e o usuário pode tentar outro código
      {"status": "FAILED", "error"} — o fluxo terminou em erro
    """
    entry = get_pending_challenge(account_id)
    if not entry:
        return {"status": "FAILED", "error": "Nenhum desafio pendente"}

    state = entry["state"]
    asked_before = state["asked"]

    entry["queue"].put(code)
    entry["sent"] += 1

    deadline = time.time() + timeout
    while time.time() < deadline:
        if state["done"]:
            if state["ok"]:
                _slog("CHALLENGE_SUCCESS", account_id)
                return {"status": "AUTHENTICATED"}
            return {"status": "FAILED", "error": state["error"] or "Desafio não concluído"}
        # O callback foi chamado de novo: o instagrapi recusou este código e
        # está pedindo outro. O desafio continua vivo.
        if state["asked"] > asked_before:
            _slog("CHALLENGE_CODE_REJECTED", account_id, attempt=entry["sent"])
            return {"status": "CODE_REJECTED"}
        time.sleep(0.25)

    return {"status": "FAILED", "error": "Tempo esgotado ao validar o código"}


def clear_pending_challenge(account_id: str) -> None:
    """Descarta o desafio pendente (sucesso, falha ou cancelamento)."""
    _pending_challenge.pop(account_id, None)


# ── Error classification ──────────────────────────────────────────────────────

def classify_error(e: Exception) -> str:
    """
    Map an instagrapi / httpx / urllib3 exception to a stable error code string.

    Strategy:
    1. isinstance checks against known instagrapi exception classes (most precise —
       catches subclasses and works even when the exception is re-raised or wrapped).
    2. Type name substring checks (handles wrapped exceptions from older versions).
    3. Message content checks (last resort for exceptions we can't import).

    Invariants:
    - RATE_LIMITED is never confused with TWO_FACTOR_REQUIRED.
    - PROXY_ERROR is checked before generic NETWORK_ERROR.
    - The "too many 429 error responses" MaxRetryError is always RATE_LIMITED.
    """
    # ── Sentinel: pre_login_flow was rate-limited — explicit, no message parsing ──
    if isinstance(e, _PreLoginRateLimited):
        return "RATE_LIMITED"

    # ── isinstance (primary — most reliable) ─────────────────────────────────
    if isinstance(e, TwoFactorRequired):
        return "TWO_FACTOR_REQUIRED"
    if isinstance(e, ChallengeRequired):
        return "CHALLENGE_REQUIRED"
    if isinstance(e, BadPassword):
        return "BAD_PASSWORD"
    if isinstance(e, LoginRequired):
        return "SESSION_EXPIRED"
    if isinstance(e, FeedbackRequired):
        return "FEEDBACK_REQUIRED"
    if _PleaseWait is not None and isinstance(e, _PleaseWait):
        return "RATE_LIMITED"
    if _RateLimit is not None and isinstance(e, _RateLimit):
        return "RATE_LIMITED"

    type_name = type(e).__name__.lower()
    msg       = str(e).lower()

    # ── Conta suspensa ────────────────────────────────────────────────────────
    # instagrapi só lança AccountSuspended quando a URL do desafio contém
    # "/suspended/". A mensagem da exceção é "challenge_required", então a
    # checagem por texto mais abaixo classificaria como desafio comum e o painel
    # mandaria o usuário resolver algo no app — quando o estado real é suspensão,
    # que nenhuma automação resolve. O tipo tem prioridade sobre a mensagem.
    if "accountsuspended" in type_name or "account_suspended" in msg:
        return "ACCOUNT_SUSPENDED"

    # ── Proxy errors (before generic network) ────────────────────────────────
    if any(x in type_name for x in ("proxyerror", "socks5", "socks4")):
        return "PROXY_ERROR"
    if "proxy" in msg or ("tunnel" in msg and ("connect" in msg or "refused" in msg)):
        return "PROXY_ERROR"

    # ── Rate limit ────────────────────────────────────────────────────────────
    # "too many 429 error responses" — urllib3 MaxRetryError after exhausting retries
    if "429" in msg or "too many" in msg or "please wait" in msg:
        return "RATE_LIMITED"
    if "ratelimit" in type_name or "rate_limit" in msg or "rate limit" in msg:
        return "RATE_LIMITED"

    # ── Specific type name fallbacks ──────────────────────────────────────────
    if "twofactorrequired" in type_name:
        return "TWO_FACTOR_REQUIRED"
    if "challengerequired" in type_name or "challenge_required" in type_name:
        return "CHALLENGE_REQUIRED"
    if "badpassword" in type_name or "bad_password" in type_name:
        return "BAD_PASSWORD"
    if "loginrequired" in type_name or "login_required" in type_name:
        return "SESSION_EXPIRED"
    if "feedbackrequired" in type_name or "feedback_required" in type_name:
        return "FEEDBACK_REQUIRED"

    # ── Message-based fallbacks ───────────────────────────────────────────────
    if "challenge" in msg:
        return "CHALLENGE_REQUIRED"
    if "two_factor" in msg or "two factor" in msg or "2fa" in msg:
        return "TWO_FACTOR_REQUIRED"
    if "bad password" in msg or "wrong password" in msg:
        return "BAD_PASSWORD"
    if "login" in msg and ("required" in msg or "needed" in msg):
        return "SESSION_EXPIRED"

    # ── Timeouts ──────────────────────────────────────────────────────────────
    if "timeout" in type_name or "timed out" in msg or "timeout" in msg:
        return "TIMEOUT"

    # ── Network / connection (checked after RATE_LIMITED so MaxRetryError
    #    with 429 message doesn't land here) ───────────────────────────────────
    if any(x in type_name for x in ("connectionerror", "connecttimeout",
                                     "connectionreset", "networkxexception")):
        return "NETWORK_ERROR"
    if any(x in msg for x in ("connection refused", "connection reset",
                               "unreachable", "eof occurred", "broken pipe",
                               "name or service not known")):
        return "NETWORK_ERROR"

    # ── Identificador inexistente ─────────────────────────────────────────────
    # Resposta do Instagram quando o @ (ou e-mail) não corresponde a nenhuma
    # conta — inclui contas apagadas ou desativadas. Sem esta classificação cai
    # em UNKNOWN_ERROR e o painel sugere trocar a senha, que não é o problema.
    if ("can't find an account" in msg or "can’t find an account" in msg
            or "cant find an account" in msg or "no users found" in msg
            or "usernotfound" in type_name or "user not found" in msg):
        return "USER_NOT_FOUND"

    return "UNKNOWN_ERROR"

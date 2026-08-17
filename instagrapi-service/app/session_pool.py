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


def _patch_client_retries(client: Client) -> None:
    """
    Disable urllib3's automatic HTTP retry on the instagrapi private session.

    By default instagrapi/urllib3 may retry on 429 responses, turning one login
    click into 3-4 Instagram requests and accelerating the rate-limit window.
    Setting total=0 makes every 429 raise immediately so classify_error() handles
    it as RATE_LIMITED without amplifying requests to Instagram.

    Compatibility: works with urllib3 1.x and 2.x — avoids raise_on_status which
    has different semantics across minor versions and is not needed with total=0.
    """
    if not _HAS_REQUESTS_RETRY:
        return
    private = getattr(client, 'private', None)
    if private is None or not hasattr(private, 'mount'):
        return  # httpx-based client (future instagrapi versions) — no-op
    adapter_cls = _LoggingHTTPAdapter if _LoggingHTTPAdapter is not None else _HTTPAdapter
    adapter = adapter_cls(max_retries=_Retry(total=0))
    private.mount('https://', adapter)
    private.mount('http://', adapter)


def _patch_client_fail_fast(client: Client) -> None:
    """Override pre_login_flow to raise _PreLoginRateLimited on 429 instead of ignoring it.

    instagrapi's login() catches PleaseWaitFewMinutes/ClientThrottledError from
    pre_login_flow() and silently continues to call accounts/login/ — wasting one
    Instagram request per blocked attempt.

    This patch wraps pre_login_flow so any 429 raises _PreLoginRateLimited (a type
    that login() does NOT catch) → classify_error() maps it to RATE_LIMITED, and
    the accounts/login/ call is never made.

    Effect: each IP-blocked login attempt uses 1 Instagram request instead of 2.
    """
    if not _RATE_LIMIT_EXC:
        return  # no rate-limit exceptions importable — safe no-op
    _orig = client.pre_login_flow

    def _fail_fast_pre_login_flow():
        try:
            return _orig()
        except _RATE_LIMIT_EXC as exc:
            raise _PreLoginRateLimited(
                "pre_login_flow rate-limited — aborting to avoid spending accounts/login/ request"
            ) from exc

    client.pre_login_flow = _fail_fast_pre_login_flow


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


async def get_entry(account_id: str) -> dict:
    """Get or create a pool entry for this account (creates isolated Client + Lock)."""
    async with _pool_lock:
        if account_id not in _pool:
            client = Client()
            client.set_uuids(_device_uuids(account_id))
            _patch_client_retries(client)
            _patch_client_fail_fast(client)
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


def detect_challenge_kind(client: Client) -> str:
    """
    Distingue os dois tipos de checkpoint do Instagram.

    'approval' — bloks redirect: aparece "tentativa de login" no app oficial e o
                 usuário aprova ali. NÃO chega código por e-mail/SMS. Depois da
                 aprovação é preciso chamar challenge_bloks_redirect_dismiss()
                 no MESMO client para reconhecer o checkpoint.
    'code'     — contact form: o Instagram envia um código por e-mail ou SMS.

    Confundir os dois deixa o usuário esperando um código que nunca chega.
    """
    last_json = getattr(client, "last_json", None) or {}
    if last_json.get("bloks_action") == BLOKS_REDIRECT_ACTION and last_json.get("challenge_context"):
        return "approval"
    return "code"


def store_pending_approval(account_id: str, client: Client, username: str) -> dict:
    """
    Registra um checkpoint do tipo aprovação.

    Sem thread e sem fila: nada a aguardar aqui — o usuário aprova no app e só
    então chamamos o dismiss. O client é preservado porque
    challenge_bloks_redirect_dismiss() depende do last_json desta instância.
    """
    entry = {
        "kind":       "approval",
        "client":     client,
        "username":   username,
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

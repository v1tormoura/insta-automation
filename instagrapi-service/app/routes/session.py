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
)
from .. import session_pool

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
            client.set_proxy(proxy)

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
            kind = session_pool.detect_challenge_kind(client)
            duration_ms = int((time.perf_counter() - t0) * 1000)

            if kind == "approval":
                # Bloks redirect: o app oficial mostra "tentativa de login" e o
                # usuário aprova ali. Nenhum código é enviado. Guardamos o client
                # intacto — o dismiss depende do last_json desta instância.
                session_pool.store_pending_approval(body.account_id, client, body.username)
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
            last_json = getattr(client, "last_json", None) or {}
            session_pool.start_challenge(body.account_id, client, last_json, body.username)
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
            _raise_for_code(code, e, (body.password,), extra=meta)

        settings = client.get_settings()

    session_pool._slog("LOGIN_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


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
        # Proxy do painel (conta ou global) — o Node não repassa proxy neste
        # endpoint, então aqui só vale o do ambiente.
        global_proxy = os.getenv('GLOBAL_PROXY')
        if global_proxy:
            client.set_proxy(global_proxy)

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
            _raise_for_code(code, e, (body.verification_code,))
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
            _raise_for_code(code, e)


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
            _raise_for_code(code, e)


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
            client.set_proxy(proxy)
        loop = asyncio.get_running_loop()
        t0 = time.perf_counter()
        try:
            # login_by_sessionid sets the cookie and validates via account_info()
            # — no accounts/login/ call is made.
            await loop.run_in_executor(None, lambda: client.login_by_sessionid(body.sessionid))
        except Exception as e:
            code = session_pool.classify_error(e)
            duration_ms = int((time.perf_counter() - t0) * 1000)
            logger.warning(
                "login_by_sessionid: %s for account %s (type=%s) duration_ms=%d",
                code, body.account_id, type(e).__name__, duration_ms,
            )
            await session_pool.remove_entry(body.account_id)
            _raise_for_code(code, e, (body.sessionid,))

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
    if extra:
        message = f"{message}{extra}" if message else extra.strip()
    raise HTTPException(status_code=http_status, detail={"code": code, "message": message})

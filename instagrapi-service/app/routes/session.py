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
from instagrapi.exceptions import (
    BadPassword,
    ChallengeRequired,
    FeedbackRequired,
    LoginRequired,
    TwoFactorRequired,
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
    session_pool._slog("LOGIN_ATTEMPT", body.account_id, username=body.username)

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
            session_pool.store_pending_2fa(body.account_id, body.username, e)
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
            logger.warning(
                "[TEMP-DEBUG] login: %s for account %s (type=%s) duration_ms=%d exc=%s",
                code, body.account_id, type(e).__name__, duration_ms, exc_msg,
            )
            # Evict the failed client from the pool so ensureSession doesn't treat
            # this entry as a loaded session on subsequent restore attempts.
            await session_pool.remove_entry(body.account_id)
            _raise_for_code(code, e, (body.password,))

        settings = client.get_settings()

    session_pool._slog("LOGIN_SUCCESS", body.account_id)
    return {"status": "AUTHENTICATED", "settings": settings}


# ── /session/verify-2fa ────────────────────────────────────────────────────────

@router.post("/verify-2fa")
async def verify_2fa(body: TwoFactorVerifyRequest):
    """
    Complete a pending two-factor-authentication challenge.

    Must be called after /session/login returned TWO_FACTOR_REQUIRED.
    The pending challenge expires after 5 minutes — if expired, restart the login.
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
        # Apply global proxy if available
        global_proxy = os.getenv('GLOBAL_PROXY')
        if global_proxy:
            client.set_proxy(global_proxy)
        try:
            # instagrapi 2.18.14 uses a bloks-based 2FA flow — two_factor_login was
            # removed. _login_with_bloks_two_factor extracts two_step_verification_context
            # from login_json, infers the challenge type (totp/sms/backup_codes),
            # and drives the full bloks verification sequence.
            login_json = pending.get("login_json", {})
            orig_exc   = pending.get("exc") or TwoFactorRequired("2FA pending state")
            client._login_with_bloks_two_factor(
                body.verification_code,
                login_json,
                orig_exc,
            )
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
            return {
                "valid":     True,
                "username":  info.username or "",
                "full_name": info.full_name or "",
                "pk":        str(info.pk),
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

    client   = pending["client"]
    settings = client.get_settings()
    session_pool.clear_pending_challenge(body.account_id)

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


def _raise_for_code(code: str, exc: Exception | None = None, secrets: tuple = ()) -> None:
    """Raise the appropriate HTTPException for a given error code."""
    _STATUS = {
        "RATE_LIMITED":       429,
        "CHALLENGE_REQUIRED": 428,
        "BAD_PASSWORD":       422,
        "USER_NOT_FOUND":     422,
        "FEEDBACK_REQUIRED":  403,
        "SESSION_EXPIRED":    422,
        "TIMEOUT":            504,
        "PROXY_ERROR":        502,
        "NETWORK_ERROR":      503,
        "LOGIN_IN_PROGRESS":  409,
        # TWO_FACTOR_REQUIRED is handled before this function is called — 202 is not an error
    }
    http_status = _STATUS.get(code, 422)  # fallback 422, not 401 (401 triggers SaaS logout)
    # Códigos conhecidos têm mensagem curada no Node; para os desconhecidos,
    # devolvemos o motivo real (higienizado) em vez de deixar o front adivinhar.
    message = _safe_detail(exc, secrets) if code == "UNKNOWN_ERROR" else ""
    raise HTTPException(status_code=http_status, detail={"code": code, "message": message})

"""
Tests for session_pool.py

Covers: classify_error, pending-2FA store, pool isolation.
Does NOT call Instagram — all tests are unit tests with no network.
"""
import time
import pytest
import asyncio
from unittest.mock import MagicMock, patch


# ── classify_error ─────────────────────────────────────────────────────────────

def test_import():
    from app import session_pool
    assert hasattr(session_pool, "classify_error")


def _classify(exc_type_name, message):
    """Helper: create a fake exception with given type name and message."""
    from app import session_pool
    exc = Exception(message)
    exc.__class__ = type(exc_type_name, (Exception,), {})
    return session_pool.classify_error(exc)


def test_classify_429_in_message():
    from app import session_pool
    e = Exception("HTTPSConnectionPool: Max retries exceeded (Caused by ResponseError('too many 429 error responses'))")
    assert session_pool.classify_error(e) == "RATE_LIMITED"


def test_classify_too_many_in_message():
    from app import session_pool
    e = Exception("too many 429 error responses")
    assert session_pool.classify_error(e) == "RATE_LIMITED"


def test_classify_rate_limit_with_space():
    from app import session_pool
    e = Exception("rate limit exceeded")
    assert session_pool.classify_error(e) == "RATE_LIMITED"


def test_classify_ratelimit_typname():
    from app import session_pool
    exc = type("RateLimitError", (Exception,), {})("hit")
    assert session_pool.classify_error(exc) == "RATE_LIMITED"


def test_classify_twofactorrequired_typename():
    from app import session_pool
    exc = type("TwoFactorRequired", (Exception,), {})("2fa")
    assert session_pool.classify_error(exc) == "TWO_FACTOR_REQUIRED"


def test_classify_challenge_typename():
    from app import session_pool
    exc = type("ChallengeRequired", (Exception,), {})("challenge")
    assert session_pool.classify_error(exc) == "CHALLENGE_REQUIRED"


def test_classify_challenge_in_message():
    from app import session_pool
    e = Exception("challenge_required by instagram")
    assert session_pool.classify_error(e) == "CHALLENGE_REQUIRED"


def test_classify_bad_password_typename():
    from app import session_pool
    exc = type("BadPassword", (Exception,), {})("wrong")
    assert session_pool.classify_error(exc) == "BAD_PASSWORD"


def test_classify_login_required_typename():
    from app import session_pool
    exc = type("LoginRequired", (Exception,), {})("expired")
    assert session_pool.classify_error(exc) == "SESSION_EXPIRED"


def test_classify_feedback_typename():
    from app import session_pool
    exc = type("FeedbackRequired", (Exception,), {})("blocked")
    assert session_pool.classify_error(exc) == "FEEDBACK_REQUIRED"


def test_classify_timeout_typename():
    from app import session_pool
    exc = type("TimeoutError", (Exception,), {})("timed out")
    assert session_pool.classify_error(exc) == "TIMEOUT"


def test_classify_unknown():
    from app import session_pool
    e = Exception("some completely unknown error")
    assert session_pool.classify_error(e) == "UNKNOWN_ERROR"


# ── Pending 2FA store ──────────────────────────────────────────────────────────

def _make_2fa_exc(response=None):
    """Helper: create a fake TwoFactorRequired with a controllable .response."""
    from instagrapi.exceptions import TwoFactorRequired
    exc = TwoFactorRequired("2FA required")
    exc.response = response
    return exc


def test_store_and_get_pending_2fa():
    from app import session_pool

    # response is already a dict — store_pending_2fa should keep it as-is
    exc = _make_2fa_exc(response={"two_step_verification_context": "ctx-abc"})
    session_pool.store_pending_2fa("acc1", "user1", exc)
    pending = session_pool.get_pending_2fa("acc1")
    assert pending is not None
    assert pending["username"] == "user1"
    assert pending["login_json"] == {"two_step_verification_context": "ctx-abc"}
    assert pending["exc"] is exc


def test_store_pending_2fa_response_object():
    from app import session_pool
    from unittest.mock import MagicMock

    # response is a requests.Response-like object with .json()
    mock_response = MagicMock()
    mock_response.json.return_value = {"two_step_verification_context": "ctx-xyz"}
    exc = _make_2fa_exc(response=mock_response)
    session_pool.store_pending_2fa("acc1b", "user1b", exc)
    pending = session_pool.get_pending_2fa("acc1b")
    assert pending["login_json"] == {"two_step_verification_context": "ctx-xyz"}


def test_store_pending_2fa_no_response():
    from app import session_pool

    # response is None — login_json should default to {}
    exc = _make_2fa_exc(response=None)
    session_pool.store_pending_2fa("acc1c", "user1c", exc)
    pending = session_pool.get_pending_2fa("acc1c")
    assert pending["login_json"] == {}


def test_clear_pending_2fa():
    from app import session_pool
    session_pool.store_pending_2fa("acc2", "user2", _make_2fa_exc())
    session_pool.clear_pending_2fa("acc2")
    assert session_pool.get_pending_2fa("acc2") is None


def test_pending_2fa_expires():
    from app import session_pool
    session_pool.store_pending_2fa("acc3", "user3", _make_2fa_exc())
    # Manually expire the entry
    session_pool._pending_2fa["acc3"]["expires_at"] = time.time() - 1
    assert session_pool.get_pending_2fa("acc3") is None


def test_pending_2fa_not_present_returns_none():
    from app import session_pool
    assert session_pool.get_pending_2fa("nonexistent-account") is None


# ── Pool isolation ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_different_accounts_get_different_clients():
    from app import session_pool
    e1 = await session_pool.get_entry("iso-1")
    e2 = await session_pool.get_entry("iso-2")
    assert e1["client"] is not e2["client"]
    assert e1["lock"] is not e2["lock"]


@pytest.mark.asyncio
async def test_same_account_returns_same_client():
    from app import session_pool
    e1 = await session_pool.get_entry("same-acc")
    e2 = await session_pool.get_entry("same-acc")
    assert e1["client"] is e2["client"]


@pytest.mark.asyncio
async def test_remove_entry_evicts_client():
    from app import session_pool
    await session_pool.get_entry("evict-acc")
    assert session_pool.is_loaded("evict-acc") is True
    await session_pool.remove_entry("evict-acc")
    assert session_pool.is_loaded("evict-acc") is False


@pytest.mark.asyncio
async def test_remove_entry_clears_pending_2fa():
    from app import session_pool
    session_pool.store_pending_2fa("evict-2fa", "user", "ident")
    await session_pool.remove_entry("evict-2fa")
    assert session_pool.get_pending_2fa("evict-2fa") is None


# ── Phase B: isinstance-based classify_error ───────────────────────────────────
# These tests use REAL instagrapi exception classes so the isinstance path is exercised,
# not just the type-name fallback path.

def test_classify_real_two_factor_required():
    from app import session_pool
    from instagrapi.exceptions import TwoFactorRequired
    assert session_pool.classify_error(TwoFactorRequired("2fa")) == "TWO_FACTOR_REQUIRED"


def test_classify_real_challenge_required():
    from app import session_pool
    from instagrapi.exceptions import ChallengeRequired
    assert session_pool.classify_error(ChallengeRequired("chall")) == "CHALLENGE_REQUIRED"


def test_classify_real_bad_password():
    from app import session_pool
    from instagrapi.exceptions import BadPassword
    assert session_pool.classify_error(BadPassword("wrong")) == "BAD_PASSWORD"


def test_classify_real_login_required_is_session_expired():
    from app import session_pool
    from instagrapi.exceptions import LoginRequired
    assert session_pool.classify_error(LoginRequired("expired")) == "SESSION_EXPIRED"


def test_classify_real_feedback_required():
    from app import session_pool
    from instagrapi.exceptions import FeedbackRequired
    assert session_pool.classify_error(FeedbackRequired("blocked")) == "FEEDBACK_REQUIRED"


# ── Phase B: PROXY_ERROR ───────────────────────────────────────────────────────

def test_classify_proxy_error_by_typename():
    from app import session_pool
    exc = type("ProxyError", (Exception,), {})("connection refused through proxy")
    assert session_pool.classify_error(exc) == "PROXY_ERROR"


def test_classify_proxy_error_by_message():
    from app import session_pool
    e = Exception("proxy refused connection: 407 Proxy Authentication Required")
    assert session_pool.classify_error(e) == "PROXY_ERROR"


def test_classify_tunnel_connect_refused_is_proxy_error():
    from app import session_pool
    e = Exception("tunnel connection failed: 403 Forbidden (connect refused)")
    assert session_pool.classify_error(e) == "PROXY_ERROR"


# ── Phase B: NETWORK_ERROR ────────────────────────────────────────────────────

def test_classify_connection_error_typename():
    from app import session_pool
    exc = type("ConnectionError", (Exception,), {})("network failure")
    assert session_pool.classify_error(exc) == "NETWORK_ERROR"


def test_classify_network_error_by_message():
    from app import session_pool
    e = Exception("connection refused to api.instagram.com:443")
    assert session_pool.classify_error(e) == "NETWORK_ERROR"


def test_classify_eof_is_network_error():
    from app import session_pool
    e = Exception("EOF occurred in violation of protocol")
    assert session_pool.classify_error(e) == "NETWORK_ERROR"


def test_classify_maxretry_429_is_rate_limited_not_network():
    """MaxRetryError with '429' message must classify as RATE_LIMITED, not NETWORK_ERROR."""
    from app import session_pool
    exc = type("MaxRetryError", (Exception,), {})(
        "HTTPSConnectionPool: Max retries exceeded (Caused by ResponseError('too many 429 error responses'))"
    )
    assert session_pool.classify_error(exc) == "RATE_LIMITED"


# ── Phase B: _slog secret stripping ───────────────────────────────────────────

def test_slog_strips_password(caplog):
    import logging
    from app import session_pool
    with caplog.at_level(logging.INFO, logger="app.session_pool"):
        session_pool._slog("TEST_EVENT", "acc-secret", password="supersecret", username="user1")
    assert "supersecret" not in caplog.text
    assert "user1" in caplog.text


def test_slog_strips_verification_code(caplog):
    import logging
    from app import session_pool
    with caplog.at_level(logging.INFO, logger="app.session_pool"):
        session_pool._slog("TEST_EVENT", "acc-vc", verification_code="123456", event_type="login")
    assert "123456" not in caplog.text
    assert "event_type" in caplog.text

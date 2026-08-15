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

def test_store_and_get_pending_2fa():
    from app import session_pool
    session_pool.store_pending_2fa("acc1", "user1", "ident-abc")
    pending = session_pool.get_pending_2fa("acc1")
    assert pending is not None
    assert pending["username"] == "user1"
    assert pending["two_factor_identifier"] == "ident-abc"


def test_clear_pending_2fa():
    from app import session_pool
    session_pool.store_pending_2fa("acc2", "user2", "ident-xyz")
    session_pool.clear_pending_2fa("acc2")
    assert session_pool.get_pending_2fa("acc2") is None


def test_pending_2fa_expires():
    from app import session_pool
    session_pool.store_pending_2fa("acc3", "user3", "ident")
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

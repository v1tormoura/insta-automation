"""
Tests for _patch_client_fail_fast and _PreLoginRateLimited (session_pool.py).

Verifies:
- _PreLoginRateLimited always classifies as RATE_LIMITED without message parsing
- Patched pre_login_flow raises _PreLoginRateLimited on rate-limit exceptions
- Patched pre_login_flow lets non-rate-limit errors propagate unchanged
- Patched pre_login_flow passes through successful calls unchanged
- _patch_client_fail_fast is a no-op when _RATE_LIMIT_EXC is empty
- Client from get_entry() has the fail-fast patch active
"""
import asyncio
import pytest
from unittest.mock import MagicMock, patch


# ── classify_error + _PreLoginRateLimited ─────────────────────────────────────

def test_pre_login_rate_limited_classifies_as_rate_limited():
    """_PreLoginRateLimited must be RATE_LIMITED — no message-content check."""
    from app.session_pool import _PreLoginRateLimited, classify_error
    assert classify_error(_PreLoginRateLimited("pre_login_flow rate-limited")) == "RATE_LIMITED"


def test_pre_login_rate_limited_empty_message_still_rate_limited():
    """_PreLoginRateLimited with no message still classifies as RATE_LIMITED."""
    from app.session_pool import _PreLoginRateLimited, classify_error
    assert classify_error(_PreLoginRateLimited()) == "RATE_LIMITED"


def test_pre_login_rate_limited_takes_priority_over_message_check():
    """_PreLoginRateLimited is matched by isinstance before any message-content check."""
    from app.session_pool import _PreLoginRateLimited, classify_error
    # Deliberately ambiguous message — classified by type, not content
    exc = _PreLoginRateLimited("some unrelated message with no 429 keywords")
    assert classify_error(exc) == "RATE_LIMITED"


# ── _patch_client_fail_fast behavior ─────────────────────────────────────────

def test_patch_fail_fast_converts_please_wait_to_pre_login_rate_limited():
    """PleaseWaitFewMinutes from pre_login_flow becomes _PreLoginRateLimited."""
    from instagrapi import Client
    from instagrapi.exceptions import PleaseWaitFewMinutes
    from app.session_pool import _patch_client_fail_fast, _PreLoginRateLimited

    client = Client()
    client.pre_login_flow = MagicMock(side_effect=PleaseWaitFewMinutes("Please wait"))
    _patch_client_fail_fast(client)

    with pytest.raises(_PreLoginRateLimited):
        client.pre_login_flow()


def test_patch_fail_fast_result_classifies_as_rate_limited_end_to_end():
    """_PreLoginRateLimited from the patch classifies as RATE_LIMITED (full chain)."""
    from instagrapi import Client
    from instagrapi.exceptions import PleaseWaitFewMinutes
    from app.session_pool import _patch_client_fail_fast, classify_error

    client = Client()
    client.pre_login_flow = MagicMock(side_effect=PleaseWaitFewMinutes("Please wait"))
    _patch_client_fail_fast(client)

    caught = None
    try:
        client.pre_login_flow()
    except Exception as e:
        caught = e

    assert caught is not None
    assert classify_error(caught) == "RATE_LIMITED"


def test_patch_fail_fast_non_rate_limit_error_propagates_unchanged():
    """Non-rate-limit errors from pre_login_flow propagate as their original type."""
    from instagrapi import Client
    from app.session_pool import _patch_client_fail_fast, _PreLoginRateLimited

    client = Client()
    client.pre_login_flow = MagicMock(side_effect=ConnectionError("network down"))
    _patch_client_fail_fast(client)

    with pytest.raises(ConnectionError):
        client.pre_login_flow()


def test_patch_fail_fast_non_rate_limit_not_wrapped_as_pre_login():
    """Non-rate-limit errors are NOT converted to _PreLoginRateLimited."""
    from instagrapi import Client
    from app.session_pool import _patch_client_fail_fast, _PreLoginRateLimited

    client = Client()
    client.pre_login_flow = MagicMock(side_effect=ValueError("unexpected"))
    _patch_client_fail_fast(client)

    with pytest.raises(ValueError):
        client.pre_login_flow()


def test_patch_fail_fast_success_returns_unchanged():
    """Successful pre_login_flow (returns True) passes through without modification."""
    from instagrapi import Client
    from app.session_pool import _patch_client_fail_fast

    client = Client()
    client.pre_login_flow = MagicMock(return_value=True)
    _patch_client_fail_fast(client)

    assert client.pre_login_flow() is True


def test_patch_fail_fast_applies_instance_attribute():
    """_patch_client_fail_fast sets pre_login_flow as an instance attribute (not class)."""
    from instagrapi import Client
    from app.session_pool import _patch_client_fail_fast

    client = Client()
    _patch_client_fail_fast(client)

    assert 'pre_login_flow' in client.__dict__


def test_patch_fail_fast_noop_when_rate_limit_exc_empty():
    """_patch_client_fail_fast is a no-op and does NOT patch when _RATE_LIMIT_EXC is empty."""
    from instagrapi import Client
    from app import session_pool
    from app.session_pool import _patch_client_fail_fast

    client = Client()

    with patch.object(session_pool, '_RATE_LIMIT_EXC', ()):
        _patch_client_fail_fast(client)
        # pre_login_flow must NOT be set as instance attribute (function returned early)
        assert 'pre_login_flow' not in client.__dict__


# ── get_entry() integration ───────────────────────────────────────────────────

def test_get_entry_client_has_fail_fast_patch():
    """Client created by get_entry() has pre_login_flow patched to fail fast on 429."""
    from instagrapi.exceptions import PleaseWaitFewMinutes
    from app.session_pool import get_entry, remove_entry, _PreLoginRateLimited

    test_id = "test-fail-fast-integration"

    async def run():
        await remove_entry(test_id)
        entry = await get_entry(test_id)
        client = entry["client"]

        # Mock sync_launcher (what the original pre_login_flow calls internally).
        # Mocking pre_login_flow directly would replace the fail-fast wrapper, bypassing it.
        client.sync_launcher = MagicMock(side_effect=PleaseWaitFewMinutes("wait"))

        try:
            client.pre_login_flow()  # wrapper → _orig() → sync_launcher → PleaseWait → _PreLoginRateLimited
            return "no_exception"
        except _PreLoginRateLimited:
            return "correct"
        except Exception as exc:
            return f"wrong_type:{type(exc).__name__}"
        finally:
            await remove_entry(test_id)

    result = asyncio.run(run())
    assert result == "correct", f"Expected _PreLoginRateLimited, got: {result}"


def test_get_entry_client_has_retry_zero_and_fail_fast():
    """Client from get_entry() has BOTH retry=0 and fail-fast patches active."""
    from app.session_pool import get_entry, remove_entry

    test_id = "test-both-patches"

    async def run():
        await remove_entry(test_id)
        entry = await get_entry(test_id)
        client = entry["client"]

        # Check retry patch
        adapter = client.private.get_adapter("https://i.instagram.com/")
        # read=0/status=0 é a proteção real (ver _build_retry); total=0 era a
        # política antiga, trocada na correção do login por TLS EOF.
        retry_ok = adapter.max_retries.read == 0 and adapter.max_retries.status == 0

        # Check fail-fast patch
        fail_fast_ok = 'pre_login_flow' in client.__dict__

        await remove_entry(test_id)
        return retry_ok, fail_fast_ok

    retry_ok, fail_fast_ok = asyncio.run(run())
    assert retry_ok, "retry total should be 0 (urllib3 no-retry patch)"
    assert fail_fast_ok, "pre_login_flow should be patched (fail-fast patch)"

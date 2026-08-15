"""
Tests for session.py route helpers.

Focuses on _raise_for_code — verifies that:
- PROXY_ERROR   → 502  (not 401, not 422)
- NETWORK_ERROR → 503
- LOGIN_IN_PROGRESS → 409
- BAD_PASSWORD  → 422  (not 401)
- SESSION_EXPIRED → 422 (not 401)
- RATE_LIMITED  → 429
- UNKNOWN       → 422  (fallback must be 422, never 401 — 401 triggers SaaS logout)
"""
import pytest
from fastapi import HTTPException


def _raise(code: str):
    from app.routes.session import _raise_for_code
    with pytest.raises(HTTPException) as exc_info:
        _raise_for_code(code)
    return exc_info.value


def test_bad_password_returns_422():
    assert _raise("BAD_PASSWORD").status_code == 422


def test_session_expired_returns_422():
    assert _raise("SESSION_EXPIRED").status_code == 422


def test_rate_limited_returns_429():
    assert _raise("RATE_LIMITED").status_code == 429


def test_challenge_required_returns_428():
    assert _raise("CHALLENGE_REQUIRED").status_code == 428


def test_feedback_required_returns_403():
    assert _raise("FEEDBACK_REQUIRED").status_code == 403


def test_timeout_returns_504():
    assert _raise("TIMEOUT").status_code == 504


def test_proxy_error_returns_502():
    assert _raise("PROXY_ERROR").status_code == 502


def test_network_error_returns_503():
    assert _raise("NETWORK_ERROR").status_code == 503


def test_login_in_progress_returns_409():
    assert _raise("LOGIN_IN_PROGRESS").status_code == 409


def test_unknown_code_returns_422_not_401():
    """Any unknown code must return 422. 401 is reserved for SaaS JWT auth and must never
    be returned by instagrapi routes — it triggers the frontend to log the user out."""
    assert _raise("UNKNOWN_ERROR").status_code == 422
    assert _raise("PUBLISH_ERROR").status_code == 422
    assert _raise("WHATEVER").status_code == 422


def test_raise_for_code_embeds_code_in_detail():
    exc = _raise("BAD_PASSWORD")
    assert exc.detail["code"] == "BAD_PASSWORD"

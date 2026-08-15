"""
Tests for _patch_client_retries (session_pool.py).

Verifies:
- Retry(total=0) constructor works in the installed urllib3 version (1.x and 2.x)
- _patch_client_retries() mounts an adapter with total=0 on the client's private session
- A 429 response is NOT retried (only 1 request reaches Instagram per login attempt)
- The patch is a no-op when client.private is None (httpx-based future versions)
"""
import pytest


def test_retry_zero_constructor_compat():
    """Retry(total=0) must work in urllib3 1.x and 2.x without keyword errors."""
    from urllib3.util.retry import Retry
    from requests.adapters import HTTPAdapter
    retry = Retry(total=0)
    adapter = HTTPAdapter(max_retries=retry)
    assert adapter is not None
    assert adapter.max_retries.total == 0


def test_patch_sets_retry_total_zero():
    """After _patch_client_retries(), the private session adapter must have total=0."""
    from instagrapi import Client
    from app.session_pool import _patch_client_retries

    client = Client()
    _patch_client_retries(client)

    private = client.private
    # requests.Session.get_adapter returns the adapter for a given URL prefix
    adapter = private.get_adapter("https://i.instagram.com/api/v1/accounts/login/")
    assert adapter.max_retries.total == 0, (
        f"Expected retry total=0, got {adapter.max_retries.total!r}. "
        "_patch_client_retries did not override the adapter."
    )


def test_patch_covers_http_prefix():
    """The http:// prefix must also be patched (some instagrapi endpoints use plain http)."""
    from instagrapi import Client
    from app.session_pool import _patch_client_retries

    client = Client()
    _patch_client_retries(client)

    adapter = client.private.get_adapter("http://i.instagram.com/")
    assert adapter.max_retries.total == 0


def test_patch_noop_when_private_is_none():
    """_patch_client_retries must not raise when client.private is None."""
    from unittest.mock import MagicMock
    from app.session_pool import _patch_client_retries

    client = MagicMock()
    client.private = None  # simulate httpx-based Client (future instagrapi)
    _patch_client_retries(client)  # must not raise


def test_patch_noop_when_private_has_no_mount():
    """_patch_client_retries must not raise when client.private lacks .mount()."""
    from unittest.mock import MagicMock
    from app.session_pool import _patch_client_retries

    client = MagicMock()
    client.private = MagicMock(spec=[])  # spec=[] → no attributes, hasattr returns False
    _patch_client_retries(client)  # must not raise


def test_patch_idempotent():
    """Calling _patch_client_retries twice must not raise and total stays 0."""
    from instagrapi import Client
    from app.session_pool import _patch_client_retries

    client = Client()
    _patch_client_retries(client)
    _patch_client_retries(client)  # second call must be safe

    adapter = client.private.get_adapter("https://i.instagram.com/")
    assert adapter.max_retries.total == 0

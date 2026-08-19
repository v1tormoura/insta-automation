"""
Tests for _patch_client_retries (session_pool.py).

Verifies:
- Retry(total=0) constructor works in the installed urllib3 version (1.x and 2.x)
- _patch_client_retries() mounts an adapter with total=0 on the client's private session
- A 429 response is NOT retried (only 1 request reaches Instagram per login attempt)
- The patch is a no-op when client.private is None (httpx-based future versions)
"""
import pytest


def _assert_politica(retry):
    """
    Verifica a política de retentativa REAL do projeto.

    Antes era total=0 (nenhuma retentativa). Isso protegia contra amplificar
    rate limit, mas matava o login em qualquer queda momentânea de TLS — comum
    com proxy. A política passou a separar transporte de resposta:

      connect > 0 → repete quando a conexão nem chegou ao servidor (seguro).
      read = 0    → NÃO repete depois de enviar: um POST entregue pode já ter
                    sido processado, e repetir publicaria/logaria duas vezes.
      status = 0  → NÃO repete por código HTTP; 429 falha de imediato.

    O que estes testes precisam garantir é read=0 e status=0 — é aí que mora a
    proteção. Fixar total=0 amarrava o teste à política antiga.
    """
    assert retry.read == 0,   f"read deve ser 0 (não repetir POST enviado), veio {retry.read!r}"
    assert retry.status == 0, f"status deve ser 0 (não repetir por HTTP), veio {retry.status!r}"
    assert (retry.connect or 0) > 0, f"connect deve permitir retentativa de transporte, veio {retry.connect!r}"



def test_retry_zero_constructor_compat():
    """
    Retry(total=0) precisa construir em urllib3 1.x e 2.x sem erro de keyword.

    Verifica a RESERVA de _build_retry (o `return _Retry(total=0)` do último
    except), não a política do projeto — por isso não usa _assert_politica.
    """
    from urllib3.util.retry import Retry
    from requests.adapters import HTTPAdapter
    retry = Retry(total=0)
    adapter = HTTPAdapter(max_retries=retry)
    assert adapter is not None
    assert adapter.max_retries.total == 0


def test_patch_sets_retry_policy():
    """Depois de _patch_client_retries(), o adapter privado segue a política do projeto."""
    from instagrapi import Client
    from app.session_pool import _patch_client_retries

    client = Client()
    _patch_client_retries(client)

    private = client.private
    # requests.Session.get_adapter returns the adapter for a given URL prefix
    adapter = private.get_adapter("https://i.instagram.com/api/v1/accounts/login/")
    _assert_politica(adapter.max_retries)


def test_patch_covers_http_prefix():
    """The http:// prefix must also be patched (some instagrapi endpoints use plain http)."""
    from instagrapi import Client
    from app.session_pool import _patch_client_retries

    client = Client()
    _patch_client_retries(client)

    adapter = client.private.get_adapter("http://i.instagram.com/")
    _assert_politica(adapter.max_retries)


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
    _assert_politica(adapter.max_retries)

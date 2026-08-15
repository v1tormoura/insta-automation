"""
Per-account instagrapi client pool.

Each account gets exactly one Client instance and one asyncio.Lock.
The pool lives for the process lifetime; clients are evicted when
invalidated or the process restarts (Node.js reloads sessions from MongoDB).

SECURITY GUARANTEES:
- Each account's Client, session, cookies, device UUID, and proxy are fully isolated.
- No client data is ever shared between accounts.
- Per-account asyncio.Lock prevents concurrent Instagram requests for the same account.
"""

import asyncio
from typing import Dict
from instagrapi import Client

# pool: account_id → { "client": Client, "lock": asyncio.Lock }
_pool: Dict[str, dict] = {}
_pool_lock = asyncio.Lock()


async def get_entry(account_id: str) -> dict:
    """Get or create a pool entry for this account (creates isolated Client + Lock)."""
    async with _pool_lock:
        if account_id not in _pool:
            _pool[account_id] = {
                "client": Client(),
                "lock": asyncio.Lock(),
            }
        return _pool[account_id]


async def remove_entry(account_id: str) -> None:
    """Evict an account's client from the pool (called after session invalidation)."""
    async with _pool_lock:
        _pool.pop(account_id, None)


def is_loaded(account_id: str) -> bool:
    """Return True if this account has a client in the pool (sync — pool check only)."""
    return account_id in _pool


def classify_error(e: Exception) -> str:
    """Map an instagrapi exception to a stable error code string."""
    type_name = type(e).__name__
    msg = str(e).lower()
    if "loginrequired" in type_name or "login_required" in msg or "ClientLoginRequired" in type_name:
        return "SESSION_EXPIRED"
    if "challenge" in type_name.lower() or "challenge" in msg:
        return "CHALLENGE_REQUIRED"
    if "feedback" in type_name.lower() or "feedback_required" in msg:
        return "FEEDBACK_REQUIRED"
    if "ratelimit" in type_name.lower() or "rate limit" in msg:
        return "RATE_LIMITED"
    return "PUBLISH_ERROR"

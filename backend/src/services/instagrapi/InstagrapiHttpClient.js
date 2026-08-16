'use strict';

const UPLOADS_DIR      = process.env.UPLOADS_DIR || '/app/uploads';
const DEFAULT_BASE     = process.env.INSTAGRAPI_SERVICE_URL || 'http://instagrapi-svc:8000';
const TIMEOUT_FAST     = 15_000;   // ms — for session operations (status, ping, evict)
const TIMEOUT_LOGIN    = 90_000;   // ms — Instagram login can take 20-90 s under load
const TIMEOUT_MEDIA    = 180_000;  // ms — up to 3 min for video uploads
// Publish lock TTL: longer than the media upload timeout so the lock never
// expires while a valid upload is in progress.
const LOCK_TTL_PUBLISH = 210_000;  // ms — 3.5 min

/**
 * HTTP client for the Docker-internal Python instagrapi service.
 *
 * Responsibilities:
 *  - Calls the Python FastAPI service for all Instagram operations.
 *  - Coordinates session load/save with SessionManager (MongoDB persistence).
 *  - Maps media relative paths to absolute container paths (/app/uploads/…).
 *
 * SECURITY:
 *  - Passwords are never stored — they are passed through in-memory only.
 *  - Session blobs are always encrypted by SessionManager before MongoDB storage.
 *  - The Python service is only reachable from the internal Docker network.
 */
class InstagrapiHttpClient {
  /**
   * @param {string|null}  baseUrl        — override service URL (null = use env var)
   * @param {import('./SessionManager').SessionManager} sessionManager
   */
  constructor(baseUrl, sessionManager) {
    this._base = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this._sm   = sessionManager;
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async _post(endpoint, body, timeoutMs = TIMEOUT_FAST) {
    const url = this._base + endpoint;
    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw _serviceUnavailable(e.message);
    }
    return _parseResponse(res, endpoint);
  }

  async _get(endpoint, timeoutMs = TIMEOUT_FAST) {
    const url = this._base + endpoint;
    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw _serviceUnavailable(e.message);
    }
    return _parseResponse(res, endpoint);
  }

  // ── Session management ───────────────────────────────────────────────────

  /**
   * Ensures the Python service has this account's session in its in-memory pool.
   * If the pool entry is missing (e.g. after a Python restart), loads from MongoDB
   * and sends the decrypted settings to the Python service.
   * Structured event: SESSION_RESTORED is logged by SessionManager.load().
   */
  async ensureSession(account) {
    const accountId = String(account._id);
    const { loaded } = await this._get(
      `/session/status?account_id=${encodeURIComponent(accountId)}`
    );
    if (loaded) return;

    const settings = await this._sm.load(accountId);
    if (!settings) {
      const e = new Error('Conta sem sessão instagrapi — faça login pelo painel');
      e.code  = 'NO_INSTAGRAPI_SESSION';
      throw e;
    }
    await this._post('/session/load', {
      account_id: accountId,
      settings,
      proxy: account.proxy || null,
    });
  }

  /**
   * Performs a fresh login with username + password.
   * The password travels in-memory only — it is NEVER persisted.
   * Returns { status: 'AUTHENTICATED', settings } on success.
   * Returns { status: 'TWO_FACTOR_REQUIRED' } when Instagram requires 2FA
   * (caller must handle this case and call verify2fa() after getting the code).
   * Saves the resulting session to MongoDB via SessionManager.
   *
   * @param {Object}  account          — Mongoose Account document
   * @param {string}  username
   * @param {string}  password         — never stored
   * @param {string}  [verificationCode=''] — TOTP or SMS/email 2FA code (optional on first try)
   */
  async login(account, username, password, verificationCode = '') {
    const accountId = String(account._id);
    const result = await this._post('/session/login', {
      account_id:         accountId,
      username,
      password,
      verification_code:  verificationCode || '',
      proxy:              account.proxy || null,
    }, TIMEOUT_LOGIN);

    // TWO_FACTOR_REQUIRED is returned as a 2xx (202) — not an error
    if (result.status === 'TWO_FACTOR_REQUIRED') {
      return result;
    }

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Authenticates using an existing Instagram session ID (from browser cookie).
   * Does NOT call accounts/login/ — bypasses IP-level rate limits entirely.
   *
   * The sessionid is never persisted in Node.js — it is forwarded to Python and
   * discarded immediately after the request. Only the resulting instagrapi
   * settings blob (encrypted by SessionManager) is stored in MongoDB.
   *
   * @param {Object} account   — Mongoose Account document
   * @param {string} sessionid — value of the 'sessionid' cookie from instagram.com
   */
  async loginBySessionid(account, sessionid) {
    const accountId = String(account._id);
    const result = await this._post('/session/login-by-sessionid', {
      account_id: accountId,
      sessionid,
    }, TIMEOUT_LOGIN);

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Completes a pending 2FA challenge using the code sent to the user's device.
   * Must be called after login() returned { status: 'TWO_FACTOR_REQUIRED' }.
   * Saves the resulting session to MongoDB via SessionManager.
   *
   * @param {Object} account           — Mongoose Account document
   * @param {string} verificationCode  — SMS/email/TOTP code
   */
  async verify2fa(account, verificationCode) {
    const accountId = String(account._id);
    const result = await this._post('/session/verify-2fa', {
      account_id:        accountId,
      verification_code: verificationCode,
    });

    if (result.settings) {
      await this._sm.save(accountId, result.settings);
      await this._sm.recordLogin(accountId, true);
    }
    return result;
  }

  /**
   * Lightweight session check — calls Python /session/ping which calls account_info().
   * Used by the health check to verify the session is still active with Instagram.
   * Never attempts a new login.
   *
   * @param {Object} account — Mongoose Account document
   * @returns {Promise<{valid, username, full_name, pk}>}
   */
  async pingSession(account) {
    const accountId = String(account._id);
    return this._get(`/session/ping?account_id=${encodeURIComponent(accountId)}`);
  }

  /**
   * Fetches a safe subset of public profile info for the account's username.
   * Called immediately after a successful login to populate avatar, display name, etc.
   * Non-blocking from the caller's perspective — errors should be caught and logged,
   * not allowed to break the login flow.
   *
   * @param {Object} account   — Mongoose Account document
   * @param {string} username
   * @returns {Promise<{pk, full_name, profile_pic_url, follower_count, following_count, media_count}>}
   */
  async getUserInfo(account, username) {
    const accountId = String(account._id);
    return this._get(
      `/session/userinfo?account_id=${encodeURIComponent(accountId)}&username=${encodeURIComponent(username)}`
    );
  }

  /**
   * Evicts the account's client from the Python service pool.
   * Called after invalidation so stale sessions are not reused.
   * Best-effort — failure is silently ignored.
   */
  async evictSession(accountId) {
    await this._post('/session/evict', { account_id: String(accountId) }).catch(() => {});
  }

  // ── Publication ──────────────────────────────────────────────────────────

  /**
   * Publishes a Reel via the Python instagrapi service.
   * Acquires a per-account Redis lock to prevent concurrent publications.
   * Persists the updated session blob returned by Python to MongoDB.
   */
  async publishReel(account, postData) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const result = await this._post('/publish/reel', {
        account_id: accountId,
        media_path: _toContainerPath(postData.media),
        caption:    postData.caption || '',
        cover_path: _toContainerPath(postData.cover) || null,
      }, TIMEOUT_MEDIA);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }

  /**
   * Publishes a photo post via the Python instagrapi service.
   * Acquires a per-account Redis lock to prevent concurrent publications.
   * Persists the updated session blob returned by Python to MongoDB.
   */
  async publishPost(account, postData) {
    const accountId = String(account._id);
    return this._sm.withLock(accountId, LOCK_TTL_PUBLISH, async () => {
      await this.ensureSession(account);
      const result = await this._post('/publish/post', {
        account_id: accountId,
        media_path: _toContainerPath(postData.media),
        caption:    postData.caption || '',
      }, TIMEOUT_MEDIA);
      if (result.settings) await this._sm.save(accountId, result.settings);
      return result;
    });
  }
}

// ── Module-private helpers ────────────────────────────────────────────────────

function _toContainerPath(rel) {
  if (!rel) return null;
  if (rel.startsWith('/')) return rel; // already absolute
  return `${UPLOADS_DIR}/${rel}`;
}

function _serviceUnavailable(msg) {
  const e = new Error(`InstagrapiService inacessível: ${msg}`);
  e.code  = 'INSTAGRAPI_SERVICE_UNAVAILABLE';
  return e;
}

async function _parseResponse(res, endpoint) {
  let body;
  try {
    body = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(`InstagrapiService: resposta inválida de ${endpoint} (${res.status}): ${text}`);
  }
  if (!res.ok) {
    const detail  = body?.detail ?? body;
    const code    = typeof detail === 'object' ? detail.code  : null;
    const message = typeof detail === 'object' ? detail.message : String(detail);
    const e       = new Error(`InstagrapiService ${endpoint}: ${message}`);
    e.code        = code || `INSTAGRAPI_HTTP_${res.status}`;
    e.httpStatus  = res.status;
    throw e;
  }
  return body;
}

module.exports = { InstagrapiHttpClient };

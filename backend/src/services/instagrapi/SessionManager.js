'use strict';

const Account     = require('../../models/Account');
const SessionLock = require('./SessionLock');

// Lazy-load crypto helpers so ENCRYPTION_KEY can be set before require in tests
let _encFn, _decFn;
function _crypto() {
  if (!_encFn) {
    const te = require('../tokenEncryption');
    _encFn = te.encrypt;
    _decFn = te.decrypt;
  }
  return { encrypt: _encFn, decrypt: _decFn };
}

/**
 * Instagrapi session state machine values.
 * Mirrors the Account.sessionStatus enum defined in Account.js.
 */
const SESSION_STATUS = Object.freeze({
  UNKNOWN:            'UNKNOWN',
  VALID:              'VALID',
  EXPIRING:           'EXPIRING',
  INVALID:            'INVALID',
  RECOVERING:         'RECOVERING',
  AUTH_REQUIRED:      'AUTH_REQUIRED',
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  FAILED:             'FAILED',
  DISABLED:           'DISABLED',
  // Extended:
  RATE_LIMITED:       'RATE_LIMITED',
  REAUTH_REQUIRED:    'REAUTH_REQUIRED',
  NETWORK_ERROR:      'NETWORK_ERROR',
});

/**
 * Structured event names for session lifecycle.
 * Used in logs so ops can grep for specific transitions.
 *
 * Naming convention:
 *   SESSION_LOAD_*    — reading the encrypted blob from MongoDB
 *   SESSION_RESTORE_* — the full chain: load from DB → send to Python pool
 *                       (emitted by InstagrapiHttpClient.ensureSession)
 */
const SESSION_EVENTS = Object.freeze({
  // ── Session blob (MongoDB layer) ──────────────────────────────────────────
  SESSION_LOAD_STARTED:    'SESSION_LOAD_STARTED',
  SESSION_LOAD_SUCCESS:    'SESSION_LOAD_SUCCESS',
  SESSION_LOAD_FAILED:     'SESSION_LOAD_FAILED',
  // ── Full restore chain (DB → Python pool, emitted by InstagrapiHttpClient) ─
  SESSION_RESTORE_STARTED: 'SESSION_RESTORE_STARTED',
  SESSION_RESTORE_SUCCESS: 'SESSION_RESTORE_SUCCESS',
  SESSION_RESTORE_FAILED:  'SESSION_RESTORE_FAILED',
  // ── Other session lifecycle events ────────────────────────────────────────
  SESSION_RESTORED:     'SESSION_RESTORED',     // backward-compat alias (= SESSION_LOAD_SUCCESS)
  SESSION_VALIDATED:    'SESSION_VALIDATED',
  SESSION_SAVED:        'SESSION_SAVED',
  SESSION_INVALIDATED:  'SESSION_INVALIDATED',
  SESSION_RATE_LIMITED: 'SESSION_RATE_LIMITED',
  SESSION_EXPIRED:      'SESSION_EXPIRED',
  SESSION_LOCKED:       'SESSION_LOCKED',
  SESSION_CONFLICT:     'SESSION_CONFLICT',
  LOGIN_SUCCESS:        'LOGIN_SUCCESS',
  LOGIN_FAILED:         'LOGIN_FAILED',
});

/**
 * Structured session log helper.
 *
 * Accepts either a plain string (backward-compat) or a context object.
 * When an object is passed, emits JSON with event, account, ts, and any
 * additional safe fields. Secret fields are stripped before logging.
 *
 * SECURITY: password, instagrapiSession, cookies, sessionid, accessToken,
 * twoFactorSecret, and verification_code are NEVER logged.
 *
 * @param {string}         event     — SESSION_EVENTS value
 * @param {string}         accountId
 * @param {string|Object}  [ctx]     — extra string (legacy) or structured context
 */
function _log(event, accountId, ctx = '') {
  if (typeof ctx !== 'object' || ctx === null) {
    // legacy callers: _log(event, id, 'key=value ...')
    console.log(`[SessionManager] ${event} account=${accountId}${ctx ? ' ' + ctx : ''}`);
    return;
  }
  const safe = { event, account: String(accountId), ts: new Date().toISOString(), ...ctx };
  // Strip secret fields — defence-in-depth
  for (const k of ['password', 'instagrapiSession', 'cookies', 'sessionid',
                   'accessToken', 'twoFactorSecret', 'verification_code']) {
    delete safe[k];
  }
  console.log(`[SessionManager] ${JSON.stringify(safe)}`);
}

// After this many consecutive failures the session is marked FAILED and
// requires explicit re-login — automatic recovery is not attempted.
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Manages instagrapi sessions with:
 *   - Persistence: encrypted JSON blob in Account.instagrapiSession
 *   - Recovery after restart: always loads from MongoDB on first access
 *   - Versioning: sessionVersion incremented on every save to invalidate
 *     stale in-process caches across multiple worker replicas
 *   - Redis locking: per-account distributed lock (SessionLock) so only
 *     one worker modifies a session at a time
 *   - Failure metrics: consecutiveFailures, lastSessionErrorAt, etc.
 *   - Concurrency protection: withLock() wraps mutating operations
 *
 * Every method is scoped to a single accountId — no state is shared
 * between different accounts.
 */
class SessionManager {
  /** @param {import('ioredis').Redis} redis */
  constructor(redis) {
    this._lock  = new SessionLock(redis);
    // In-process cache: accountId → { data: Object, version: number }
    // Invalidated when DB.sessionVersion differs from cached version.
    this._cache = new Map();
  }

  // ── Locking ───────────────────────────────────────────────────────────────

  /** @returns {Promise<string|null>} token on success, null if already locked */
  acquireLock(accountId, ttlMs)  { return this._lock.acquire(String(accountId), ttlMs); }

  /** @returns {Promise<boolean>} */
  releaseLock(accountId, token)  { return this._lock.release(String(accountId), token); }

  /** Acquires lock, runs fn(), releases. Throws SESSION_LOCKED if unavailable. */
  withLock(accountId, ttlMs, fn) { return this._lock.withLock(String(accountId), ttlMs, fn); }

  // ── Session CRUD ──────────────────────────────────────────────────────────

  /**
   * Loads and decrypts the session blob from MongoDB.
   * Uses in-process cache keyed by (accountId, sessionVersion) to avoid
   * redundant DB reads within a single worker invocation.
   * Returns null if no session is stored.
   *
   * Emits SESSION_LOAD_STARTED → SESSION_LOAD_SUCCESS | SESSION_LOAD_FAILED.
   *
   * @param {string} accountId
   * @returns {Promise<Object|null>}
   */
  async load(accountId) {
    const id = String(accountId);
    const t0 = Date.now();
    _log(SESSION_EVENTS.SESSION_LOAD_STARTED, id, {});

    const acct = await Account.findById(id)
      .select('instagrapiSession sessionVersion provider')
      .lean();

    if (!acct?.instagrapiSession) {
      _log(SESSION_EVENTS.SESSION_LOAD_FAILED, id, {
        reason:     'no_stored_session',
        durationMs: Date.now() - t0,
      });
      return null;
    }

    const cached = this._cache.get(id);
    if (cached && cached.version === acct.sessionVersion) {
      _log(SESSION_EVENTS.SESSION_LOAD_SUCCESS, id, {
        sessionVersion: acct.sessionVersion,
        provider:       acct.provider,
        durationMs:     Date.now() - t0,
        source:         'cache',
      });
      return cached.data;
    }

    try {
      const { decrypt } = _crypto();
      const data = JSON.parse(decrypt(acct.instagrapiSession));
      this._cache.set(id, { data, version: acct.sessionVersion });
      _log(SESSION_EVENTS.SESSION_LOAD_SUCCESS, id, {
        sessionVersion: acct.sessionVersion,
        provider:       acct.provider,
        durationMs:     Date.now() - t0,
        source:         'db',
      });
      return data;
    } catch (err) {
      _log(SESSION_EVENTS.SESSION_LOAD_FAILED, id, {
        reason:     'decrypt_error',
        error:      err?.message?.slice(0, 120),
        durationMs: Date.now() - t0,
      });
      await this._setStatus(id, SESSION_STATUS.INVALID);
      return null;
    }
  }

  /**
   * Returns safe metadata about whether a persisted session exists.
   * NEVER returns the session blob, cookies, tokens, or any secret.
   *
   * @param {string} accountId
   * @returns {Promise<{
   *   exists: boolean,
   *   provider: string|null,
   *   sessionVersion: number,
   *   status: string,
   *   lastValidatedAt: Date|null,
   * }>}
   */
  async hasPersistedSession(accountId) {
    const id   = String(accountId);
    const acct = await Account.findById(id)
      .select('provider instagrapiSession sessionVersion sessionStatus lastValidatedAt')
      .lean();

    if (!acct) {
      return {
        exists:          false,
        provider:        null,
        sessionVersion:  0,
        status:          SESSION_STATUS.UNKNOWN,
        lastValidatedAt: null,
      };
    }

    return {
      exists:          !!acct.instagrapiSession,
      provider:        acct.provider        || 'official',
      sessionVersion:  acct.sessionVersion  || 0,
      status:          acct.sessionStatus   || SESSION_STATUS.UNKNOWN,
      lastValidatedAt: acct.lastValidatedAt || null,
    };
  }

  /**
   * Encrypts and persists the session blob to MongoDB.
   * Increments sessionVersion to invalidate stale caches in other workers.
   *
   * @param {string}      accountId
   * @param {Object}      sessionData      — raw instagrapi session object
   * @param {number|null} [expectedVersion] — if provided, only saves when DB version matches
   *                                          (optimistic lock). Throws SESSION_VERSION_CONFLICT
   *                                          if another worker already saved a newer version.
   */
  async save(accountId, sessionData, expectedVersion = null) {
    const id  = String(accountId);
    const { encrypt } = _crypto();
    const blob = encrypt(JSON.stringify(sessionData));

    const filter = expectedVersion !== null
      ? { _id: id, sessionVersion: expectedVersion }
      : { _id: id };

    const updated = await Account.findOneAndUpdate(
      filter,
      {
        $set: { instagrapiSession: blob, sessionStatus: SESSION_STATUS.VALID },
        $inc: { sessionVersion: 1 },
      },
      { new: true, select: 'sessionVersion' }
    );

    if (!updated) {
      this._cache.delete(id);
      if (expectedVersion !== null) {
        // Another worker saved a newer version — our data is stale
        const e = new Error(`Session save conflict for ${id}: expected version ${expectedVersion}`);
        e.code = 'SESSION_VERSION_CONFLICT';
        _log(SESSION_EVENTS.SESSION_CONFLICT, id, `expected=${expectedVersion}`);
        throw e;
      }
      return; // account not found — silently skip
    }

    this._cache.set(id, { data: sessionData, version: updated.sessionVersion });
    _log(SESSION_EVENTS.SESSION_SAVED, id, `version=${updated.sessionVersion}`);
  }

  /**
   * Clears the session blob and resets failure counters.
   * @param {string} accountId
   */
  async invalidate(accountId) {
    const id = String(accountId);
    this._cache.delete(id);
    await Account.findByIdAndUpdate(id, {
      $set: {
        instagrapiSession:   '',
        sessionStatus:       SESSION_STATUS.INVALID,
        consecutiveFailures: 0,
      },
    });
    _log(SESSION_EVENTS.SESSION_INVALIDATED, id);
  }

  /**
   * Validates the session using stored metadata only (no network call).
   * @param {string} accountId
   * @returns {Promise<{valid: boolean, reason: string, status: string}>}
   */
  async validate(accountId) {
    const id   = String(accountId);
    const acct = await Account.findById(id)
      .select('instagrapiSession sessionStatus consecutiveFailures')
      .lean();

    if (!acct) {
      return { valid: false, reason: 'Conta não encontrada', status: SESSION_STATUS.UNKNOWN };
    }
    if (!acct.instagrapiSession) {
      return { valid: false, reason: 'Sem sessão instagrapi configurada', status: SESSION_STATUS.UNKNOWN };
    }

    const status = acct.sessionStatus || SESSION_STATUS.UNKNOWN;

    if (status === SESSION_STATUS.FAILED || status === SESSION_STATUS.DISABLED) {
      return { valid: false, reason: `Sessão marcada como ${status}`, status };
    }

    if ((acct.consecutiveFailures || 0) >= MAX_CONSECUTIVE_FAILURES) {
      return {
        valid:  false,
        reason: `${acct.consecutiveFailures} falhas consecutivas — relogin necessário`,
        status: SESSION_STATUS.FAILED,
      };
    }

    if (status === SESSION_STATUS.VALID || status === SESSION_STATUS.EXPIRING) {
      return { valid: true, reason: '', status };
    }

    // UNKNOWN / RECOVERING — presume valid until proven otherwise
    return { valid: true, reason: 'Status indeterminado — assumindo válido', status };
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  /**
   * Records a successful Instagram API request.
   * Resets the consecutive failure counter and timestamps last success.
   */
  async recordSuccess(accountId) {
    const id = String(accountId);
    await Account.findByIdAndUpdate(id, {
      $set: {
        consecutiveFailures:     0,
        lastSuccessfulRequestAt: new Date(),
        sessionStatus:           SESSION_STATUS.VALID,
      },
    });
    _log(SESSION_EVENTS.SESSION_VALIDATED, id);
  }

  /**
   * Records a failed Instagram API request.
   * Routes RATE_LIMITED to recordRateLimit(); otherwise increments consecutive
   * failure counter and marks session FAILED at threshold.
   * @param {string} accountId
   * @param {Error}  error
   */
  async recordFailure(accountId, error) {
    const id   = String(accountId);
    const code = error?.code || '';

    if (code === 'RATE_LIMITED') {
      return this.recordRateLimit(id);
    }

    const acct = await Account.findById(id).select('consecutiveFailures').lean();
    const n    = (acct?.consecutiveFailures || 0) + 1;

    let status = n >= MAX_CONSECUTIVE_FAILURES ? SESSION_STATUS.FAILED : SESSION_STATUS.INVALID;
    if (code === 'SESSION_EXPIRED' || code === 'AUTH_REQUIRED') {
      status = SESSION_STATUS.REAUTH_REQUIRED;
    } else if (code === 'INSTAGRAPI_SERVICE_UNAVAILABLE' || code === 'TIMEOUT') {
      status = SESSION_STATUS.NETWORK_ERROR;
    }

    await Account.findByIdAndUpdate(id, {
      $set: {
        consecutiveFailures: n,
        lastSessionErrorAt:  new Date(),
        sessionStatus:       status,
      },
    });
    _log(SESSION_EVENTS.SESSION_EXPIRED, id, `code=${code} failures=${n}`);
  }

  /**
   * Records a rate-limit event. Increments rateLimitCount, sets lastRateLimitAt,
   * and marks session status RATE_LIMITED.
   */
  async recordRateLimit(accountId) {
    const id = String(accountId);
    await Account.findByIdAndUpdate(id, {
      $set: {
        sessionStatus:      SESSION_STATUS.RATE_LIMITED,
        lastRateLimitAt:    new Date(),
        lastSessionErrorAt: new Date(),
      },
      $inc: { rateLimitCount: 1 },
    });
    _log(SESSION_EVENTS.SESSION_RATE_LIMITED, id);
  }

  /**
   * Records a login attempt (successful or failed).
   * On success: resets failure counters, marks VALID.
   * On failure: increments reloginAttempts.
   * @param {string}  accountId
   * @param {boolean} success
   */
  async recordLogin(accountId, success) {
    const id  = String(accountId);
    const inc = { loginAttempts: 1, ...(success ? {} : { reloginAttempts: 1 }) };
    const set = {
      lastLoginAt: new Date(),
      ...(success ? { consecutiveFailures: 0, sessionStatus: SESSION_STATUS.VALID } : {}),
    };
    await Account.findByIdAndUpdate(id, { $inc: inc, $set: set });
    _log(success ? SESSION_EVENTS.LOGIN_SUCCESS : SESSION_EVENTS.LOGIN_FAILED, id);
  }

  /**
   * Resets all failure counters. Used after a successful manual re-login.
   */
  async resetFailures(accountId) {
    await Account.findByIdAndUpdate(String(accountId), {
      $set: { consecutiveFailures: 0, sessionStatus: SESSION_STATUS.UNKNOWN },
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _setStatus(accountId, status) {
    await Account.findByIdAndUpdate(String(accountId), { $set: { sessionStatus: status } });
  }
}

// ── Process-wide singleton ────────────────────────────────────────────────────

let _instance = null;

/** Returns the singleton SessionManager (creates it on first call). */
function getSessionManager() {
  if (!_instance) {
    const redis = require('../../queue/connection');
    _instance   = new SessionManager(redis);
  }
  return _instance;
}

/** Resets the singleton. Only for tests — never call in production code. */
function _resetForTest() { _instance = null; }

module.exports = { SessionManager, SESSION_STATUS, SESSION_EVENTS, getSessionManager, _resetForTest };

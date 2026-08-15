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
 * Mirrors the Account.sessionStatus enum defined in Phase 2.
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
});

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
   * @param {string} accountId
   * @returns {Promise<Object|null>}
   */
  async load(accountId) {
    const id   = String(accountId);
    const acct = await Account.findById(id)
      .select('instagrapiSession sessionVersion')
      .lean();

    if (!acct?.instagrapiSession) return null;

    const cached = this._cache.get(id);
    if (cached && cached.version === acct.sessionVersion) return cached.data;

    try {
      const { decrypt } = _crypto();
      const data = JSON.parse(decrypt(acct.instagrapiSession));
      this._cache.set(id, { data, version: acct.sessionVersion });
      return data;
    } catch {
      await this._setStatus(id, SESSION_STATUS.INVALID);
      return null;
    }
  }

  /**
   * Encrypts and persists the session blob to MongoDB.
   * Increments sessionVersion to invalidate stale caches in other workers.
   * @param {string} accountId
   * @param {Object} sessionData — raw instagrapi session object
   */
  async save(accountId, sessionData) {
    const id  = String(accountId);
    const { encrypt } = _crypto();
    const blob = encrypt(JSON.stringify(sessionData));

    const updated = await Account.findByIdAndUpdate(
      id,
      {
        $set: { instagrapiSession: blob, sessionStatus: SESSION_STATUS.VALID },
        $inc: { sessionVersion: 1 },
      },
      { new: true, select: 'sessionVersion' }
    );

    if (updated) {
      this._cache.set(id, { data: sessionData, version: updated.sessionVersion });
    }
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
    await Account.findByIdAndUpdate(String(accountId), {
      $set: {
        consecutiveFailures:     0,
        lastSuccessfulRequestAt: new Date(),
        sessionStatus:           SESSION_STATUS.VALID,
      },
    });
  }

  /**
   * Records a failed Instagram API request.
   * Increments the consecutive failure counter; marks session FAILED at threshold.
   * @param {string} accountId
   * @param {Error} error
   */
  async recordFailure(accountId, error) {
    const id   = String(accountId);
    const acct = await Account.findById(id).select('consecutiveFailures').lean();
    const n    = (acct?.consecutiveFailures || 0) + 1;

    await Account.findByIdAndUpdate(id, {
      $set: {
        consecutiveFailures: n,
        lastSessionErrorAt:  new Date(),
        sessionStatus:       n >= MAX_CONSECUTIVE_FAILURES
          ? SESSION_STATUS.FAILED
          : SESSION_STATUS.INVALID,
      },
    });
  }

  /**
   * Records a login attempt (successful or failed).
   * On success: resets failure counters, marks VALID.
   * On failure: increments reloginAttempts.
   * @param {string} accountId
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

module.exports = { SessionManager, SESSION_STATUS, getSessionManager, _resetForTest };

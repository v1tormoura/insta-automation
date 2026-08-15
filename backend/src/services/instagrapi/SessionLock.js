'use strict';

const crypto = require('crypto');

const LOCK_PREFIX  = 'iglock:';
const DEFAULT_TTL  = 30_000; // ms

// Atomic release: only del if the stored token matches ours.
// Prevents a late-arriving unlock from releasing a lock acquired by another caller.
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Per-account Redis distributed lock.
 *
 * Key namespace: "iglock:{accountId}" — separate from BullMQ's keys.
 * Acquire: SET NX PX (atomic, single round-trip).
 * Release: Lua script (atomic check-and-delete).
 *
 * Never confuse this with MongoDB's isBusy lock: isBusy guards the publishing
 * pipeline; SessionLock guards instagrapi session mutations (save/invalidate/login).
 */
class SessionLock {
  /** @param {import('ioredis').Redis} redis */
  constructor(redis) {
    this._redis = redis;
  }

  /**
   * Tries to acquire the lock.
   * @param {string} accountId
   * @param {number} [ttlMs=30000]
   * @returns {Promise<string|null>} random token on success, null if already locked
   */
  async acquire(accountId, ttlMs = DEFAULT_TTL) {
    const key   = LOCK_PREFIX + accountId;
    const token = crypto.randomBytes(16).toString('hex');
    const res   = await this._redis.set(key, token, 'NX', 'PX', ttlMs);
    return res === 'OK' ? token : null;
  }

  /**
   * Releases the lock only if the token matches (prevents releasing another owner's lock).
   * @param {string} accountId
   * @param {string} token — token returned by acquire()
   * @returns {Promise<boolean>} true if released, false if not owner or already expired
   */
  async release(accountId, token) {
    const res = await this._redis.eval(RELEASE_LUA, 1, LOCK_PREFIX + accountId, token);
    return res === 1;
  }

  /**
   * @param {string} accountId
   * @returns {Promise<boolean>}
   */
  async isLocked(accountId) {
    return (await this._redis.exists(LOCK_PREFIX + accountId)) === 1;
  }

  /**
   * Acquires the lock, calls fn(), then releases. Throws SESSION_LOCKED if unavailable.
   * The lock is always released in the finally block — even if fn() throws.
   * @param {string} accountId
   * @param {number} ttlMs
   * @param {Function} fn
   * @returns {Promise<*>} whatever fn() returns
   */
  async withLock(accountId, ttlMs, fn) {
    const token = await this.acquire(accountId, ttlMs);
    if (!token) {
      const err = new Error(`Conta ${accountId}: lock de sessão indisponível — tente novamente`);
      err.code  = 'SESSION_LOCKED';
      throw err;
    }
    try {
      return await fn();
    } finally {
      await this.release(accountId, token).catch(() => {}); // best-effort; TTL is the safety net
    }
  }
}

module.exports = SessionLock;

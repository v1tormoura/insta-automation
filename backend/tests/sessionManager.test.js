'use strict';

// ENCRYPTION_KEY must be set before any module that uses tokenEncryption is required
process.env.ENCRYPTION_KEY = '0'.repeat(64); // 32 zero-bytes — tests only

// ── In-memory Redis fake ───────────────────────────────────────────────────────

class MockRedis {
  constructor() { this._store = new Map(); }

  async set(key, value, opt1, opt2, opt3) {
    // Handles: set(key, val, 'NX', 'PX', ttlMs)
    if (opt1 === 'NX' && this._store.has(key)) return null;
    this._store.set(key, value);
    return 'OK';
  }

  async get(key)    { return this._store.get(key) ?? null; }
  async del(key)    { const had = this._store.has(key); this._store.delete(key); return had ? 1 : 0; }
  async exists(key) { return this._store.has(key) ? 1 : 0; }

  // Simplified Lua eval matching the release script used by SessionLock
  async eval(script, numKeys, key, token) {
    if (this._store.get(key) === token) { this._store.delete(key); return 1; }
    return 0;
  }
}

// ── Account model mock ────────────────────────────────────────────────────────

const mockFindById          = jest.fn();
const mockFindByIdAndUpdate = jest.fn();

jest.mock('../src/models/Account', () => ({
  findById:          (...a) => mockFindById(...a),
  findByIdAndUpdate: (...a) => mockFindByIdAndUpdate(...a),
}));

// Make queue/connection return our in-memory Redis
// (each test suite gets its own instance via makeRedis())
jest.mock('../src/queue/connection', () => new MockRedis());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRedis()   { return new MockRedis(); }
function makeMgr(r)    {
  const { SessionManager } = require('../src/services/instagrapi/SessionManager');
  return new SessionManager(r || makeRedis());
}

// Returns a Mongoose-like query chain that resolves to `data` via .lean()
function dbChain(data) {
  const chain = { lean: jest.fn().mockResolvedValue(data) };
  chain.select = jest.fn().mockReturnValue(chain);
  return chain;
}

const { SessionLock } = (() => {
  const mod = { SessionLock: require('../src/services/instagrapi/SessionLock') };
  return mod;
})();

const { SESSION_STATUS } = require('../src/services/instagrapi/SessionManager');

// ── SessionLock ───────────────────────────────────────────────────────────────

describe('SessionLock', () => {
  let redis, lock;

  beforeEach(() => {
    redis = makeRedis();
    lock  = new SessionLock(redis);
  });

  test('acquire() returns a non-empty token string', async () => {
    const token = await lock.acquire('acc1');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('acquire() returns null when lock is already held', async () => {
    await lock.acquire('acc1');
    const second = await lock.acquire('acc1');
    expect(second).toBeNull();
  });

  test('release() releases with the correct token', async () => {
    const token   = await lock.acquire('acc1');
    const ok      = await lock.release('acc1', token);
    expect(ok).toBe(true);

    const newToken = await lock.acquire('acc1'); // should succeed now
    expect(newToken).not.toBeNull();
  });

  test('release() returns false for wrong token', async () => {
    await lock.acquire('acc1');
    const ok = await lock.release('acc1', 'bad-token');
    expect(ok).toBe(false);
  });

  test('isLocked() is true while locked, false after release', async () => {
    expect(await lock.isLocked('acc1')).toBe(false);
    const token = await lock.acquire('acc1');
    expect(await lock.isLocked('acc1')).toBe(true);
    await lock.release('acc1', token);
    expect(await lock.isLocked('acc1')).toBe(false);
  });

  test('withLock() executes fn and releases lock after', async () => {
    const fn = jest.fn().mockResolvedValue(42);
    const result = await lock.withLock('acc1', 5000, fn);
    expect(result).toBe(42);
    expect(await lock.isLocked('acc1')).toBe(false);
  });

  test('withLock() throws SESSION_LOCKED when lock unavailable', async () => {
    await lock.acquire('acc1');
    await expect(lock.withLock('acc1', 5000, jest.fn()))
      .rejects.toMatchObject({ code: 'SESSION_LOCKED' });
  });

  test('withLock() releases lock even if fn() throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('inner error'));
    await expect(lock.withLock('acc1', 5000, fn)).rejects.toThrow('inner error');
    expect(await lock.isLocked('acc1')).toBe(false);
  });

  test('locks for different accounts are independent', async () => {
    const t1 = await lock.acquire('acc1');
    const t2 = await lock.acquire('acc2');
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy(); // different keys — both succeed
  });
});

// ── SessionManager — session CRUD ─────────────────────────────────────────────

describe('SessionManager: load / save / invalidate', () => {
  let mgr;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
  });

  test('load() returns null when account has no instagrapiSession', async () => {
    mockFindById.mockReturnValue(dbChain({ instagrapiSession: '', sessionVersion: 0 }));
    expect(await mgr.load('acc1')).toBeNull();
  });

  test('load() returns null when account not found', async () => {
    mockFindById.mockReturnValue(dbChain(null));
    expect(await mgr.load('acc1')).toBeNull();
  });

  test('save() + load() round-trip: same manager instance uses in-process cache', async () => {
    const session = { username: 'test', cookies: { sessionid: 'abc123' } };

    mockFindByIdAndUpdate.mockResolvedValue({ sessionVersion: 1 });
    await mgr.save('acc1', session);

    // load() hits cache — sessionVersion matches → returns cached data
    mockFindById.mockReturnValue(dbChain({ instagrapiSession: 'anything', sessionVersion: 1 }));
    const loaded = await mgr.load('acc1');
    expect(loaded).toEqual(session);
  });

  test('save() stores an encrypted blob (never plaintext JSON)', async () => {
    mockFindByIdAndUpdate.mockResolvedValue({ sessionVersion: 1 });
    await mgr.save('acc1', { secret: 'value' });

    const [, update] = mockFindByIdAndUpdate.mock.calls[0];
    const blob = update.$set.instagrapiSession;
    expect(blob).toMatch(/^enc1:/); // encrypted prefix
    expect(blob).not.toContain('value'); // plaintext never stored
  });

  test('save() increments sessionVersion via $inc', async () => {
    mockFindByIdAndUpdate.mockResolvedValue({ sessionVersion: 1 });
    await mgr.save('acc1', {});

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({ $inc: { sessionVersion: 1 } }),
      expect.any(Object)
    );
  });

  test('invalidate() clears blob and resets consecutiveFailures', async () => {
    mockFindByIdAndUpdate.mockResolvedValue({});
    await mgr.invalidate('acc1');

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: {
        instagrapiSession:   '',
        sessionStatus:       SESSION_STATUS.INVALID,
        consecutiveFailures: 0,
      },
    });
  });
});

// ── SessionManager — validate ─────────────────────────────────────────────────

describe('SessionManager: validate()', () => {
  let mgr;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindById.mockReset();
  });

  test('invalid when account not found', async () => {
    mockFindById.mockReturnValue(dbChain(null));
    const r = await mgr.validate('acc1');
    expect(r.valid).toBe(false);
    expect(r.status).toBe(SESSION_STATUS.UNKNOWN);
  });

  test('invalid when instagrapiSession is empty', async () => {
    mockFindById.mockReturnValue(dbChain({ instagrapiSession: '', sessionStatus: 'UNKNOWN', consecutiveFailures: 0 }));
    const r = await mgr.validate('acc1');
    expect(r.valid).toBe(false);
  });

  test('valid when status is VALID and failures < threshold', async () => {
    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: 'enc1:data',
      sessionStatus:     SESSION_STATUS.VALID,
      consecutiveFailures: 0,
    }));
    const r = await mgr.validate('acc1');
    expect(r.valid).toBe(true);
    expect(r.status).toBe(SESSION_STATUS.VALID);
  });

  test('invalid when status is FAILED', async () => {
    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: 'enc1:data',
      sessionStatus:     SESSION_STATUS.FAILED,
      consecutiveFailures: 5,
    }));
    const r = await mgr.validate('acc1');
    expect(r.valid).toBe(false);
  });

  test('invalid when consecutiveFailures reaches MAX_CONSECUTIVE_FAILURES (5)', async () => {
    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: 'enc1:data',
      sessionStatus:     SESSION_STATUS.VALID,
      consecutiveFailures: 5,
    }));
    const r = await mgr.validate('acc1');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/relogin/i);
  });

  test('valid (assumed) when status is UNKNOWN but session blob exists', async () => {
    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: 'enc1:data',
      sessionStatus:     SESSION_STATUS.UNKNOWN,
      consecutiveFailures: 0,
    }));
    const r = await mgr.validate('acc1');
    expect(r.valid).toBe(true);
  });
});

// ── SessionManager — metrics ──────────────────────────────────────────────────

describe('SessionManager: metrics', () => {
  let mgr;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset().mockResolvedValue({});
  });

  test('recordSuccess() resets consecutiveFailures to 0 and sets VALID', async () => {
    await mgr.recordSuccess('acc1');
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({
        consecutiveFailures: 0,
        sessionStatus:       SESSION_STATUS.VALID,
      }),
    });
  });

  test('recordFailure() increments consecutiveFailures', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 2 }));
    await mgr.recordFailure('acc1', new Error('timeout'));
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ consecutiveFailures: 3 }),
    });
  });

  test('recordFailure() sets FAILED at threshold (5)', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 4 })); // 4+1 = 5
    await mgr.recordFailure('acc1', new Error('x'));
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.FAILED }),
    });
  });

  test('recordFailure() sets INVALID below threshold (4)', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 2 })); // 2+1 = 3
    await mgr.recordFailure('acc1', new Error('x'));
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.INVALID }),
    });
  });

  test('recordLogin(true) increments loginAttempts and resets failures', async () => {
    await mgr.recordLogin('acc1', true);
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $inc: { loginAttempts: 1 },
      $set: expect.objectContaining({ consecutiveFailures: 0, sessionStatus: SESSION_STATUS.VALID }),
    });
  });

  test('recordLogin(false) increments both loginAttempts and reloginAttempts', async () => {
    await mgr.recordLogin('acc1', false);
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $inc: { loginAttempts: 1, reloginAttempts: 1 },
      $set: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
    });
  });

  test('resetFailures() clears counter and sets UNKNOWN', async () => {
    await mgr.resetFailures('acc1');
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: { consecutiveFailures: 0, sessionStatus: SESSION_STATUS.UNKNOWN },
    });
  });
});

// ── Concurrency — withLock ────────────────────────────────────────────────────

describe('SessionManager: concurrency (withLock)', () => {
  let mgr;

  beforeEach(() => { mgr = makeMgr(); });

  test('prevents concurrent mutation of the same account', async () => {
    const log = [];
    const slow = async () => {
      log.push('start');
      await new Promise(r => setTimeout(r, 30));
      log.push('end');
    };

    const [r1, r2] = await Promise.allSettled([
      mgr.withLock('acc1', 5000, slow),
      mgr.withLock('acc1', 5000, slow),
    ]);

    // Exactly one must succeed and one must be SESSION_LOCKED
    const ok  = [r1, r2].filter(r => r.status === 'fulfilled');
    const bad = [r1, r2].filter(r => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason).toMatchObject({ code: 'SESSION_LOCKED' });
    // Only the successful one's log entries appear
    expect(log).toEqual(['start', 'end']);
  });

  test('sequential calls to the same account succeed normally', async () => {
    const results = [];
    await mgr.withLock('acc1', 5000, async () => results.push(1));
    await mgr.withLock('acc1', 5000, async () => results.push(2));
    expect(results).toEqual([1, 2]);
  });

  test('concurrent calls to different accounts do not block each other', async () => {
    const log = [];
    const slow = label => async () => {
      log.push(`${label}:start`);
      await new Promise(r => setTimeout(r, 20));
      log.push(`${label}:end`);
    };

    await Promise.all([
      mgr.withLock('acc1', 5000, slow('A')),
      mgr.withLock('acc2', 5000, slow('B')),
    ]);

    expect(log).toContain('A:start');
    expect(log).toContain('B:start');
    expect(log).toContain('A:end');
    expect(log).toContain('B:end');
  });
});

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

const mockFindById            = jest.fn();
const mockFindByIdAndUpdate   = jest.fn();
const mockFindOneAndUpdate    = jest.fn();

jest.mock('../src/models/Account', () => ({
  findById:           (...a) => mockFindById(...a),
  findByIdAndUpdate:  (...a) => mockFindByIdAndUpdate(...a),
  findOneAndUpdate:   (...a) => mockFindOneAndUpdate(...a),
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

const { SESSION_STATUS, SESSION_EVENTS } = require('../src/services/instagrapi/SessionManager');

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

// ── SESSION_STATUS / SESSION_EVENTS — constants ───────────────────────────────

describe('SESSION_STATUS constants', () => {
  test('includes all required base values', () => {
    const expected = ['UNKNOWN', 'VALID', 'EXPIRING', 'INVALID', 'RECOVERING',
      'AUTH_REQUIRED', 'CHALLENGE_REQUIRED', 'FAILED', 'DISABLED'];
    expected.forEach(v => expect(SESSION_STATUS[v]).toBe(v));
  });

  test('includes extended values: RATE_LIMITED, REAUTH_REQUIRED, NETWORK_ERROR', () => {
    expect(SESSION_STATUS.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(SESSION_STATUS.REAUTH_REQUIRED).toBe('REAUTH_REQUIRED');
    expect(SESSION_STATUS.NETWORK_ERROR).toBe('NETWORK_ERROR');
  });

  test('SESSION_EVENTS includes original lifecycle events', () => {
    expect(SESSION_EVENTS.SESSION_RESTORED).toBe('SESSION_RESTORED');
    expect(SESSION_EVENTS.SESSION_SAVED).toBe('SESSION_SAVED');
    expect(SESSION_EVENTS.SESSION_RATE_LIMITED).toBe('SESSION_RATE_LIMITED');
    expect(SESSION_EVENTS.SESSION_CONFLICT).toBe('SESSION_CONFLICT');
    expect(SESSION_EVENTS.LOGIN_SUCCESS).toBe('LOGIN_SUCCESS');
    expect(SESSION_EVENTS.LOGIN_FAILED).toBe('LOGIN_FAILED');
    expect(SESSION_EVENTS.SESSION_INVALIDATED).toBe('SESSION_INVALIDATED');
    expect(SESSION_EVENTS.SESSION_VALIDATED).toBe('SESSION_VALIDATED');
    expect(SESSION_EVENTS.SESSION_LOCKED).toBe('SESSION_LOCKED');
  });

  test('SESSION_EVENTS includes SESSION_LOAD_* events (Phase 2)', () => {
    expect(SESSION_EVENTS.SESSION_LOAD_STARTED).toBe('SESSION_LOAD_STARTED');
    expect(SESSION_EVENTS.SESSION_LOAD_SUCCESS).toBe('SESSION_LOAD_SUCCESS');
    expect(SESSION_EVENTS.SESSION_LOAD_FAILED).toBe('SESSION_LOAD_FAILED');
  });

  test('SESSION_EVENTS includes SESSION_RESTORE_* events (Phase 2, emitted by InstagrapiHttpClient)', () => {
    expect(SESSION_EVENTS.SESSION_RESTORE_STARTED).toBe('SESSION_RESTORE_STARTED');
    expect(SESSION_EVENTS.SESSION_RESTORE_SUCCESS).toBe('SESSION_RESTORE_SUCCESS');
    expect(SESSION_EVENTS.SESSION_RESTORE_FAILED).toBe('SESSION_RESTORE_FAILED');
  });

  test('SESSION_EVENTS is frozen (immutable)', () => {
    expect(Object.isFrozen(SESSION_EVENTS)).toBe(true);
    expect(Object.isFrozen(SESSION_STATUS)).toBe(true);
  });
});

// ── SessionManager — hasPersistedSession ──────────────────────────────────────

describe('SessionManager: hasPersistedSession()', () => {
  let mgr;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindById.mockReset();
  });

  test('returns exists:false when account not found', async () => {
    mockFindById.mockReturnValue(dbChain(null));
    const r = await mgr.hasPersistedSession('acc1');
    expect(r.exists).toBe(false);
    expect(r.provider).toBeNull();
    expect(r.sessionVersion).toBe(0);
    expect(r.status).toBe(SESSION_STATUS.UNKNOWN);
  });

  test('returns exists:false when instagrapiSession is empty', async () => {
    mockFindById.mockReturnValue(dbChain({
      provider: 'instagrapi', instagrapiSession: '', sessionVersion: 2,
      sessionStatus: 'UNKNOWN', lastValidatedAt: null,
    }));
    const r = await mgr.hasPersistedSession('acc1');
    expect(r.exists).toBe(false);
  });

  test('returns exists:true with safe metadata when session blob is present', async () => {
    const validatedAt = new Date('2024-06-01T12:00:00Z');
    mockFindById.mockReturnValue(dbChain({
      provider:        'instagrapi',
      instagrapiSession: 'enc1:opaque-blob',
      sessionVersion:  7,
      sessionStatus:   'VALID',
      lastValidatedAt: validatedAt,
    }));
    const r = await mgr.hasPersistedSession('acc1');
    expect(r.exists).toBe(true);
    expect(r.provider).toBe('instagrapi');
    expect(r.sessionVersion).toBe(7);
    expect(r.status).toBe('VALID');
    expect(r.lastValidatedAt).toEqual(validatedAt);
  });

  test('SECURITY: result never contains the session blob or any secret', async () => {
    mockFindById.mockReturnValue(dbChain({
      provider: 'instagrapi', instagrapiSession: 'enc1:super-secret', sessionVersion: 1,
      sessionStatus: 'VALID', lastValidatedAt: null,
    }));
    const r = await mgr.hasPersistedSession('acc1');
    const json = JSON.stringify(r);
    expect(json).not.toContain('super-secret');
    expect(r).not.toHaveProperty('instagrapiSession');
    expect(r).not.toHaveProperty('cookies');
    expect(r).not.toHaveProperty('password');
    expect(r).not.toHaveProperty('accessToken');
  });

  test('returns provider:official when account has no provider field', async () => {
    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: 'enc1:data', sessionVersion: 1,
      sessionStatus: 'UNKNOWN', lastValidatedAt: null,
      // provider missing → defaults to 'official'
    }));
    const r = await mgr.hasPersistedSession('acc1');
    expect(r.provider).toBe('official');
  });

  test('returns status:UNKNOWN when sessionStatus field is missing', async () => {
    mockFindById.mockReturnValue(dbChain({
      provider: 'instagrapi', instagrapiSession: 'enc1:x', sessionVersion: 0,
      // sessionStatus missing
    }));
    const r = await mgr.hasPersistedSession('acc1');
    expect(r.status).toBe(SESSION_STATUS.UNKNOWN);
  });
});

// ── SessionManager — load() structured logging ────────────────────────────────

describe('SessionManager: load() structured log events', () => {
  let mgr;
  let logLines;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindById.mockReset();
    logLines = [];
    jest.spyOn(console, 'log').mockImplementation(msg => logLines.push(msg));
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('emits SESSION_LOAD_STARTED then SESSION_LOAD_FAILED when no session stored', async () => {
    mockFindById.mockReturnValue(dbChain({ instagrapiSession: '', sessionVersion: 0 }));
    await mgr.load('acc-x');

    const started = logLines.find(l => l.includes('SESSION_LOAD_STARTED'));
    const failed  = logLines.find(l => l.includes('SESSION_LOAD_FAILED'));
    expect(started).toBeTruthy();
    expect(failed).toBeTruthy();

    const failedObj = JSON.parse(failed.replace('[SessionManager] ', ''));
    expect(failedObj.reason).toBe('no_stored_session');
    expect(failedObj.account).toBe('acc-x');
    expect(failedObj).not.toHaveProperty('instagrapiSession');
    expect(failedObj).not.toHaveProperty('password');
  });

  test('emits SESSION_LOAD_SUCCESS with safe context on successful decrypt', async () => {
    // save a real encrypted blob first, then load it back
    mockFindById.mockReset();

    // Simulate a real encrypt → store → load cycle via the actual crypto
    const { encrypt } = require('../src/services/tokenEncryption');
    const sessionData = { username: 'bob', cookies: { sessionid: 'abc' } };
    const blob = encrypt(JSON.stringify(sessionData));

    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: blob, sessionVersion: 3, provider: 'instagrapi',
    }));

    await mgr.load('acc-y');

    const success = logLines.find(l => l.includes('SESSION_LOAD_SUCCESS'));
    expect(success).toBeTruthy();

    const successObj = JSON.parse(success.replace('[SessionManager] ', ''));
    expect(successObj.sessionVersion).toBe(3);
    expect(successObj.provider).toBe('instagrapi');
    expect(successObj).toHaveProperty('durationMs');
    expect(successObj).not.toHaveProperty('instagrapiSession');
    expect(successObj).not.toHaveProperty('cookies');
    expect(successObj).not.toHaveProperty('sessionid');
  });

  test('SECURITY: SESSION_LOAD_FAILED log never contains secret fields', async () => {
    mockFindById.mockReturnValue(dbChain({
      instagrapiSession: 'corrupted-not-encrypted', sessionVersion: 1, provider: 'instagrapi',
    }));
    await mgr.load('acc-z');

    const failed = logLines.find(l => l.includes('SESSION_LOAD_FAILED'));
    expect(failed).toBeTruthy();
    expect(failed).not.toContain('corrupted-not-encrypted');
    expect(failed).not.toContain('password');
    expect(failed).not.toContain('cookies');
  });
});

// ── SessionManager — session CRUD ─────────────────────────────────────────────

describe('SessionManager: load / save / invalidate', () => {
  let mgr;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset();
    mockFindOneAndUpdate.mockReset();
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

    mockFindOneAndUpdate.mockResolvedValue({ sessionVersion: 1 });
    await mgr.save('acc1', session);

    // load() hits cache — sessionVersion matches → returns cached data
    mockFindById.mockReturnValue(dbChain({ instagrapiSession: 'anything', sessionVersion: 1 }));
    const loaded = await mgr.load('acc1');
    expect(loaded).toEqual(session);
  });

  test('save() stores an encrypted blob (never plaintext JSON)', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ sessionVersion: 1 });
    await mgr.save('acc1', { secret: 'value' });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    const blob = update.$set.instagrapiSession;
    expect(blob).toMatch(/^enc1:/); // encrypted prefix
    expect(blob).not.toContain('value'); // plaintext never stored
  });

  test('save() increments sessionVersion via $inc', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ sessionVersion: 1 });
    await mgr.save('acc1', {});

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'acc1' }),
      expect.objectContaining({ $inc: { sessionVersion: 1 } }),
      expect.any(Object)
    );
  });

  test('save() without expectedVersion uses only _id as filter', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ sessionVersion: 2 });
    await mgr.save('acc2', {});

    const [filter] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'acc2' });
    expect(filter.sessionVersion).toBeUndefined();
  });

  test('save() with expectedVersion includes version in filter (optimistic lock)', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ sessionVersion: 4 });
    await mgr.save('acc3', {}, 3);

    const [filter] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'acc3', sessionVersion: 3 });
  });

  test('save() with expectedVersion throws SESSION_VERSION_CONFLICT when DB returns null', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null); // version mismatch
    const err = await mgr.save('acc4', {}, 5).catch(e => e);
    expect(err.code).toBe('SESSION_VERSION_CONFLICT');
  });

  test('save() without expectedVersion does not throw when DB returns null (account not found)', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);
    await expect(mgr.save('acc5', {})).resolves.toBeUndefined();
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

  /* `consecutiveFailures` decide, em MAX, se a sessão passa a ser tratada como
     inválida — e daí o painel dizer "sessão expirada". Estes testes afirmavam
     que QUALQUER erro incrementava, inclusive `new Error('timeout')` sem
     código. Era o comportamento real, e era o defeito: o worker chama
     recordFailure com qualquer falha de publicação, então cinco tropeços de
     rede em dias diferentes marcavam como expirada uma conta logada e sadia.

     Um teste que descreve o defeito com precisão é o que faz o defeito
     sobreviver a uma revisão. Agora eles afirmam a regra correta: só conta o
     que é evidência sobre a sessão. */

  test('erro de sessão incrementa consecutiveFailures', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 2 }));
    await mgr.recordFailure('acc1', Object.assign(new Error('login required'), { code: 'SESSION_EXPIRED' }));
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ consecutiveFailures: 3 }),
    });
  });

  test('erro sem código NÃO incrementa — não é evidência sobre a sessão', async () => {
    // É o caso mais comum vindo da publicação: vídeo recusado, proxy caído,
    // serviço Python reiniciando. Nada disso diz que a sessão morreu.
    mockFindById.mockClear();
    await mgr.recordFailure('acc1', new Error('falha ao enviar o vídeo'));
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.NETWORK_ERROR }),
    });
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ consecutiveFailures: expect.anything() }),
    });
  });

  test('TIMEOUT e serviço fora do ar não aproximam a conta da invalidez', async () => {
    for (const code of ['TIMEOUT', 'INSTAGRAPI_SERVICE_UNAVAILABLE', 'PROXY_ERROR']) {
      mockFindById.mockClear();
      await mgr.recordFailure('acc1', Object.assign(new Error('x'), { code }));
      expect(mockFindById).not.toHaveBeenCalled();
    }
  });

  test('sessão inválida chega a FAILED no limite (5)', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 4 })); // 4+1 = 5
    await mgr.recordFailure('acc1', Object.assign(new Error('x'), { code: 'BAD_PASSWORD' }));
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.FAILED }),
    });
  });

  test('abaixo do limite fica INVALID', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 2 })); // 2+1 = 3
    await mgr.recordFailure('acc1', Object.assign(new Error('x'), { code: 'NO_INSTAGRAPI_SESSION' }));
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.INVALID }),
    });
  });

  test('cem falhas técnicas seguidas não invalidam a sessão', async () => {
    // O cenário do usuário, comprimido: a conta está online e sadia, e a
    // instabilidade é da infraestrutura.
    mockFindById.mockClear();
    for (let i = 0; i < 100; i++) {
      await mgr.recordFailure('acc1', Object.assign(new Error('x'), { code: 'TIMEOUT' }));
    }
    expect(mockFindById).not.toHaveBeenCalled();
  });

  test('recordFailure() sets REAUTH_REQUIRED for SESSION_EXPIRED error code', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 0 }));
    const err = Object.assign(new Error('login required'), { code: 'SESSION_EXPIRED' });
    await mgr.recordFailure('acc1', err);
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.REAUTH_REQUIRED }),
    });
  });

  test('recordFailure() sets NETWORK_ERROR for TIMEOUT error code', async () => {
    mockFindById.mockReturnValue(dbChain({ consecutiveFailures: 0 }));
    const err = Object.assign(new Error('timed out'), { code: 'TIMEOUT' });
    await mgr.recordFailure('acc1', err);
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', {
      $set: expect.objectContaining({ sessionStatus: SESSION_STATUS.NETWORK_ERROR }),
    });
  });

  test('recordFailure() with RATE_LIMITED routes to recordRateLimit() (no findById call)', async () => {
    const err = Object.assign(new Error('too many requests'), { code: 'RATE_LIMITED' });
    await mgr.recordFailure('acc1', err);

    // recordRateLimit() uses findByIdAndUpdate with $inc
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', expect.objectContaining({
      $inc: { rateLimitCount: 1 },
    }));
    // findById should NOT be called (short-circuits before the consecutive-failure path)
    expect(mockFindById).not.toHaveBeenCalled();
  });

  test('recordRateLimit() sets RATE_LIMITED status, increments rateLimitCount', async () => {
    await mgr.recordRateLimit('acc2');
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc2', {
      $set: expect.objectContaining({
        sessionStatus:   SESSION_STATUS.RATE_LIMITED,
        lastRateLimitAt: expect.any(Date),
      }),
      $inc: { rateLimitCount: 1 },
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

// ── SessionManager: optimistic locking isolation ──────────────────────────────

describe('SessionManager: optimistic lock (race condition)', () => {
  let mgr;

  beforeEach(() => {
    mgr = makeMgr();
    mockFindOneAndUpdate.mockReset();
  });

  test('two concurrent saves for same account — second detects conflict via expectedVersion', async () => {
    // Both workers read version=3, both try to save with expectedVersion=3.
    // DB returns null for the second (version already incremented to 4).
    let callCount = 0;
    mockFindOneAndUpdate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ sessionVersion: 4 }); // first wins
      return Promise.resolve(null); // second: version mismatch
    });

    const session = { username: 'u1', cookies: {} };
    const [r1, r2] = await Promise.allSettled([
      mgr.save('acc1', session, 3),
      mgr.save('acc1', session, 3),
    ]);

    const ok  = [r1, r2].filter(r => r.status === 'fulfilled');
    const bad = [r1, r2].filter(r => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason.code).toBe('SESSION_VERSION_CONFLICT');
  });
});

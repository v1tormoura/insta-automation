'use strict';

// ── Mocks — must come before any require of the modules under test ─────────────

jest.mock('../src/models/Account', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/queue/connection', () => ({
  set: jest.fn().mockResolvedValue('OK'),
  exists: jest.fn().mockResolvedValue(0),
  eval: jest.fn().mockResolvedValue(1),
}));

jest.mock('../src/services/instagramPrivateService', () => ({
  postReel:     jest.fn(),
  createClient: jest.fn(),
}));

jest.mock('../src/services/instagramAPI', () => ({
  postReel: jest.fn(),
}));

jest.mock('../src/services/storyService', () => ({
  postStory: jest.fn(),
}));

jest.mock('../src/services/instagrapi/SessionManager', () => {
  const mockSM = {
    validate:    jest.fn().mockResolvedValue({ valid: true, reason: '', status: 'VALID' }),
    invalidate:  jest.fn().mockResolvedValue(undefined),
    _setStatus:  jest.fn().mockResolvedValue(undefined),
  };
  return {
    getSessionManager: jest.fn(() => mockSM),
    _resetForTest:     jest.fn(),
    SESSION_STATUS:    { RECOVERING: 'RECOVERING' },
    _mockSM:           mockSM, // exposed for assertions
  };
});

const InstagramProvider  = require('../src/providers/InstagramProvider');
const OfficialAPIProvider = require('../src/providers/OfficialAPIProvider');
const InstagrapiProvider  = require('../src/providers/InstagrapiProvider');
const { getProvider, _resetForTest } = require('../src/providers/ProviderFactory');

// ── Abstract base ──────────────────────────────────────────────────────────────

describe('InstagramProvider (abstract base)', () => {
  const base = new InstagramProvider();

  test('providerName throws', () => {
    expect(() => base.providerName).toThrow('must define providerName');
  });

  test('validateSession throws "not implemented"', async () => {
    await expect(base.validateSession({})).rejects.toThrow('not implemented');
  });

  test('publishReel throws "not implemented"', async () => {
    await expect(base.publishReel({}, {})).rejects.toThrow('not implemented');
  });

  test('publishPost throws "not implemented"', async () => {
    await expect(base.publishPost({}, {})).rejects.toThrow('not implemented');
  });

  test('publishStory throws "not implemented"', async () => {
    await expect(base.publishStory({}, {})).rejects.toThrow('not implemented');
  });

  test('invalidateSession throws "not implemented"', async () => {
    await expect(base.invalidateSession('id')).rejects.toThrow('not implemented');
  });

  test('recoverSession throws "not implemented"', async () => {
    await expect(base.recoverSession({})).rejects.toThrow('not implemented');
  });
});

// ── OfficialAPIProvider ────────────────────────────────────────────────────────

describe('OfficialAPIProvider', () => {
  const provider = new OfficialAPIProvider();

  test('extends InstagramProvider', () => {
    expect(provider).toBeInstanceOf(InstagramProvider);
  });

  test('providerName is "official"', () => {
    expect(provider.providerName).toBe('official');
  });

  // validateSession ──────────────────────────────────────────────────────────

  test('validateSession: igSession present → valid', async () => {
    const r = await provider.validateSession({ igSession: 'some-blob' });
    expect(r.valid).toBe(true);
  });

  test('validateSession: rawWebSessionid present → valid', async () => {
    const r = await provider.validateSession({ rawWebSessionid: 'sid' });
    expect(r.valid).toBe(true);
  });

  test('validateSession: accessToken + igUserId → valid', async () => {
    const r = await provider.validateSession({ accessToken: 'tok', igUserId: '999' });
    expect(r.valid).toBe(true);
  });

  test('validateSession: no credentials → invalid with reason', async () => {
    const r = await provider.validateSession({});
    expect(r.valid).toBe(false);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  // publishReel routing ──────────────────────────────────────────────────────

  test('publishReel uses Graph API when accessToken + igUserId present', async () => {
    const { postReel: graph } = require('../src/services/instagramAPI');
    graph.mockResolvedValueOnce(undefined);
    await provider.publishReel({ accessToken: 'tok', igUserId: '1' }, {});
    expect(graph).toHaveBeenCalled();
  });

  test('publishReel falls back to Private API without Graph token', async () => {
    const { postReel: priv } = require('../src/services/instagramPrivateService');
    priv.mockResolvedValueOnce(undefined);
    await provider.publishReel({ igSession: 'sess' }, {});
    expect(priv).toHaveBeenCalled();
  });

  // invalidateSession ────────────────────────────────────────────────────────

  test('invalidateSession clears igSession and sets sessao_expirada', async () => {
    const Account = require('../src/models/Account');
    Account.findByIdAndUpdate.mockClear();
    await provider.invalidateSession('acc123');
    expect(Account.findByIdAndUpdate).toHaveBeenCalledWith(
      'acc123',
      expect.objectContaining({
        $set: expect.objectContaining({ igSession: '', healthStatus: 'sessao_expirada' }),
      })
    );
  });

  // recoverSession ───────────────────────────────────────────────────────────

  test('recoverSession returns { recovered: true } when createClient succeeds', async () => {
    const { createClient } = require('../src/services/instagramPrivateService');
    createClient.mockResolvedValueOnce({});
    const r = await provider.recoverSession({ _id: 'abc', username: 'u' });
    expect(r.recovered).toBe(true);
    expect(r.reason).toBe('');
  });

  test('recoverSession returns { recovered: false, reason } when createClient throws', async () => {
    const { createClient } = require('../src/services/instagramPrivateService');
    createClient.mockRejectedValueOnce(new Error('CHALLENGE_REQUIRED'));
    const r = await provider.recoverSession({ _id: 'abc', username: 'u' });
    expect(r.recovered).toBe(false);
    expect(r.reason).toContain('CHALLENGE_REQUIRED');
  });
});

// ── InstagrapiProvider ────────────────────────────────────────────────────────

describe('InstagrapiProvider', () => {
  const { getSessionManager, _mockSM } = require('../src/services/instagrapi/SessionManager');
  const sm       = getSessionManager();
  const provider = new InstagrapiProvider(sm);

  beforeEach(() => jest.clearAllMocks());

  test('extends InstagramProvider', () => {
    expect(provider).toBeInstanceOf(InstagramProvider);
  });

  test('providerName is "instagrapi"', () => {
    expect(provider.providerName).toBe('instagrapi');
  });

  test('publishReel throws INSTAGRAPI_NOT_IMPLEMENTED', async () => {
    await expect(provider.publishReel({}, {}))
      .rejects.toMatchObject({ code: 'INSTAGRAPI_NOT_IMPLEMENTED' });
  });

  test('publishPost throws INSTAGRAPI_NOT_IMPLEMENTED', async () => {
    await expect(provider.publishPost({}, {}))
      .rejects.toMatchObject({ code: 'INSTAGRAPI_NOT_IMPLEMENTED' });
  });

  test('publishStory throws INSTAGRAPI_NOT_IMPLEMENTED', async () => {
    await expect(provider.publishStory({}, {}))
      .rejects.toMatchObject({ code: 'INSTAGRAPI_NOT_IMPLEMENTED' });
  });

  test('validateSession delegates to SessionManager.validate()', async () => {
    _mockSM.validate.mockResolvedValueOnce({ valid: true, reason: '', status: 'VALID' });
    const r = await provider.validateSession({ _id: 'myId' });
    expect(r.valid).toBe(true);
    expect(_mockSM.validate).toHaveBeenCalledWith('myId');
  });

  test('invalidateSession delegates to SessionManager.invalidate()', async () => {
    await provider.invalidateSession('myId');
    expect(_mockSM.invalidate).toHaveBeenCalledWith('myId');
  });

  test('recoverSession sets status RECOVERING and returns recovered: false', async () => {
    const r = await provider.recoverSession({ _id: 'myId' });
    expect(_mockSM._setStatus).toHaveBeenCalledWith('myId', 'RECOVERING');
    expect(r.recovered).toBe(false);
  });
});

// ── ProviderFactory ────────────────────────────────────────────────────────────

describe('ProviderFactory', () => {
  beforeEach(() => _resetForTest());

  test('returns OfficialAPIProvider for provider="official"', () => {
    const p = getProvider({ provider: 'official' });
    expect(p).toBeInstanceOf(OfficialAPIProvider);
    expect(p.providerName).toBe('official');
  });

  test('returns OfficialAPIProvider when provider field is absent', () => {
    const p = getProvider({});
    expect(p).toBeInstanceOf(OfficialAPIProvider);
  });

  test('returns OfficialAPIProvider for null/undefined account', () => {
    const p = getProvider(null);
    expect(p).toBeInstanceOf(OfficialAPIProvider);
  });

  test('returns InstagrapiProvider for provider="instagrapi"', () => {
    const p = getProvider({ provider: 'instagrapi' });
    expect(p).toBeInstanceOf(InstagrapiProvider);
    expect(p.providerName).toBe('instagrapi');
  });

  test('OfficialAPIProvider is a singleton across calls', () => {
    const p1 = getProvider({ provider: 'official' });
    const p2 = getProvider({});
    expect(p1).toBe(p2);
  });

  test('InstagrapiProvider is a singleton across calls', () => {
    const p1 = getProvider({ provider: 'instagrapi' });
    const p2 = getProvider({ provider: 'instagrapi' });
    expect(p1).toBe(p2);
  });

  test('official and instagrapi providers are distinct instances', () => {
    const off  = getProvider({ provider: 'official' });
    const inst = getProvider({ provider: 'instagrapi' });
    expect(off).not.toBe(inst);
  });
});

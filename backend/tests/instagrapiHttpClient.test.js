'use strict';

// ENCRYPTION_KEY must be set before any module that uses tokenEncryption is required
process.env.ENCRYPTION_KEY = '0'.repeat(64);

// ── Mock global fetch (Node 20 native) ───────────────────────────────────────

let _fetchMock;
global.fetch = (...args) => _fetchMock(...args);

function mockFetch(status, body) {
  _fetchMock = jest.fn().mockResolvedValue({
    ok:   status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  return _fetchMock;
}

function mockFetchError(msg) {
  _fetchMock = jest.fn().mockRejectedValue(new Error(msg));
  return _fetchMock;
}

// ── Mock SessionManager ───────────────────────────────────────────────────────

const _sm = {
  load:          jest.fn(),
  save:          jest.fn().mockResolvedValue(undefined),
  recordLogin:   jest.fn().mockResolvedValue(undefined),
  recordSuccess: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn().mockResolvedValue(undefined),
};

const { InstagrapiHttpClient } = require('../src/services/instagrapi/InstagrapiHttpClient');

// All tests use a local base URL so real network is never touched
const BASE = 'http://localhost:9999';

function makeClient() {
  return new InstagrapiHttpClient(BASE, _sm);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Service unavailable ───────────────────────────────────────────────────────

describe('InstagrapiHttpClient: service unavailable', () => {
  test('_post() throws INSTAGRAPI_SERVICE_UNAVAILABLE when fetch rejects', async () => {
    mockFetchError('ECONNREFUSED');
    const client = makeClient();
    await expect(client._post('/any', {}))
      .rejects.toMatchObject({ code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' });
  });

  test('_get() throws INSTAGRAPI_SERVICE_UNAVAILABLE when fetch rejects', async () => {
    mockFetchError('connect ETIMEDOUT');
    const client = makeClient();
    await expect(client._get('/any'))
      .rejects.toMatchObject({ code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' });
  });
});

// ── HTTP error responses ──────────────────────────────────────────────────────

describe('InstagrapiHttpClient: HTTP error handling', () => {
  test('non-OK JSON response with code+message propagates as structured error', async () => {
    mockFetch(422, { detail: { code: 'SESSION_EXPIRED', message: 'Login required' } });
    const client = makeClient();
    const err = await client._post('/publish/reel', {}).catch(e => e);
    expect(err.code).toBe('SESSION_EXPIRED');
    expect(err.message).toContain('Login required');
    expect(err.httpStatus).toBe(422);
  });

  test('non-OK string response uses INSTAGRAPI_HTTP_{status} code', async () => {
    mockFetch(500, { detail: 'Internal Server Error' });
    const client = makeClient();
    const err = await client._post('/session/load', {}).catch(e => e);
    expect(err.code).toBe('INSTAGRAPI_HTTP_500');
  });
});

// ── ensureSession ─────────────────────────────────────────────────────────────

describe('InstagrapiHttpClient: ensureSession()', () => {
  const account = { _id: 'acc1', proxy: null };

  test('does not call /session/load when Python pool already has session', async () => {
    const fetchMock = mockFetch(200, { loaded: true });
    const client    = makeClient();
    await client.ensureSession(account);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only GET /session/status
  });

  test('loads from MongoDB and calls /session/load when pool is empty', async () => {
    // First call: GET /session/status → not loaded
    // Second call: POST /session/load → ok
    let call = 0;
    _fetchMock = jest.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: false }), text: async () => '' });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' });
    });

    _sm.load.mockResolvedValue({ username: 'test', cookies: {} });

    const client = makeClient();
    await client.ensureSession(account);

    expect(_sm.load).toHaveBeenCalledWith('acc1');
    expect(_fetchMock).toHaveBeenCalledTimes(2);
  });

  test('throws NO_INSTAGRAPI_SESSION when pool empty AND MongoDB has no session', async () => {
    _fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ loaded: false }), text: async () => '' });
    _sm.load.mockResolvedValue(null);

    const client = makeClient();
    await expect(client.ensureSession(account))
      .rejects.toMatchObject({ code: 'NO_INSTAGRAPI_SESSION' });
  });
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('InstagrapiHttpClient: login()', () => {
  const account = { _id: 'acc2', proxy: null };

  test('saves returned settings to MongoDB and records login on success', async () => {
    const settings = { cookies: { sessionid: 'xyz' } };
    mockFetch(200, { settings });
    const client = makeClient();

    await client.login(account, 'user', 'pass');

    expect(_sm.save).toHaveBeenCalledWith('acc2', settings);
    expect(_sm.recordLogin).toHaveBeenCalledWith('acc2', true);
  });

  test('propagates CHALLENGE_REQUIRED from Python service', async () => {
    mockFetch(428, { detail: { code: 'CHALLENGE_REQUIRED', message: 'Challenge needed' } });
    const client = makeClient();
    await expect(client.login(account, 'user', 'pass'))
      .rejects.toMatchObject({ code: 'CHALLENGE_REQUIRED' });
    expect(_sm.save).not.toHaveBeenCalled();
  });
});

// ── publishReel ───────────────────────────────────────────────────────────────

describe('InstagrapiHttpClient: publishReel()', () => {
  const account  = { _id: 'acc3', proxy: null };
  const postData = { media: 'video.mp4', caption: 'Test', cover: 'thumb.jpg' };

  test('calls /publish/reel and saves updated session settings', async () => {
    // ensureSession: loaded=true
    // publishReel: { media_id, settings }
    const updatedSettings = { cookies: { sessionid: 'refreshed' } };
    let call = 0;
    _fetchMock = jest.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: true }), text: async () => '' });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ media_id: '12345', settings: updatedSettings }), text: async () => '' });
    });

    const client = makeClient();
    const result = await client.publishReel(account, postData);

    expect(result.media_id).toBe('12345');
    expect(_sm.save).toHaveBeenCalledWith('acc3', updatedSettings);
  });

  test('maps relative media path to /app/uploads/… in request body', async () => {
    let capturedBody;
    _fetchMock = jest.fn().mockImplementation((url, opts) => {
      if (url.includes('/status')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: true }), text: async () => '' });
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ media_id: '1', settings: {} }), text: async () => '' });
    });

    const client = makeClient();
    await client.publishReel(account, postData);

    expect(capturedBody.media_path).toBe('/app/uploads/video.mp4');
    expect(capturedBody.cover_path).toBe('/app/uploads/thumb.jpg');
  });

  test('propagates SESSION_EXPIRED from Python service', async () => {
    _fetchMock = jest.fn().mockImplementation((url) => {
      if (url.includes('/status')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: true }), text: async () => '' });
      return Promise.resolve({ ok: false, status: 422, json: async () => ({ detail: { code: 'SESSION_EXPIRED', message: 'login_required' } }), text: async () => '' });
    });

    const client = makeClient();
    await expect(client.publishReel(account, postData))
      .rejects.toMatchObject({ code: 'SESSION_EXPIRED', httpStatus: 422 });
    expect(_sm.save).not.toHaveBeenCalled();
  });
});

// ── publishPost ───────────────────────────────────────────────────────────────

describe('InstagrapiHttpClient: publishPost()', () => {
  const account  = { _id: 'acc4', proxy: null };
  const postData = { media: 'photo.jpg', caption: 'Caption' };

  test('calls /publish/post and returns media_id', async () => {
    let call = 0;
    _fetchMock = jest.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: true }), text: async () => '' });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ media_id: '99', settings: {} }), text: async () => '' });
    });

    const client = makeClient();
    const result = await client.publishPost(account, postData);
    expect(result.media_id).toBe('99');
  });
});

// ── evictSession ──────────────────────────────────────────────────────────────

describe('InstagrapiHttpClient: evictSession()', () => {
  test('calls /session/evict and does not throw on success', async () => {
    mockFetch(200, { ok: true });
    const client = makeClient();
    await expect(client.evictSession('acc5')).resolves.toBeUndefined();
  });

  test('silently ignores failure (best-effort)', async () => {
    mockFetchError('connection refused');
    const client = makeClient();
    await expect(client.evictSession('acc5')).resolves.toBeUndefined();
  });
});

// ── Path handling ─────────────────────────────────────────────────────────────

describe('InstagrapiHttpClient: path handling', () => {
  test('absolute paths are passed through unchanged', async () => {
    let capturedBody;
    _fetchMock = jest.fn().mockImplementation((url, opts) => {
      if (url.includes('/status')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: true }), text: async () => '' });
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ media_id: '1', settings: {} }), text: async () => '' });
    });

    const client = makeClient();
    await client.publishReel({ _id: 'x', proxy: null }, { media: '/abs/path/video.mp4', caption: '' });

    expect(capturedBody.media_path).toBe('/abs/path/video.mp4');
  });

  test('null/empty cover is sent as null', async () => {
    let capturedBody;
    _fetchMock = jest.fn().mockImplementation((url, opts) => {
      if (url.includes('/status')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ loaded: true }), text: async () => '' });
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ media_id: '1', settings: {} }), text: async () => '' });
    });

    const client = makeClient();
    await client.publishReel({ _id: 'x', proxy: null }, { media: 'file.mp4', cover: '', caption: '' });

    expect(capturedBody.cover_path).toBeNull();
  });
});

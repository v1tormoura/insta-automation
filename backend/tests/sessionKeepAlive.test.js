'use strict';

process.env.ENCRYPTION_KEY = '0'.repeat(64);

// ── Mock SessionManager ───────────────────────────────────────────────────────

const mockSm = {
  validate:      jest.fn(),
  acquireLock:   jest.fn(),
  releaseLock:   jest.fn().mockResolvedValue(true),
  recordFailure: jest.fn().mockResolvedValue(undefined),
  recordSuccess: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../src/services/instagrapi/SessionManager', () => ({
  getSessionManager: () => mockSm,
}));

// ── Mock InstagrapiHttpClient ─────────────────────────────────────────────────
// login is explicitly included so tests can assert it is never called.

const mockHttp = {
  ensureSession: jest.fn(),
  // O keep-alive passou a fazer um ping leve depois de carregar a sessao:
  // ensureSession apenas popula o pool do servico Python, sem falar com o
  // Instagram. Sem o ping o blob salvo nunca recebia os cookies/tokens que o
  // Instagram rotaciona, e a sessao envelhecia parada.
  pingSession:   jest.fn(),
  login:         jest.fn(), // must never be called by keepAlive
};

jest.mock('../src/services/instagrapi/InstagrapiHttpClient', () => ({
  InstagrapiHttpClient: jest.fn().mockImplementation(() => mockHttp),
}));

// ── Mock Account ──────────────────────────────────────────────────────────────

jest.mock('../src/models/Account', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  find:              jest.fn().mockResolvedValue([]),
}));

// ── Mock broadcaster (pulled in via healthCheck dependency chain) ─────────────

jest.mock('../src/events/broadcaster', () => ({ broadcast: jest.fn() }));

// ── Mock fs (keepAliveAccount uses fs for legacy paths) ──────────────────────

jest.mock('fs', () => ({ existsSync: jest.fn().mockReturnValue(false) }));

// ── Load SUT ──────────────────────────────────────────────────────────────────

const { _keepAliveInstagrapi } = require('../src/jobs/sessionKeepAlive');
const Account = require('../src/models/Account');

const ACCOUNT = {
  _id:               'acc1',
  username:          'test_user',
  provider:          'instagrapi',
  instagrapiSession: 'enc-blob',
  proxy:             null,
};

const LOCK_TOKEN = 'tok-abc123';

beforeEach(() => {
  jest.clearAllMocks();
  mockSm.releaseLock.mockResolvedValue(true);
  mockSm.recordFailure.mockResolvedValue(undefined);
  mockSm.recordSuccess.mockResolvedValue(undefined);
  Account.findByIdAndUpdate.mockResolvedValue({});
});

// ── Cenário 1: sessão já existe → mantida, SEM login, SEM nova sessão ────────

describe('_keepAliveInstagrapi: sessão válida', () => {
  test('ensureSession chamado, login NUNCA chamado, status ok', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    mockHttp.ensureSession.mockResolvedValue(undefined);
    mockHttp.pingSession.mockResolvedValue({ valid: true });

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('ok');
    expect(mockHttp.ensureSession).toHaveBeenCalledTimes(1);
    expect(mockHttp.pingSession).toHaveBeenCalledTimes(1); // mantem a sessao viva
    expect(mockHttp.login).not.toHaveBeenCalled();       // NUNCA pede senha
    expect(Account.findByIdAndUpdate).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({ lastSessionKeepAlive: expect.any(Date) })
    );
    expect(mockSm.releaseLock).toHaveBeenCalledWith('acc1', LOCK_TOKEN);
  });
});

// ── Cenário 2: Python indisponível → transitório, sessão preservada ───────────

describe('_keepAliveInstagrapi: Python indisponível', () => {
  test('INSTAGRAPI_SERVICE_UNAVAILABLE → status ok, sessão NÃO apagada, sem login', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    const svcErr = Object.assign(new Error('service down'), { code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' });
    mockHttp.ensureSession.mockRejectedValue(svcErr);

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('ok');
    expect(mockHttp.login).not.toHaveBeenCalled();
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
    // instagrapiSession NUNCA apagada — findByIdAndUpdate não deve ser chamado com instagrapiSession:''
    const calls = Account.findByIdAndUpdate.mock.calls;
    for (const [, update] of calls) {
      expect(update.instagrapiSession).toBeUndefined();
    }
    expect(mockSm.releaseLock).toHaveBeenCalledWith('acc1', LOCK_TOKEN);
  });

  test('TIMEOUT → status ok, sessão preservada', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    const timeoutErr = Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    mockHttp.ensureSession.mockRejectedValue(timeoutErr);

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('ok');
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
    expect(mockHttp.login).not.toHaveBeenCalled();
  });
});

// ── Cenário 3: sessão expirada → marca expirada, sem login, sem descobrir senha ─

describe('_keepAliveInstagrapi: sessão expirada', () => {
  /* O keep-alive é o que traz a conta de volta: um ciclo bem-sucedido chama
     `recordSuccess` e zera o contador. Barrar por contagem de falhas fechava o
     círculo — a queda de rede enchia o contador, o contador impedia o
     keep-alive, e a conta ficava presa fora do ar por um problema já resolvido. */

  test('contagem de falhas não impede o ciclo — é ele que cura', async () => {
    mockSm.validate.mockResolvedValue({
      valid: false, status: 'FAILED', reason: '23 falhas consecutivas — relogin necessário',
    });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);

    await _keepAliveInstagrapi(ACCOUNT);

    expect(mockSm.acquireLock).toHaveBeenCalled();
    expect(mockHttp.ensureSession).toHaveBeenCalled();
  });

  test('sem sessão gravada, desiste antes de gastar rede', async () => {
    mockSm.validate.mockResolvedValue({
      valid: false, status: 'UNKNOWN', reason: 'Sem sessão instagrapi configurada',
    });

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('expirada');
    expect(mockHttp.ensureSession).not.toHaveBeenCalled();
    expect(mockSm.acquireLock).not.toHaveBeenCalled();
  });

  test('SESSION_EXPIRED de ensureSession → marca expirada, recordFailure, sem login', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    const expErr = Object.assign(new Error('session expired'), { code: 'SESSION_EXPIRED' });
    mockHttp.ensureSession.mockRejectedValue(expErr);

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('expirada');
    expect(mockHttp.login).not.toHaveBeenCalled();       // NUNCA tenta login
    expect(mockSm.recordFailure).toHaveBeenCalledWith('acc1', expErr);
    expect(Account.findByIdAndUpdate).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({ healthStatus: 'sessao_expirada' })
    );
    // instagrapiSession nunca apagada
    const calls = Account.findByIdAndUpdate.mock.calls;
    for (const [, update] of calls) {
      expect(update.instagrapiSession).toBeUndefined();
    }
    expect(mockSm.releaseLock).toHaveBeenCalledWith('acc1', LOCK_TOKEN);
  });
});

// ── Cenário 4: lock ocupado → pula silenciosamente ───────────────────────────

describe('_keepAliveInstagrapi: lock ocupado', () => {
  test('acquireLock retorna null → pula, sem ensureSession, sem login', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(null); // lock ocupado por publish/login

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('ok');
    expect(mockHttp.ensureSession).not.toHaveBeenCalled();
    expect(mockHttp.login).not.toHaveBeenCalled();
    expect(mockSm.releaseLock).not.toHaveBeenCalled(); // não adquiriu, não libera
  });
});

// ── Cenário 5: sem sessão no banco ────────────────────────────────────────────

describe('_keepAliveInstagrapi: sem sessão no banco', () => {
  test('NO_INSTAGRAPI_SESSION → expirada, sem login, sessão não limpa', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    const noSessErr = Object.assign(new Error('no session'), { code: 'NO_INSTAGRAPI_SESSION' });
    mockHttp.ensureSession.mockRejectedValue(noSessErr);

    const result = await _keepAliveInstagrapi(ACCOUNT);

    expect(result.status).toBe('expirada');
    expect(mockHttp.login).not.toHaveBeenCalled();
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
    expect(mockSm.releaseLock).toHaveBeenCalledWith('acc1', LOCK_TOKEN);
  });
});

// ── Cenário 6: lock sempre liberado mesmo em erro ────────────────────────────

describe('_keepAliveInstagrapi: lock liberado em erro', () => {
  test('releaseLock chamado no finally mesmo quando ensureSession lança', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    mockHttp.ensureSession.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' })
    );

    await _keepAliveInstagrapi(ACCOUNT);

    expect(mockSm.releaseLock).toHaveBeenCalledWith('acc1', LOCK_TOKEN);
  });
});

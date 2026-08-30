'use strict';

process.env.ENCRYPTION_KEY = '0'.repeat(64);

// ── Mock SessionManager ───────────────────────────────────────────────────────
// Variables referenced inside jest.mock factories must be prefixed with "mock"

const mockSm = {
  validate:      jest.fn(),
  recordSuccess: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn().mockResolvedValue(undefined),
  load:          jest.fn(),
};

jest.mock('../src/services/instagrapi/SessionManager', () => ({
  getSessionManager: () => mockSm,
}));

// ── Mock InstagrapiHttpClient ─────────────────────────────────────────────────

const mockHttp = {
  ensureSession: jest.fn(),
  pingSession:   jest.fn(),
};

jest.mock('../src/services/instagrapi/InstagrapiHttpClient', () => ({
  InstagrapiHttpClient: jest.fn().mockImplementation(() => mockHttp),
}));

// ── Mock Account ──────────────────────────────────────────────────────────────

jest.mock('../src/models/Account', () => ({
  findById:          jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  find:              jest.fn().mockResolvedValue([]),
}));

// ── Mock broadcaster ──────────────────────────────────────────────────────────

jest.mock('../src/events/broadcaster', () => ({ broadcast: jest.fn() }));

// ── Mock cancelAccountWork ────────────────────────────────────────────────────

jest.mock('../src/utils/cancelAccountWork', () => jest.fn().mockResolvedValue(undefined));

// ── Load SUT ──────────────────────────────────────────────────────────────────

const { checkViaInstagrapi } = require('../src/jobs/healthCheck');

const ACCOUNT = { _id: 'acc1', username: 'test_user', proxy: null, instagrapiSession: 'enc-blob' };

beforeEach(() => {
  jest.clearAllMocks();
  mockSm.recordSuccess.mockResolvedValue(undefined);
  mockSm.recordFailure.mockResolvedValue(undefined);
});

// ── checkViaInstagrapi — cenários principais ──────────────────────────────────

describe('checkViaInstagrapi: sessão válida', () => {
  test('valida local OK + ping OK → status "ativa"', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.ensureSession.mockResolvedValue(undefined);
    mockHttp.pingSession.mockResolvedValue({ valid: true, username: 'test_user' });

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBe('ativa');
    expect(result.error).toBe('');
    expect(mockSm.recordSuccess).toHaveBeenCalledWith('acc1');
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
  });
});

describe('checkViaInstagrapi: sessão expirada', () => {
  test('ping retorna SESSION_EXPIRED → status "sessao_expirada" + recordFailure chamado', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.ensureSession.mockResolvedValue(undefined);
    const pingErr = Object.assign(new Error('session expired'), { code: 'SESSION_EXPIRED', httpStatus: 422 });
    mockHttp.pingSession.mockRejectedValue(pingErr);

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBe('sessao_expirada');
    expect(mockSm.recordFailure).toHaveBeenCalledWith('acc1', pingErr);
    expect(mockSm.recordSuccess).not.toHaveBeenCalled();
  });

  /* Este teste afirmava que a validação LOCAL bastava para declarar a sessão
     expirada, sem tocar na rede — "sem chamar rede" estava no próprio nome, e
     era tratado como virtude.

     Era o defeito. "Sessão expirada" é uma afirmação sobre o que o Instagram
     pensa, e o banco não sabe o que o Instagram pensa. Com o proxy fora do ar,
     a conta acumulava falhas, a validação local passava a reprovar, e o health
     check nunca mais chegava ao ping: a conta ficava marcada como expirada
     para sempre, com a sessão intacta, sem caminho de volta que não fosse um
     comando manual no banco. */

  test('contagem de falhas alta NÃO decide sozinha — o ping é a autoridade', async () => {
    mockSm.validate.mockResolvedValue({
      valid: false, status: 'FAILED', reason: '5 falhas consecutivas — relogin necessário',
    });
    mockHttp.pingSession.mockResolvedValue({ ok: true });

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(mockHttp.pingSession).toHaveBeenCalled();
    expect(result.status).toBe('ativa');
  });

  test('ping bem-sucedido zera o contador — o estado se cura sozinho', async () => {
    // Sem isto, resolver a causa real (a rede) não devolveria a conta ao ar.
    mockSm.validate.mockResolvedValue({
      valid: false, status: 'FAILED', reason: '23 falhas consecutivas — relogin necessário',
    });
    mockHttp.pingSession.mockResolvedValue({ ok: true });

    await checkViaInstagrapi(ACCOUNT);
    expect(mockSm.recordSuccess).toHaveBeenCalled();
  });

  test('sem sessão gravada, aí sim decide sem rede', async () => {
    // Não há o que testar: a ausência de sessão é fato local, e gastar uma
    // requisição para confirmá-la seria desperdício.
    mockSm.validate.mockResolvedValue({
      valid: false, status: 'UNKNOWN', reason: 'Sem sessão instagrapi configurada',
    });

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBe('sessao_expirada');
    expect(mockHttp.pingSession).not.toHaveBeenCalled();
  });

  test('o Instagram rejeitando a sessão continua marcando expirada', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.pingSession.mockRejectedValue(
      Object.assign(new Error('login required'), { code: 'SESSION_EXPIRED' })
    );

    const result = await checkViaInstagrapi(ACCOUNT);
    expect(result.status).toBe('sessao_expirada');
  });
});

describe('checkViaInstagrapi: Python indisponível', () => {
  test('ensureSession retorna INSTAGRAPI_SERVICE_UNAVAILABLE → status null (transitório)', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    const svcErr = Object.assign(new Error('service down'), { code: 'INSTAGRAPI_SERVICE_UNAVAILABLE' });
    mockHttp.ensureSession.mockRejectedValue(svcErr);

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBeNull();
    expect(mockHttp.pingSession).not.toHaveBeenCalled();
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
  });

  test('ping retorna TIMEOUT → status null (não invalida sessão)', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.ensureSession.mockResolvedValue(undefined);
    const timeoutErr = Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    mockHttp.pingSession.mockRejectedValue(timeoutErr);

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBeNull();
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
  });

  test('ping retorna NETWORK_ERROR → status null (não invalida sessão)', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.ensureSession.mockResolvedValue(undefined);
    const netErr = Object.assign(new Error('network'), { code: 'NETWORK_ERROR' });
    mockHttp.pingSession.mockRejectedValue(netErr);

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBeNull();
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
  });
});

describe('checkViaInstagrapi: rate-limit', () => {
  test('ping retorna RATE_LIMITED → status null, sessão preservada', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.ensureSession.mockResolvedValue(undefined);
    const rlErr = Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED' });
    mockHttp.pingSession.mockRejectedValue(rlErr);

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBeNull();
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
    expect(mockSm.recordSuccess).not.toHaveBeenCalled();
  });
});

describe('checkViaInstagrapi: conta restrita', () => {
  test('ping retorna CHALLENGE_REQUIRED → status "restrita", sem apagar sessão', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockHttp.ensureSession.mockResolvedValue(undefined);
    const chErr = Object.assign(new Error('challenge'), { code: 'CHALLENGE_REQUIRED' });
    mockHttp.pingSession.mockRejectedValue(chErr);

    const result = await checkViaInstagrapi(ACCOUNT);

    expect(result.status).toBe('restrita');
    expect(mockSm.recordFailure).not.toHaveBeenCalled();
  });
});

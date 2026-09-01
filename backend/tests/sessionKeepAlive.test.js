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

/**
 * ── O contador que só sabia subir
 *
 * O keep-alive escrevia `lastSuccessfulRequestAt` à mão e NUNCA chamava
 * `recordSuccess`. O comentário do próprio arquivo já dizia que ele "era
 * exatamente o que traria a conta de volta ao chamar recordSuccess" — só que
 * a chamada não existia.
 *
 * O efeito: uma janela ruim (o proxy sem cota, por exemplo) enchia
 * `consecutiveFailures` até cinco pelo próprio keep-alive. A partir daí
 * `validate()` respondia "5 falhas consecutivas — relogin necessário" para
 * sempre, enquanto o ping seguia passando a cada ciclo, porque a sessão estava
 * boa. O painel dizia expirada, o Instagram dizia que não, e nada tinha
 * permissão para desempatar.
 */
describe('_keepAliveInstagrapi: o ping que passa desfaz o estrago', () => {
  test('ping bem-sucedido chama recordSuccess', async () => {
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    mockHttp.ensureSession.mockResolvedValue(undefined);
    mockHttp.pingSession.mockResolvedValue({ valid: true });

    await _keepAliveInstagrapi(ACCOUNT);

    expect(mockSm.recordSuccess).toHaveBeenCalledWith('acc1');
  });

  test('conta presa em "5 falhas" volta sozinha quando o ping passa', async () => {
    /* `validate()` diz inválida por falhas antigas, e o keep-alive testa mesmo
       assim — é essa insistência que dá a chance de a conta se recuperar. Sem
       o `recordSuccess` no fim, a chance é desperdiçada todo ciclo. */
    mockSm.validate.mockResolvedValue({
      valid: false, status: 'FAILED', reason: '5 falhas consecutivas — relogin necessário',
    });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    mockHttp.ensureSession.mockResolvedValue(undefined);
    mockHttp.pingSession.mockResolvedValue({ valid: true });

    const r = await _keepAliveInstagrapi(ACCOUNT);

    expect(r.status).toBe('ok');
    expect(mockSm.recordSuccess).toHaveBeenCalledWith('acc1');
    expect(mockHttp.login).not.toHaveBeenCalled();   // sem pedir senha nenhuma
  });

  test('limpa o rótulo "sessão expirada" que o próprio keep-alive escreveu', async () => {
    /* O contador zerado não basta: quem a tela mostra é `healthStatus`, e foi o
       ramo de falha deste mesmo arquivo que o escreveu. Sem limpar, a conta
       continua vermelha na tela com a sessão funcionando. */
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    mockHttp.ensureSession.mockResolvedValue(undefined);
    mockHttp.pingSession.mockResolvedValue({ valid: true });

    await _keepAliveInstagrapi({ ...ACCOUNT, healthStatus: 'sessao_expirada' });

    const [, update] = Account.findByIdAndUpdate.mock.calls.at(-1);
    expect(update.healthStatus).toBe('ativa');
    expect(update.lastError).toBe('');
  });

  test('não apaga "banida" nem "restrita" — um ping que passa não é prova contra elas', async () => {
    /* Conta restrita responde ping normalmente; o alcance é que está cortado.
       Sobrescrever o rótulo aqui apagaria um diagnóstico verdadeiro e mais
       grave, e a pessoa pararia de procurar. */
    mockSm.validate.mockResolvedValue({ valid: true, status: 'VALID', reason: '' });
    mockSm.acquireLock.mockResolvedValue(LOCK_TOKEN);
    mockHttp.ensureSession.mockResolvedValue(undefined);
    mockHttp.pingSession.mockResolvedValue({ valid: true });

    for (const rotulo of ['restrita', 'banida']) {
      Account.findByIdAndUpdate.mockClear();
      await _keepAliveInstagrapi({ ...ACCOUNT, healthStatus: rotulo });
      const [, update] = Account.findByIdAndUpdate.mock.calls.at(-1);
      expect(update.healthStatus).toBeUndefined();
    }
  });
});

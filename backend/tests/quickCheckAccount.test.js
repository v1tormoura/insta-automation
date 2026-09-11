'use strict';

/**
 * quickCheckAccount — dois defeitos que faziam sessão boa parecer morta.
 *
 * 1. `validateOAuthToken` mandava `account.accessToken` cru pro Meta. Com
 *    `ENCRYPTION_KEY` configurada, esse campo é cifra (`enc1:...`), não o
 *    token — o Meta recusa sempre, e a conta virava "token_invalido" mesmo
 *    com uma sessão perfeitamente válida por trás.
 *
 * 2. `quickCheckAndUpdate` rodava esse mesmo teste em TODA conta, inclusive
 *    as que publicam via instagrapi e só têm um `accessToken` da API oficial
 *    sobrando de uma conexão secundária — e esse teste sozinho decidia o
 *    healthStatus da conta inteira, apagando o resultado real da sessão que
 *    ela de fato usa para publicar.
 */

const mockDecrypt = jest.fn(v => v);
jest.mock('../src/services/tokenEncryption', () => ({ decrypt: (...a) => mockDecrypt(...a) }));

const mockFindByIdAndUpdate = jest.fn(async () => ({}));
jest.mock('../src/models/Account', () => ({
  findByIdAndUpdate: (...a) => mockFindByIdAndUpdate(...a),
}));

const { quickCheckAndUpdate } = require('../src/services/quickCheckAccount');

const contaOficial = (overrides = {}) => ({
  _id: 'acc1', username: 'contaoficial', provider: 'official',
  accessToken: 'enc1:cifra-nao-e-o-token', igUserId: '123', healthStatus: 'ativa',
  ...overrides,
});

const contaInstagrapi = (overrides = {}) => ({
  _id: 'acc2', username: 'containstagrapi', provider: 'instagrapi',
  // Sobra de uma conexão oficial antiga — a conta publica pelo instagrapi,
  // não por este token, mas ele ainda está gravado.
  accessToken: 'enc1:token-velho-nao-usado', igUserId: '456', healthStatus: 'ativa',
  ...overrides,
});

// A checagem de perfil público (passo 2) não importa para estes testes —
// resolvida "ativa" para não interferir na asserção do passo 1 (OAuth).
const perfilPublicoOk = () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('graph.instagram.com')) return oauthResponder(url);
    // web_profile_info / og:title — qualquer 200 sem corpo útil cai em "desconhecido",
    // que não altera o healthStatus (nem 'banida' nem 'restrita').
    return { ok: true, status: 200, json: async () => ({}) };
  });
};

let oauthResponder = async () => ({ ok: true, json: async () => ({ id: '123' }) });

beforeEach(() => {
  mockDecrypt.mockReset().mockImplementation(v => v.startsWith('enc1:') ? v.slice(5) : v);
  mockFindByIdAndUpdate.mockReset().mockResolvedValue({});
  oauthResponder = async () => ({ ok: true, json: async () => ({ id: '123' }) });
  perfilPublicoOk();
});

describe('token é descriptografado antes de ir para o Meta', () => {
  test('a URL chamada carrega o token decifrado, não a cifra', async () => {
    let urlChamada = '';
    oauthResponder = async (url) => { urlChamada = String(url); return { ok: true, json: async () => ({ id: '123' }) }; };

    await quickCheckAndUpdate(contaOficial());

    expect(mockDecrypt).toHaveBeenCalledWith('enc1:cifra-nao-e-o-token');
    expect(urlChamada).toContain('access_token=cifra-nao-e-o-token');
    expect(urlChamada).not.toContain('enc1:');
  });

  test('a URL não carrega /v21.0/ — forma que syncAccountAPI.js já comprovou funcionar para todo tipo de token', async () => {
    let urlChamada = '';
    oauthResponder = async (url) => { urlChamada = String(url); return { ok: true, json: async () => ({ id: '123' }) }; };

    await quickCheckAndUpdate(contaOficial());

    expect(urlChamada).toMatch(/^https:\/\/graph\.instagram\.com\/me\?/);
    expect(urlChamada).not.toContain('/v21.0/');
  });

  test('token que decifra e valida OK não mexe no healthStatus de uma conta já ativa', async () => {
    const r = await quickCheckAndUpdate(contaOficial({ healthStatus: 'ativa' }));
    expect(r.status).not.toBe('token_invalido');
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith('acc1', expect.objectContaining({ healthStatus: 'token_invalido' }));
  });

  test('Meta recusando de verdade ainda marca token_invalido — a correção não silencia falha real', async () => {
    oauthResponder = async () => ({ ok: true, json: async () => ({ error: { message: 'Error validating access token' } }) });

    const r = await quickCheckAndUpdate(contaOficial({ healthStatus: 'ativa' }));

    expect(r.status).toBe('token_invalido');
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('acc1', expect.objectContaining({ healthStatus: 'token_invalido' }));
  });
});

describe('conta instagrapi não é julgada pelo token OAuth secundário', () => {
  test('token OAuth ruim numa conta instagrapi não deixa rastro de token_invalido', async () => {
    // Mesmo com o Meta recusando esse token velho, a conta usa instagrapi —
    // este teste nem deveria rodar.
    oauthResponder = async () => ({ ok: true, json: async () => ({ error: { message: 'Error validating access token' } }) });

    const r = await quickCheckAndUpdate(contaInstagrapi({ healthStatus: 'ativa' }));

    expect(r.status).not.toBe('token_invalido');
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith('acc2', expect.objectContaining({ healthStatus: 'token_invalido' }));
  });

  test('o passo OAuth nem chega a chamar o Meta para conta instagrapi', async () => {
    const chamadasOAuth = [];
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('graph.instagram.com')) chamadasOAuth.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await quickCheckAndUpdate(contaInstagrapi());

    expect(chamadasOAuth).toHaveLength(0);
  });

  test('conta com instagrapiSession preenchido (sem provider explícito) também é poupada', async () => {
    oauthResponder = async () => ({ ok: true, json: async () => ({ error: { message: 'qualquer erro' } }) });

    const r = await quickCheckAndUpdate(contaInstagrapi({ provider: undefined, instagrapiSession: 'sessao-ativa' }));

    expect(r.status).not.toBe('token_invalido');
  });
});

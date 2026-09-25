'use strict';

/**
 * Conexão pela API oficial: o `state` assinado, a URL de autorização e o
 * aviso de redirect mal configurado.
 *
 * O `state` é o que impede alguém de forjar um retorno do Instagram e prender
 * uma conta dele numa conta do painel — por isso sem assinatura não passa.
 */

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
process.env.FRONTEND_URL = 'https://painel.exemplo.com';

jest.mock('../src/repos/metaApps', () => ({
  credenciais: jest.fn(async () => ({ id: 'app-uuid', appId: '123456', appSecret: 's', loginConfigId: '' })),
}));

const { signState, verifyAndStripState } = require('../src/services/csrfState');
const conexao = require('../src/services/conexao');
const metaApps = require('../src/repos/metaApps');
const { avisoDoRedirect } = require('../src/routes/oauthRoutes');

describe('state assinado', () => {
  test('ida e volta devolvem o mesmo conteúdo', () => {
    const assinado = signState('3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b__mapp_x');
    expect(verifyAndStripState(assinado)).toEqual({ valid: true, state: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b__mapp_x' });
  });

  test('cada assinatura é única (nonce), mesmo para o mesmo conteúdo', () => {
    expect(signState('new')).not.toBe(signState('new'));
  });

  test('sem assinatura, adulterado ou vazio: recusado', () => {
    const bom = signState('new__mapp_app-uuid');
    expect(verifyAndStripState('new__mapp_app-uuid').valid).toBe(false);
    expect(verifyAndStripState(bom.replace('new', 'abc')).valid).toBe(false);
    expect(verifyAndStripState(bom.slice(0, -1) + (bom.endsWith('0') ? '1' : '0')).valid).toBe(false);
    expect(verifyAndStripState('').valid).toBe(false);
    expect(verifyAndStripState(undefined).valid).toBe(false);
  });

  test('lerState separa a conta e o app', () => {
    const conta = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
    expect(conexao.lerState(signState(`${conta}__mapp_app-uuid`))).toEqual({ alvo: conta, metaAppId: 'app-uuid' });
    expect(conexao.lerState(signState('new'))).toEqual({ alvo: 'new', metaAppId: null });
    expect(conexao.lerState('new__mapp_app-uuid')).toBeNull();
  });
});

describe('URL de autorização', () => {
  test('Instagram Login com os escopos da API oficial e o redirect do painel', async () => {
    const { url, metaAppId } = await conexao.urlDeAutorizacao({ accountId: 'new' });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('123456');
    expect(u.searchParams.get('redirect_uri')).toBe('https://painel.exemplo.com/oauth-callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope').split(',')).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_insights',
    ]);
    expect(metaAppId).toBe('app-uuid');
    expect(conexao.lerState(u.searchParams.get('state'))).toEqual({ alvo: 'new', metaAppId: 'app-uuid' });
  });

  test('force_reauth ligado: a segunda conta no mesmo navegador pede login de novo', async () => {
    const { url } = await conexao.urlDeAutorizacao({});
    expect(new URL(url).searchParams.get('force_reauth')).toBe('true');
  });

  test('config_id do login da empresa entra quando cadastrado', async () => {
    metaApps.credenciais.mockResolvedValueOnce({ id: 'a', appId: '1', appSecret: 's', loginConfigId: '999' });
    const { url } = await conexao.urlDeAutorizacao({});
    expect(new URL(url).searchParams.get('config_id')).toBe('999');
  });

  test('sem app cadastrado não há URL', async () => {
    metaApps.credenciais.mockResolvedValueOnce(null);
    expect(await conexao.urlDeAutorizacao({})).toBeNull();
  });
});

describe('aviso de redirect', () => {
  test('localhost com painel público: avisa e diz o endereço certo', () => {
    const aviso = avisoDoRedirect('http://localhost:3000/oauth/callback', 'https://painel.exemplo.com/');
    expect(aviso).toContain('localhost');
    expect(aviso).toContain('https://painel.exemplo.com/oauth-callback');
    expect(aviso).not.toContain('com//oauth');
  });

  test('vazio ou inválido também avisa', () => {
    expect(avisoDoRedirect('', 'https://painel.exemplo.com')).toMatch(/não está configurado/);
    expect(avisoDoRedirect('isto não é url', 'https://painel.exemplo.com')).toMatch(/não é uma URL válida/);
  });

  test('configuração correta não gera aviso', () => {
    expect(avisoDoRedirect('https://painel.exemplo.com/oauth-callback', 'https://painel.exemplo.com')).toBeNull();
    // Em desenvolvimento, tudo em localhost é coerente.
    expect(avisoDoRedirect('http://localhost:5173/oauth-callback', 'http://localhost:5173')).toBeNull();
  });
});

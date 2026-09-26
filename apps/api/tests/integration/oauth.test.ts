import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setMetaGraph } from '../../src/integrations/meta/index.js';
import { InstagramAccount } from '../../src/modules/accounts/account.model.js';
import { openToken } from '../../src/modules/accounts/tokenVault.js';
import { hmac } from '../../src/lib/crypto.js';
import { MediaInsight } from '../../src/modules/insights/insight.models.js';
import { OAuthState } from '../../src/modules/oauth/oauthState.model.js';
import type { RealtimeHub } from '../../src/modules/realtime/events.js';
import { resetDatabases, startDatabases, stopDatabases } from '../helpers/db.js';
import { FakeMeta, metaError } from '../helpers/fakeMeta.js';
import { makeApp, signedInAgent } from '../helpers/http.js';

let app: Awaited<ReturnType<typeof makeApp>>['app'];
let hub: RealtimeHub;
let meta: FakeMeta;

beforeAll(async () => {
  await startDatabases();
  ({ app, hub } = await makeApp());
});
afterAll(async () => {
  await hub.stop();
  await stopDatabases();
});
beforeEach(async () => {
  await resetDatabases();
  meta = new FakeMeta()
    .reply('POST', /api\.instagram\.com\/oauth\/access_token/, {
      data: [{ access_token: 'IGAAshort000000000000000000000', user_id: '17841400000000999', permissions: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights' }],
    })
    .reply('GET', /graph\.instagram\.com\/access_token$/, { access_token: 'IGAAlong00000000000000000000000', token_type: 'bearer', expires_in: 5_184_000 })
    .reply('GET', /\/v25\.0\/me$/, {
      id: '999',
      user_id: '17841400000000999',
      username: 'loja_exemplo',
      name: 'Loja Exemplo',
      account_type: 'BUSINESS',
      profile_picture_url: 'https://cdn.example/p.jpg',
      followers_count: 1520,
      follows_count: 10,
      media_count: 42,
    });
  setMetaGraph(meta.client());
});
afterEach(() => setMetaGraph(undefined));

async function start(agent: request.Agent) {
  const res = await agent.post('/api/oauth/instagram/start').set('x-nexora-client', 'web').expect(200);
  return new URL(res.body.url).searchParams.get('state')!;
}

describe('OAuth do Instagram', () => {
  it('conecta a conta, cifra o token e nunca o devolve ao frontend', async () => {
    const { agent, user } = await signedInAgent(app);
    const state = await start(agent);
    const cb = await agent.get(`/api/oauth/instagram/callback?code=AQBcode%23_&state=${state}`);
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toBe('http://localhost:5173/accounts?connected=loja_exemplo');

    // O code chegou sem o sufixo #_.
    const exchange = meta.calls.find((c) => c.path.includes('oauth/access_token'))!;
    expect(exchange.params.code).toBe('AQBcode');
    expect(exchange.params.client_secret).toBe('test-app-secret');

    const doc = await InstagramAccount.findOne({ userId: new Types.ObjectId(user.id) }).select('+token').lean();
    expect(doc).toMatchObject({ igUserId: '17841400000000999', username: 'loja_exemplo', status: 'CONNECTED', followersCount: 1520 });
    expect(JSON.stringify(doc!.token)).not.toContain('IGAAlong');
    expect(openToken(doc!.token!)).toBe('IGAAlong00000000000000000000000');

    const list = await agent.get('/api/accounts');
    expect(JSON.stringify(list.body)).not.toContain('IGAA');
    expect(list.body.items[0].missingPermissions).toEqual([]);
  });

  it('callback repetido não troca o code de novo', async () => {
    const { agent } = await signedInAgent(app);
    const state = await start(agent);
    await agent.get(`/api/oauth/instagram/callback?code=AQB1&state=${state}`).expect(303);
    const second = await agent.get(`/api/oauth/instagram/callback?code=AQB1&state=${state}`);
    expect(second.headers.location).toContain('connected=loja_exemplo');
    expect(meta.count('POST', /oauth\/access_token/)).toBe(1);
  });

  it('state desconhecido ou vencido é recusado', async () => {
    const { agent } = await signedInAgent(app);
    const bad = await agent.get('/api/oauth/instagram/callback?code=x&state=inventado');
    expect(bad.headers.location).toContain('oauth_error=invalid_state');

    const state = await start(agent);
    await OAuthState.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await agent.get(`/api/oauth/instagram/callback?code=x&state=${state}`);
    expect(expired.headers.location).toContain('oauth_error=expired_state');
    expect(meta.count('POST', /oauth\/access_token/)).toBe(0);
  });

  it('o callback precisa chegar na sessão de quem iniciou (anti login-CSRF)', async () => {
    const attacker = await signedInAgent(app);
    const victim = await signedInAgent(app);
    const state = await start(attacker.agent);
    const res = await victim.agent.get(`/api/oauth/instagram/callback?code=x&state=${state}`);
    expect(res.headers.location).toContain('oauth_error=session_mismatch');
    const anonymous = await request(app).get(`/api/oauth/instagram/callback?code=x&state=${await start(attacker.agent)}`);
    expect(anonymous.headers.location).toContain('oauth_error=session_mismatch');
    expect(meta.count('POST', /oauth\/access_token/)).toBe(0);
  });

  it('usuário negou a autorização', async () => {
    const { agent } = await signedInAgent(app);
    const state = await start(agent);
    const res = await agent.get(`/api/oauth/instagram/callback?error=access_denied&state=${state}`);
    expect(res.headers.location).toContain('oauth_error=access_denied');
  });

  it('permissão obrigatória ausente não salva a conta', async () => {
    meta.reply('POST', /api\.instagram\.com\/oauth\/access_token/, {
      access_token: 'IGAAshort', user_id: 1, permissions: 'instagram_business_basic',
    });
    const { agent, user } = await signedInAgent(app);
    const res = await agent.get(`/api/oauth/instagram/callback?code=x&state=${await start(agent)}`);
    expect(res.headers.location).toContain('oauth_error=missing_permissions');
    expect(await InstagramAccount.countDocuments({ userId: new Types.ObjectId(user.id) })).toBe(0);
  });

  it('erro da Meta vira mensagem genérica, sem vazar detalhes', async () => {
    meta.reply('POST', /api\.instagram\.com\/oauth\/access_token/, metaError(100, undefined, 'code expirado'), 400);
    const { agent } = await signedInAgent(app);
    const res = await agent.get(`/api/oauth/instagram/callback?code=x&state=${await start(agent)}`);
    expect(res.headers.location).toContain('oauth_error=meta_error');
  });

  it('reconectar a mesma conta atualiza o token em vez de duplicar', async () => {
    const { agent, user } = await signedInAgent(app);
    await agent.get(`/api/oauth/instagram/callback?code=a&state=${await start(agent)}`);
    await InstagramAccount.updateOne({ userId: new Types.ObjectId(user.id) }, { $set: { status: 'EXPIRED' } });
    await agent.get(`/api/oauth/instagram/callback?code=b&state=${await start(agent)}`);
    const docs = await InstagramAccount.find({ userId: new Types.ObjectId(user.id) }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.status).toBe('CONNECTED');
  });

  it('respeita o limite de contas do plano', async () => {
    const { agent, user } = await signedInAgent(app); // plano free: 3 contas
    for (let i = 0; i < 3; i++) {
      await InstagramAccount.create({ userId: new Types.ObjectId(user.id), igUserId: `x${i}`, username: `c${i}`, status: 'CONNECTED' });
    }
    const res = await agent.get(`/api/oauth/instagram/callback?code=x&state=${await start(agent)}`);
    expect(res.headers.location).toContain('oauth_error=plan_limit');
  });

  it('desconectar remove o token', async () => {
    const { agent, user } = await signedInAgent(app);
    await agent.get(`/api/oauth/instagram/callback?code=a&state=${await start(agent)}`);
    const account = await InstagramAccount.findOne({ userId: new Types.ObjectId(user.id) }).lean();
    await agent.delete(`/api/accounts/${account!._id}`).set('x-nexora-client', 'web').expect(200);
    const after = await InstagramAccount.findOne({ userId: new Types.ObjectId(user.id) }).select('+token').lean();
    expect(after!.status).toBe('DISCONNECTED');
    expect(after!.token).toBeUndefined();
  });

  describe('callbacks de plataforma da Meta', () => {
    const signed = (payload: object, secret = 'test-app-secret') => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${hmac(secret, body)}.${body}`;
    };

    it('deauthorize apaga o token de todas as conexões daquela conta', async () => {
      const { agent, user } = await signedInAgent(app);
      await agent.get(`/api/oauth/instagram/callback?code=a&state=${await start(agent)}`);
      await request(app)
        .post('/api/oauth/instagram/deauthorize')
        .type('form')
        .send({ signed_request: signed({ algorithm: 'HMAC-SHA256', user_id: '17841400000000999' }) })
        .expect(200);
      const doc = await InstagramAccount.findOne({ userId: new Types.ObjectId(user.id) }).select('+token').lean();
      expect(doc).toMatchObject({ status: 'DISCONNECTED' });
      expect(doc!.token).toBeUndefined();
    });

    it('recusa signed_request com assinatura inválida', async () => {
      await request(app)
        .post('/api/oauth/instagram/deauthorize')
        .type('form')
        .send({ signed_request: signed({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'outro-segredo') })
        .expect(400);
    });

    it('data deletion remove métricas e devolve código de confirmação', async () => {
      const { agent, user } = await signedInAgent(app);
      await agent.get(`/api/oauth/instagram/callback?code=a&state=${await start(agent)}`);
      const account = await InstagramAccount.findOne({ userId: new Types.ObjectId(user.id) }).lean();
      await MediaInsight.create({ userId: account!.userId, accountId: account!._id, igMediaId: 'm1', metrics: {}, syncedAt: new Date() });
      const res = await request(app)
        .post('/api/oauth/instagram/data-deletion')
        .type('form')
        .send({ signed_request: signed({ algorithm: 'HMAC-SHA256', user_id: '17841400000000999' }) })
        .expect(200);
      expect(res.body.url).toMatch(/^http:\/\/localhost:5173\/privacy\/deletion\?code=/);
      expect(res.body.confirmation_code).toBeTruthy();
      expect(await MediaInsight.countDocuments({ userId: account!.userId })).toBe(0);
    });
  });
});

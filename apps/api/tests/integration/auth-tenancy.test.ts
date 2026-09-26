import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TenantScopeError } from '../../src/infra/tenantGuard.js';
import { InstagramAccount } from '../../src/modules/accounts/account.model.js';
import { Post } from '../../src/modules/posts/post.model.js';
import type { RealtimeHub } from '../../src/modules/realtime/events.js';
import { resetDatabases, startDatabases, stopDatabases } from '../helpers/db.js';
import { makeAccount, makeImageMedia } from '../helpers/factories.js';
import { makeApp, signedInAgent } from '../helpers/http.js';

let app: Awaited<ReturnType<typeof makeApp>>['app'];
let hub: RealtimeHub;

beforeAll(async () => {
  await startDatabases();
  ({ app, hub } = await makeApp());
});
afterAll(async () => {
  await hub.stop();
  await stopDatabases();
});
beforeEach(resetDatabases);

describe('autenticação', () => {
  it('cadastro, sessão, me e logout', async () => {
    const { agent } = await signedInAgent(app, 'ana@test.local');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'ana@test.local', plan: 'free' });
    expect(me.body.user.passwordHash).toBeUndefined();

    await agent.post('/api/auth/logout').set('x-nexora-client', 'web').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('cookie de sessão é httpOnly e SameSite=Lax', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('x-nexora-client', 'web')
      .send({ name: 'Bia', email: 'bia@test.local', password: 'senha-super-segura' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('login errado não revela se o e-mail existe', async () => {
    await signedInAgent(app, 'caio@test.local');
    const wrongPass = await request(app).post('/api/auth/login').set('x-nexora-client', 'web').send({ email: 'caio@test.local', password: 'xxxxxxxxxxxx' });
    const noUser = await request(app).post('/api/auth/login').set('x-nexora-client', 'web').send({ email: 'ninguem@test.local', password: 'xxxxxxxxxxxx' });
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPass.body.error.message).toBe(noUser.body.error.message);
  });

  it('e-mail duplicado', async () => {
    await signedInAgent(app, 'dup@test.local');
    const res = await request(app).post('/api/auth/signup').set('x-nexora-client', 'web').send({ name: 'Dup', email: 'dup@test.local', password: 'senha-super-segura' });
    expect(res.status).toBe(409);
  });

  it('escrita sem o header do cliente ou de outra origem é recusada (CSRF)', async () => {
    const { agent } = await signedInAgent(app);
    await agent.post('/api/auth/logout').expect(403);
    await agent.post('/api/auth/logout').set('x-nexora-client', 'web').set('origin', 'https://malicioso.example').expect(403);
  });

  it('rotas protegidas exigem sessão', async () => {
    await request(app).get('/api/accounts').expect(401);
    await request(app).get('/api/dashboard').expect(401);
  });
});

describe('isolamento entre clientes (multi-tenant)', () => {
  it('um usuário não enxerga nem altera dados de outro', async () => {
    const a = await signedInAgent(app);
    const b = await signedInAgent(app);
    const accountB = await makeAccount(new Types.ObjectId(b.user.id));
    const mediaB = await makeImageMedia(new Types.ObjectId(b.user.id));

    const listA = await a.agent.get('/api/accounts');
    expect(listA.body.items).toEqual([]);
    await a.agent.get(`/api/accounts/${accountB._id}`).expect(404);
    await a.agent.delete(`/api/accounts/${accountB._id}`).set('x-nexora-client', 'web').expect(404);
    await a.agent.get(`/api/media/${mediaB._id}`).expect(404);
    await a.agent.get(`/api/media/${mediaB._id}/file`).expect(404);

    // Tentar publicar com a conta e a mídia de outro usuário.
    const post = await a.agent
      .post('/api/posts')
      .set('x-nexora-client', 'web')
      .send({ content: { type: 'IMAGE', caption: 'x', mediaIds: [mediaB._id.toString()] }, accountIds: [accountB._id.toString()], schedule: { mode: 'now' } });
    expect(post.status).toBe(404);
    expect(await Post.countDocuments({ userId: new Types.ObjectId(a.user.id) })).toBe(0);

    const listB = await b.agent.get('/api/accounts');
    expect(listB.body.items).toHaveLength(1);
    expect(listB.body.items[0].token).toBeUndefined();
  });

  it('consulta sem userId é bloqueada pelo tenant guard', async () => {
    await expect(InstagramAccount.find({ username: 'x' })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(InstagramAccount.updateMany({}, { $set: { status: 'ERROR' } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(InstagramAccount.find({}).setOptions({ crossTenant: true })).resolves.toEqual([]);
  });
});

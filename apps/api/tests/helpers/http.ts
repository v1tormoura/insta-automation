import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { RealtimeHub } from '../../src/modules/realtime/events.js';

export async function makeApp() {
  const hub = new RealtimeHub();
  await hub.start();
  return { app: createApp({ hub }), hub };
}

/** Agente com cookie de sessão e o header de cliente exigido nas escritas. */
export async function signedInAgent(app: Parameters<typeof request.agent>[0], email?: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/signup')
    .set('x-nexora-client', 'web')
    .send({ name: 'Teste', email: email ?? `u${Date.now()}${Math.random().toString(16).slice(2)}@test.local`, password: 'senha-super-segura' });
  if (res.status !== 201) throw new Error(`signup falhou: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  return { agent, cookie, user: res.body.user as { id: string } };
}

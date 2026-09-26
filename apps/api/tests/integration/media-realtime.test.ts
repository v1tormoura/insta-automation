import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Media } from '../../src/modules/media/media.model.js';
import { signedMediaUrl } from '../../src/modules/media/publicUrl.js';
import { notify } from '../../src/modules/notifications/notification.service.js';
import type { RealtimeHub } from '../../src/modules/realtime/events.js';
import { resetDatabases, startDatabases, stopDatabases } from '../helpers/db.js';
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

const png = () => sharp({ create: { width: 1200, height: 1200, channels: 4, background: '#f0a' } }).png().toBuffer();

describe('biblioteca de mídia', () => {
  it('converte PNG para JPEG, gera miniatura e deduplica', async () => {
    const { agent } = await signedInAgent(app);
    const file = await png();
    const up = await agent.post('/api/media').set('x-nexora-client', 'web').attach('file', file, 'arte.png');
    expect(up.status).toBe(201);
    expect(up.body.media).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', width: 1200, height: 1200, originalName: 'arte.png' });

    const preview = await agent.get(up.body.media.previewUrl);
    expect(preview.headers['content-type']).toContain('image/jpeg');
    const thumb = await agent.get(up.body.media.thumbnailUrl);
    expect(thumb.headers['content-type']).toContain('image/webp');

    const again = await agent.post('/api/media').set('x-nexora-client', 'web').attach('file', file, 'copia.png');
    expect(again.body.media.id).toBe(up.body.media.id);
  });

  it('recusa arquivo que não é mídia, mesmo com extensão de imagem', async () => {
    const { agent } = await signedInAgent(app);
    const res = await agent.post('/api/media').set('x-nexora-client', 'web').attach('file', Buffer.from('<script>alert(1)</script>'), 'x.jpg');
    expect(res.status).toBe(400);
  });

  it('URL pública assinada entrega o arquivo; sem assinatura válida, 404', async () => {
    const { agent, user } = await signedInAgent(app);
    const up = await agent.post('/api/media').set('x-nexora-client', 'web').attach('file', await png(), 'a.png');
    const url = new URL(signedMediaUrl(up.body.media.id, 'original', 'a.jpg'));
    const ok = await request(app).get(url.pathname);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/jpeg');
    await request(app).get(url.pathname.replace(/\/original\//, '/thumb/')).expect(404);

    await agent.delete(`/api/media/${up.body.media.id}`).set('x-nexora-client', 'web').expect(204);
    await request(app).get(url.pathname).expect(404);
    expect(await Media.countDocuments({ userId: new Types.ObjectId(user.id), deletedAt: null })).toBe(0);
  });
});

describe('tempo real (SSE)', () => {
  it('entrega eventos só para o dono', async () => {
    const owner = await signedInAgent(app);
    const other = await signedInAgent(app);
    const server = http.createServer(app).listen(0);
    const port = (server.address() as AddressInfo).port;

    const listen = (cookie: string) =>
      new Promise<string>((resolve) => {
        let buffer = '';
        const req = http.get({ port, path: '/api/events', headers: { cookie } }, (res) => {
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            if (buffer.includes('event: notification.created')) {
              req.destroy();
              resolve(buffer);
            }
          });
        });
        setTimeout(() => {
          req.destroy();
          resolve(buffer);
        }, 1500);
      });

    const ownerStream = listen(owner.cookie);
    const otherStream = listen(other.cookie);
    await new Promise((r) => setTimeout(r, 200));
    await notify(new Types.ObjectId(owner.user.id), { kind: 'account.connected', level: 'success', title: 'olá' });

    expect(await ownerStream).toContain('"title":"olá"');
    expect(await otherStream).not.toContain('olá');
    server.close();
  });
});

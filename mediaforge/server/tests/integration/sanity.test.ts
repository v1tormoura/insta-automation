import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '../helpers/client';
import { fx } from '../helpers/fixtures';
import { frameMd5, sha256, tmpFile } from '../helpers/media';
import { startServer, type TestServer } from '../helpers/server';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => srv?.close());

it('importa e processa um vídeo de ponta a ponta', async () => {
  const c = new Client(srv.base);
  const [a] = await c.importOk(fx('plain.mp4'));
  const [job] = await c.processOk(a!.id, { mode: 'quick' });
  expect(job!.report?.strategy).toBe('stream-copy');
  expect(job!.validationStatus).toBe('passed');
  // O resultado baixado é o anunciado (SHA-256) e tem exatamente os mesmos quadros da fonte.
  const r = await c.download(job!.output!.downloadUrl);
  expect(r.status).toBe(200);
  expect(sha256(r.body)).toBe(job!.output!.sha256);
  expect(frameMd5(tmpFile(r.body, 'mp4'))).toBe(frameMd5(fx('plain.mp4')));
});

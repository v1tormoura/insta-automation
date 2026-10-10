import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '../helpers/client';
import { fx } from '../helpers/fixtures';
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
});

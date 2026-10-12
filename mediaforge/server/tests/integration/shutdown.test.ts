import { describe, expect, it } from 'vitest';
import { acquireDataDirLock } from '../../src/services/dataDirLock';
import { startServer } from '../helpers/server';

describe('encerramento ordenado', () => {
  it('com uma aba aberta (SSE conectado), stop() termina rápido e libera banco e bloqueio do DATA_DIR', async () => {
    const srv = await startServer();
    // Uma "aba aberta": cria a sessão e mantém o fluxo de eventos conectado.
    const first = await fetch(`${srv.base}/api/session`);
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!;
    const sse = await fetch(`${srv.base}/api/events`, { headers: { cookie } });
    expect(sse.status).toBe(200);
    const reader = sse.body!.getReader();
    const firstChunk = new TextDecoder().decode((await reader.read()).value);
    expect(firstChunk).toMatch(/retry: 3000/);

    const t0 = performance.now();
    await srv.close({ keepData: true });
    const elapsed = performance.now() - t0;
    expect(elapsed, `stop() levou ${Math.round(elapsed)} ms`).toBeLessThan(3000);

    // O fluxo do navegador foi encerrado pelo servidor (o EventSource reconecta depois).
    let done = false;
    for (let i = 0; i < 5 && !done; i++) done = (await reader.read().catch(() => ({ done: true }))).done;
    expect(done).toBe(true);

    // O bloqueio foi liberado: outra instância pode usar o mesmo diretório.
    const lock = acquireDataDirLock(srv.dataDir);
    lock.release();
  }, 30_000);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import '../../src/silenceSqliteWarning';
import { buildApp, type MediaForgeApp } from '../../src/app';
import { loadConfig } from '../../src/config';

export interface TestServer {
  mf: MediaForgeApp;
  base: string;
  dataDir: string;
  /** Encerra o servidor (fila incluída). `keepData` preserva o diretório para testes de recuperação. */
  close(opts?: { keepData?: boolean }): Promise<void>;
}

/**
 * Sobe uma instância real do MediaForge (FFmpeg de verdade) numa porta livre,
 * com diretório de dados temporário e isolado.
 */
export async function startServer(
  overrides: Record<string, string | number | boolean> = {},
  opts: { dataDir?: string; startQueue?: boolean } = {},
): Promise<TestServer> {
  process.env.MEDIAFORGE_SKIP_ENV_FILE = '1';
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mediaforge-test-'));
  const config = loadConfig({
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    SERVE_WEB: false,
    MIN_FREE_MEMORY_MB: 0,
    DEFAULT_CONCURRENCY: 2,
    MAX_CONCURRENCY: 4,
    ...overrides,
  });
  const mf = await buildApp(config, { logger: false });
  if (opts.startQueue === false) {
    await mf.ctx.tools.detect();
  } else {
    await mf.start();
  }
  await mf.app.listen({ host: '127.0.0.1', port: 0 });
  const port = (mf.app.server.address() as AddressInfo).port;
  return {
    mf,
    base: `http://127.0.0.1:${port}`,
    dataDir,
    async close(o = {}) {
      await mf.stop();
      if (!o.keepData) fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

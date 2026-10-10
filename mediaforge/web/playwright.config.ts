import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5320);
const DATA_DIR = path.join(os.tmpdir(), `mediaforge-e2e-${process.pid}`);

/**
 * Testes de ponta a ponta: o servidor real (FFmpeg de verdade) serve o build da
 * interface; o navegador importa mídias, processa, baixa e confere os relatórios.
 * Navegador: `npx playwright install chromium` (uma vez) se ainda não houver.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/globalSetup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
  webServer: {
    command: 'npm run build && node --import tsx ../server/src/index.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      SERVE_WEB: 'true',
      LOG_LEVEL: 'warn',
      MEDIAFORGE_SKIP_ENV_FILE: '1',
      MIN_FREE_MEMORY_MB: '0',
      DEFAULT_CONCURRENCY: '2',
      MAX_CONCURRENCY: '4',
    },
  },
});

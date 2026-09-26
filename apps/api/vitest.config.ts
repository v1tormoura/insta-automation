import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Os testes de integração compartilham um mongod/redis por arquivo.
    fileParallelism: false,
  },
});

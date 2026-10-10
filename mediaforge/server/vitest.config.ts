import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Testes de integração disputam CPU com o FFmpeg: arquivos em sequência.
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
  },
});

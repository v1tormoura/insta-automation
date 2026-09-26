import { defineConfig } from 'tsup';

// Um bundle por processo (API e worker). O pacote compartilhado entra no
// bundle; o resto de node_modules fica externo e vem do `npm ci` da imagem.
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: ['@nexora/shared'],
});

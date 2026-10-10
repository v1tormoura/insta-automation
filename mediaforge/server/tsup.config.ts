import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', doctor: 'src/doctor.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // O pacote compartilhado é TypeScript puro do workspace: entra no bundle.
  noExternal: ['@mediaforge/shared'],
});

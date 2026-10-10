import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.MEDIAFORGE_API ?? 'http://127.0.0.1:5310';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5311,
    strictPort: true,
    // Sem changeOrigin: o servidor confere Origin × Host para recusar requisições de outros sites.
    proxy: { '/api': { target: API, changeOrigin: false, ws: false } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});

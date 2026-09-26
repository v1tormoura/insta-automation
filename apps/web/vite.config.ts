import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_DEV_API ?? 'http://localhost:4000';

// Em dev o Vite faz proxy da API: frontend e backend ficam na mesma origem,
// então o cookie de sessão funciona sem CORS (igual à produção via nginx).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/public': { target: API, changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});

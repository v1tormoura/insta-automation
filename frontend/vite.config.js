import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins:[
    react(),
    tailwindcss(),
    mkcert(),
  ],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    strictPort: false,
    host: true,
    https: process.env.DISABLE_HTTPS !== 'true',
  }
})

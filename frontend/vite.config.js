import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    rolldownOptions: {
      output: {
        /* Bibliotecas em arquivos próprios: mudam raramente, então o
           navegador as guarda em cache entre um deploy e outro e só baixa de
           novo o código do painel. */
        codeSplitting: {
          groups: [
            /* clsx é usada pelo painel E pelo recharts: sem grupo próprio ela
               cairia em "graficos" e a tela inicial baixaria os gráficos. */
            { name: 'utils', test: /node_modules[\\/](clsx|tailwind-merge)[\\/]/, priority: 30 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 20 },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 15 },
            { name: 'graficos', test: /node_modules[\\/](recharts|d3-[^/\\]+|victory-vendor|recharts-scale|lodash)[\\/]/, priority: 15 },
          ],
        },
      },
    },
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    strictPort: false,
    host: true,
  },
})

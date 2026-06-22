# Insta Automation — Frontend

Dashboard web para gerenciamento de automacao de contas no Instagram.

## Tecnologias

- React 19 + Vite
- React Router DOM
- Server-Sent Events (SSE) para atualizacoes em tempo real

## Pre-requisitos

- Node.js 18+
- Backend rodando em `http://localhost:3000` (veja `../backend/`)

## Como rodar

```bash
cd frontend
npm install
npm run dev
```

O app abre em `http://localhost:5173`.

## Scripts disponiveis

| Comando | Descricao |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com HMR |
| `npm run build` | Build de producao em `dist/` |
| `npm run preview` | Pre-visualizacao do build |
| `npm run lint` | Verificacao de codigo com ESLint |

## Estrutura

```
src/
├── components/   # Componentes reutilizaveis (Header, Sidebar, Cards)
├── layouts/      # MainLayout com navegacao
├── pages/        # Uma pagina por rota (Dashboard, Accounts, Posts...)
└── services/     # Cliente HTTP (api.js) e hook SSE (useServerEvents.js)
```

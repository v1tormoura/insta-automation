# Nexora

SaaS de gestão e publicação para contas profissionais do Instagram, construído **exclusivamente sobre as APIs oficiais da Meta** (Instagram API with Instagram Login).

Sem senha do Instagram, sem cookies, sem automação de navegador, sem API privada. As contas são conectadas por OAuth oficial, publicam pela Content Publishing API e as métricas vêm da Insights API.

## O que o produto faz

| Área | Funcionalidades |
|---|---|
| **Conta no SaaS** | Cadastro, login por sessão segura, perfil, fuso horário, "sair de todos os dispositivos". Estrutura de planos com limites por usuário. |
| **Contas do Instagram** (`/accounts`) | Conectar uma ou várias contas via OAuth; avatar, @, nome, seguidores, posts, última sincronização, status (`CONNECTED`, `SYNCING`, `EXPIRED`, `ERROR`, `DISCONNECTED`), permissões concedidas, cota de 24h; sincronizar, pausar, intervalo mínimo por conta, reautorizar e desconectar. |
| **Publicação** (`/compose`) | Foto, carrossel (2–10 itens), Reel (capa por imagem própria ou quadro do vídeo, "mostrar no feed") e Story. Upload com progresso, biblioteca de mídia, legenda com contadores de caracteres/hashtags/menções, uma ou várias contas, intervalo entre contas, publicar agora, agendar ou salvar rascunho. |
| **Filas de publicação** (`/campaigns`) | N conteúdos × M contas, com intervalo entre conteúdos e entre contas, linha do tempo prévia, pausar, retomar e cancelar. |
| **Acompanhamento** (`/queue`, `/history`, `/posts/:id`) | Progresso em tempo real por conta (SSE), motivo de espera, erros traduzidos, tentar de novo, publicar agora, cancelar; histórico filtrável. |
| **Métricas** (`/insights`) | Alcance, visualizações, contas engajadas, interações e engajamento por período; série diária de alcance; evolução de seguidores; desempenho por publicação. Métricas que a Meta não entrega para a conta aparecem como indisponíveis, com o motivo. |
| **Notificações** | Sucesso, falha, conclusão de post/fila, conta expirada — no sino (tempo real), toast e página própria. |
| **Dashboard** (`/`) | Contas, seguidores, agendadas, publicadas hoje, taxa de sucesso, publicações por dia, próximas publicações, atividade recente e saúde/cota das contas. |

## Arquitetura em uma imagem

```
 navegador ──HTTPS──▶ nginx (apps/web) ──/api, /public──▶ API (Express)  ──▶ MongoDB  (fonte da verdade)
      ▲                                                     │    ▲
      └──────────── SSE /api/events ◀── Redis pub/sub ◀─────┘    │
                                                                 │
                                   BullMQ (Redis) ◀──enfileira───┘
                                        │
                                        ▼
                             workers (1..N réplicas) ──▶ graph.instagram.com (Meta)
                                        ▲                        │
                                        └── baixa a mídia de /public/media/<assinada> ◀┘
```

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Estrutura do repositório

```
apps/
  api/        Backend (Node 22, TypeScript, Express 5, Mongoose, BullMQ). Processos: server.ts e worker.ts
  web/        Frontend (React 19, TypeScript, Vite, Tailwind v4, Radix/shadcn, TanStack Query)
packages/
  shared/     Tipos, enums, limites da Meta, schemas zod e o planner de horários — usados pelos dois lados
docs/         Arquitetura e configuração do app da Meta
```

## Rodando

### Com Docker (recomendado)

```bash
cp .env.example .env          # gere as chaves e preencha a integração da Meta
docker compose up -d --build  # mongo, redis, api, worker, web
open http://localhost:8080
```

Para produção, ponha um proxy com TLS na frente da porta 8080 (Caddy, Traefik, Cloudflare). A Meta exige HTTPS no redirect do OAuth e precisa baixar as mídias por uma URL pública (`API_PUBLIC_URL`). Workers escalam com `docker compose up -d --scale worker=3`.

### Desenvolvimento local

Pré-requisitos: Node 22.12+, MongoDB 7+ e Redis 7 rodando localmente (ffmpeg opcional — sem ele vídeos ficam sem duração/miniatura na biblioteca, e a Meta continua validando).

```bash
npm install
cp .env.example .env   # descomente MONGO_URI, REDIS_URL, STORAGE_DIR e PORT; APP_URL=http://localhost:5173 e API_PUBLIC_URL=http://localhost:4000
npm run dev --workspace @nexora/api         # API em :4000
npm run dev:worker --workspace @nexora/api  # workers
npm run dev --workspace @nexora/web         # painel em :5173 (proxy de /api para :4000)
```

Para ver a interface com dados fictícios: `npm run seed:demo --workspace @nexora/api` e entre com `demo@nexora.dev` / `demo-nexora-123`. As contas do seed não têm token válido — nada publica de verdade.

> Publicar de verdade em desenvolvimento exige que a Meta alcance sua máquina: exponha a API com um túnel HTTPS (ngrok, Cloudflare Tunnel) e use a URL do túnel em `API_PUBLIC_URL` e no redirect URI do app.

### Configurar o app da Meta

Passo a passo em [`docs/META_SETUP.md`](docs/META_SETUP.md): criação do app, produto Instagram, redirect URI, callbacks de desautorização e exclusão de dados, permissões e App Review.

## Testes e qualidade

```bash
npm run typecheck   # os três pacotes
npm test            # shared + api (unitários e integração) + web
npm run build
```

Os testes de integração da API sobem um MongoDB real (`mongodb-memory-server`) e usam Redis real (`REDIS_URL`, banco 15 por padrão), com uma Graph API falsa para exercitar: OAuth (state, sessão, callback repetido, permissões, limite do plano), isolamento entre clientes, a máquina de estados de publicação (processamento de vídeo, carrossel, lock por conta, limite por plano, intervalo mínimo, token revogado, retry, rate limit, resposta perdida do `media_publish`, cancelamento), filas, upload de mídia, SSE e a fila real do BullMQ ponta a ponta. Onde o download do binário do Mongo é bloqueado, aponte `MONGOMS_SYSTEM_BINARY` para um `mongod` local.

## Segurança

- **OAuth:** `state` aleatório (256 bits), guardado só como hash, válido por 10 min, consumido atomicamente uma única vez e amarrado à sessão de quem iniciou — protege contra CSRF, replay e callback duplicado. O `code` é trocado no backend; o frontend nunca recebe token.
- **Tokens da Meta:** cifrados com AES-256-GCM (chave fora do banco, com suporte a rotação), nunca selecionados por padrão, nunca serializados em DTO, e removidos em desconexão, desautorização ou pedido de exclusão.
- **Sessão:** token opaco em cookie `httpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção; só o hash fica no banco. Escritas exigem o header `X-Nexora-Client` e origem permitida (CSRF). Senhas com scrypt.
- **Multi-tenant:** todo model de cliente tem um guard que **recusa** consulta sem `userId`; rotinas de sistema precisam declarar `crossTenant` explicitamente.
- **Logs:** tokens, `code`, `client_secret` e cookies são removidos de logs, mensagens de erro e query strings.
- **Mídias públicas:** a Meta baixa as mídias por URLs com assinatura HMAC e validade; a biblioteca não fica exposta.
- **Limites:** rate limit de login/cadastro e da API por usuário no Redis; limites de plano (contas, pendências, paralelismo, armazenamento).

## O que a API oficial não permite (e como o produto trata)

O produto não implementa atalhos não oficiais. Quando algo não existe na API, a interface diz isso claramente.

- **Só contas profissionais** (Empresa ou Criador). Contas pessoais não podem ser conectadas.
- **Stories pela API** não levam legenda, figurinhas, links, enquetes ou música. O editor avisa e não envia legenda.
- **Capa** só existe para Reels (`cover_url` ou `thumb_offset`). Foto, carrossel e story não têm capa pela API.
- **Limite de publicações:** a Meta limita publicações via API por conta numa janela de 24h (hoje 100, consultado em `content_publishing_limit`). A fila espera a cota liberar sozinha, sem falhar.
- **Mídia por URL pública:** a API não aceita upload direto; o servidor precisa estar acessível pela internet via HTTPS.
- **Formatos:** fotos só em JPEG (o servidor converte PNG/WebP), proporção do feed entre 4:5 e 1.91:1; vídeos MP4/MOV (H.264/HEVC + AAC).
- **Métricas:** algumas só existem para contas com 100+ seguidores, várias foram descontinuadas pela Meta (ex.: `impressions`, `plays` → `views`), e há atraso de consolidação. Métrica indisponível aparece como "—" com o motivo.
- **Sem agendamento nativo na Meta:** o agendamento é feito pelo Nexora; a publicação acontece no horário pelos workers.
- **Token de 60 dias:** renovado automaticamente; se a pessoa revogar o acesso no Instagram, a conta vira `EXPIRED` e basta reconectar.

## Fora do escopo desta versão

Deliberadamente não implementado agora, com a arquitetura pronta para receber: cobrança dos planos, armazenamento em S3/R2 (a interface `FileStorage` já isola isso), webhooks da Meta, comentários e mensagens, colaboração em equipe (workspaces).

## Histórico

Esta versão substitui a implementação anterior (JavaScript, com instagrapi, Puppeteer, sessões e proxies), que não segue a regra de usar apenas APIs oficiais. O código antigo continua no histórico do Git, no commit `6ef2c30`.

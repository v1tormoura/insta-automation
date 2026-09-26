# Arquitetura

## Processos

| Processo | Entrada | Responsabilidade |
|---|---|---|
| **API** | `apps/api/src/server.ts` | HTTP (Express 5): autenticação, OAuth, CRUD, upload, SSE, URLs públicas assinadas de mídia. Nunca fala com a Meta para publicar. |
| **Workers** | `apps/api/src/worker.ts` | Filas BullMQ `publish`, `sync` e `maintenance`. Podem rodar em N réplicas. |
| **Web** | `apps/web` | SPA React servida por nginx, que também faz proxy de `/api` e `/public` para a API (mesma origem). |
| **MongoDB** | — | Fonte da verdade de tudo: usuários, contas, posts, jobs, filas, métricas, notificações. |
| **Redis** | — | BullMQ, locks por conta, vagas por cliente, rate limit HTTP, cache de insights e pub/sub dos eventos em tempo real. |

## Camadas do backend

```
http/            app, middlewares (sessão, CSRF/origem, rate limit, erros), validação zod
modules/<área>/  *.routes.ts  → só HTTP: parse da entrada, chama o service, devolve DTO
                 *.service.ts → regras de negócio
                 *.model.ts   → schema Mongoose (com tenant guard)
integrations/meta/  cliente da Graph API, OAuth, publicação, insights e classificação de erros
queue/           definição das filas e locks distribuídos
workers/         processadores das filas (publicação, sincronização, manutenção)
```

Nenhuma rota fala com o banco diretamente, e nenhum componente React contém regra de negócio: o frontend chama hooks (`features/*/api.ts`) e as regras do editor ficam em funções puras (`features/compose/contentState.ts`). O que precisa valer nos dois lados — enums, limites da Meta, validação de conteúdo, planner de horários — mora em `packages/shared`.

## Multi-tenant

- Todo documento de cliente carrega `userId`.
- O plugin `tenantGuard` (em `infra/tenantGuard.ts`) intercepta `find*`, `update*`, `delete*`, `count*` e `aggregate` e **lança erro** se o filtro não tiver `userId`. Esquecer o escopo vira falha imediata em teste, não vazamento em produção.
- Rotinas de sistema que atravessam clientes (varredura de recuperação, renovação de tokens, rota pública de mídia) declaram `setOptions({ crossTenant: true })` — explícito e fácil de auditar com `grep`.
- Limites por plano (`packages/shared/src/limits.ts`): contas conectadas, publicações pendentes, publicações simultâneas e armazenamento.

## Publicação

### Modelo

- **Post** — um conteúdo (tipo, mídias, legenda, capa) e as contas de destino.
- **PublishJob** — um post em **uma** conta. É a unidade executada pela fila.
- **Campaign** (fila de publicação) — agrupa N posts × M contas com horários calculados por `planSchedule`:

  ```
  runAt(conteúdo i, conta j) = início + i · intervalo + j · espaçamento
  ```

O status de post e fila é sempre **derivado** da contagem de jobs (`modules/publishing/aggregate.ts`), nunca mantido à mão.

### Máquina de estados do PublishJob

```
SCHEDULED ──(horário)──▶ QUEUED ──(portões ok)──▶ CREATING ──▶ PROCESSING ──▶ PUBLISHING ──▶ PUBLISHED
                           ▲  │                        │            │  ▲             │
                           │  └── espera: lock da      │            │  └ polling do  │
                           │      conta, vaga do plano,│            │    status_code │
                           │      intervalo mínimo,    │            │                │
                           │      cota de 24h          ▼            ▼                ▼
                           └──────────── erro retentável sem container ────────  FAILED / CANCELED
```

Cada passo grava o progresso (ids de container, status) **antes** do próximo. O executor (`modules/publishing/publishExecutor.ts`) é retomável: se o worker morrer, o job volta e continua do ponto salvo.

1. **Portões** (só antes de criar o container):
   - **lock da conta** (`lock:account:<id>`, re-entrante para o mesmo job): uma conta publica uma coisa por vez;
   - **vaga do cliente** (sorted set com expiração de membros antigos): respeita `maxConcurrentPublishes` do plano;
   - **intervalo mínimo** configurável por conta;
   - **cota da Meta** (`content_publishing_limit`, consultada no máximo a cada 10 min).
2. **CREATING** — cria o(s) container(s): `image_url`, `video_url` + `media_type=REELS` (`cover_url`/`thumb_offset`/`share_to_feed`), `STORIES`, ou itens `is_carousel_item` + container `CAROUSEL` (criado só quando todos os itens terminam de processar).
3. **PROCESSING** — consulta `status_code` (`IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`, `PUBLISHED`) com intervalo crescente para vídeo; desiste após 45 min.
4. **PUBLISHING** — `media_publish`. Proteção contra duplicidade: se uma tentativa anterior pode ter chamado o endpoint, o status do container é conferido antes; se a resposta se perdeu (rede/5xx) e o container está `PUBLISHED`, a mídia é localizada pela data e legenda em vez de publicar de novo.
5. **PUBLISHED** — busca o `permalink`, atualiza `lastPublishedAt` e a cota local, recalcula o post, notifica.

### Esperas não ocupam o worker

Toda espera (lock ocupado, vaga do plano, intervalo, cota, processamento de vídeo, rate limit) é feita com `job.moveToDelayed()` + `DelayedError`: o job sai do slot e volta depois. Um worker com concorrência 20 atende 20 contas diferentes; uma conta travada, lenta ou bloqueada não segura as outras.

### Política de erro

Erros da Graph API são classificados em `integrations/meta/errors.ts` (códigos `190`, `10`/`2xx`, `4`/`17`/`32`/`613`/`80002`, `9007`, subcódigos `2207xxx`) e decididos em `decideFailure`:

| Categoria | Exemplos | O que acontece |
|---|---|---|
| `auth` | token expirado/revogado (190) | job falha, conta → `EXPIRED`, notificação para reconectar |
| `permission`, `account` | permissão ausente, conta restrita (2207050/51) | job falha, conta → `ERROR` com o motivo |
| `rate_limit`, `publish_limit` | 4, 17, 80002, 2207042 | espera o tempo indicado pela Meta (headers de uso) **sem gastar tentativa**; teto de 40 esperas |
| `not_ready` | 9007 / 2207027 | volta para `PROCESSING` e consulta de novo |
| `media` retentável, `transient` | download da mídia, 5xx, rede, resposta que não veio da Graph API | até 5 tentativas com backoff exponencial (máx. 30 min) |
| `media` definitiva, `invalid_request` | formato/proporção inválidos | falha imediata, mensagem em português com o subcódigo |

### Recuperação

A cada 2 minutos, `sweep.recovery` procura jobs vencidos (`SCHEDULED`/`QUEUED` com horário passado, ou em andamento parados há 20 min) que não estejam na fila do BullMQ e os recoloca. Perder o Redis atrasa publicações; não as perde. O `jobId` do BullMQ é o id do PublishJob, então reenfileirar é idempotente.

## Sincronização

Fila `sync`, um job por (tipo, conta), com `jobId` determinístico para não empilhar:

- `account.profile` — perfil e snapshot diário de seguidores (base do gráfico de evolução);
- `account.quota` — cota de publicação;
- `account.media-insights` — últimas 25 mídias e suas métricas;
- `account.token-refresh` — renova o token de longa duração (`ig_refresh_token`) quando faltam menos de 15 dias.

As varreduras `sweep.sync` (6h, espalhada em 30 min) e `sweep.token-refresh` (6h) alimentam essa fila. Métricas de conta por período são consultadas sob demanda e ficam 1h em cache. Métricas que a Meta recusa são reconsultadas uma a uma para isolar a indisponível; erros que não são de métrica (token, rede, rate limit) não são mascarados como "indisponível".

## Tempo real

Workers e API publicam eventos (`job.updated`, `post.updated`, `campaign.updated`, `account.updated`, `notification.created`) no canal Redis `nexora:events`. Cada instância da API assina o canal e repassa ao SSE (`GET /api/events`) apenas as conexões do dono do evento. O frontend aplica o evento direto no cache do TanStack Query e invalida agregados em lote; ao reconectar, recarrega tudo.

## Coleções

| Coleção | Conteúdo |
|---|---|
| `users`, `sessions` | conta do SaaS, plano, sessões (hash do token, TTL) |
| `oauthstates` | `state` do OAuth (hash, dono, validade, resultado) |
| `instagram_accounts` | conexão: ids, perfil, status, permissões, token cifrado, cota, configurações |
| `media` | biblioteca: tipo, dimensões, duração, chave de armazenamento, checksum |
| `posts`, `publish_jobs`, `campaigns` | conteúdo, execução por conta, filas |
| `notifications` | avisos com chave de deduplicação (TTL 90 dias) |
| `account_snapshots`, `media_insights` | histórico de seguidores e métricas das mídias |

## Escala

- **API** é stateless (sessão no Mongo, eventos via Redis): escala horizontal atrás de balanceador.
- **Workers** escalam horizontalmente; isolamento por conta e limites por cliente vivem no Redis.
- **Armazenamento** local via volume hoje; a interface `FileStorage` permite trocar por S3/R2 (com URLs pré-assinadas no lugar da rota `/public/media`).

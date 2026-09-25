# Insta Automation

Painel para publicar e acompanhar várias contas do Instagram pela **API oficial
da Meta** (API do Instagram com login do Instagram).

- **Postar** — reels, fotos e stories em lote para várias contas, com
  intervalo, agendamento, ordem das mídias, marca d'água, capa por perfil e
  comentário fixado.
- **Loop** — republica uma lista de mídias em ciclo.
- **Stories** — imagem ou vídeo 9:16, com texto queimado na imagem.
- **Campanhas** — plano conta × conteúdo com legendas e comentários por nível,
  prévia, pausa, retomada e reprocessamento individual.
- **Métricas** — alcance, visualizações, público e ranking por conta e por post.
- **Contas** — conexão por OAuth, saúde do token e renovação automática.

## Estrutura

```
backend/    API Node (Express) + fila de publicação, num processo só
  src/db/         conexão com o Postgres e migrações (aplicadas na subida)
  src/queue/      fila de trabalhos no próprio Postgres
  src/worker.js   execução das publicações
frontend/   painel React (Vite)
DEPLOY.md   passo a passo: Supabase + VPS (Docker, HTTPS automático)
```

Banco: Postgres (Supabase). Sem Redis, sem Mongo: a fila é uma tabela.

## Rodar

Veja [DEPLOY.md](DEPLOY.md) — produção e desenvolvimento local.

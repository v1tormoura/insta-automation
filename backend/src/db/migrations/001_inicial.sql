-- Esquema inicial da versão enxuta: só a API oficial do Instagram.
--
-- Convenções:
--   * ids são uuid; as colunas são snake_case e o cliente as entrega em camelCase.
--   * updated_at é mantido pelo gatilho set_updated_at, nunca pela aplicação.
--   * listas de contas (account_ids) são uuid[]: são lidas sempre inteiras e
--     nenhuma consulta precisa juntar por elas.
--   * configurações compostas (marca d'água, trilha, legenda aleatória…) são
--     jsonb com as chaves em camelCase, do jeito que o painel as envia.

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── Usuário do painel (um só: o dono) ────────────────────────────────────────
create table usuarios (
  id               uuid primary key default gen_random_uuid(),
  chave            text not null unique default 'principal',
  nome             text not null default '',
  email            text not null default '',
  avatar           text not null default '',
  senha_hash       text not null default '',
  senha_trocada_em timestamptz,
  preferencias     jsonb not null default '{"tema":"escuro","idioma":"pt","fundoAnimado":true}',
  notificacoes     jsonb not null default '{"mostrarNome":true,"mostrarValor":true}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── Chave/valor de configurações ─────────────────────────────────────────────
create table settings (
  key        text primary key,
  value      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Apps da Meta usados para conectar contas ─────────────────────────────────
create table meta_apps (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  app_id               text not null,
  app_secret           text not null,
  login_config_id      text not null default '',
  instagram_app_id     text not null default '',
  instagram_app_secret text not null default '',
  is_default           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── Contas do Instagram (API oficial) ────────────────────────────────────────
create table accounts (
  id                uuid primary key default gen_random_uuid(),
  username          text not null default '',
  name              text not null default '',
  avatar            text not null default '',
  avatar_origem     text not null default '',
  bio               text not null default '',
  external_link     text not null default '',
  account_type      text not null default '',
  followers         integer not null default 0,
  following         integer not null default 0,
  posts_count       integer not null default 0,
  status            text not null default 'ativa',
  health_status     text not null default 'ativa'
                    check (health_status in ('ativa', 'restrita', 'token_invalido', 'banida', 'conta_pessoal')),
  last_error        text not null default '',
  last_sync         timestamptz,
  last_health_check timestamptz,
  ig_user_id        text not null default '',
  access_token      text not null default '',
  token_expires_at  timestamptz,
  meta_app_id       uuid references meta_apps(id) on delete set null,
  daily_post_limit  integer not null default 999999,
  posts_today       integer not null default 0,
  last_post_date    timestamptz,
  last_post_at      timestamptz,
  is_busy           boolean not null default false,
  busy_since        timestamptz,
  busy_reason       text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index accounts_ig_user_id_key on accounts (ig_user_id) where ig_user_id <> '';
create index accounts_health_status_idx on accounts (health_status);

-- ── Convites de testador do app ──────────────────────────────────────────────
create table convites_de_acesso (
  id          uuid primary key default gen_random_uuid(),
  username    text not null unique,
  estado      text not null default 'pendente' check (estado in ('pendente', 'enviado')),
  meta_app_id text not null default '',
  observacao  text not null default '',
  enviado_em  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Biblioteca de mídias ─────────────────────────────────────────────────────
create table media (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  original_name text not null default '',
  path          text not null default '',
  url           text not null default '',
  mime_type     text not null default '',
  size          integer not null default 0,
  type          text not null default 'other' check (type in ('image', 'video', 'other')),
  folder        text not null default 'default',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index media_folder_idx on media (folder, created_at desc);

-- ── Legendas salvas ──────────────────────────────────────────────────────────
create table legends (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  category   text not null default 'Geral',
  text       text not null,
  is_active  boolean not null default true,
  favorita   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Trilhas de áudio ─────────────────────────────────────────────────────────
create table trilhas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  arquivo    text not null,
  tamanho    integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Envios (Postar e Loop) ───────────────────────────────────────────────────
create table jobs (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null default '',
  type               text not null default 'post' check (type in ('post', 'loop')),
  status             text not null default 'queued'
                     check (status in ('queued', 'running', 'waiting_interval', 'paused', 'completed', 'cancelled', 'failed')),
  account_ids        uuid[] not null default '{}',
  media_files        text[] not null default '{}',
  post_type          text not null default 'reel' check (post_type in ('post', 'reel', 'story')),
  caption            text not null default '',
  cover              text not null default '',
  cta_comment        text not null default '',
  process_mode       text not null default 'limpeza_leve',
  ordem_das_midias   text not null default 'antigos_primeiro',
  midias_aleatorias  boolean not null default false,
  semente_da_ordem   text not null default '',
  marca_dagua        jsonb,
  variacao_edicao    jsonb,
  trilha             jsonb,
  legenda_aleatoria  jsonb,
  capas_por_conta    jsonb,
  rodizio_de_midias  boolean not null default false,
  interval_minutes   integer not null default 0,
  simultaneous_limit integer not null default 1,
  current_round      integer not null default 0,
  total_rounds       integer not null default 0,
  rounds_completed   integer not null default 0,
  posts_published    integer not null default 0,
  posts_errors       integer not null default 0,
  posts_total        integer not null default 0,
  started_at         timestamptz,
  completed_at       timestamptz,
  next_round_at      timestamptz,
  last_error         text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index jobs_status_idx on jobs (status, next_round_at);
create index jobs_account_ids_idx on jobs using gin (account_ids);

-- ── Publicações (uma mídia enviada a N contas) ───────────────────────────────
create table posts (
  id                uuid primary key default gen_random_uuid(),
  media             text not null,
  cover             text not null default '',
  media_type        text not null default 'image' check (media_type in ('image', 'video')),
  post_type         text not null default 'post' check (post_type in ('post', 'reel', 'story')),
  caption           text not null default '',
  cta_comment       text not null default '',
  process_mode      text not null default 'limpeza_leve',
  job_id            uuid references jobs(id) on delete set null,
  job_round         integer,
  job_name          text not null default '',
  ig_media_id       text not null default '',
  midias_publicadas jsonb not null default '[]',
  marca_dagua       jsonb,
  variacao_edicao   jsonb,
  trilha            jsonb,
  capas_por_conta   jsonb,
  account_ids       uuid[] not null default '{}',
  scheduled_at      timestamptz,
  status            text not null default 'pendente',
  error             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- A mesma rodada pode rodar duas vezes (restart no meio): a chave faz a segunda
-- reencontrar o post da primeira em vez de publicar tudo de novo.
create unique index posts_rodada_key on posts (job_id, media, job_round) where job_id is not null;
create index posts_status_idx on posts (status);
create index posts_updated_at_idx on posts (updated_at desc);
create index posts_scheduled_idx on posts (scheduled_at desc, created_at desc);
create index posts_account_ids_idx on posts using gin (account_ids);
create index posts_ig_media_id_idx on posts (ig_media_id) where ig_media_id <> '';

-- ── Campanhas ────────────────────────────────────────────────────────────────
create table campaigns (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  description            text not null default '',
  status                 text not null default 'draft'
                         check (status in ('draft', 'planning', 'scheduled', 'running', 'paused', 'completed', 'partial', 'failed', 'cancelled')),
  account_ids            uuid[] not null default '{}',
  content_ids            uuid[] not null default '{}',
  strategy               jsonb not null default '{}',
  schedule               jsonb not null default '{}',
  caption_mode           text not null default 'global',
  comment_mode           text not null default 'disabled',
  captions               jsonb not null default '{}',
  comments               jsonb not null default '{}',
  settings               jsonb not null default '{}',
  covers                 jsonb not null default '{}',
  total_publications     integer not null default 0,
  pending_publications   integer not null default 0,
  published_publications integer not null default 0,
  failed_publications    integer not null default 0,
  started_at             timestamptz,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index campaigns_status_idx on campaigns (status, created_at desc);

-- Conta e conteúdo sem chave estrangeira de propósito: a publicação sobrevive
-- à conta/mídia apagada e é marcada como indisponível pelo executor.
create table campaign_publications (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  account_id         uuid not null,
  content_id         uuid not null,
  post_id            uuid,
  queue_job_id       text not null default '',
  "order"            integer not null default 0,
  scheduled_at       timestamptz not null,
  caption_template   text not null default '',
  comment_template   text not null default '',
  resolved_caption   text not null default '',
  resolved_comment   text not null default '',
  status             text not null default 'pending'
                     check (status in ('pending', 'scheduled', 'processing', 'published', 'failed', 'cancelled')),
  attempts           integer not null default 0,
  error              text not null default '',
  error_code         text not null default '',
  published_at       timestamptz,
  instagram_media_id text not null default '',
  comment_status     text not null default 'none'
                     check (comment_status in ('none', 'scheduled', 'posted', 'failed', 'cancelled')),
  comment_job_id     text not null default '',
  comment_posted_at  timestamptz,
  comment_error      text not null default '',
  comment_error_code text not null default '',
  comment_id         text not null default '',
  comment_attempts   integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (campaign_id, account_id, content_id)
);
create index campaign_publications_campaign_idx on campaign_publications (campaign_id, status);
create index campaign_publications_scheduled_idx on campaign_publications (campaign_id, scheduled_at);
create index campaign_publications_status_idx on campaign_publications (status, scheduled_at);
create index campaign_publications_account_idx on campaign_publications (account_id, scheduled_at);

create table campaign_events (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  publication_id uuid,
  account_id     uuid,
  evento         text not null,
  error_code     text not null default '',
  error          text not null default '',
  media_id       text not null default '',
  attempt        integer not null default 0,
  duration_ms    integer not null default 0,
  criado_em      timestamptz not null default now()
);
create index campaign_events_campaign_idx on campaign_events (campaign_id, criado_em desc);
create index campaign_events_criado_em_idx on campaign_events (criado_em);

-- ── Métricas por mídia ───────────────────────────────────────────────────────
create table insights (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id) on delete cascade,
  username            text not null default '',
  ig_media_id         text not null unique,
  media_type          text not null default 'IMAGE',
  media_url           text not null default '',
  thumbnail_url       text not null default '',
  permalink           text not null default '',
  caption             text not null default '',
  posted_at           timestamptz,
  like_count          integer not null default 0,
  comments_count      integer not null default 0,
  share_count         integer not null default 0,
  saved_count         integer not null default 0,
  reach               integer not null default 0,
  impressions         integer not null default 0,
  video_views         integer not null default 0,
  total_interactions  integer not null default 0,
  avg_watch_time_ms   double precision,
  total_watch_time_ms double precision,
  engagement_score    double precision not null default 0,
  synced_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index insights_account_idx on insights (account_id);
create index insights_posted_at_idx on insights (posted_at desc);
create index insights_engagement_idx on insights (engagement_score desc);

-- ── Série diária de seguidores ───────────────────────────────────────────────
create table seguidores_do_dia (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  username    text not null default '',
  dia         text not null,
  seguidores  integer not null default 0,
  seguindo    integer not null default 0,
  publicacoes integer not null default 0,
  novos       integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (account_id, dia)
);
create index seguidores_do_dia_dia_idx on seguidores_do_dia (dia desc);

-- ── Notificações ─────────────────────────────────────────────────────────────
create table milestones (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  content_id      text not null,
  metric_type     text not null,
  maior_disparado double precision not null default 0,
  ultimo_valor    double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, content_id, metric_type)
);

create table notificacoes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) on delete set null,
  username    text not null default '',
  avatar      text not null default '',
  content_id  text not null default '',
  event_type  text not null,
  metric_type text not null default '',
  threshold   double precision not null default 0,
  tema        text not null default 'milestone',
  prioridade  text not null default 'normal',
  titulo      text not null,
  mensagem    text not null default '',
  metadados   jsonb not null default '{}',
  lida_em     timestamptz,
  criada_em   timestamptz not null default now()
);
create index notificacoes_lida_idx on notificacoes (lida_em, criada_em desc);
create index notificacoes_account_idx on notificacoes (account_id, criada_em desc);
create unique index notificacoes_marco_key on notificacoes (account_id, content_id, metric_type, threshold)
  where event_type = 'milestone';

create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  endpoint     text not null unique,
  keys         jsonb not null,
  aparelho     text not null default '',
  falhas       integer not null default 0,
  ultimo_envio timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Fila de trabalhos ────────────────────────────────────────────────────────
-- Substitui o BullMQ/Redis. `key` torna o enfileiramento idempotente; trabalho
-- concluído é apagado, e o que está em 'running' ao subir é órfão e volta.
create table queue_jobs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  data       jsonb not null default '{}',
  key        text unique,
  run_at     timestamptz not null default now(),
  status     text not null default 'queued' check (status in ('queued', 'running')),
  attempts   integer not null default 0,
  locked_at  timestamptz,
  created_at timestamptz not null default now()
);
create index queue_jobs_proximos_idx on queue_jobs (run_at) where status = 'queued';

-- ── updated_at automático ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'usuarios', 'settings', 'meta_apps', 'accounts', 'convites_de_acesso', 'media',
    'legends', 'trilhas', 'jobs', 'posts', 'campaigns', 'campaign_publications',
    'insights', 'seguidores_do_dia', 'milestones', 'push_subscriptions'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- Funil de vendas (bots de Telegram, checkout...): links rastreados por conta
-- do Instagram e os eventos que chegam por webhook.

create table if not exists funil_config (
  usuario_id  uuid primary key references usuarios(id) on delete cascade,
  token       text not null unique,
  criado_em   timestamptz not null default now()
);

create table if not exists funil_links (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  codigo      text not null unique,
  destino     text not null,
  account_id  uuid references accounts(id) on delete set null,
  rotulo      text not null default '',
  criado_em   timestamptz not null default now()
);
create index if not exists funil_links_usuario_idx on funil_links (usuario_id);

create table if not exists funil_eventos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  link_id     uuid references funil_links(id) on delete set null,
  codigo      text not null default '',
  etapa       text not null check (etapa in ('clique', 'entrou', 'checkout', 'comprou', 'outro')),
  evento      text not null default '',
  lead        text not null default '',
  nome        text not null default '',
  username    text not null default '',
  email       text not null default '',
  telefone    text not null default '',
  valor       numeric(12,2),
  plano       text not null default '',
  bruto       jsonb,
  criado_em   timestamptz not null default now()
);
create index if not exists funil_eventos_usuario_idx on funil_eventos (usuario_id, criado_em desc);
create index if not exists funil_eventos_lead_idx on funil_eventos (usuario_id, lead);

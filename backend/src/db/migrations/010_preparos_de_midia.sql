-- Variações de Mídia: arquivos enviados para conversão (formato, corte,
-- qualidade, ajustes escolhidos pela pessoa) e as saídas geradas. Os arquivos
-- ficam fora da Biblioteca e expiram; a linha fica 30 dias como histórico.

create table if not exists preparos_de_midia (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references usuarios(id) on delete cascade,
  lote           uuid not null,
  nome_original  text not null,
  tipo           text not null check (tipo in ('video', 'imagem')),
  bytes          bigint not null default 0,
  status         text not null default 'aguardando'
                 check (status in ('enviando', 'aguardando', 'processando', 'concluido', 'erro', 'cancelado', 'expirado')),
  erro           text not null default '',
  info           jsonb not null default '{}',
  config         jsonb not null default '{}',
  saidas         jsonb not null default '[]',
  tentativas     int not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  expira_em      timestamptz not null
);
create index if not exists preparos_de_midia_usuario_idx on preparos_de_midia (usuario_id, criado_em desc);
create index if not exists preparos_de_midia_lote_idx on preparos_de_midia (usuario_id, lote);
create index if not exists preparos_de_midia_expira_idx on preparos_de_midia (expira_em) where status <> 'expirado';

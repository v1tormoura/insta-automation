-- Login em dois fatores (código do app autenticador) e o registro do que
-- cada usuário fez no painel.

alter table usuarios
  add column if not exists totp_segredo        text,
  add column if not exists totp_ativo          boolean not null default false,
  add column if not exists totp_ultimo_passo   bigint,
  add column if not exists totp_reserva        text[] not null default '{}',
  add column if not exists totp_ativado_em     timestamptz;

create table if not exists registro_de_atividade (
  id          bigserial primary key,
  usuario_id  uuid references usuarios(id) on delete cascade,
  quando      timestamptz not null default now(),
  acao        text not null,
  detalhe     text not null default '',
  ip          text not null default '',
  aparelho    text not null default ''
);
create index if not exists registro_de_atividade_usuario_idx on registro_de_atividade (usuario_id, quando desc);
create index if not exists registro_de_atividade_quando_idx on registro_de_atividade (quando desc);

-- Recuperação de senha por e-mail.
--
-- O link leva um código aleatório; aqui fica só o hash dele (sha256) — quem ler
-- o banco não consegue usar um pedido em aberto. Vale 1 hora e uma vez.
--
-- `sessoes_desde`: depois de redefinir a senha, tokens emitidos antes deixam de
-- valer — quem estava com a conta aberta em outro aparelho sai.

create table recuperacoes_de_senha (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  token_hash  text not null unique,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  created_at  timestamptz not null default now()
);
create index recuperacoes_de_senha_usuario_idx on recuperacoes_de_senha (usuario_id);

alter table usuarios add column sessoes_desde timestamptz;

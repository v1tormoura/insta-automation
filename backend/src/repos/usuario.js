'use strict';

/**
 * Usuários do painel.
 *
 * O admin é a linha `chave = 'principal'` (criada pela migração 002): entra
 * com AUTH_USERNAME e aprova os cadastros. Os demais nascem 'pendente' pelo
 * cadastro público e só entram depois de aprovados.
 */

const { sql } = require('../db');

const STATUS = ['pendente', 'ativo', 'bloqueado', 'recusado'];

async function admin() {
  const [u] = await sql`
    insert into usuarios (chave, nome, papel, status, aprovado_em)
    values ('principal', 'Administrador', 'admin', 'ativo', now())
    on conflict (chave) do update set chave = excluded.chave
    returning *`;
  return u;
}

async function porId(id) {
  const [u] = await sql`select * from usuarios where id = ${id}`;
  return u || null;
}

async function porEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const [u] = await sql`select * from usuarios where lower(email) = ${e}`;
  return u || null;
}

async function criar({ nome, email, senhaHash }) {
  const [u] = await sql`
    insert into usuarios (nome, email, senha_hash, papel, status)
    values (${nome}, ${email.toLowerCase()}, ${senhaHash}, 'usuario', 'pendente')
    returning *`;
  return u;
}

async function atualizar(id, campos) {
  const [u] = await sql`update usuarios set ${sql(campos)} where id = ${id} returning *`;
  return u || null;
}

/** Mescla chaves num campo jsonb (`preferencias`, `notificacoes`) sem apagar as outras. */
async function mesclar(id, coluna, parcial) {
  if (!Object.keys(parcial).length) return porId(id);
  const [u] = await sql`
    update usuarios set ${sql(coluna)} = ${sql(coluna)} || ${sql.json(parcial)}
    where id = ${id} returning *`;
  return u || null;
}

/** Lista para a tela de Usuários, com o que cada um tem na plataforma. */
async function listar({ status = null } = {}) {
  return sql`
    select u.id, u.nome, u.email, u.papel, u.status, u.avatar, u.created_at, u.aprovado_em, u.ultimo_login,
      (select count(*) from accounts a where a.usuario_id = u.id) as contas,
      (select count(*) from posts p where p.usuario_id = u.id and p.status = 'concluido') as publicacoes
    from usuarios u
    ${status ? sql`where u.status = ${status}` : sql``}
    order by (u.status = 'pendente') desc, u.created_at desc`;
}

async function contarPendentes() {
  const [{ n }] = await sql`select count(*) as n from usuarios where status = 'pendente'`;
  return n;
}

module.exports = { STATUS, admin, porId, porEmail, criar, atualizar, mesclar, listar, contarPendentes };

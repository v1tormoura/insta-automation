'use strict';

/** O usuário único do painel (linha `chave = 'principal'`), criado na primeira leitura. */

const { sql } = require('../db');

async function carregar() {
  const [u] = await sql`
    insert into usuarios (chave) values ('principal')
    on conflict (chave) do update set chave = excluded.chave
    returning *`;
  return u;
}

async function atualizar(campos) {
  await carregar();
  const [u] = await sql`update usuarios set ${sql(campos)} where chave = 'principal' returning *`;
  return u;
}

/** Mescla chaves num campo jsonb (`preferencias`, `notificacoes`) sem apagar as outras. */
async function mesclar(coluna, parcial) {
  if (!Object.keys(parcial).length) return carregar();
  await carregar();
  const [u] = await sql`
    update usuarios set ${sql(coluna)} = ${sql(coluna)} || ${sql.json(parcial)}
    where chave = 'principal' returning *`;
  return u;
}

module.exports = { carregar, atualizar, mesclar };

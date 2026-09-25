'use strict';

/**
 * Apoio aos testes que usam o Postgres de teste (ver tests/globalSetup.js).
 * `limpar()` esvazia as tabelas entre testes; as fábricas criam o mínimo que
 * cada tabela exige.
 */

const { sql } = require('../../src/db');

async function limpar() {
  const tabelas = await sql`
    select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`;
  if (tabelas.length) await sql.unsafe(`truncate ${tabelas.map(t => `"${t.tablename}"`).join(', ')} cascade`);
}

async function criarConta(campos = {}) {
  const [c] = await sql`insert into accounts ${sql({ username: 'conta', ...campos })} returning *`;
  return c;
}

async function criarJob(campos = {}) {
  const [j] = await sql`insert into jobs ${sql({ name: 'envio', ...campos })} returning *`;
  return j;
}

async function criarLegenda(campos = {}) {
  const [l] = await sql`insert into legends ${sql({ title: 't', text: 'texto', ...campos })} returning *`;
  return l;
}

async function criarPost(campos = {}) {
  const [p] = await sql`insert into posts ${sql({ media: 'a.mp4', ...campos })} returning *`;
  return p;
}

module.exports = { sql, limpar, criarConta, criarJob, criarLegenda, criarPost };

'use strict';

/**
 * Apoio aos testes que usam o Postgres de teste (ver tests/globalSetup.js).
 * `limpar()` esvazia as tabelas entre testes; as fábricas criam o mínimo que
 * cada tabela exige.
 *
 * Todo dado tem dono: as fábricas usam o admin (`dono()`) quando o teste não
 * diz outro `usuarioId`. `req()` monta a requisição de um usuário logado.
 */

const { sql } = require('../../src/db');

/** Id fixo do admin de teste: sobrevive a `limpar()`, então pode ser guardado em constante. */
const DONO_ID = '00000000-0000-4000-8000-00000000a0a0';

async function limpar() {
  const tabelas = await sql`
    select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`;
  if (tabelas.length) await sql.unsafe(`truncate ${tabelas.map(t => `"${t.tablename}"`).join(', ')} cascade`);
  await dono();
}

/** O admin (linha `principal`), criado se ainda não existir. */
async function dono() {
  const [u] = await sql`
    insert into usuarios (id, chave, nome, papel, status) values (${DONO_ID}, 'principal', 'Admin', 'admin', 'ativo')
    on conflict (chave) do update set chave = excluded.chave
    returning *`;
  return u;
}

let _seq = 0;
async function criarUsuario(campos = {}) {
  _seq += 1;
  const [u] = await sql`insert into usuarios ${sql({
    nome: `Usuário ${_seq}`, email: `u${_seq}-${Date.now()}@teste.com`, papel: 'usuario', status: 'ativo', ...campos,
  })} returning *`;
  return u;
}

const comDono = async campos => ({ usuarioId: campos.usuarioId || (await dono()).id, ...campos });

async function criarConta(campos = {}) {
  const [c] = await sql`insert into accounts ${sql(await comDono({ username: 'conta', ...campos }))} returning *`;
  return c;
}

async function criarJob(campos = {}) {
  const [j] = await sql`insert into jobs ${sql(await comDono({ name: 'envio', ...campos }))} returning *`;
  return j;
}

async function criarLegenda(campos = {}) {
  const [l] = await sql`insert into legends ${sql(await comDono({ title: 't', text: 'texto', ...campos }))} returning *`;
  return l;
}

async function criarPost(campos = {}) {
  const [p] = await sql`insert into posts ${sql(await comDono({ media: 'a.mp4', ...campos }))} returning *`;
  return p;
}

async function criarMidia(campos = {}) {
  const [m] = await sql`insert into media ${sql(await comDono({ filename: 'a.mp4', type: 'video', ...campos }))} returning *`;
  return m;
}

/** Requisição de um usuário logado (o admin, sem `usuario`). */
async function req(extra = {}, usuario = null) {
  const u = usuario || await dono();
  return {
    params: {}, query: {}, body: {}, files: [], get: () => undefined, ip: '127.0.0.1',
    ...extra,
    user: { id: u.id, papel: u.papel, nome: u.nome, email: u.email },
  };
}

module.exports = { sql, DONO_ID, limpar, dono, criarUsuario, criarConta, criarJob, criarLegenda, criarPost, criarMidia, req };

'use strict';

/**
 * Conexão com o Postgres (Supabase em produção).
 *
 * `postgres` entrega as colunas em camelCase e converte de volta no `sql(obj)`,
 * então o resto do código conversa em camelCase — o mesmo formato que o painel
 * envia e recebe.
 *
 * int8 e numeric viram Number: `count(*)` e `sum()` são int8 no Postgres, e
 * voltariam como string, o que quebra soma e comparação em silêncio.
 */

const postgres = require('postgres');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definido — veja backend/.env.example');

const local = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(url);

const sql = postgres(url, {
  ssl: local ? false : 'require',
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  idle_timeout: 30,
  connect_timeout: 15,
  // O pooler de transação do Supabase (porta 6543) não aceita prepared statements.
  prepare: !/:6543\//.test(url),
  transform: postgres.camel,
  types: {
    bigint:  { to: 20,   from: [20],   serialize: String, parse: Number },
    numeric: { to: 1700, from: [1700], serialize: String, parse: Number },
  },
  onnotice: () => {},
});

/**
 * CRUD de uma tabela: o que se repete em todo repositório.
 *
 * `where` é igualdade simples ({ coluna: valor }); filtro mais rico vai em SQL
 * escrito à mão no próprio repositório, que é onde ele é legível.
 */
function tabela(nome) {
  const t = sql(nome);
  const filtro = where => {
    const pares = Object.entries(where || {}).filter(([, v]) => v !== undefined);
    if (!pares.length) return sql`true`;
    return pares
      .map(([k, v]) => (v === null ? sql`${sql(k)} is null` : sql`${sql(k)} = ${v}`))
      .reduce((a, b) => sql`${a} and ${b}`);
  };

  return {
    async findById(id, db = sql) {
      if (!ehUuid(id)) return null;
      const [row] = await db`select * from ${t} where id = ${id}`;
      return row || null;
    },
    async findOne(where, db = sql) {
      const [row] = await db`select * from ${t} where ${filtro(where)} limit 1`;
      return row || null;
    },
    async findMany(where = {}, { orderBy = 'created_at desc', limit = null, offset = 0 } = {}, db = sql) {
      return db`
        select * from ${t} where ${filtro(where)}
        order by ${sql.unsafe(orderBy)}
        ${limit ? sql`limit ${limit}` : sql``} offset ${offset}`;
    },
    async count(where = {}, db = sql) {
      const [{ n }] = await db`select count(*) as n from ${t} where ${filtro(where)}`;
      return n;
    },
    async insert(obj, db = sql) {
      const [row] = await db`insert into ${t} ${sql(limpar(obj))} returning *`;
      return row;
    },
    async update(id, patch, db = sql) {
      if (!ehUuid(id)) return null;
      const campos = limpar(patch);
      if (!Object.keys(campos).length) return this.findById(id, db);
      const [row] = await db`update ${t} set ${sql(campos)} where id = ${id} returning *`;
      return row || null;
    },
    async remove(id, db = sql) {
      if (!ehUuid(id)) return null;
      const [row] = await db`delete from ${t} where id = ${id} returning *`;
      return row || null;
    },
  };
}

/** Tira `undefined` (que o driver recusaria) e o id, que nunca é atualizável. */
function limpar(obj) {
  const saida = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || k === 'id') continue;
    saida[k] = v;
  }
  return saida;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ehUuid(v) {
  return typeof v === 'string' && UUID.test(v);
}

module.exports = { sql, tabela, ehUuid };

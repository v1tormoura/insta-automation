'use strict';

/** Configurações chave → valor (jsonb). */

const { sql } = require('../db');

async function ler(chave) {
  const [row] = await sql`select value from settings where key = ${chave}`;
  return row ? row.value : null;
}

async function gravar(chave, valor) {
  await sql`
    insert into settings (key, value) values (${chave}, ${sql.json(valor)})
    on conflict (key) do update set value = excluded.value`;
}

module.exports = { ler, gravar };

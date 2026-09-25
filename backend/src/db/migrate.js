'use strict';

/**
 * Aplica as migrações de src/db/migrations em ordem, uma vez cada.
 *
 * Roda na subida do servidor (e por `npm run migrate`). Cada arquivo entra numa
 * transação: ou aplica inteiro, ou não aplica nada — um esquema pela metade é
 * pior que nenhum.
 */

const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, 'migrations');

async function migrar(sql, log = console.log) {
  await sql`
    create table if not exists schema_migrations (
      nome        text primary key,
      aplicada_em timestamptz not null default now()
    )`;
  const feitas = new Set((await sql`select nome from schema_migrations`).map(r => r.nome));
  const arquivos = fs.readdirSync(PASTA).filter(f => f.endsWith('.sql')).sort();

  for (const nome of arquivos) {
    if (feitas.has(nome)) continue;
    const conteudo = fs.readFileSync(path.join(PASTA, nome), 'utf8');
    await sql.begin(async tx => {
      await tx.unsafe(conteudo);
      await tx`insert into schema_migrations (nome) values (${nome})`;
    });
    log(`🗄️  [DB] migração aplicada: ${nome}`);
  }
}

module.exports = { migrar };

if (require.main === module) {
  require('../config');
  const { sql } = require('./index');
  migrar(sql)
    .then(() => { console.log('🗄️  [DB] esquema em dia'); return sql.end(); })
    .catch(err => { console.error('💥 [DB] migração falhou:', err.message); process.exit(1); });
}

'use strict';

/**
 * Banco de teste do zero a cada execução: esquema apagado e migrações
 * aplicadas. Usa TEST_DATABASE_URL (padrão: o Postgres local do docker compose).
 * Sem banco acessível, os testes de lógica pura rodam e os de banco falham
 * dizendo o porquê.
 */

module.exports = async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/insta_test';
  const postgres = require('postgres');
  const { migrar } = require('../src/db/migrate');
  const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {}, max: 1 });
  try {
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrar(sql, () => {});
  } catch (err) {
    console.warn(`\n⚠️  Banco de teste indisponível (${err.message}) — os testes que consultam o banco vão falhar.\n`);
  } finally {
    await sql.end();
  }
};

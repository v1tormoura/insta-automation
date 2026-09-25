'use strict';

/**
 * Contas do Instagram.
 *
 * O token da API é cifrado em repouso (AES-256-GCM, ver tokenEncryption.js):
 * cifra ao gravar, decifra ao ler. Fora deste módulo ninguém vê o token
 * cifrado — e nenhuma resposta da API o vê em claro (`paraApi`).
 *
 * Toda escrita que muda `healthStatus` passa por aqui, e é aqui que sai o
 * aviso de "conta caiu" / "conta voltou" (saudeDaConta.js).
 */

const { sql, tabela } = require('../db');
const { encrypt, decrypt } = require('../services/tokenEncryption');
const saude = require('../services/saudeDaConta');

const base = tabela('accounts');

function ler(row) {
  if (!row) return row;
  let accessToken = row.accessToken;
  try { accessToken = decrypt(accessToken); } catch { accessToken = ''; }
  return { ...row, accessToken };
}

function paraGravar(campos) {
  if (!campos || campos.accessToken === undefined) return campos;
  return { ...campos, accessToken: campos.accessToken ? encrypt(campos.accessToken) : '' };
}

/** A conta como o painel a recebe: sem o token, com o que ele precisa saber dele. */
function paraApi(conta) {
  if (!conta) return conta;
  const { accessToken, ...resto } = conta;
  return { ...resto, hasApiToken: !!(accessToken && conta.igUserId) };
}

async function findById(id, db) { return ler(await base.findById(id, db)); }
async function findOne(where, db) { return ler(await base.findOne(where, db)); }
async function findMany(where, opts, db) { return (await base.findMany(where, opts, db)).map(ler); }

async function porIds(ids, db = sql) {
  const lista = [...new Set((ids || []).map(String))].filter(Boolean);
  if (!lista.length) return [];
  return (await db`select * from accounts where id = any(${lista}::uuid[])`).map(ler);
}

async function insert(campos, db) { return ler(await base.insert(paraGravar(campos), db)); }

async function update(id, campos, db) {
  const mudaSaude = campos && typeof campos.healthStatus === 'string';
  const antes = mudaSaude ? await base.findById(id, db) : null;
  const depois = ler(await base.update(id, paraGravar(campos), db));
  if (mudaSaude && antes && depois && antes.healthStatus !== depois.healthStatus) {
    saude.avisarTransicao({
      conta: depois, de: antes.healthStatus, para: depois.healthStatus, lastError: depois.lastError,
    }).catch(e => console.log('[Aviso] transição de saúde falhou:', e.message));
  }
  return depois;
}

async function remove(id, db) { return base.remove(id, db); }
async function count(where, db) { return base.count(where, db); }

/**
 * Trava a conta para UMA publicação por vez, numa operação só: dois
 * trabalhos que vissem `isBusy = false` ao mesmo tempo publicariam juntos.
 * Trava com mais de 10 minutos é de processo que morreu e pode ser tomada.
 */
async function travar(id, motivo = 'Publicando') {
  const [row] = await sql`
    update accounts set is_busy = true, busy_since = now(), busy_reason = ${motivo}
    where id = ${id}
      and (is_busy = false or busy_since < now() - interval '10 minutes')
    returning *`;
  return ler(row);
}

async function destravar(id) {
  await sql`update accounts set is_busy = false, busy_since = null, busy_reason = '' where id = ${id}`;
}

async function destravarVencidas() {
  const r = await sql`
    update accounts set is_busy = false, busy_since = null, busy_reason = ''
    where is_busy = true and busy_since < now() - interval '10 minutes'`;
  return r.count;
}

/**
 * As contas de um usuário. Leitura, alteração e remoção só enxergam as dele;
 * a inserção grava o dono. A alteração passa pelo `update` de cima (aviso de
 * saúde, cifra do token) depois de confirmar que a conta é dele.
 */
function de(usuarioId) {
  const dono = base.de(usuarioId);
  return {
    async findById(id, db) { return ler(await dono.findById(id, db)); },
    async findOne(where, db) { return ler(await dono.findOne(where, db)); },
    async findMany(where, opts, db) { return (await dono.findMany(where, opts, db)).map(ler); },
    async count(where, db) { return dono.count(where, db); },
    async porIds(ids, db = sql) {
      const lista = [...new Set((ids || []).map(String))].filter(Boolean);
      if (!lista.length) return [];
      return (await db`select * from accounts where id = any(${lista}::uuid[]) and usuario_id = ${usuarioId}`).map(ler);
    },
    async insert(campos, db) { return ler(await dono.insert(paraGravar(campos), db)); },
    async update(id, campos, db) {
      if (!(await dono.findById(id, db))) return null;
      return update(id, campos, db);
    },
    async remove(id, db) { return dono.remove(id, db); },
  };
}

module.exports = {
  findById, findOne, findMany, porIds, insert, update, remove, count,
  travar, destravar, destravarVencidas, paraApi, de,
};

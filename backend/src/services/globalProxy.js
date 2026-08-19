'use strict';

const Setting = require('../models/Setting');
const { normalizeProxy } = require('./testProxy');

const KEY = 'globalProxy';

/**
 * Proxy global do SaaS — aplicado a TODA a automação (login, publicação,
 * sync, warmup) para qualquer conta que não tenha proxy próprio.
 *
 * Persistido no MongoDB para sobreviver a restart e ser visível ao worker,
 * que roda em outro container. `process.env.GLOBAL_PROXY` continua sendo
 * aceito como fallback (definido no docker-compose), mas a configuração
 * feita pelo painel tem prioridade.
 *
 * Formato do documento:
 *   { url, ativo, ip, ok, error, lastCheck }
 */

const EMPTY = { url: '', ativo: false, ip: '', ok: false, error: '', lastCheck: null };

// Cache curto — evita uma query por publicação sem atrasar a propagação
// de uma mudança feita no painel.
let _cache   = null;
let _cacheAt = 0;
const CACHE_TTL = 5_000; // ms

function _fromEnv() {
  const envUrl = normalizeProxy(process.env.GLOBAL_PROXY || '');
  if (!envUrl) return { ...EMPTY };
  return { ...EMPTY, url: envUrl, ativo: true };
}

/** Configuração completa do proxy global (com status do último teste). */
async function getGlobalProxyConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;

  // Sem conexão ativa o Mongoose ENFILEIRA a query em vez de falhar, e só
  // desiste após bufferTimeoutMS (10s por padrão). Como esta função está no
  // caminho de todo login e publicação, isso significaria travar cada operação
  // por 10s durante uma instabilidade do Mongo. Aqui a ausência de conexão é
  // tratada como "sem configuração": cai no cache ou na variável de ambiente.
  const mongoose = require('mongoose');
  if (mongoose.connection?.readyState !== 1) {
    return _cache || _fromEnv();
  }

  let doc = null;
  try {
    doc = await Setting.findOne({ key: KEY }).lean();
  } catch (err) {
    console.error('[globalProxy] falha ao ler config:', err.message);
    return _cache || _fromEnv();
  }

  _cache   = doc?.value ? { ...EMPTY, ...doc.value } : _fromEnv();
  _cacheAt = Date.now();
  return _cache;
}

/**
 * URL do proxy global se — e somente se — estiver ativo.
 * É esta função que a automação consome.
 * @returns {Promise<string>} URL do proxy, ou '' quando não há proxy ativo.
 */
async function getGlobalProxyUrl() {
  const cfg = await getGlobalProxyConfig();
  return cfg.ativo && cfg.url ? cfg.url : '';
}

/** Grava a configuração (merge com a atual) e invalida o cache. */
async function saveGlobalProxyConfig(patch) {
  const current = await getGlobalProxyConfig();
  const value   = { ...current, ...patch };

  await Setting.findOneAndUpdate(
    { key: KEY },
    { key: KEY, value },
    { upsert: true, returnDocument: 'after' }
  );

  _cache   = value;
  _cacheAt = Date.now();
  return value;
}

/**
 * Proxy efetivo de uma conta: o proxy próprio da conta tem prioridade;
 * sem ele, cai no proxy global (se ativo); sem nenhum, string vazia.
 */
async function resolveProxyFor(account) {
  const own = String(account?.proxy || '').trim();
  if (own) return normalizeProxy(own);
  return getGlobalProxyUrl();
}

module.exports = {
  getGlobalProxyConfig,
  getGlobalProxyUrl,
  saveGlobalProxyConfig,
  resolveProxyFor,
};

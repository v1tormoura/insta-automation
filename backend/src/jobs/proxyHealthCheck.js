'use strict';

const Account   = require('../models/Account');
const testProxy = require('../services/testProxy');
const {
  getGlobalProxyConfig,
  saveGlobalProxyConfig,
} = require('../services/globalProxy');

const INTERVAL_MS = 90_000; // 1min30 — monitoramento contínuo sem castigar o proxy

/**
 * Monitoramento contínuo de proxies.
 *
 * Roda no servidor (e não no navegador) para que o status seja o mesmo em
 * qualquer aba aberta e continue sendo atualizado com o painel fechado.
 * Grava o resultado no banco; o frontend apenas lê.
 */

async function checkGlobalProxy() {
  const cfg = await getGlobalProxyConfig();
  if (!cfg.ativo || !cfg.url) return;

  const result = await testProxy(cfg.url);
  await saveGlobalProxyConfig({
    ip:        result.ok ? result.ip : cfg.ip,
    ok:        result.ok,
    error:     result.error,
    lastCheck: new Date(),
  });

  if (!result.ok) {
    console.warn(`[ProxyHealth] proxy global OFFLINE — ${result.error}`);
  }
}

async function checkAccountProxies() {
  const accounts = await Account.find({
    proxy: { $exists: true, $nin: ['', null] },
  }).select('_id username proxy proxyStatus proxyIp');

  for (const account of accounts) {
    try {
      const result = await testProxy(account.proxy);

      account.proxyStatus    = result.ok ? 'online' : 'offline';
      account.proxyLastCheck = new Date();
      if (result.ok) account.proxyIp = result.ip;

      await account.save();

      if (!result.ok) {
        console.warn(`[ProxyHealth] @${account.username} proxy OFFLINE — ${result.error}`);
      }
    } catch (err) {
      console.error(`[ProxyHealth] erro ao testar proxy de @${account.username}:`, err.message);
    }
  }
}

async function runOnce() {
  try {
    await checkGlobalProxy();
    await checkAccountProxies();
  } catch (err) {
    console.error('[ProxyHealth] ciclo falhou:', err.message);
  }
}

function startProxyHealthCheck() {
  // Primeira passada logo após o boot, dando tempo do Mongo conectar.
  setTimeout(runOnce, 15_000);
  setInterval(runOnce, INTERVAL_MS);
  console.log(`[ProxyHealth] monitoramento de proxies ativo (a cada ${INTERVAL_MS / 1000}s)`);
}

module.exports = { startProxyHealthCheck, runOnce };

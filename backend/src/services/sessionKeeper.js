'use strict';

/**
 * Session Keeper
 *
 * Mantém as sessões do browser (cookies.json) vivas rodando uma visita
 * leve ao Instagram a cada 12 horas em background (headless+oculto).
 *
 * Instagram invalida sessões inativas mais rápido que sessões que visitam
 * o site periodicamente — especialmente sessões de automação Puppeteer.
 */

const fs      = require('fs');
const path    = require('path');
const Account = require('../models/Account');

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
const INTERVAL_MS   = 12 * 60 * 60 * 1000; // 12 horas
const BATCH_SIZE    = 3;                     // contas em paralelo
const BATCH_DELAY   = 30 * 1000;            // 30s entre lotes

let _timer = null;
let _running = false;

function hasCookies(username) {
  const p = path.join(SESSIONS_ROOT, username, 'cookies.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function refreshOneSession(account) {
  const { launchBrowser, saveSession, isLoggedIn } = require('./instagramBot');

  // Lança browser OCULTO e headless
  const origHeadless = process.env.HEADLESS;
  const origHidden   = process.env.HIDDEN_BROWSER;
  process.env.HEADLESS       = 'true';
  process.env.HIDDEN_BROWSER = 'true';

  let browser;
  try {
    const { browser: b, page } = await launchBrowser(account.proxy, account.username);
    browser = b;

    // Carrega cookies salvos
    const cookiesPath = path.join(SESSIONS_ROOT, account.username, 'cookies.json');
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
    if (cookies.length) await page.setCookie(...cookies);

    // Faz uma visita leve ao Instagram
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await new Promise(r => setTimeout(r, 5000));

    const loggedIn = await isLoggedIn(page);

    if (loggedIn) {
      // Atualiza cookies.json com os cookies frescos
      await saveSession(page, account.username);
      console.log(`✅ [SessionKeeper] @${account.username} — sessão renovada`);

      // Atualiza lastSync no banco
      await Account.findByIdAndUpdate(account._id, { lastSync: new Date() });
    } else {
      console.log(`⚠️ [SessionKeeper] @${account.username} — sessão expirada, não renovada`);
    }
  } catch (err) {
    console.log(`⚠️ [SessionKeeper] @${account.username}: ${err.message}`);
  } finally {
    process.env.HEADLESS       = origHeadless;
    process.env.HIDDEN_BROWSER = origHidden;
    try { await browser?.close(); } catch {}
  }
}

async function runKeeper() {
  if (_running) {
    console.log('⏩ [SessionKeeper] Já em execução, pulando...');
    return;
  }
  _running = true;
  console.log('🔄 [SessionKeeper] Iniciando renovação de sessões...');

  try {
    // Pega contas que têm cookies salvos (sessão browser)
    const allAccounts = await Account.find({ healthStatus: { $ne: 'banida' } }).lean();
    const accounts    = allAccounts.filter(a => hasCookies(a.username));

    console.log(`🔄 [SessionKeeper] ${accounts.length} conta(s) com sessão para renovar`);

    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(a => refreshOneSession(a)));

      if (i + BATCH_SIZE < accounts.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }

    console.log('✅ [SessionKeeper] Renovação concluída');
  } catch (err) {
    console.log('❌ [SessionKeeper] Erro:', err.message);
  } finally {
    _running = false;
  }
}

/**
 * Inicia o session keeper.
 * Primeira execução acontece após 30 minutos (dá tempo de logar as contas),
 * depois a cada INTERVAL_MS.
 */
function start() {
  if (_timer) return; // já iniciado

  console.log(`🕐 [SessionKeeper] Agendado para rodar a cada ${INTERVAL_MS / 3600000}h`);

  // Primeira execução após 30 minutos
  setTimeout(() => {
    runKeeper();
    _timer = setInterval(runKeeper, INTERVAL_MS);
  }, 30 * 60 * 1000);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, runKeeper };

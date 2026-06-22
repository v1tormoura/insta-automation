'use strict';

// AutoSync — usa apenas APIs (sem Puppeteer, sem browser)
// Ordem de prioridade por conta:
//   1. Graph API  — contas com token OAuth (IGQ/EAA)
//   2. Private API — contas com igSession ou cookies.json (accountFastSync)
//   3. Só atualiza lastSync — sem credenciais válidas

const Account       = require('../models/Account');
const syncViaAPI    = require('../services/syncAccountAPI');
const { syncOneAccountFast } = require('./accountFastSync');
const { broadcast } = require('../events/broadcaster');

const delay = ms => new Promise(r => setTimeout(r, ms));

let running = false;

async function runAutoSync() {
  if (running) return;
  running = true;

  try {
    const accounts = await Account.find({
      status: { $ne: 'banida' },
      isBusy: { $ne: true },
    }).sort({ lastSync: 1 });

    console.log(`🔄 AutoSync — ${accounts.length} conta(s)`);

    for (const acc of accounts) {
      const fresh = await Account.findById(acc._id);
      if (!fresh || fresh.isBusy) continue;

      try {
        if (fresh.accessToken && fresh.igUserId) {
          // Conta com token OAuth — Graph API (sem browser)
          await syncViaAPI(fresh);
          await delay(1500);
        } else {
          // Conta sem token — tenta private API (igSession / cookies.json)
          // syncOneAccountFast ignora silenciosamente se não tiver sessão
          await syncOneAccountFast(fresh);
          await delay(3000);
        }
      } catch (err) {
        console.log(`⚠️ Sync @${acc.username}: ${err.message}`);
        await delay(2000);
      }
    }

    broadcast('accounts', { action: 'synced' });
    console.log('✅ AutoSync concluído');
  } catch (err) {
    console.log('💥 Erro AutoSync:', err.message);
  } finally {
    running = false;
  }
}

function startAutoSync() {
  // Primeira execução: 30s após iniciar
  setTimeout(runAutoSync, 30_000);

  // Depois: a cada 15 minutos
  setInterval(runAutoSync, 15 * 60 * 1000);
}

module.exports = startAutoSync;

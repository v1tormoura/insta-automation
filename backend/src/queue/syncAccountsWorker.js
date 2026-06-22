require('dotenv').config();

const connectDB = require('../config/db');
const Account = require('../models/Account');
const syncAccountInfo = require('../services/syncAccountInfo');

connectDB();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncAllAccounts() {
  try {
    console.log('🔄 Iniciando sync das contas...');

    const accounts = await Account.find({
      status: { $ne: 'deletada' },
    });

    for (const account of accounts) {
      try {
        console.log(`📲 Sincronizando @${account.username}`);

        await syncAccountInfo(account._id);

        console.log(`✅ Sync concluído: @${account.username}`);

        await delay(15000);
      } catch (err) {
        console.log(`💥 Erro sync @${account.username}:`, err.message);
      }
    }

    console.log('✅ Sync geral finalizado');
  } catch (err) {
    console.log('💥 Erro geral no sync:', err.message);
  }
}

syncAllAccounts();

setInterval(
  () => {
    syncAllAccounts();
  },
  30 * 60 * 1000
);

console.log('Worker de sync rodando...');

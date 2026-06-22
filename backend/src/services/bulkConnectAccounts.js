const fs = require('fs');
const path = require('path');

const Account = require('../models/Account');
const { launchBrowser, loginInstagram, saveSession, loadSession } = require('./instagramBot');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function getCookiesPath(username) {
  return path.resolve(__dirname, '../../sessions', username, 'cookies.json');
}

async function isAlreadyConnected(username) {
  return fs.existsSync(getCookiesPath(username));
}

async function bulkConnectAccounts() {
  const accounts = await Account.find({
    password: { $ne: '' },
  }).sort({ updatedAt: 1 });

  const results = [];

  for (const account of accounts) {
    let browser;

    try {
      if (account.isBusy) {
        results.push({
          username: account.username,
          status: 'skip',
          message: 'Conta em uso',
        });

        continue;
      }

      if (await isAlreadyConnected(account.username)) {
        results.push({
          username: account.username,
          status: 'skip',
          message: 'Sessão já existe',
        });

        continue;
      }

      account.isBusy = true;
      account.busyReason = 'Conectando conta';
      account.busySince = new Date();
      await account.save();

      console.log(`🔐 Conectando em lote: @${account.username}`);

      const launched = await launchBrowser(account.proxy, account.username);

      browser = launched.browser;

      const page = launched.page;

      await loginInstagram(page, account.username, account.password);

      await saveSession(page, account.username);

      account.status = 'ativa';
      account.healthStatus = 'ativa';
      account.lastError = '';
      account.lastSync = new Date();

      account.isBusy = false;
      account.busyReason = '';
      account.busySince = null;

      await account.save();

      results.push({
        username: account.username,
        status: 'success',
        message: 'Conectada com sucesso',
      });

      await browser.close();
      browser = null;

      await delay(30000);
    } catch (err) {
      console.log(`❌ Erro ao conectar @${account.username}:`, err.message);

      account.status = 'erro';
      account.healthStatus = 'erro_login';
      account.lastError = err.message;

      account.isBusy = false;
      account.busyReason = '';
      account.busySince = null;

      await account.save();

      results.push({
        username: account.username,
        status: 'error',
        message: err.message,
      });

      if (browser) {
        await browser.close().catch(() => {});
      }

      await delay(20000);
    }
  }

  return results;
}

module.exports = bulkConnectAccounts;

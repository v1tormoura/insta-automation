const Account = require('../models/Account');
const { launchBrowser, ensureLogin } = require('./instagramBot');

async function openLoggedAccount(accountId) {
  const account = await Account.findById(accountId);

  if (!account) {
    throw new Error('Conta não encontrada');
  }

  console.log(`🌐 Abrindo conta desktop: ${account.username}`);

  const { page } = await launchBrowser(account.proxy, account.username);

  await ensureLogin(page, account);

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
  });

  console.log(`✅ Conta aberta desktop: ${account.username}`);

  return {
    success: true,
    username: account.username,
  };
}

module.exports = openLoggedAccount;

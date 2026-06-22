const Account = require('../models/Account');
const { launchBrowser, ensureLogin, saveSession, isLoggedIn } = require('./instagramBot');

// Rastreia browsers abertos por username para fechar antes de abrir novo
const _openBrowsers = new Map(); // username -> browser

/**
 * Após o browser estar logado, extrai os cookies do Instagram e cria
 * uma sessão da instagram-private-api, salvando no banco.
 * Isso permite postar stories/reels via API sem precisar logar de novo.
 */
async function capturePrivateApiSession(page, account) {
  try {
    const { IgApiClient } = require('instagram-private-api');

    // Pega todos os cookies do Instagram do browser
    const cookies = await page.cookies('https://www.instagram.com');
    const sessionCookie = cookies.find(c => c.name === 'sessionid');
    if (!sessionCookie) {
      console.log(`⚠️  [CaptureSession] Cookie sessionid não encontrado para @${account.username}`);
      return;
    }

    const ig = new IgApiClient();
    const seed = `${account.username}_${Date.now()}`;
    ig.state.generateDevice(seed);

    // Monta o cookie jar no formato que a biblioteca espera
    const igCookies = cookies
      .filter(c => c.domain && (c.domain.includes('instagram.com')))
      .map(c => ({
        key:          c.name,
        value:        c.value,
        domain:       c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path:         c.path || '/',
        secure:       c.secure  || false,
        httpOnly:     c.httpOnly || false,
        hostOnly:     !c.domain.startsWith('.'),
        creation:     new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      }));

    const jarJson = JSON.stringify({ version: 'tough-cookie@4.1.2', storeType: 'MemoryCookieStore', rejectPublicSuffixes: true, enableLooseMode: false, allowSpecialUseDomain: true, cookies: igCookies });
    await ig.state.deserializeCookieJar(jarJson);

    // Valida a sessão
    const user = await ig.account.currentUser();
    console.log(`✅ [CaptureSession] Sessão API capturada para @${user.username}`);

    // Salva no banco
    const state = await ig.state.serialize();
    delete state.constants;
    state._deviceSeed = seed;

    await Account.findByIdAndUpdate(account._id, { igSession: JSON.stringify(state) });
    console.log(`💾 [CaptureSession] Sessão salva no banco para @${account.username}`);
  } catch (err) {
    console.log(`⚠️  [CaptureSession] Falhou para @${account.username}: ${err.message}`);
  }
}

async function openAccountBrowser(accountId) {
  const account = await Account.findById(accountId);

  if (!account) {
    throw new Error('Conta não encontrada');
  }

  // Fecha browser anterior desta conta se ainda estiver aberto
  const existing = _openBrowsers.get(account.username);
  if (existing) {
    console.log(`🔄 Fechando browser anterior de @${account.username}...`);
    try { await existing.close(); } catch {}
    _openBrowsers.delete(account.username);
    // Aguarda um pouco para o Chrome liberar o profile
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`🌐 Abrindo navegador logado em @${account.username}`);

  const { browser, page } = await launchBrowser(account.proxy, account.username);

  // Registra o browser para poder fechá-lo depois
  _openBrowsers.set(account.username, browser);
  browser.on('disconnected', () => _openBrowsers.delete(account.username));

  await ensureLogin(page, account);

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
    timeout: 120000,
  });

  console.log(`✅ Navegador aberto logado em @${account.username}`);

  // Salva cookies no cookies.json para que storyWebSession/storyPuppeteer possam usar
  await saveSession(page, account.username).catch(e =>
    console.log(`⚠️ [Entrar] saveSession falhou: ${e.message}`)
  );

  // Verifica se sessionid foi salvo com sucesso no cookies.json
  const cookies = await page.cookies().catch(() => []);
  const hasSession = cookies.some(c => c.name === 'sessionid' && c.domain && c.domain.includes('instagram'));
  if (hasSession) {
    console.log(`✅ [Entrar] @${account.username} — sessão pronta para postar stories`);

    // Atualiza status da conta para refletir que sessão está ativa
    try {
      const { broadcast } = require('../events/broadcaster');
      await Account.findByIdAndUpdate(account._id, {
        healthStatus: 'ativa',
        lastError: '',
        lastSync: new Date(),
      });
      broadcast('accounts', { action: 'synced' });
    } catch {}
  } else {
    console.log(`⚠️ [Entrar] @${account.username} — sessionid não encontrado. Tente reconectar via 🔗 API.`);
  }

  return browser;
}

module.exports = openAccountBrowser;
module.exports.capturePrivateApiSession = capturePrivateApiSession;

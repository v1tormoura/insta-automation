const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getAccountSessionDir(username) {
  return path.join(SESSIONS_ROOT, username);
}

function getCookiesPath(username) {
  return path.join(getAccountSessionDir(username), 'cookies.json');
}

function getProfilePath(username) {
  return path.join(getAccountSessionDir(username), 'profile');
}

function isHeadlessEnabled() {
  return String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
}

async function closeExtraPages(browser) {
  const pages = await browser.pages();

  for (let i = 1; i < pages.length; i++) {
    try {
      await pages[i].close();
    } catch {}
  }

  return pages[0] || null;
}

ensureDir(SESSIONS_ROOT);

async function launchBrowser(proxy, username, options = {}) {
  const headless = isHeadlessEnabled();
  const useTempProfile = options.useTempProfile === true;

  console.log('🔥 HEADLESS CONFIG:', headless);

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-features=Translate',
    '--disable-popup-blocking',
    '--lang=pt-BR',
  ];

  if (!headless) {
    if (String(process.env.HIDDEN_BROWSER || 'false').toLowerCase() === 'true') {
      // Move completely off-screen and keep a workable viewport size
      args.push('--window-position=-10000,-10000');
      args.push('--window-size=1366,900');
    } else {
      args.push('--start-maximized');
    }
  }

  if (proxy) {
    args.push(`--proxy-server=${proxy}`);
  }

  const hidden = String(process.env.HIDDEN_BROWSER || 'false').toLowerCase() === 'true';

  const launchOptions = {
    headless: headless ? 'new' : false,
    // Always set a viewport when hidden or headless so Puppeteer has reliable dimensions
    defaultViewport: (headless || hidden) ? { width: 1366, height: 900 } : null,
    args,
  };

  let tempProfilePath = null;

  if (username) {
    if (useTempProfile) {
      tempProfilePath = path.join(
        SESSIONS_ROOT,
        '_temp',
        `${username}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );

      ensureDir(tempProfilePath);
      launchOptions.userDataDir = tempProfilePath;
    } else {
      const profilePath = getProfilePath(username);
      ensureDir(profilePath);
      // Remove lock files do Chrome para evitar "browser already running"
      for (const lock of ['SingletonLock', 'SingletonCookie', 'lockfile']) {
        try { fs.unlinkSync(path.join(profilePath, lock)); } catch {}
      }
      launchOptions.userDataDir = profilePath;
    }
  }

  const browser = await puppeteer.launch(launchOptions);

  let page = await closeExtraPages(browser);

  if (!page || page.isClosed()) {
    page = await browser.newPage();
  }

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9',
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language', {
      get: () => 'pt-BR',
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['pt-BR', 'pt'],
    });
  });

  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  return { browser, page, tempProfilePath };
}

async function saveSession(page, username) {
  const sessionDir = getAccountSessionDir(username);
  ensureDir(sessionDir);

  // Coleta cookies de todas as URLs relevantes do Instagram para garantir sessionid
  let cookies = [];
  try {
    const [c1, c2, c3] = await Promise.all([
      page.cookies('https://www.instagram.com'),
      page.cookies('https://instagram.com'),
      page.cookies(),
    ]);
    // Merge e deduplica por (name + domain)
    const seen = new Set();
    for (const c of [...c1, ...c2, ...c3]) {
      const key = `${c.name}|${c.domain}`;
      if (!seen.has(key)) { seen.add(key); cookies.push(c); }
    }
  } catch {
    cookies = await page.cookies().catch(() => []);
  }

  const sessionId = cookies.find(c => c.name === 'sessionid');
  console.log(`💾 Sessão salva: ${username} (${cookies.length} cookies, sessionid: ${sessionId ? '✅' : '❌'})`);

  fs.writeFileSync(getCookiesPath(username), JSON.stringify(cookies, null, 2));
}

async function loadSession(page, username) {
  const cookiesPath = getCookiesPath(username);

  if (!fs.existsSync(cookiesPath)) {
    console.log(`⚠️ Sessão não encontrada: ${username}`);
    return false;
  }

  const cookies = JSON.parse(fs.readFileSync(cookiesPath));

  if (cookies.length) {
    await page.setCookie(...cookies);
  }

  console.log(`♻️ Sessão carregada: ${username}`);
  return true;
}

async function clickInstagramPopups(page) {
  return await page
    .evaluate(() => {
      const buttons = [...document.querySelectorAll('button, div[role="button"]')];

      // 1. Tenta clicar botões de "não agora" / "permitir" etc.
      const dismissBtn = buttons.find((b) => {
        const text = (b.innerText || '').toLowerCase();
        return (
          text.includes('allow all') ||
          text.includes('permitir todos') ||
          text.includes('not now') ||
          text.includes('agora não') ||
          text.includes('agora nao') ||
          text.includes('salvar informações') ||
          text.includes('save info') ||
          text.includes('não agora') ||
          text.includes('nao agora')
        );
      });

      if (dismissBtn) {
        dismissBtn.click();
        return true;
      }

      return false;
    })
    .catch(() => false);
}

async function isLoggedIn(page) {
  try {
    const url = page.url();
    if (!url.includes('instagram.com')) return false;
    if (
      url.includes('/accounts/login') ||
      url.includes('/accounts/onetap') ||
      url.includes('/accounts/emailsignup') ||
      url.includes('/accounts/password')
    ) return false;

    // Verifica se é a tela "Continuar" (seletor de conta) — não está logado ainda
    const hasContinuarBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some(b => b.innerText.trim().toLowerCase() === 'continuar');
    }).catch(() => false);
    if (hasContinuarBtn) return false;

    return true;
  } catch {
    return false;
  }
}

async function waitManualLoginOr2FA(page, username) {
  console.log('🔐 2FA/checkpoint detectado.');
  console.log('👉 Digite o código do Google Authenticator no navegador.');
  console.log('⏳ O navegador NÃO vai fechar. Aguardando até 10 minutos...');

  const startedAt = Date.now();
  const maxTime = 10 * 60 * 1000;

  while (Date.now() - startedAt < maxTime) {
    try {
      await clickInstagramPopups(page);

      if (await isLoggedIn(page)) {
        await delay(3000);
        await saveSession(page, username);
        console.log(`✅ Login completo e sessão salva: ${username}`);
        return true;
      }

      const url = page.url();
      const text = await page.evaluate(() => document.body.innerText || '').catch(() => '');

      console.log(
        `⏳ Aguardando 2FA de @${username}... ${Math.round((Date.now() - startedAt) / 1000)}s`
      );
      console.log('URL ATUAL:', url);
      console.log('TELA:', text.slice(0, 180).replace(/\n/g, ' | '));
    } catch (err) {
      console.log('⚠️ Aguardando página estabilizar:', err.message);
    }

    await delay(5000);
  }

  throw new Error(`Tempo esgotado aguardando 2FA/checkpoint da conta @${username}.`);
}

async function loginInstagram(page, username, password) {
  console.log(`🔐 Fazendo login: ${username}`);

  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await delay(12000);
  await clickInstagramPopups(page);
  await delay(3000);

  console.log('LOGIN URL:', page.url());

  const inputsInfo = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].map((input, index) => ({
      index,
      type: input.type,
      name: input.name,
      placeholder: input.placeholder,
      aria: input.getAttribute('aria-label'),
      visible: !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length),
    }));
  });

  console.log('INPUTS ENCONTRADOS:', inputsInfo);

  const inputs = await page.$$('input');
  const visibleInputs = [];

  for (const input of inputs) {
    const visible = await input.evaluate((el) => {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    });

    if (visible) visibleInputs.push(input);
  }

  let usernameInput = null;
  let passwordInput = null;

  for (const input of visibleInputs) {
    const info = await input.evaluate((el) => ({
      type: el.type,
      name: el.name,
      placeholder: el.placeholder,
      aria: el.getAttribute('aria-label'),
    }));

    const text = `${info.type} ${info.name} ${info.placeholder} ${info.aria}`.toLowerCase();

    if (
      !usernameInput &&
      (text.includes('username') ||
        text.includes('email') ||
        text.includes('mobile') ||
        text.includes('phone') ||
        text.includes('usuário') ||
        text.includes('usuario') ||
        info.type === 'text' ||
        info.name === 'email')
    ) {
      usernameInput = input;
    }

    if (!passwordInput && (info.type === 'password' || info.name === 'pass')) {
      passwordInput = input;
    }
  }

  if (!usernameInput || !passwordInput) {
    throw new Error(
      `Campos de login não encontrados. Inputs detectados: ${JSON.stringify(inputsInfo)}`
    );
  }

  await usernameInput.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await usernameInput.type(username, { delay: 100 });

  await delay(800);

  await passwordInput.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await passwordInput.type(password, { delay: 100 });

  await delay(1000);

  const clickedLogin = await page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll('button, div[role="button"], input[type="submit"]'),
    ];

    const btn =
      buttons.find((b) => {
        const text = (b.innerText || b.value || '').trim().toLowerCase();
        return text === 'log in' || text === 'login' || text === 'entrar';
      }) || document.querySelector('button[type="submit"], input[type="submit"]');

    if (btn) {
      btn.click();
      return true;
    }

    return false;
  });

  if (!clickedLogin) {
    throw new Error('Botão de login não encontrado.');
  }

  console.log('✅ Login enviado, aguardando resposta...');

  await delay(8000);

  // Se aparecer tela "Continuar" (seletor de conta), clica automaticamente
  const clickedContinuar = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => b.innerText.trim().toLowerCase() === 'continuar');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);

  if (clickedContinuar) {
    console.log('🔄 [Login] Clicando "Continuar" no seletor de conta...');
    await delay(5000);
  }

  await clickInstagramPopups(page);

  const afterLoginUrl = page.url();
  const afterLoginBody = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  const afterText = afterLoginBody.toLowerCase();

  console.log('AFTER LOGIN URL:', afterLoginUrl);
  console.log('AFTER LOGIN BODY:', afterLoginBody.slice(0, 500));

  const needs2FA =
    afterLoginUrl.includes('/challenge') ||
    afterText.includes('challenge') ||
    afterText.includes('security code') ||
    afterText.includes('confirmation code') ||
    afterText.includes('código') ||
    afterText.includes('codigo') ||
    afterText.includes('two-factor') ||
    afterText.includes('2-factor') ||
    afterText.includes('autenticação de dois fatores') ||
    afterText.includes('autenticacao de dois fatores') ||
    afterText.includes('authentication code') ||
    afterText.includes('authenticator app') ||
    afterText.includes('check your phone') ||
    afterText.includes('verifique');

  if (needs2FA) {
    await waitManualLoginOr2FA(page, username);
    return;
  }

  if (!(await isLoggedIn(page))) {
    console.log('⚠️ Login enviado, mas ainda não confirmou entrada.');
    console.log('👉 Se apareceu 2FA/checkpoint, resolva no navegador.');

    await waitManualLoginOr2FA(page, username);
    return;
  }

  await saveSession(page, username);

  console.log(`✅ Login salvo: ${username}`);
}

async function ensureLogin(page, account) {
  // Tenta restaurar cookies (pode não existir se o Chrome profile já tem sessão via userDataDir)
  await loadSession(page, account.username);

  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await delay(5000);

  // Se aparecer a tela "Continuar" (seletor de conta salva), clica automaticamente
  const clickedContinuar = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => b.innerText.trim().toLowerCase() === 'continuar');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);

  if (clickedContinuar) {
    console.log(`🔄 @${account.username} — clicando "Continuar" na seleção de conta...`);
    await delay(6000); // aguarda navegação após clicar Continuar
  }

  await clickInstagramPopups(page);

  // Se já está logado (Chrome profile tem sessão ou cookies funcionaram), não precisa logar de novo
  if (await isLoggedIn(page)) {
    console.log(`✅ Conta logada: ${account.username}`);
    // Refresh cookies.json para manter sessão viva (atualiza timestamp dos cookies)
    await saveSession(page, account.username).catch(() => {});
    return;
  }

  if (!account.password) {
    // Conta sem senha (ex: conectada só via API) — aguarda o usuário interagir no browser (até 10min)
    console.log(`⏳ @${account.username} — sem senha. Aguardando login manual no browser...`);
    await waitManualLoginOr2FA(page, account.username);
    return;
  }

  await loginInstagram(page, account.username, account.password);
}

module.exports = {
  launchBrowser,
  ensureLogin,
  saveSession,
  loadSession,
  closeExtraPages,
  loginInstagram,
  isLoggedIn,
  waitManualLoginOr2FA,
};

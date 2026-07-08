const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const Account = require('../models/Account');
const { extractInstagramProfileStats } = require('../utils/instagramProfileStats');
const traduzirErro = require('../utils/traduzirErro');
const https = require('https');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUsername(username = '') {
  return String(username || '')
    .trim()
    .replace(/^@+/, '');
}

function parseNumber(text = '') {
  const clean = String(text).replace(/[^\d]/g, '');
  return Number(clean || 0);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isHeadlessEnabled() {
  return (
    String(process.env.SYNC_HEADLESS || process.env.HEADLESS || 'true').toLowerCase() !== 'false'
  );
}

async function forcePortugueseBrowser(page) {
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.5,en;q=0.3',
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', {
        get: () => 'pt-BR',
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['pt-BR', 'pt', 'en-US', 'en'],
      });
    });
  } catch (err) {
    console.log('⚠️ Não consegui forçar headers PT-BR:', err.message);
  }
}

async function forceInstagramPortuguese(page) {
  try {
    console.log('🇧🇷 Forçando idioma Português (Brasil)...');

    await page.goto('https://www.instagram.com/accounts/language_preferences/?hl=pt-br', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await delay(7000);

    const result = await page.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const elements = [...document.querySelectorAll('button, div, span, a, label')].filter(
        visible
      );

      const option = elements.find((el) => {
        const text = (el.innerText || '').trim().toLowerCase();

        return (
          text === 'português (brasil)' ||
          text === 'portuguese (brazil)' ||
          text.includes('português (brasil)') ||
          text.includes('portuguese (brazil)')
        );
      });

      if (!option) {
        return {
          ok: false,
          reason: 'option_not_found',
          url: location.href,
          texts: elements
            .map((el) => (el.innerText || '').trim())
            .filter(Boolean)
            .slice(0, 80),
        };
      }

      let clickable = option;

      for (let i = 0; i < 6; i++) {
        const role = clickable.getAttribute?.('role');
        const tag = clickable.tagName;

        if (role === 'button' || role === 'option' || tag === 'BUTTON' || tag === 'A') {
          break;
        }

        if (!clickable.parentElement) break;
        clickable = clickable.parentElement;
      }

      clickable.click();

      return {
        ok: true,
        clickedText: option.innerText,
      };
    });

    console.log('LANGUAGE RESULT:', result);

    await delay(5000);

    return result.ok;
  } catch (err) {
    console.log('⚠️ Não consegui alterar idioma:', err.message);
    return false;
  }
}

async function getCurrentUsername(page) {
  await page.goto('https://www.instagram.com/accounts/edit/?hl=pt-br', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await delay(6000);

  const username = await page.evaluate(() => {
    const input =
      document.querySelector('input[name="username"]') ||
      document.querySelector('input[aria-label="Username"]') ||
      document.querySelector('input[aria-label="Nome de usuário"]') ||
      document.querySelector('input[autocomplete="username"]');

    return input?.value?.trim() || '';
  });

  return normalizeUsername(username);
}

async function downloadAvatar(url, username) {
  try {
    if (!url) return '';

    const avatarsDir = path.resolve(__dirname, '../../uploads/avatars');
    ensureDir(avatarsDir);

    const avatarFile = `${username}.jpg`;
    const avatarPath = path.join(avatarsDir, avatarFile);

    return new Promise((resolve) => {
      const file = fs.createWriteStream(avatarPath);

      https
        .get(url, (response) => {
          response.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve(`/uploads/avatars/${avatarFile}`);
          });
        })
        .on('error', () => {
          resolve('');
        });
    });
  } catch {
    return '';
  }
}

async function syncAccountInfo(accountId) {
  const account = await Account.findById(accountId);

  if (!account) throw new Error('Conta nao encontrada');

  if (account.isBusy) {
    throw new Error('Conta em uso, sincronização ignorada');
  }

  account.isBusy = true;
  account.busyReason = 'Sincronizando';
  account.busySince = new Date();
  await account.save();

  const oldUsername = normalizeUsername(account.username);

  const sessionsRoot = path.resolve(__dirname, '../../sessions');
  const oldSessionDir = path.join(sessionsRoot, oldUsername);
  const oldCookiesPath = path.join(oldSessionDir, 'cookies.json');
  const oldProfilePath = path.join(oldSessionDir, 'profile');

  let browser = null;

  try {
    if (!fs.existsSync(oldCookiesPath)) {
      throw new Error('Sessao nao encontrada');
    }

    const headless = isHeadlessEnabled();

    console.log(`🔥 SYNC HEADLESS: ${headless}`);
    console.log(`🔄 Sync isolado: @${oldUsername}`);

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-features=Translate',
      '--disable-popup-blocking',
      '--disable-notifications',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--lang=pt-BR',
      '--window-size=1280,900',
    ];

    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,
      userDataDir: oldProfilePath,
      defaultViewport: {
        width: 1280,
        height: 900,
      },
      args,
    });

    const pages = await browser.pages();

    for (let i = 1; i < pages.length; i++) {
      try {
        await pages[i].close();
      } catch {}
    }

    const page = pages[0] || (await browser.newPage());

    await forcePortugueseBrowser(page);

    let currentUsername = oldUsername;

    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setCacheEnabled(false);

    const cookies = JSON.parse(fs.readFileSync(oldCookiesPath));

    if (cookies.length) {
      await page.setCookie(...cookies);
    }

    await forceInstagramPortuguese(page);

    const detectedUsername = await getCurrentUsername(page);

    if (detectedUsername) {
      currentUsername = detectedUsername;
    }

    console.log('USERNAME ANTIGO:', oldUsername);
    console.log('USERNAME ATUAL:', currentUsername);

    await page.goto(`https://www.instagram.com/${currentUsername}/?hl=pt-br&t=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await delay(8000);

    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';

      const lines = bodyText
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);

      const avatar =
        [...document.querySelectorAll('img')].find((img) =>
          /profile picture|foto do perfil/i.test(img.alt || '')
        )?.src ||
        document.querySelector('header img')?.src ||
        document.querySelector('meta[property="og:image"]')?.content ||
        '';

      const title = document.querySelector('meta[property="og:title"]')?.content || '';

      const description =
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content ||
        '';

      return {
        avatar,
        title,
        description,
        bodyText,
        lines,
        url: location.href,
      };
    });

    console.log('SYNC URL:', data.url);
    console.log('LINES:', data.lines.slice(0, 40));
    console.log('AVATAR:', data.avatar);

    // ── Detectar sessão expirada (redirecionou para login) ──────────────────
    if (
      data.url.includes('/accounts/login') ||
      data.url.includes('/accounts/onetap') ||
      data.url.includes('accounts/login')
    ) {
      account.healthStatus = 'sessao_expirada';
      account.lastError = 'Sessão expirada — clique em "Entrar" para reconectar';
      account.status = 'erro';
      account.isBusy = false;
      account.busyReason = '';
      account.busySince = null;
      await account.save();
      throw new Error('Sessão expirada (redirecionado para login)');
    }

    // ── Detectar conta banida ou desativada ─────────────────────────────────
    const BANNED_PHRASES = [
      'conta foi desativada',
      'sua conta foi desativada',
      'account has been disabled',
      'account has been suspended',
      'violating our terms',
      'violando nossos termos',
      'desculpe, esta página não está disponível',
      "sorry, this page isn't available",
      'esta página não está disponível',
      "this page isn't available",
      'page not found',
      'página não encontrada',
    ];
    const lowerBodyText = (data.bodyText || '').toLowerCase();
    const isBanned = BANNED_PHRASES.some(p => lowerBodyText.includes(p));
    if (isBanned) {
      console.log(`🚫 [Sync] @${currentUsername} — página indica conta banida/desativada`);
      account.healthStatus = 'banida';
      account.lastError = 'Conta banida ou desativada pelo Instagram';
      account.status = 'erro';
      account.isBusy = false;
      account.busyReason = '';
      account.busySince = null;
      await account.save();
      throw new Error('Conta banida ou desativada pelo Instagram');
    }

    // ── Detectar conta restrita (perfil existe mas sem stats) ──────────────
    // Se a página carregou mas a URL não é do perfil esperado, pode ser restrição
    const profileUrlOk = data.url.includes(`instagram.com/${currentUsername}`);
    if (!profileUrlOk && !data.url.includes('instagram.com/')) {
      console.log(`⚠️ [Sync] @${currentUsername} — URL inesperada: ${data.url}`);
    }

    let postsCount = 0;
    let followers = 0;
    let following = 0;

    const joined = data.lines.join(' ');

    const visibleMatch =
      joined.match(/(\d+)\s+posts?\s+(\d+)\s+followers?\s+(\d+)\s+following/i) ||
      joined.match(/(\d+)\s+posts?\s+(\d+)\s+seguidor(?:es)?\s+(\d+)\s+seguindo/i) ||
      joined.match(/(\d+)\s+publicaç(?:ões|oes)\s+(\d+)\s+seguidor(?:es)?\s+(\d+)\s+seguindo/i);

    if (visibleMatch) {
      postsCount = parseNumber(visibleMatch[1]);
      followers = parseNumber(visibleMatch[2]);
      following = parseNumber(visibleMatch[3]);
    } else {
      const extracted = extractInstagramProfileStats({
        description: data.description,
        stats: [],
        bodyText: data.bodyText,
      });

      followers = extracted.followers;
      following = extracted.following;
      postsCount = extracted.postsCount;
    }

    console.log('AVATAR ENCONTRADO:', data.avatar);

    account.username = currentUsername;
    account.name = data.title.split('(')[0].trim() || account.name;
    account.followers = followers;
    account.following = following;
    account.postsCount = postsCount;
    account.status = 'ativa';
    account.healthStatus = 'ativa';
    account.lastError = '';
    account.lastSync = new Date();

    const localAvatar = await downloadAvatar(data.avatar, currentUsername);

    account.avatar = localAvatar || account.avatar;

    const Growth = require('../models/Growth');

    await Growth.create({
      account: account._id,
      username: currentUsername,
      followers,
      following,
      postsCount,
    });

    account.isBusy = false;
    account.busyReason = '';
    account.busySince = null;

    await account.save();

    if (currentUsername !== oldUsername) {
      const newSessionDir = path.join(sessionsRoot, currentUsername);

      if (!fs.existsSync(newSessionDir)) {
        try {
          fs.cpSync(oldSessionDir, newSessionDir, {
            recursive: true,
          });

          console.log(`📦 Sessão copiada: ${oldUsername} -> ${currentUsername}`);
        } catch (err) {
          console.log('⚠️ Não consegui copiar sessão:', err.message);
        }
      }
    }

    return account;
  } catch (err) {
    account.status = 'erro';
    account.healthStatus = 'restrita';
    account.lastError = traduzirErro(err.message);
    account.isBusy = false;
    account.busyReason = '';
    account.busySince = null;

    await account.save();

    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

module.exports = syncAccountInfo;

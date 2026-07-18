'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const Account = require('../models/Account');
const { broadcast } = require('../events/broadcaster');

puppeteer.use(StealthPlugin());

const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');

function _parseProxy(proxy) {
  if (!proxy?.trim()) return { server: null, username: null, password: null };
  try {
    const url = new URL(proxy.trim().startsWith('http') ? proxy.trim() : `http://${proxy.trim()}`);
    const server = `${url.protocol}//${url.hostname}:${url.port}`;
    return { server, username: url.username || null, password: url.password || null };
  } catch {
    return { server: proxy.trim(), username: null, password: null };
  }
}

async function _launch(proxy) {
  const { server } = _parseProxy(proxy);
  const args = [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu',
    '--window-size=390,844',
  ];
  if (server) args.push(`--proxy-server=${server}`);
  return puppeteer.launch({ headless: true, executablePath: CHROMIUM, args });
}

function _extractSessionid(igSession) {
  try {
    const state = JSON.parse(igSession);
    if (state._rawSessionid) return state._rawSessionid;
    const jar = state.cookieJarSerialization;
    if (!jar) return null;
    let cookies = [];
    if (Array.isArray(jar.cookies)) cookies = jar.cookies;
    else if (jar.cookies && typeof jar.cookies === 'object') {
      for (const domain of Object.values(jar.cookies))
        for (const pathObj of Object.values(domain))
          if (Array.isArray(pathObj)) cookies.push(...pathObj);
          else for (const [k, v] of Object.entries(pathObj))
            cookies.push({ key: k, value: typeof v === 'object' ? (v.value || '') : v });
    }
    return cookies.find(c => c.key === 'sessionid')?.value || null;
  } catch { return null; }
}

async function editProfilePuppeteer(account, { fullName, biography, picBuffer } = {}) {
  const sessionid = account.rawWebSessionid || _extractSessionid(account.igSession);
  if (!sessionid) throw new Error('Sem sessionid — importe via 🍪 antes de editar o perfil.');

  const browser = await _launch(account.proxy);
  const page    = await browser.newPage();

  try {
    const { username: proxyUser, password: proxyPass } = _parseProxy(account.proxy);
    if (proxyUser) await page.authenticate({ username: proxyUser, password: proxyPass });

    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

    await page.setCookie({
      name: 'sessionid', value: sessionid,
      domain: '.instagram.com', path: '/', secure: true, httpOnly: true,
    });

    await page.goto('https://www.instagram.com/accounts/edit/', {
      waitUntil: 'networkidle2', timeout: 40_000,
    });

    const url = page.url();
    if (url.includes('/accounts/login') || url.includes('/challenge/')) {
      throw new Error('sessionid expirado ou conta bloqueada — reimporte via 🍪');
    }

    // Nome completo
    if (fullName !== undefined) {
      const sel = 'input[name="fullName"], input[aria-label*="name" i], input[aria-label*="nome" i]';
      const el = await page.waitForSelector(sel, { timeout: 15_000 });
      await el.click({ clickCount: 3 });
      await el.evaluate(n => n.value = '');
      await el.type(fullName, { delay: 40 });
    }

    // Bio
    if (biography !== undefined) {
      const sel = 'textarea[name="biography"], textarea[aria-label*="bio" i]';
      const el = await page.waitForSelector(sel, { timeout: 10_000 });
      await el.click({ clickCount: 3 });
      await el.evaluate(n => n.value = '');
      await el.type(biography, { delay: 25 });
    }

    // Salva alterações de texto
    if (fullName !== undefined || biography !== undefined) {
      const btn = await page.waitForSelector('button[type="submit"]', { timeout: 5_000 });
      await btn.click();
      await new Promise(r => setTimeout(r, 2_500));
    }

    // Foto de perfil
    if (picBuffer) {
      const tmp = path.join(os.tmpdir(), `ig_pic_${account._id}_${Date.now()}.jpg`);
      fs.writeFileSync(tmp, picBuffer);
      try {
        // Tenta localizar o input de foto ou botão de troca
        const fileInput = await page.$('input[type="file"][accept*="image"]');
        if (fileInput) {
          await fileInput.uploadFile(tmp);
          await new Promise(r => setTimeout(r, 3_000));
        } else {
          // Alternativa: clica no avatar/botão de foto e captura o fileChooser
          const photoTrigger = await page.$('button[class*="photo"], img[data-testid*="user-avatar"], ._aatk');
          if (photoTrigger) {
            const [chooser] = await Promise.all([
              page.waitForFileChooser({ timeout: 5_000 }).catch(() => null),
              photoTrigger.click(),
            ]);
            if (chooser) { await chooser.accept([tmp]); await new Promise(r => setTimeout(r, 3_000)); }
          }
        }
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }

      // Cache local do avatar
      try {
        if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
        fs.writeFileSync(path.join(AVATARS_DIR, `${account.username}.jpg`), picBuffer);
        await Account.findByIdAndUpdate(account._id, { avatar: `/uploads/avatars/${account.username}.jpg` });
      } catch {}
    }

    const dbUpdate = { healthStatus: 'ativa', lastError: '' };
    if (fullName !== undefined) dbUpdate.name = fullName;
    await Account.findByIdAndUpdate(account._id, dbUpdate);
    broadcast('accounts', { action: 'synced' });

    console.log(`[PuppeteerEdit] @${account.username} — concluído`);
    return { profileEdited: fullName !== undefined || biography !== undefined, pictureChanged: !!picBuffer };
  } catch (err) {
    await Account.findByIdAndUpdate(account._id, { lastError: err.message }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { editProfilePuppeteer };

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
    '--window-size=1280,800',
    '--disable-features=ServiceWorker',
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

    await page.setCookie(
      { name: 'sessionid', value: sessionid, domain: '.instagram.com', path: '/', secure: true, httpOnly: true },
    );

    // Navega diretamente para o endpoint JSON — antes do SPA carregar, sem service worker
    await page.setExtraHTTPHeaders({
      'Accept': 'application/json, text/plain, */*',
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
    });

    const meResponse = await page.goto(
      'https://www.instagram.com/api/v1/accounts/current_user/?edit=true',
      { waitUntil: 'domcontentloaded', timeout: 20_000 }
    );
    const meText = await meResponse.text();
    let meData = {};
    try { meData = JSON.parse(meText); } catch {}
    const me = meData.user || meData;

    if (!me?.username) {
      const status = meResponse.status();
      if (status === 401 || meText.includes('"login_required"') || meText.includes('"not_authorized"')) {
        throw new Error('sessionid expirado — reimporte via 🍪');
      }
      // Ainda retornou HTML: usa o sessionid direto via fetch com headers completos
      const fallback = await page.evaluate(async ({ sid, fullName, biography }) => {
        try {
          const meR = await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', {
            headers: {
              'Cookie': `sessionid=${sid}`,
              'X-IG-App-ID': '936619743392459',
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': 'application/json',
            },
            credentials: 'include',
          });
          const t = await meR.text();
          let d = {}; try { d = JSON.parse(t); } catch {}
          const u = d.user || d;
          if (!u?.username) return { error: `sem username (${meR.status}): ${t.slice(0, 80)}` };

          const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
          const body = new URLSearchParams({
            username: u.username,
            full_name: fullName !== undefined ? fullName : (u.full_name || ''),
            biography: biography !== undefined ? biography : (u.biography || ''),
            external_url: u.external_url || '',
            email: u.email || '',
            phone_number: u.phone_number || '',
            gender: String(u.gender ?? 4),
            custom_gender: u.custom_gender || '',
          });
          const editR = await fetch('https://www.instagram.com/api/v1/accounts/edit/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-CSRFToken': csrf,
              'X-IG-App-ID': '936619743392459',
            },
            body: body.toString(),
            credentials: 'include',
          });
          const ed = await editR.json().catch(() => ({}));
          if (!editR.ok || ed.status === 'fail') return { error: ed.message || `HTTP ${editR.status}` };
          return { ok: true };
        } catch (e) { return { error: e.message }; }
      }, { sid: sessionid, fullName, biography });

      if (fallback.error) throw new Error(fallback.error);
      // fallback funcionou — pula para o save do DB
      const dbUpdate = { healthStatus: 'ativa', lastError: '' };
      if (fullName !== undefined) dbUpdate.name = fullName;
      await Account.findByIdAndUpdate(account._id, dbUpdate);
      broadcast('accounts', { action: 'synced' });
      console.log(`[PuppeteerEdit] @${account.username} — concluído (fallback fetch)`);
      return { profileEdited: fullName !== undefined || biography !== undefined, pictureChanged: false };
    }

    // Caso normal: navegação direta retornou JSON
    const result = await page.evaluate(async ({ fullName, biography, me }) => {
      try {
        const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
        const body = new URLSearchParams({
          username:      me.username,
          full_name:     fullName  !== undefined ? fullName  : (me.full_name  || ''),
          biography:     biography !== undefined ? biography : (me.biography  || ''),
          external_url:  me.external_url  || '',
          email:         me.email         || '',
          phone_number:  me.phone_number  || '',
          gender:        String(me.gender ?? 4),
          custom_gender: me.custom_gender || '',
        });
        const editR = await fetch('/api/v1/accounts/edit/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': csrf,
            'X-IG-App-ID': '936619743392459',
          },
          body: body.toString(),
          credentials: 'include',
        });
        const ed = await editR.json().catch(() => ({}));
        if (!editR.ok || ed.status === 'fail') return { error: ed.message || `HTTP ${editR.status}` };
        return { ok: true };
      } catch (e) { return { error: e.message }; }
    }, { fullName, biography, me });

    if (result.error) throw new Error(result.error);

    // Foto de perfil via fetch dentro do browser
    if (picBuffer) {
      const b64 = picBuffer.toString('base64');
      const photoResult = await page.evaluate(async (b64) => {
        try {
          const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          const form = new FormData();
          form.append('profile_pic', blob, 'photo.jpg');
          const r = await fetch('/api/v1/accounts/change_profile_picture/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrfToken, 'X-IG-App-ID': '936619743392459' },
            body: form,
            credentials: 'include',
          });
          return { ok: r.ok, status: r.status };
        } catch (e) { return { error: e.message }; }
      }, b64);

      if (!photoResult.error && photoResult.ok) {
        try {
          if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
          fs.writeFileSync(path.join(AVATARS_DIR, `${account.username}.jpg`), picBuffer);
          await Account.findByIdAndUpdate(account._id, { avatar: `/uploads/avatars/${account.username}.jpg` });
        } catch {}
      }
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

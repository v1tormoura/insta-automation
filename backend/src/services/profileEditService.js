'use strict';

const fs   = require('fs');
const path = require('path');
const Account = require('../models/Account');
const { createClient } = require('./instagramPrivateService');
const { broadcast }    = require('../events/broadcaster');
const { editProfilePuppeteer } = require('./puppeteerProfileService');

const delay = ms => new Promise(r => setTimeout(r, ms));

const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');
const IG_HOST = 'https://www.instagram.com';
// Mesmo UA usado pelo import-session (comprovadamente funciona)
const IG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function _extractCookies(igSessionStr) {
  try {
    const state = JSON.parse(igSessionStr);
    if (state._rawSessionid) {
      return { sessionid: state._rawSessionid, csrftoken: state._rawCsrftoken || '', ds_user_id: state._rawDsUserId || '' };
    }
    const jar = state.cookieJarSerialization;
    if (!jar) return null;
    let cookies = [];
    if (Array.isArray(jar.cookies)) {
      cookies = jar.cookies;
    } else if (jar.cookies && typeof jar.cookies === 'object') {
      for (const domain of Object.values(jar.cookies)) {
        for (const pathObj of Object.values(domain)) {
          if (Array.isArray(pathObj)) cookies.push(...pathObj);
          else for (const [k, v] of Object.entries(pathObj))
            cookies.push({ key: k, value: typeof v === 'object' ? (v.value || '') : v });
        }
      }
    }
    const get = key => cookies.find(c => c.key === key)?.value || '';
    const sessionid = get('sessionid');
    if (!sessionid) return null;
    return { sessionid, csrftoken: get('csrftoken'), ds_user_id: get('ds_user_id') };
  } catch { return null; }
}

function _makeProxy(proxyUrl) {
  if (!proxyUrl?.trim()) return undefined;
  try { return new (require('undici').ProxyAgent)(proxyUrl.trim()); } catch { return undefined; }
}

// Fetch direto — mesma abordagem do import-session que funciona
async function _igGet(sessionid, proxy) {
  const dispatcher = _makeProxy(proxy);
  const r = await fetch(`${IG_HOST}/api/v1/accounts/current_user/?edit=true`, {
    headers: {
      'Cookie': `sessionid=${sessionid}`,
      'User-Agent': IG_UA,
      'X-IG-App-ID': '936619743392459',
    },
    signal: AbortSignal.timeout(20_000),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch {
    if (r.status >= 300 && r.status < 400) throw new Error('Sessão expirada (redirect) — reimporte via 🍪');
    throw new Error('Instagram não retornou JSON — verifique o proxy ou tente novamente');
  }
  if (r.status === 401 || data.message === 'login_required') throw new Error('Sessão expirada — reimporte via 🍪');
  if (!data.user?.username) throw new Error(data.message || `Sessão inválida (${r.status})`);
  // Extrai csrftoken do Set-Cookie da resposta
  const setCookie = r.headers.get('set-cookie') || '';
  const csrfMatch = setCookie.match(/csrftoken=([^;,\s]+)/);
  return { user: data.user, csrftoken: csrfMatch ? csrfMatch[1] : '' };
}

async function _igPost(path, body, sessionid, csrftoken, proxy) {
  const dispatcher = _makeProxy(proxy);
  const r = await fetch(`${IG_HOST}${path}`, {
    method: 'POST',
    headers: {
      'Cookie': `sessionid=${sessionid}; csrftoken=${csrftoken}`,
      'User-Agent': IG_UA,
      'X-IG-App-ID': '936619743392459',
      'X-CSRFToken': csrftoken,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': IG_HOST,
      'Referer': `${IG_HOST}/accounts/edit/`,
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status}`); }
  if (!r.ok || data.status === 'fail') throw new Error(data.message || `HTTP ${r.status}`);
  return data;
}

async function _editViaWebApi(account, { fullName, biography, gender, customGender, picBuffer }) {
  const sessionid = account.rawWebSessionid || _extractCookies(account.igSession)?.sessionid;
  if (!sessionid) throw new Error('Sessão expirada — reimporte o sessionid via 🍪');

  const proxy = account.proxy?.trim() || null;
  const dbUpdate = { healthStatus: 'ativa', lastError: '' };
  const results = {};

  if (fullName !== undefined || biography !== undefined || gender !== undefined) {
    const { user: current, csrftoken } = await _igGet(sessionid, proxy);

    // Fallback csrftoken do igSession se a resposta não trouxe
    const csrf = csrftoken || _extractCookies(account.igSession)?.csrftoken || 'missing';

    await _igPost('/api/v1/accounts/edit/', {
      username:      current.username || account.username,
      full_name:     fullName    !== undefined ? fullName    : (current.full_name    || ''),
      biography:     biography   !== undefined ? biography   : (current.biography    || ''),
      external_url:  current.external_url  || '',
      email:         current.email         || '',
      phone_number:  current.phone_number  || '',
      gender:        String(gender !== undefined ? Number(gender) : (current.gender ?? 4)),
      custom_gender: customGender !== undefined ? customGender : (current.custom_gender || ''),
    }, sessionid, csrf, proxy);

    results.profileEdited = true;
    if (fullName  !== undefined) dbUpdate.name = fullName;
    if (biography !== undefined) dbUpdate.bio  = biography;
    console.log(`[EditProfile/Web] @${account.username} — perfil atualizado`);
    await delay(1500);
  }

  if (picBuffer) {
    const csrf2 = _extractCookies(account.igSession)?.csrftoken || 'missing';
    const dispatcher = _makeProxy(proxy);
    const formData = new FormData();
    formData.append('profile_pic', new Blob([picBuffer], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(`${IG_HOST}/api/v1/accounts/change_profile_picture/`, {
      method: 'POST',
      headers: {
        'Cookie': `sessionid=${sessionid}; csrftoken=${csrf2}`,
        'User-Agent': IG_UA,
        'X-IG-App-ID': '936619743392459',
        'X-CSRFToken': csrf2,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!r.ok) throw new Error(`Falha ao trocar foto: HTTP ${r.status}`);
    results.pictureChanged = true;
    console.log(`[EditProfile/Web] @${account.username} — foto trocada`);
    try {
      if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
      fs.writeFileSync(path.join(AVATARS_DIR, `${account.username}.jpg`), picBuffer);
      dbUpdate.avatar = `/uploads/avatars/${account.username}.jpg`;
    } catch {}
  }

  await Account.findByIdAndUpdate(account._id, dbUpdate);
  broadcast('accounts', { action: 'synced' });
  return results;
}

async function editProfile(account, { fullName, biography, gender, profilePicUrl, profilePicBuffer, customGender }, _retried = false) {
  let picBuffer = profilePicBuffer || null;
  if (!picBuffer && profilePicUrl) {
    const res = await fetch(profilePicUrl);
    if (!res.ok) throw new Error(`Nao foi possivel baixar a foto: HTTP ${res.status}`);
    picBuffer = Buffer.from(await res.arrayBuffer());
  }

  // rawWebSessionid presente → fetch server-side direto (igual ao import-session que funciona)
  if (account.rawWebSessionid) {
    console.log(`[EditProfile] @${account.username} — web API direta (rawWebSessionid)`);
    return _editViaWebApi(account, { fullName, biography, gender, customGender, picBuffer });
  }

  if (account.igSession) {
    try {
      return await editProfilePuppeteer(account, { fullName, biography, picBuffer });
    } catch (puppeteerErr) {
      console.log(`[EditProfile] @${account.username} — Puppeteer falhou (${puppeteerErr.message.slice(0,60)}), tentando web API...`);
      if (puppeteerErr.message.includes('sessionid expirado') || puppeteerErr.message.includes('Sem sessionid')) {
        throw puppeteerErr;
      }
      const fresh = await Account.findById(account._id);
      return _editViaWebApi(fresh, { fullName, biography, gender, customGender, picBuffer });
    }
  }

  // Sem sessionid web — tenta mobile API
  let ig = null;
  try {
    ig = await createClient(account);
  } catch (firstErr) {
    if (firstErr.code === 'CHALLENGE_REQUIRED') {
      await Account.findByIdAndUpdate(account._id, {
        healthStatus: 'sessao_expirada',
        challengeState: '',
        lastError: 'Sessão mobile expirada — tentando web API',
      });
      const freshForWeb = await Account.findById(account._id);
      if (freshForWeb?.rawWebSessionid) {
        return _editViaWebApi(freshForWeb, { fullName, biography, gender, customGender, picBuffer });
      }
      const hasProxy = account.proxy?.trim();
      throw new Error(`@${account.username}: Sessão expirada — ${hasProxy ? 'clique ⚡ para reconectar via proxy' : 'reimporte os cookies (🍪) ou configure um proxy residencial e clique ⚡ Reconectar'}`);
    }
    if (firstErr.code === 'TOTP_REQUIRED') {
      throw new Error(`@${account.username}: 2FA necessário — configure a chave 2FA no botão ✏️ da conta.`);
    }
    if (firstErr.code === 'LOGIN_EMAIL_REQUIRED' || firstErr.code === 'MOBILE_API_REJECTED') {
      const freshForWeb2 = await Account.findById(account._id);
      if (freshForWeb2?.rawWebSessionid) {
        return _editViaWebApi(freshForWeb2, { fullName, biography, gender, customGender, picBuffer });
      }
      if (firstErr.code === 'LOGIN_EMAIL_REQUIRED') {
        throw new Error(`@${account.username}: Instagram não reconheceu o username — reimporte o sessionid via 🍪 ou configure o email de login no ✏️.`);
      }
    }
    if (account.password) {
      throw new Error(`@${account.username}: falha no login — ${firstErr.message}`);
    }
    console.log(`[EditProfile] @${account.username} — sem senha, mobile API falhou (${firstErr.code || firstErr.message?.slice(0,60)}), tentando web API...`);
  }

  if (ig) {
    async function guardedCall(fn) {
      try {
        return await fn();
      } catch (e) {
        if (e.statusCode === 403 || /login.required|not.authorized|login_required/i.test(e.message)) {
          ig = null;
          const webErr = new Error('MOBILE_API_REJECTED');
          webErr.code = 'MOBILE_API_REJECTED';
          throw webErr;
        }
        throw e;
      }
    }

    const results = {};
    const dbUpdate = { healthStatus: 'ativa', lastError: '' };

    try {
      if (fullName !== undefined || biography !== undefined || gender !== undefined) {
        const current = await guardedCall(() => ig.account.currentUser());
        const payload = {
          username:      current.username,
          full_name:     fullName    !== undefined ? fullName    : (current.full_name || ''),
          biography:     biography   !== undefined ? biography   : (current.biography || ''),
          external_url:  current.external_url || '',
          email:         current.email        || '',
          phone_number:  current.phone_number || '',
          gender:        gender !== undefined ? Number(gender) : (current.gender ?? 4),
          custom_gender: customGender !== undefined ? customGender : (current.custom_gender || ''),
        };
        await guardedCall(() => ig.account.editProfile(payload));
        results.profileEdited = true;
        console.log(`[EditProfile] @${account.username} — nome/bio/genero atualizados`);
        if (fullName  !== undefined) dbUpdate.name = fullName;
        if (biography !== undefined) dbUpdate.bio  = biography;
        await delay(1500);
      }

      if (picBuffer) {
        await guardedCall(() => ig.account.changeProfilePicture(picBuffer));
        results.pictureChanged = true;
        console.log(`[EditProfile] @${account.username} — foto trocada`);
        try {
          if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
          fs.writeFileSync(path.join(AVATARS_DIR, `${account.username}.jpg`), picBuffer);
          dbUpdate.avatar = `/uploads/avatars/${account.username}.jpg`;
        } catch {}
      }

      await Account.findByIdAndUpdate(account._id, dbUpdate);
      broadcast('accounts', { action: 'synced' });
      return results;
    } catch (mobileErr) {
      if (mobileErr.code !== 'MOBILE_API_REJECTED') throw mobileErr;
      if (account.password && !_retried) {
        console.log(`[EditProfile] @${account.username} — mobile API rejeitou sessão, recriando com senha...`);
        await Account.findByIdAndUpdate(account._id, { igSession: '' });
        return editProfile(await Account.findById(account._id), { fullName, biography, gender, profilePicUrl: null, profilePicBuffer: picBuffer, customGender }, true);
      }
      const fresh = await Account.findById(account._id);
      if (!fresh?.rawWebSessionid) throw new Error('Sessão expirada — reimporte o sessionid via 🍪');
      return _editViaWebApi(fresh, { fullName, biography, gender, customGender, picBuffer });
    }
  }

  const freshForWeb = await Account.findById(account._id);
  if (freshForWeb?.igSession || freshForWeb?.rawWebSessionid) {
    console.log(`[EditProfile] @${account.username} — usando web API (sem mobile session)`);
    return _editViaWebApi(freshForWeb, { fullName, biography, gender, customGender, picBuffer });
  }

  throw new Error(`@${account.username}: sem sessão válida. Importe cookies (🍪) ou configure uma senha.`);
}

async function bulkEditProfiles(edits, { delayBetween = 5000, jobId } = {}) {
  const results = [];
  const total   = edits.length;

  for (let i = 0; i < edits.length; i++) {
    const edit    = edits[i];
    const account = await Account.findById(edit.accountId);
    if (!account) {
      results.push({ accountId: edit.accountId, status: 'error', error: 'Conta nao encontrada' });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, status: 'error' } });
      continue;
    }

    if (!account.igSession && !account.password && !account.rawWebSessionid) {
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: 'Sem sessao — importe cookies via 🍪 ou configure senha' });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, username: account.username, status: 'error' } });
      continue;
    }

    try {
      const r = await editProfile(account, edit);
      results.push({ accountId: edit.accountId, username: account.username, status: 'ok', ...r });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, username: account.username, status: 'ok' } });
    } catch (err) {
      console.error(`[EditProfile] @${account.username}:`, err.message);
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: err.message });
      if (jobId) broadcast('profile_edit', { jobId, done: i + 1, total, latest: { accountId: edit.accountId, username: account.username, status: 'error', error: err.message } });
    }

    if (delayBetween > 0) await delay(delayBetween);
  }

  return results;
}

module.exports = { editProfile, bulkEditProfiles };

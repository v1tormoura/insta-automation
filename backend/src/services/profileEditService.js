'use strict';

/**
 * Edição de perfil via Private API (nome, bio, gênero, foto).
 * Tenta primeiro mobile API; se o sessionid for do browser (web),
 * faz fallback automático para a API web do Instagram.
 *
 * Gênero: 1 = Masculino, 2 = Feminino, 3 = Não-binário/Personalizado, 4 = Prefiro não dizer
 */

const fs   = require('fs');
const path = require('path');
const Account = require('../models/Account');
const { createClient } = require('./instagramPrivateService');
const { broadcast }    = require('../events/broadcaster');

const delay = ms => new Promise(r => setTimeout(r, ms));

const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');

const WEB_HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'X-IG-App-ID': '936619743392459',
  'Origin': 'https://www.instagram.com',
  'Referer': 'https://www.instagram.com/accounts/edit/',
};

function _extractCookies(igSessionStr) {
  try {
    const state = JSON.parse(igSessionStr);
    // Caminho rápido: sessionid bruto salvo durante o import
    if (state._rawSessionid) {
      return { sessionid: state._rawSessionid, csrftoken: state._rawCsrftoken || '', ds_user_id: state._rawDsUserId || '' };
    }
    // Fallback: parseia o cookieJar serializado (array ou nested)
    const jar = state.cookieJarSerialization;
    const cookies = Array.isArray(jar?.cookies) ? jar.cookies
      : Array.isArray(jar) ? jar : [];
    const get = key => cookies.find(c => c.key === key)?.value || '';
    return { sessionid: get('sessionid'), csrftoken: get('csrftoken'), ds_user_id: get('ds_user_id') };
  } catch {
    return null;
  }
}

async function _webApiGet(url, { sessionid, csrftoken }) {
  const r = await fetch(url, {
    headers: {
      ...WEB_HEADERS_BASE,
      'Cookie': `sessionid=${sessionid}; csrftoken=${csrftoken}`,
      'X-CSRFToken': csrftoken,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401 || r.status === 403) throw new Error(`web_auth_failed:${r.status}`);
  return r.json();
}

async function _webApiPost(url, body, { sessionid, csrftoken }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...WEB_HEADERS_BASE,
      'Cookie': `sessionid=${sessionid}; csrftoken=${csrftoken}`,
      'X-CSRFToken': csrftoken,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401 || r.status === 403) throw new Error(`web_auth_failed:${r.status}`);
  const data = await r.json().catch(() => ({}));
  if (data.status === 'fail' || data.message) throw new Error(data.message || 'web API retornou erro');
  return data;
}

async function _editViaWebApi(account, { fullName, biography, gender, customGender, picBuffer }) {
  const creds = _extractCookies(account.igSession);
  if (!creds?.sessionid) throw new Error('sessionid não encontrado no igSession salvo');

  const results = {};
  const dbUpdate = { healthStatus: 'ativa', lastError: '' };

  if (fullName !== undefined || biography !== undefined || gender !== undefined) {
    const meData = await _webApiGet(
      'https://www.instagram.com/api/v1/accounts/current_user/?edit=true',
      creds
    );
    const current = meData.user || meData;

    await _webApiPost('https://www.instagram.com/api/v1/accounts/edit/', {
      username:      current.username || account.username,
      full_name:     fullName    !== undefined ? fullName    : (current.full_name || ''),
      biography:     biography   !== undefined ? biography   : (current.biography || ''),
      external_url:  current.external_url || '',
      email:         current.email        || '',
      phone_number:  current.phone_number || '',
      gender:        String(gender !== undefined ? Number(gender) : (current.gender ?? 4)),
      custom_gender: customGender !== undefined ? customGender : (current.custom_gender || ''),
    }, creds);

    results.profileEdited = true;
    console.log(`[EditProfile/Web] @${account.username} — nome/bio/genero atualizados`);
    if (fullName  !== undefined) dbUpdate.name = fullName;
    if (biography !== undefined) dbUpdate.bio  = biography;
    await delay(1500);
  }

  if (picBuffer) {
    // Foto via web API: multipart/form-data
    const formData = new FormData();
    formData.append('profile_pic', new Blob([picBuffer], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch('https://www.instagram.com/api/v1/accounts/change_profile_picture/', {
      method: 'POST',
      headers: {
        ...WEB_HEADERS_BASE,
        'Cookie': `sessionid=${creds.sessionid}; csrftoken=${creds.csrftoken}`,
        'X-CSRFToken': creds.csrftoken,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Falha ao trocar foto via web API: HTTP ${r.status}`);
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

async function editProfile(account, { fullName, biography, gender, profilePicUrl, profilePicBuffer, customGender }) {
  let picBuffer = profilePicBuffer || null;
  if (!picBuffer && profilePicUrl) {
    const res = await fetch(profilePicUrl);
    if (!res.ok) throw new Error(`Nao foi possivel baixar a foto: HTTP ${res.status}`);
    picBuffer = Buffer.from(await res.arrayBuffer());
  }

  // Tenta mobile API primeiro
  let ig = null;
  try {
    ig = await createClient(account);
  } catch (firstErr) {
    if (firstErr.code === 'CHALLENGE_REQUIRED' || firstErr.code === 'TOTP_REQUIRED') {
      await Account.findByIdAndUpdate(account._id, { challengeState: null, igSession: '' });
      const fresh = await Account.findById(account._id);
      try { ig = await createClient(fresh); } catch {}
    }
    // SESSION_EXPIRED ou outro: ig continua null → tenta web API abaixo
  }

  if (ig) {
    // Mobile API disponível — usa ela
    async function guardedCall(fn) {
      try {
        return await fn();
      } catch (e) {
        if (e.statusCode === 403 || /login.required|not.authorized|login_required/i.test(e.message)) {
          ig = null; // sinaliza para tentar web API
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
      console.log(`[EditProfile] @${account.username} — mobile API rejeitou, tentando web API...`);
      // Recarrega conta pois igSession pode ter sido apagado acima
      const fresh = await Account.findById(account._id);
      if (!fresh?.igSession) throw new Error('Sessão expirada — reimporte o sessionid via 🍪');
      return _editViaWebApi(fresh, { fullName, biography, gender, customGender, picBuffer });
    }
  }

  // Sem mobile API — tenta web API diretamente se há igSession
  const freshForWeb = await Account.findById(account._id);
  if (freshForWeb?.igSession) {
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

    if (!account.igSession && !account.password) {
      results.push({ accountId: edit.accountId, username: account.username, status: 'error', error: 'Sem sessao ou senha — nao e possivel editar via Private API' });
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

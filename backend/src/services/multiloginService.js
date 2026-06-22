'use strict';

/**
 * Multilogin auto-sync service.
 * Suporta ML6 local (porta 63332) e MLX cloud.
 * Se a conta nao tiver multiloginProfileId, descobre automaticamente
 * pelo nome do perfil (deve conter o username do Instagram).
 */

const fs   = require('fs');
const path = require('path');
const Account = require('../models/Account');

const ML6_BASE = 'http://127.0.0.1:63332';
const MLX_BASE = 'https://api.multilogin.com';
const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');

let _cloudToken    = null;
let _cloudTokenExp = 0;

async function getCloudToken() {
  if (_cloudToken && Date.now() < _cloudTokenExp) return _cloudToken;

  const email    = process.env.MULTILOGIN_EMAIL;
  const password = process.env.MULTILOGIN_PASSWORD;
  if (!email || !password) throw new Error('MULTILOGIN_EMAIL / MULTILOGIN_PASSWORD nao definidos no .env');

  const crypto  = require('crypto');
  const pwdHash = crypto.createHash('md5').update(password).digest('hex');

  const r = await fetch(`${MLX_BASE}/user/signin`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password: pwdHash }),
  });
  const d = await r.json();
  if (!d.data?.token) throw new Error(`Login Multilogin X falhou: ${JSON.stringify(d)}`);

  _cloudToken    = d.data.token;
  _cloudTokenExp = Date.now() + 55 * 60 * 1000;
  return _cloudToken;
}

// Token local do ML6 (requer auth igual ao cloud)
let _ml6Token    = null;
let _ml6TokenExp = 0;

async function getMl6Token() {
  if (_ml6Token && Date.now() < _ml6TokenExp) return _ml6Token;

  const email    = process.env.MULTILOGIN_EMAIL;
  const password = process.env.MULTILOGIN_PASSWORD;
  if (!email || !password) return null; // ML6 pode rodar sem auth

  const crypto  = require('crypto');
  const pwdHash = crypto.createHash('md5').update(password).digest('hex');

  try {
    const r = await fetch(`${ML6_BASE}/user/signin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password: pwdHash }),
      signal:  AbortSignal.timeout(5000),
    });
    const d = await r.json();
    const token = d?.data?.token || d?.token;
    if (token) {
      _ml6Token    = token;
      _ml6TokenExp = Date.now() + 55 * 60 * 1000;
      return _ml6Token;
    }
  } catch {}
  return null;
}

// Lista todos os perfis do ML6 local
// Tenta com e sem autenticação, e múltiplos formatos de resposta
async function listProfilesLocal() {
  const token = await getMl6Token();
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  let all = [];
  let offset = 0;
  const count = 100;

  for (;;) {
    const url = `${ML6_BASE}/api/v1/profile?offset=${offset}&count=${count}`;
    let r;
    try {
      r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    } catch (e) {
      console.log(`[Multilogin] ML6 nao acessivel em ${ML6_BASE}: ${e.message}`);
      break;
    }
    if (!r.ok) {
      console.log(`[Multilogin] ML6 /profile retornou ${r.status}`);
      break;
    }

    const body = await r.json();
    // ML6 pode retornar: array, { data: [...] }, { profiles: [...] }, { data: { profiles: [...] } }
    let page = [];
    if (Array.isArray(body))                  page = body;
    else if (Array.isArray(body.data))        page = body.data;
    else if (Array.isArray(body.profiles))    page = body.profiles;
    else if (Array.isArray(body.data?.profiles)) page = body.data.profiles;

    if (!page.length) break;

    all = all.concat(page);
    if (page.length < count) break;
    offset += count;
  }

  return all;
}

// Descobre automaticamente o perfil do Multilogin pelo username da conta Instagram
async function autoDiscoverProfile(account) {
  const mode = (process.env.MULTILOGIN_MODE || 'local').toLowerCase();

  if (mode !== 'local') {
    throw new Error(
      'Auto-descoberta de perfil so esta disponivel em modo local (ML6). ' +
      'Em modo cloud, defina multiloginProfileId manualmente na conta.'
    );
  }

  console.log(`[Multilogin] Auto-descobrindo perfil para @${account.username}...`);
  const profiles = await listProfilesLocal();

  if (!profiles.length) {
    throw new Error(
      'Multilogin nao retornou perfis. Verifique se o Multilogin 6 esta rodando na porta 63332.'
    );
  }

  const user = account.username.toLowerCase();
  const found =
    profiles.find(p => (p.name || '').toLowerCase() === user) ||
    profiles.find(p => (p.name || '').toLowerCase().includes(user)) ||
    profiles.find(p => user.includes((p.name || '').toLowerCase().replace('@', '')));

  if (!found) {
    const names = profiles.slice(0, 10).map(p => p.name || p.uuid).join(', ');
    throw new Error(
      `Nenhum perfil Multilogin com nome "@${account.username}" encontrado. ` +
      `Perfis disponiveis: ${names}. ` +
      `Renomeie o perfil para conter "${account.username}" ou defina multiloginProfileId manualmente.`
    );
  }

  const profileId = found.uuid || found.id;
  console.log(`[Multilogin] Perfil encontrado: "${found.name}" (${profileId})`);

  // Salva na conta para evitar re-descoberta
  await Account.findByIdAndUpdate(account._id, { multiloginProfileId: profileId });

  return profileId;
}

async function getCookiesLocal(profileId) {
  const url = `${ML6_BASE}/api/v1/profile/cookies/export?profileId=${profileId}`;
  const r   = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`ML6 cookies export falhou: ${r.status}`);
  const cookies = await r.json();
  return cookies.filter(c => (c.domain || '').includes('instagram'));
}

async function getCookiesCloud(profileId) {
  const token = await getCloudToken();

  await fetch(`${MLX_BASE}/browser/start`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ profile_id: profileId, headless: true }),
  });

  await new Promise(r => setTimeout(r, 3000));

  const r = await fetch(`${MLX_BASE}/profile/cookies/export?profile_id=${profileId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`MLX cookies export falhou: ${r.status}`);
  const cookies = await r.json();
  return (cookies.data || cookies).filter(c => (c.domain || '').includes('instagram'));
}

// Exporta cookies do Multilogin e salva em disco para a conta.
// Se multiloginProfileId nao estiver definido, descobre automaticamente pelo nome.
async function syncCookiesFromMultilogin(account) {
  const mode = (process.env.MULTILOGIN_MODE || 'local').toLowerCase();

  let profileId = account.multiloginProfileId?.trim();

  if (!profileId) {
    profileId = await autoDiscoverProfile(account);
  }

  let cookies;
  if (mode === 'cloud') {
    cookies = await getCookiesCloud(profileId);
  } else {
    cookies = await getCookiesLocal(profileId);
  }

  if (!cookies?.length) throw new Error('Nenhum cookie Instagram exportado do Multilogin');

  const hasSession = cookies.some(c => (c.name || c.key) === 'sessionid');
  if (!hasSession) {
    throw new Error(
      'Cookies nao contem sessionid. ' +
      'Certifique-se de estar logado no Instagram dentro do perfil do Multilogin.'
    );
  }

  const normalized = cookies.map(c => ({
    name:     c.name  || c.key  || '',
    value:    c.value || '',
    domain:   (c.domain?.startsWith('.') ? c.domain : `.${c.domain || 'instagram.com'}`),
    path:     c.path     || '/',
    secure:   c.secure   || false,
    httpOnly: c.httpOnly || false,
  }));

  const dir = path.join(SESSIONS_ROOT, account.username);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cookies.json'), JSON.stringify(normalized, null, 2));

  console.log(`[Multilogin] @${account.username} -- ${normalized.length} cookies sincronizados`);
  return normalized.length;
}

module.exports = { syncCookiesFromMultilogin, autoDiscoverProfile, listProfilesLocal };

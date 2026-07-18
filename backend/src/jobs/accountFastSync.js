'use strict';

/**
 * Fast sync — atualiza nome, bio, seguidores, seguindo e avatar de todas as contas
 * usando a instagram-private-api (sem Puppeteer). Roda a cada 5 minutos.
 */

const Account       = require('../models/Account');
const { broadcast } = require('../events/broadcaster');
const path          = require('path');
const fs            = require('fs');
const https         = require('https');

const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

/** Baixa avatar CDN com retry automático (até 3 tentativas) */
async function downloadAvatar(url, username, retries = 3) {
  if (!url || !username) return '';
  ensureDir(AVATARS_DIR);
  const dest = path.join(AVATARS_DIR, `${username}.jpg`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = https.get(url, res => {
          if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(dest); } catch {}
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      });
      return `/uploads/avatars/${username}.jpg`;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        console.log(`⚠️ [Avatar] @${username}: falha após ${retries} tentativas — ${err.message}`);
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
        return '';
      }
    }
  }
  return '';
}

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
const delay = ms => new Promise(r => setTimeout(r, ms));

let running = false;

function getIgApiClient() {
  try {
    const { IgApiClient } = require('instagram-private-api');
    return IgApiClient;
  } catch {
    return null;
  }
}

const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function makeProxyFS(proxyUrl) {
  if (!proxyUrl?.trim()) return undefined;
  try { return new (require('undici').ProxyAgent)(proxyUrl.trim()); } catch { return undefined; }
}

/**
 * Sync via rawWebSessionid — valida sessão e busca stats via web_profile_info.
 */
async function syncViaWebSession(account) {
  const sid = account.rawWebSessionid;
  const headers = {
    'Cookie': `sessionid=${sid}`,
    'User-Agent': WEB_UA,
    'X-IG-App-ID': '936619743392459',
  };
  const dispatcher = makeProxyFS(account.proxy);
  const fetchOpts = (extra = {}) => ({ headers, signal: AbortSignal.timeout(10_000), ...extra, ...(dispatcher ? { dispatcher } : {}) });

  // 1. Valida sessão e obtém username/nome
  const meR = await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', fetchOpts());
  const meText = await meR.text();
  let meData;
  try { meData = JSON.parse(meText); } catch { return; }
  const user = meData.user;
  if (!user?.username) return;

  // 2. Busca contadores — tenta /users/{pk}/info/ depois web_profile_info
  let followers = 0, following = 0, postsCount = 0;

  // Tentativa 1: /users/{pk}/info/ retorna follower_count direto
  if (user.pk) {
    try {
      const infoR = await fetch(`https://www.instagram.com/api/v1/users/${user.pk}/info/`, fetchOpts());
      const infoData = await infoR.json().catch(() => ({}));
      const u = infoData.user;
      if (u) {
        followers  = u.follower_count  || 0;
        following  = u.following_count || 0;
        postsCount = u.media_count     || 0;
      }
    } catch {}
  }

  // Tentativa 2: web_profile_info (formato GraphQL edge)
  if (!followers && !following && !postsCount) {
    try {
      const prR = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(user.username)}`,
        fetchOpts()
      );
      const prData = await prR.json().catch(() => ({}));
      const pu = prData?.data?.user;
      if (pu) {
        followers  = pu.edge_followed_by?.count             || pu.follower_count  || 0;
        following  = pu.edge_follow?.count                  || pu.following_count || 0;
        postsCount = pu.edge_owner_to_timeline_media?.count || pu.media_count     || 0;
      }
    } catch {}
  }

  await Account.findByIdAndUpdate(account._id, {
    followers,
    following,
    postsCount,
    name:        user.full_name || account.name || '',
    healthStatus: 'ativa',
    lastError:   '',
    lastSync:    new Date(),
  });
}

/**
 * Sincroniza uma única conta via Private API (sem Puppeteer).
 * Retorna true se conseguiu sincronizar, false caso contrário.
 */
async function syncOneAccountFast(account) {
  const IgApiClient = getIgApiClient();
  if (!IgApiClient) return false;

  const ig   = new IgApiClient();
  const seed = `${account.username}_${String(account._id)}`;
  ig.state.generateDevice(seed);

  let igReady = false;

  // 1. Tenta igSession salvo (sem proxy — proxy invalida sessão existente)
  if (account.igSession) {
    try {
      const saved = typeof account.igSession === 'string'
        ? JSON.parse(account.igSession)
        : account.igSession;
      ig.state.generateDevice(saved._deviceSeed || seed);
      await ig.state.deserialize(saved);
      igReady = true;
    } catch {
      ig.state.generateDevice(seed);
    }
  }

  // 2. Tenta bootstrap via cookies.json
  if (!igReady) {
    const cookiesPath = path.join(SESSIONS_ROOT, account.username, 'cookies.json');
    if (!fs.existsSync(cookiesPath)) return false;

    try {
      const browserCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      const sessionCookie  = browserCookies.find(c => c.name === 'sessionid');
      if (!sessionCookie) return false;

      const igCookies = browserCookies
        .filter(c => c.domain && c.domain.includes('instagram.com'))
        .map(c => ({
          key:          c.name,
          value:        c.value,
          domain:       c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
          path:         c.path  || '/',
          secure:       c.secure   || false,
          httpOnly:     c.httpOnly  || false,
          hostOnly:     !c.domain.startsWith('.'),
          creation:     new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        }));

      await ig.state.deserializeCookieJar(JSON.stringify({
        version:                'tough-cookie@4.1.2',
        storeType:              'MemoryCookieStore',
        rejectPublicSuffixes:   true,
        enableLooseMode:        false,
        allowSpecialUseDomain:  true,
        cookies:                igCookies,
      }));
      igReady = true;
    } catch {
      return false;
    }
  }

  if (!igReady) return false;

  // Uma única chamada para obter todos os dados do perfil
  const me = await ig.account.currentUser();

  const cdnUrl = me.hd_profile_pic_url_info?.url || me.profile_pic_url || '';
  const localAvatar = cdnUrl ? await downloadAvatar(cdnUrl, account.username) : '';

  const updates = {
    lastSync:    new Date(),
    name:        me.full_name        || '',
    bio:         me.biography        || '',
    followers:   me.follower_count   || 0,
    following:   me.following_count  || 0,
    postsCount:  me.media_count      || 0,
    avatar:      localAvatar         || account.avatar || '',
    healthStatus: 'ativa',
    lastError:   '',
  };

  await Account.findByIdAndUpdate(account._id, updates);
  return true;
}

async function runFastSync() {
  if (running) return;
  running = true;

  let synced = 0;

  try {
    const accounts = await Account.find({
      status:  { $ne: 'banida' },
      isBusy:  { $ne: true },
    }).select('username _id igSession rawWebSessionid avatar name bio followers following postsCount proxy');

    for (const acc of accounts) {
      // rawWebSessionid tem prioridade: igSession pode ser um shell sem dados mobile reais
      if (acc.rawWebSessionid) {
        try { await syncViaWebSession(acc); synced++; } catch {}
        continue;
      }
      const hasCookies = fs.existsSync(path.join(SESSIONS_ROOT, acc.username, 'cookies.json'));
      if (!acc.igSession && !hasCookies) continue;

      try {
        if (await syncOneAccountFast(acc)) synced++;
      } catch (err) {
        // Ignora erros de rate limit; loga o resto brevemente
        const msg = String(err.message || '');
        if (!msg.includes('429') && !msg.includes('rate limit') && !msg.includes('login_required')) {
          console.log(`⚠️ [FastSync] @${acc.username}: ${msg.slice(0, 70)}`);
        }
      }

      await delay(400); // pausa suave entre contas para não sobrecarregar
    }

    if (synced > 0) {
      broadcast('accounts', { action: 'synced' });
      console.log(`⚡ [FastSync] ${synced}/${accounts.length} conta(s) sincronizadas`);
    }
  } catch (err) {
    console.log('💥 [FastSync] Erro geral:', err.message);
  } finally {
    running = false;
  }
}

function startFastSync() {
  // Primeira execução: 2 minutos após o servidor subir
  setTimeout(runFastSync, 2 * 60 * 1000);
  // Depois: a cada 5 minutos
  setInterval(runFastSync, 5 * 60 * 1000);
  console.log('⚡ [FastSync] Agendado — primeira execução em 2min, depois a cada 5min');
}

module.exports = { startFastSync, syncOneAccountFast };

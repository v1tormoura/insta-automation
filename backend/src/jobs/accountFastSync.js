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

/** Baixa avatar CDN → /uploads/avatars/<username>.jpg e retorna o path local */
async function downloadAvatar(url, username) {
  if (!url || !username) return '';
  ensureDir(AVATARS_DIR);
  const dest = path.join(AVATARS_DIR, `${username}.jpg`);
  return new Promise(resolve => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(`/uploads/avatars/${username}.jpg`); });
    }).on('error', () => { try { fs.unlinkSync(dest); } catch {} resolve(''); });
  });
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
    }).select('username _id igSession avatar name bio followers following postsCount proxy');

    for (const acc of accounts) {
      // Pula contas sem nenhuma sessão disponível
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

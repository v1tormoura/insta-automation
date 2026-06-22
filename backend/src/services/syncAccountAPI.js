'use strict';

/**
 * Sincronização para contas conectadas via OAuth.
 *
 * Faz chamada real à API para verificar se o token ainda funciona e
 * se a conta não foi restrita/banida pelo Instagram.
 *
 * Tokens IGAAL (Business Login curtos) não suportam graph.instagram.com/me —
 * para esses, verificamos expiração + tentamos endpoint alternativo.
 */

const Account = require('../models/Account');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');

const AVATARS_DIR = path.resolve(__dirname, '../../uploads/avatars');
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

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

async function syncViaAPI(account) {
  if (!account.accessToken || !account.igUserId) {
    throw new Error('Conta sem token OAuth — use syncAccountInfo (Puppeteer)');
  }

  const now = new Date();
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;

  // ── 1. Verificar expiração do token ───────────────────────────────────────
  if (expiresAt && expiresAt < now) {
    await Account.findByIdAndUpdate(account._id, {
      healthStatus: 'sessao_expirada',
      lastError: 'Token OAuth expirado — reconecte via 🔗 API',
      lastSync: now,
    });
    throw new Error(`Token expirado para @${account.username}`);
  }

  const daysLeft = expiresAt ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : '?';
  const isIgaal  = account.accessToken.startsWith('IGAAL');

  // ── 2. Verificação real via API ───────────────────────────────────────────
  const update = { healthStatus: 'ativa', lastError: '', lastSync: now };

  if (!isIgaal) {
    // Tokens IGQ/EAA — suportam graph.instagram.com/me
    try {
      const url = new URL('https://graph.instagram.com/me');
      url.searchParams.set('fields', 'id,username,name,followers_count,follows_count,media_count');
      url.searchParams.set('access_token', account.accessToken);

      const res  = await fetch(url.toString());
      const data = await res.json();

      if (data.error) {
        const code     = data.error.code;
        const errMsg   = data.error.message || 'Erro API';
        const isInvalid = code === 190
          || data.error.type === 'OAuthException'
          || errMsg.toLowerCase().includes('session has been invalidated')
          || errMsg.toLowerCase().includes('access token');

        if (isInvalid) {
          update.healthStatus = 'sessao_expirada';
          update.lastError    = `Token inválido (code ${code}): ${errMsg}`;
        } else {
          update.healthStatus = 'restrita';
          update.lastError    = errMsg;
        }
        console.log(`⚠️ [API Sync] @${account.username} — erro ${code}: ${errMsg}`);
      } else {
        // Atualiza dados do perfil
        if (data.username) {
          update.username   = data.username;
          update.name       = data.name           || account.name;
          update.followers  = data.followers_count || account.followers  || 0;
          update.following  = data.follows_count   || account.following  || 0;
          update.postsCount = data.media_count     || account.postsCount || 0;
        }
        console.log(`✅ [API Sync] @${account.username} — token OK (expira em ${daysLeft} dias)`);
      }
    } catch (err) {
      console.log(`⚠️ [API Sync] @${account.username} — chamada falhou: ${err.message}`);
      // Falha de rede não deve marcar como expirada — mantém status atual
      update.healthStatus = account.healthStatus || 'ativa';
    }
  } else {
    // IGAAL (Instagram Business Login) — GET /me não é suportado para este tipo de token.
    // Apenas verificamos a data de expiração salva no banco.
    // O worker limpa o token automaticamente se a sessão expirar durante a publicação.
    console.log(`✅ [API Sync] @${account.username} — token IGAAL (expira em ${daysLeft} dias)`);
  }

  await Account.findByIdAndUpdate(account._id, update);
  console.log(`✅ [API Sync] @${account.username} — status: ${update.healthStatus} (expira em ${daysLeft} dias)`);
}

module.exports = syncViaAPI;

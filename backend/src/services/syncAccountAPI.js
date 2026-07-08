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

const Account              = require('../models/Account');
const { broadcast }        = require('../events/broadcaster');
const { classifyError }    = require('../jobs/healthCheck');
const { refreshToken }     = require('./instagramAPI');
const path                 = require('path');
const fs                   = require('fs');
const https                = require('https');

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

  // Todos os tipos de token suportam graph.instagram.com/me (sem versão)
  // IGAAL usa sem versão; IGQ/EAA também funciona sem versão
  try {
    const url = new URL('https://graph.instagram.com/me');
    url.searchParams.set('fields', 'id,username,name,followers_count,follows_count,media_count,profile_picture_url');
    url.searchParams.set('access_token', account.accessToken);

    const res  = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      const code      = data.error.code;
      const errMsg    = data.error.message || 'Erro API';

      // Detecta ban/desativação
      if (/disabled|banned|violat/i.test(errMsg) || code === 326) {
        update.healthStatus = 'banida';
        update.status       = 'banida';
        update.lastError    = errMsg;
        console.log(`🚫 [API Sync] @${account.username} — BANIDA/DESATIVADA`);
      } else if (code === 190 || data.error.type === 'OAuthException' || /session.*expired|token.*expired|expired.*token/i.test(errMsg)) {
        // Tenta renovar o token antes de desistir (funciona se o token ainda não venceu no TTL)
        if (account.accessToken?.match(/^(IGAAL|IGQ|IG)/)) {
          try {
            const { accessToken: newToken, expiresIn } = await refreshToken(account.accessToken);
            update.accessToken    = newToken;
            update.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
            update.healthStatus   = 'ativa';
            update.lastError      = '';
            console.log(`🔄 [API Sync] @${account.username} — token renovado após erro 190`);
          } catch (refreshErr) {
            // Refresh falhou → sessão realmente expirada. Zera tokenExpiresAt para
            // que o tokenRefreshJob a detecte e tente recuperar no próximo ciclo.
            update.healthStatus   = 'sessao_expirada';
            update.tokenExpiresAt = new Date(); // reflete a realidade: expirou agora
            update.lastError      = `Sessão expirada (${new Date().toLocaleString('pt-BR')}) — reconecte via 🔗 API`;
            console.log(`⚠️ [API Sync] @${account.username} — refresh falhou: ${refreshErr.message}`);
          }
        } else {
          update.healthStatus = 'sessao_expirada';
          update.lastError    = `Token inválido (code ${code}) — reconecte via 🔗 API`;
        }
      } else if (/token.*invalid|invalid.*token/i.test(errMsg)) {
        update.healthStatus = 'sessao_expirada';
        update.lastError    = `Token inválido (code ${code}) — reconecte via 🔗 API`;
      } else if (/checkpoint|feedback_required|spam/i.test(errMsg)) {
        update.healthStatus = 'restrita';
        update.lastError    = errMsg;
      } else {
        update.lastError = errMsg;
      }
      console.log(`⚠️ [API Sync] @${account.username} — erro ${code}: ${errMsg}`);
    } else if (data.id) {
      // Atualiza todos os dados do perfil
      update.igUserId   = data.id;
      update.username   = data.username   || account.username;
      update.name       = data.name       || account.name;
      update.followers  = data.followers_count ?? account.followers  ?? 0;
      update.following  = data.follows_count   ?? account.following  ?? 0;
      update.postsCount = data.media_count     ?? account.postsCount ?? 0;

      // Baixa avatar se disponível
      if (data.profile_picture_url) {
        try {
          const avatarPath = await downloadAvatar(data.profile_picture_url, account.username);
          if (avatarPath) update.avatar = avatarPath;
        } catch {}
      }

      // Renovação proativa: renova se expira em menos de 15 dias (ou se não temos data de expiração)
      const fifteenDays = 15 * 24 * 60 * 60 * 1000;
      const needsRefresh = !expiresAt || (expiresAt - now) < fifteenDays;
      if (needsRefresh && account.accessToken?.match(/^(IGAAL|IGQ|IG)/)) {
        try {
          const { accessToken: newToken, expiresIn } = await refreshToken(account.accessToken);
          update.accessToken    = newToken;
          update.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
          const newDays = Math.ceil(expiresIn / 86400);
          console.log(`🔄 [API Sync] @${account.username} — token renovado proativamente (novo vencimento: ${newDays} dias)`);
        } catch (refreshErr) {
          console.log(`⚠️ [API Sync] @${account.username} — refresh proativo falhou: ${refreshErr.message}`);
        }
      }

      console.log(`✅ [API Sync] @${account.username} — ${data.followers_count} seguidores · ${data.media_count} posts (expira em ${daysLeft} dias)`);
    }
  } catch (err) {
    console.log(`⚠️ [API Sync] @${account.username} — chamada falhou: ${err.message}`);
    update.healthStatus = account.healthStatus || 'ativa';
  }

  await Account.findByIdAndUpdate(account._id, update);
  console.log(`✅ [API Sync] @${account.username} — status: ${update.healthStatus} (expira em ${daysLeft} dias)`);

  // Emite SSE em tempo real para o frontend
  broadcast('accounts', {
    action:       'health_update',
    accountId:    String(account._id),
    username:     account.username,
    healthStatus: update.healthStatus,
  });
}

module.exports = syncViaAPI;

require('dotenv').config();

const { Worker }   = require('bullmq');
const connection   = require('./connection');
const connectDB    = require('../config/db');
const Post         = require('../models/Post');
const Account      = require('../models/Account');
const { postReel: postReelGraph, refreshToken } = require('../services/instagramAPI');
const { postReel: postReelPrivate }             = require('../services/instagramPrivateService');
const { writeAccountLog } = require('../utils/accountLogger');
const { broadcast } = require('../events/broadcaster');

connectDB();

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Limpeza de locks antigos ao iniciar ───────────────────────────────────────
async function unlockStuck() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  await Account.updateMany(
    { isBusy: true, busySince: { $lt: cutoff } },
    { $set: { isBusy: false, busySince: null, busyReason: '' } }
  );
  console.log('🔓 Locks antigos limpos');
}
unlockStuck();

// Limpeza periódica
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    await Account.updateMany(
      { isBusy: true, busySince: { $lt: cutoff } },
      { $set: { isBusy: false, busySince: null, busyReason: '' } }
    );
  } catch {}
}, 60_000);

function randomDelay() {
  return Math.floor(Math.random() * 90_000) + 30_000; // 30–120s entre contas
}

function isSameDay(date) {
  if (!date) return false;
  const d = new Date(date), now = new Date();
  return d.getDate() === now.getDate() &&
         d.getMonth() === now.getMonth() &&
         d.getFullYear() === now.getFullYear();
}

async function checkDailyLimit(account) {
  if (!isSameDay(account.lastPostDate)) {
    account.postsToday   = 0;
    account.lastPostDate = new Date();
    await account.save();
  }
  return account.postsToday < account.dailyPostLimit;
}

async function registerSuccess(account) {
  account.postsToday   = (account.postsToday || 0) + 1;
  account.lastPostDate = new Date();
  account.lastPostAt   = new Date();
  account.healthStatus = 'ativa';
  account.lastError    = '';
  await account.save();
}

async function registerError(account, error) {
  account.lastError    = error;
  account.healthStatus = /sessão|session|expired|401/i.test(error)
    ? 'sessao_expirada' : 'restrita';
  await account.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLICAÇÃO — 100% via API, sem browser, sem Puppeteer
//
//  Ordem de tentativa:
//  1. Graph API (Meta) — se conta tiver token OAuth
//  2. Private API     — se conta tiver cookies.json / senha / sessão salva
// ─────────────────────────────────────────────────────────────────────────────
async function publishWithRetry(post, account) {
  const fs   = require('fs');
  const path = require('path');

  const hasGraph   = !!(account.accessToken && account.igUserId);
  const hasCookies = fs.existsSync(
    path.join(__dirname, '../../sessions', account.username, 'cookies.json')
  );
  const hasPrivate = hasCookies || !!(account.password) || !!(account.igSession);

  // ── 1. Graph API (Meta) ──────────────────────────────────────────────────
  if (hasGraph) {
    // Refresh proativo: renova se expira em menos de 7 dias
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (expiresAt && (expiresAt - Date.now()) < sevenDays) {
      try {
        console.log(`🔄 Token de @${account.username} expira em breve — renovando...`);
        const { accessToken: newToken, expiresIn } = await refreshToken(account.accessToken);
        const newExpiry = new Date(Date.now() + expiresIn * 1000);
        await Account.findByIdAndUpdate(account._id, {
          accessToken:    newToken,
          tokenExpiresAt: newExpiry,
        });
        account.accessToken    = newToken;
        account.tokenExpiresAt = newExpiry;
        console.log(`✅ Token renovado — novo vencimento: ${newExpiry.toLocaleDateString()}`);
        writeAccountLog(account.username, `🔄 Token renovado — vence em ${newExpiry.toLocaleDateString()}`);
      } catch (refreshErr) {
        console.log(`⚠️ Refresh do token falhou: ${refreshErr.message}`);
        if (/190|expired|invalid/i.test(refreshErr.message)) {
          await Account.findByIdAndUpdate(account._id, {
            accessToken: '', igUserId: '', tokenExpiresAt: null, healthStatus: 'sessao_expirada',
          });
          account.accessToken = '';
          writeAccountLog(account.username, '🚫 Token expirado — reconecte via 🔗 OAuth');
        }
      }
    }

    if (account.accessToken) {
      writeAccountLog(account.username, '🌐 Tentando via Meta Graph API...');
      console.log(`🌐 Graph API → @${account.username}`);
      try {
        await postReelGraph(account, post);
        writeAccountLog(account.username, '✅ Publicado via Graph API');
        return true;
      } catch (err) {
        writeAccountLog(account.username, `⚠️ Graph API: ${err.message}`);
        console.log(`⚠️ Graph API @${account.username}:`, err.message);

        // Token expirou durante a postagem → tenta refresh imediato
        if (/190|session.*expired|token.*expired/i.test(err.message)) {
          try {
            const { accessToken: newToken, expiresIn } = await refreshToken(account.accessToken);
            const newExpiry = new Date(Date.now() + expiresIn * 1000);
            await Account.findByIdAndUpdate(account._id, { accessToken: newToken, tokenExpiresAt: newExpiry });
            account.accessToken = newToken;
            console.log(`🔄 Token renovado no erro — retentando Graph API...`);
            await postReelGraph(account, post);
            writeAccountLog(account.username, '✅ Publicado via Graph API (após refresh)');
            return true;
          } catch (retry) {
            console.log(`⚠️ Retry Graph API após refresh falhou: ${retry.message}`);
            await Account.findByIdAndUpdate(account._id, {
              accessToken: '', igUserId: '', tokenExpiresAt: null, healthStatus: 'sessao_expirada',
            });
            writeAccountLog(account.username, '🚫 Token inválido — reconecte via 🔗 OAuth');
          }
        } else if (/Invalid OAuth|token.*invalid|invalid.*token/i.test(err.message)) {
          await Account.findByIdAndUpdate(account._id, {
            accessToken: '', igUserId: '', tokenExpiresAt: null, healthStatus: 'sessao_expirada',
          });
          writeAccountLog(account.username, '🚫 Token inválido — reconecte via 🔗 OAuth');
        }

        if (!hasPrivate) throw err;
        console.log(`🔄 Graph falhou → Private API...`);
      }
    }
  }

  // ── 2. Private API (mobile endpoints — sem browser) ──────────────────────
  if (hasPrivate) {
    writeAccountLog(account.username, '📱 Tentando via Private API do Instagram...');
    console.log(`📱 Private API → @${account.username}`);
    try {
      await postReelPrivate(account, post);
      writeAccountLog(account.username, '✅ Publicado via Private API');
      return true;
    } catch (err) {
      writeAccountLog(account.username, `❌ Private API: ${err.message}`);
      console.log(`❌ Private API @${account.username}:`, err.message);
      throw err;
    }
  }

  // ── Sem método ────────────────────────────────────────────────────────────
  writeAccountLog(account.username,
    '🚫 Sem método de publicação — importe cookies (🍪) ou adicione senha nas credenciais'
  );
  throw new Error(
    `@${account.username}: sem método de publicação. ` +
    'Importe cookies (🍪), adicione senha ou conecte via 🔗 API.'
  );
}

// ── Worker BullMQ ─────────────────────────────────────────────────────────────
const worker = new Worker(
  'posts',
  async (job) => {
    console.log('🔥 JOB:', job.data);
    const { postId } = job.data;

    const post = await Post.findById(postId).populate('accounts');
    if (!post) { console.log('❌ Post não encontrado'); return; }

    post.status = 'processando';
    post.error  = '';
    await post.save();

    let successCount = 0;
    let errorCount   = 0;
    const errors     = [];

    for (const acc of post.accounts) {
      try {
        const account = await acc.constructor.findById(acc._id);
        if (!account) {
          errors.push(`@${acc.username}: conta não encontrada`);
          errorCount++;
          continue;
        }

        // Destrava lock expirado
        if (account.isBusy) {
          const lockAge = Date.now() - (account.busySince ? new Date(account.busySince).getTime() : 0);
          if (lockAge > 10 * 60 * 1000) {
            account.isBusy     = false;
            account.busySince  = null;
            account.busyReason = '';
            await account.save();
          } else {
            errors.push(`@${acc.username}: conta em uso`);
            errorCount++;
            continue;
          }
        }

        // Adquire lock
        account.isBusy     = true;
        account.busySince  = new Date();
        account.busyReason = 'Publicando';
        await account.save();
        broadcast('accounts', { action: 'busy', accountId: account._id });

        writeAccountLog(acc.username, '🚀 Iniciando publicação');

        // Verifica limite diário
        if (!(await checkDailyLimit(account))) {
          const msg = `Limite diário atingido: ${account.postsToday}/${account.dailyPostLimit}`;
          console.log(`⛔ @${acc.username}: ${msg}`);
          writeAccountLog(acc.username, msg);
          account.isBusy     = false;
          account.busySince  = null;
          account.busyReason = '';
          await account.save();
          errors.push(`@${acc.username}: ${msg}`);
          errorCount++;
          continue;
        }

        await publishWithRetry(post, account);
        await registerSuccess(acc);

        account.isBusy     = false;
        account.busySince  = null;
        account.busyReason = '';
        await account.save();
        broadcast('accounts', { action: 'synced' });

        successCount++;
        const wait = randomDelay();
        console.log(`⏳ Pausa: ${Math.round(wait / 1000)}s`);
        await delay(wait);

      } catch (err) {
        errorCount++;
        errors.push(`@${acc.username}: ${err.message}`);
        console.log(`💥 Erro @${acc.username}:`, err.message);
        writeAccountLog(acc.username, `Erro: ${err.message}`);
        await registerError(acc, err.message);

        const locked = await acc.constructor.findById(acc._id);
        if (locked) {
          locked.isBusy     = false;
          locked.busySince  = null;
          locked.busyReason = '';
          await locked.save();
        }
        broadcast('accounts', { action: 'synced' });
        await delay(10_000);
      }
    }

    post.status = successCount > 0 && errorCount === 0 ? 'concluido'
                : successCount > 0                     ? 'parcial'
                :                                        'erro';
    post.error  = errors.join(' | ') || '';
    await post.save();

    console.log(`✅ Job finalizado — sucessos: ${successCount}, erros: ${errorCount}`);
  },
  {
    connection,
    concurrency:     1,
    lockDuration:    600_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', job => console.log('🎉 Job concluído:', job.id));
worker.on('failed',    (job, err) => console.log('💥 Job falhou:', err.message));

console.log('✅ Worker rodando — Graph API + Private API (100% background, sem browser)');

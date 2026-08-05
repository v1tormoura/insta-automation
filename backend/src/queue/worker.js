require('dotenv').config();

const { Worker }   = require('bullmq');
const connection   = require('./connection');
const connectDB    = require('../config/db');
const Post         = require('../models/Post');
const Account      = require('../models/Account');
const { postReel: postReelPrivate } = require('../services/instagramPrivateService');
const { postReel: postReelGraph, prepareVideo } = require('../services/instagramAPI');
const { writeAccountLog } = require('../utils/accountLogger');
const { broadcast }       = require('../events/broadcaster');
const { classifyError }   = require('../jobs/healthCheck');
const traduzirErro        = require('../utils/traduzirErro');
const { runPromoAfterPost, postCTACommentForPost, postEngageCommentForPost } = require('../jobs/promoJob');

connectDB();

const delay = ms => new Promise(r => setTimeout(r, ms));

// Limpa locks de contas travadas há mais de 10 minutos
async function unlockStuck() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  await Account.updateMany(
    { isBusy: true, busySince: { $lt: cutoff } },
    { $set: { isBusy: false, busySince: null, busyReason: '' } }
  );
}

// Recupera posts travados em 'processando' após crash do worker (mais de 15 min)
async function recoverStuckPosts() {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const result = await Post.updateMany(
    { status: 'processando', updatedAt: { $lt: cutoff } },
    { $set: { status: 'erro', error: 'Processamento interrompido — worker reiniciado' } }
  );
  if (result.modifiedCount > 0) {
    console.log(`♻️  ${result.modifiedCount} post(s) travado(s) em 'processando' marcado(s) como erro`);
  }
}

unlockStuck();
recoverStuckPosts().catch(e => console.error('recoverStuckPosts:', e.message));
setInterval(async () => {
  try { await unlockStuck(); } catch {}
}, 60_000);

function isSameDay(date) {
  if (!date) return false;
  const d = new Date(date), now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

async function checkDailyLimit(account) {
  if (!isSameDay(account.lastPostDate)) {
    await Account.findByIdAndUpdate(account._id, { postsToday: 0, lastPostDate: new Date() });
    account.postsToday = 0;
  }
  return account.postsToday < account.dailyPostLimit;
}

async function registerSuccess(account) {
  await Account.findByIdAndUpdate(account._id, {
    postsToday:  (account.postsToday || 0) + 1,
    lastPostDate: new Date(),
    lastPostAt:   new Date(),
    healthStatus: 'ativa',
    lastError:    '',
  });
}


// ── Publicação: Graph API (IGAA token) ou Private API (cookies/session) ──
async function publishWithRetry(post, account, preProcessedVideoUrl) {
  // Graph API — preferida quando a conta tem token IGAA conectado
  if (account.accessToken && account.igUserId) {
    writeAccountLog(account.username, 'Publicando via Graph API (Meta)...');
    try {
      await postReelGraph(account, post, preProcessedVideoUrl || null);
      writeAccountLog(account.username, 'Publicado com sucesso via Graph API');
      return true;
    } catch (err) {
      writeAccountLog(account.username, `Graph API: ${err.message}`);
      throw err;
    }
  }

  // Private API — fallback para contas sem token IGAA
  const fs   = require('fs');
  const path = require('path');

  const hasCookies = fs.existsSync(path.join(__dirname, '../../sessions', account.username, 'cookies.json'));
  const hasMethod  = hasCookies || !!(account.password) || !!(account.igSession);

  if (!hasMethod) {
    const msg = 'Sem sessão/senha e sem token de API — conecte via Meta API ou importe cookies (🍪)';
    writeAccountLog(account.username, msg);
    throw new Error(`@${account.username}: ${msg}`);
  }

  writeAccountLog(account.username, 'Publicando via Private API...');
  try {
    await postReelPrivate(account, post);
    writeAccountLog(account.username, 'Publicado com sucesso via Private API');
    return true;
  } catch (err) {
    writeAccountLog(account.username, `Private API: ${err.message}`);
    throw err;
  }
}

// ── Worker BullMQ ──────────────────────────────────────────────────────────────
const worker = new Worker(
  'posts',
  async (job) => {
    const { postId } = job.data;

    const post = await Post.findById(postId).populate('accounts');
    if (!post) { console.log('Post não encontrado:', postId); return; }

    post.status = 'processando';
    post.error  = '';
    await post.save();

    let successCount = 0;
    let errorCount   = 0;
    const errors     = [];

    async function publishOne(acc) {
      try {
        const account = await Account.findById(acc._id);
        if (!account) { errors.push(`@${acc.username}: conta não encontrada`); errorCount++; return; }

        // Busy lock — evita publicações simultâneas na mesma sessão
        if (account.isBusy) {
          const lockAge = Date.now() - (account.busySince ? new Date(account.busySince).getTime() : 0);
          if (lockAge > 10 * 60 * 1000) {
            await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
          } else {
            errors.push(`@${acc.username}: conta em uso — aguarde`);
            errorCount++;
            return;
          }
        }
        await Account.findByIdAndUpdate(account._id, { isBusy: true, busySince: new Date(), busyReason: 'Publicando' });
        broadcast('accounts', { action: 'busy', accountId: account._id });
        writeAccountLog(acc.username, 'Iniciando publicação');

        if (!(await checkDailyLimit(account))) {
          const msg = `Limite diário atingido: ${account.postsToday}/${account.dailyPostLimit}`;
          writeAccountLog(acc.username, msg);
          await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
          errors.push(`@${acc.username}: ${msg}`);
          errorCount++;
          return;
        }

        await publishWithRetry(post, account, preProcessedVideoUrl);
        await registerSuccess(account);
        await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
        broadcast('accounts', { action: 'synced' });
        successCount++;

        // Dispara promo global assincronamente
        runPromoAfterPost(account._id).catch(e => console.log('[Promo] erro:', e.message));

        // Comentário CTA específico do post/loop (independente do promo global)
        if (post.ctaComment?.trim()) {
          postCTACommentForPost(account._id, post.ctaComment)
            .catch(e => console.log('[CTA] erro:', e.message));
        }

        // Comentário de engajamento (pergunta) ~60min após publicar
        if (post.engageComment?.trim()) {
          postEngageCommentForPost(account._id, post.engageComment)
            .catch(e => console.log('[Engage] erro:', e.message));
        }

      } catch (err) {
        errorCount++;
        errors.push(`@${acc.username}: ${err.message}`);
        writeAccountLog(acc.username, `Erro: ${err.message}`);

        const classified = classifyError(err);
        const healthUpdate = {
          isBusy: false, busySince: null, busyReason: '',
          lastError: traduzirErro(err.message),
        };
        if (classified) healthUpdate.healthStatus = classified;
        await Account.findByIdAndUpdate(acc._id, healthUpdate);
        broadcast('accounts', { action: 'health_update', accountId: String(acc._id), username: acc.username, healthStatus: classified || acc.healthStatus });
      }
    }

    // Pré-processa vídeo uma vez para contas Graph API (evita reconversão paralela)
    let preProcessedVideoUrl = null;
    const graphAccounts = post.accounts.filter(a => a.accessToken && a.igUserId);
    if (graphAccounts.length > 0) {
      try {
        preProcessedVideoUrl = await prepareVideo(post);
        console.log('Vídeo pré-processado para Graph API:', preProcessedVideoUrl);
      } catch (e) {
        console.log('Aviso: pré-processamento falhou, cada conta vai tentar individualmente:', e.message);
      }
    }

    console.log(`Publicando para ${post.accounts.length} conta(s)...`);
    await Promise.allSettled(post.accounts.map(acc => publishOne(acc)));

    post.status = successCount > 0 && errorCount === 0 ? 'concluido'
                : successCount > 0                     ? 'parcial'
                :                                        'erro';
    post.error  = errors.join(' | ') || '';
    await post.save();

    console.log(`Job finalizado — sucesso: ${successCount}, erro: ${errorCount}`);
  },
  { connection, concurrency: 5, lockDuration: 600_000, stalledInterval: 60_000 }
);

worker.on('completed', job => console.log('Job concluído:', job.id));
worker.on('failed',    (job, err) => console.log('Job falhou:', err.message));

console.log('Worker rodando — 100% Private API (sem Graph API, sem browser)');

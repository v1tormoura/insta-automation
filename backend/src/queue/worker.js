require('dotenv').config();

const { Worker }   = require('bullmq');
const connection   = require('./connection');
const connectDB    = require('../config/db');
const Post         = require('../models/Post');
const Account      = require('../models/Account');
const { postReel } = require('../services/instagramPrivateService');
const { writeAccountLog } = require('../utils/accountLogger');
const { broadcast }       = require('../events/broadcaster');
const { classifyError }   = require('../jobs/healthCheck');
const traduzirErro        = require('../utils/traduzirErro');

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
unlockStuck();
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

async function registerError(account, error) {
  const healthStatus = /sessão|session|expired|401/i.test(error) ? 'sessao_expirada' : 'restrita';
  await Account.findByIdAndUpdate(account._id, { lastError: traduzirErro(error), healthStatus });
}

// ── Publicação via Private API (mobile endpoints, sem browser, sem Graph API) ──
async function publishWithRetry(post, account) {
  const fs   = require('fs');
  const path = require('path');

  const hasCookies = fs.existsSync(path.join(__dirname, '../../sessions', account.username, 'cookies.json'));
  const hasMethod  = hasCookies || !!(account.password) || !!(account.igSession);

  if (!hasMethod) {
    const msg = 'Sem sessão ou senha — importe cookies (🍪) ou configure senha e reconecte via ⚡';
    writeAccountLog(account.username, msg);
    throw new Error(`@${account.username}: ${msg}`);
  }

  writeAccountLog(account.username, 'Publicando via Private API...');
  try {
    await postReel(account, post);
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

        await publishWithRetry(post, account);
        await registerSuccess(account);
        await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
        broadcast('accounts', { action: 'synced' });
        successCount++;

      } catch (err) {
        errorCount++;
        errors.push(`@${acc.username}: ${err.message}`);
        writeAccountLog(acc.username, `Erro: ${err.message}`);
        await registerError(acc, err.message);

        const healthStatus = classifyError(err);
        const healthUpdate = { isBusy: false, busySince: null, busyReason: '', lastError: traduzirErro(err.message) };
        if (healthStatus) healthUpdate.healthStatus = healthStatus;
        await Account.findByIdAndUpdate(acc._id, healthUpdate);
        broadcast('accounts', { action: 'health_update', accountId: String(acc._id), username: acc.username, healthStatus: healthStatus || acc.healthStatus });
      }
    }

    console.log(`Publicando para ${post.accounts.length} conta(s) via Private API...`);
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

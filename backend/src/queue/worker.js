require('dotenv').config();

const { Worker }   = require('bullmq');
const connection   = require('./connection');
const connectDB    = require('../config/db');
const Post         = require('../models/Post');
const Account      = require('../models/Account');
const { postReel: postReelGraph, refreshToken, prepareVideo } = require('../services/instagramAPI');
const { postReel: postReelPrivate }             = require('../services/instagramPrivateService');
const { writeAccountLog } = require('../utils/accountLogger');
const { broadcast }       = require('../events/broadcaster');
const { classifyError }   = require('../jobs/healthCheck');
const traduzirErro        = require('../utils/traduzirErro');

connectDB();

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Limpeza de locks antigos ao iniciar ───────────────────────────────────────
async function unlockStuck() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  await Account.updateMany(
    { isBusy: true, busySince: { $lt: cutoff } },
    { $set: { isBusy: false, busySince: null, busyReason: '' } }
  );
  console.log('Locks antigos limpos');
}
unlockStuck();

setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    await Account.updateMany(
      { isBusy: true, busySince: { $lt: cutoff } },
      { $set: { isBusy: false, busySince: null, busyReason: '' } }
    );
  } catch {}
}, 60_000);

function isSameDay(date) {
  if (!date) return false;
  const d = new Date(date), now = new Date();
  return d.getDate()     === now.getDate()  &&
         d.getMonth()    === now.getMonth() &&
         d.getFullYear() === now.getFullYear();
}

async function checkDailyLimit(account) {
  if (!isSameDay(account.lastPostDate)) {
    await Account.findByIdAndUpdate(account._id, { postsToday: 0, lastPostDate: new Date() });
    account.postsToday = 0;
  }
  return account.postsToday < account.dailyPostLimit;
}

async function registerSuccess(account) {
  const postsToday = (account.postsToday || 0) + 1;
  await Account.findByIdAndUpdate(account._id, {
    postsToday,
    lastPostDate: new Date(),
    lastPostAt:   new Date(),
    healthStatus: 'ativa',
    lastError:    '',
  });
}

async function registerError(account, error) {
  const healthStatus = /sessão|session|expired|401/i.test(error)
    ? 'sessao_expirada' : 'restrita';
  await Account.findByIdAndUpdate(account._id, { lastError: traduzirErro(error), healthStatus });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLICACAO — 100% via API, sem browser, sem Puppeteer
//
//  Ordem de tentativa:
//  1. Graph API (Meta)  — se conta tiver token OAuth
//  2. Private API       — se conta tiver cookies.json / senha / sessao salva
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tenta publicar em uma conta.
 * preProcessedVideoUrl: URL do video ja convertido (gerado UMA vez antes de
 * distribuir para todas as contas em paralelo).
 */
async function publishWithRetry(post, account, preProcessedVideoUrl = null) {
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
    if (expiresAt && (expiresAt - Date.now()) < 7 * 24 * 60 * 60 * 1000) {
      try {
        console.log(`Token de @${account.username} expira em breve — renovando...`);
        const { accessToken: newToken, expiresIn } = await refreshToken(account.accessToken);
        const newExpiry = new Date(Date.now() + expiresIn * 1000);
        await Account.findByIdAndUpdate(account._id, { accessToken: newToken, tokenExpiresAt: newExpiry });
        account.accessToken    = newToken;
        account.tokenExpiresAt = newExpiry;
        console.log(`Token renovado — novo vencimento: ${newExpiry.toLocaleDateString()}`);
        writeAccountLog(account.username, `Token renovado — vence em ${newExpiry.toLocaleDateString()}`);
      } catch (refreshErr) {
        console.log(`Refresh do token falhou: ${refreshErr.message}`);
        if (/190|expired|invalid/i.test(refreshErr.message)) {
          await Account.findByIdAndUpdate(account._id, {
            accessToken: '', igUserId: '', tokenExpiresAt: null, healthStatus: 'sessao_expirada',
          });
          account.accessToken = '';
          writeAccountLog(account.username, 'Token expirado — reconecte via API');
        }
      }
    }

    if (account.accessToken) {
      writeAccountLog(account.username, 'Tentando via Meta Graph API...');
      console.log(`Graph API -> @${account.username}`);
      try {
        await postReelGraph(account, post, preProcessedVideoUrl);
        writeAccountLog(account.username, 'Publicado via Graph API');
        return true;
      } catch (err) {
        writeAccountLog(account.username, `Graph API: ${err.message}`);
        console.log(`Graph API @${account.username}:`, err.message);

        // Token expirou durante a postagem -> tenta refresh imediato
        if (/190|session.*expired|token.*expired/i.test(err.message)) {
          try {
            const { accessToken: newToken, expiresIn } = await refreshToken(account.accessToken);
            const newExpiry = new Date(Date.now() + expiresIn * 1000);
            await Account.findByIdAndUpdate(account._id, { accessToken: newToken, tokenExpiresAt: newExpiry });
            account.accessToken = newToken;
            console.log(`Token renovado no erro — retentando Graph API...`);
            await postReelGraph(account, post, preProcessedVideoUrl);
            writeAccountLog(account.username, 'Publicado via Graph API (apos refresh)');
            return true;
          } catch (retry) {
            console.log(`Retry Graph API apos refresh falhou: ${retry.message}`);
            await Account.findByIdAndUpdate(account._id, {
              accessToken: '', igUserId: '', tokenExpiresAt: null, healthStatus: 'sessao_expirada',
            });
            writeAccountLog(account.username, 'Token invalido — reconecte via API');
          }
        } else if (/Invalid OAuth|token.*invalid|invalid.*token/i.test(err.message)) {
          await Account.findByIdAndUpdate(account._id, {
            accessToken: '', igUserId: '', tokenExpiresAt: null, healthStatus: 'sessao_expirada',
          });
          writeAccountLog(account.username, 'Token invalido — reconecte via API');
        }

        if (!hasPrivate) throw err;
        console.log(`Graph falhou -> Private API...`);
      }
    }
  }

  // ── 2. Private API (mobile endpoints — sem browser) ──────────────────────
  if (hasPrivate) {
    writeAccountLog(account.username, 'Tentando via Private API do Instagram...');
    console.log(`Private API -> @${account.username}`);
    try {
      await postReelPrivate(account, post);
      writeAccountLog(account.username, 'Publicado via Private API');
      return true;
    } catch (err) {
      writeAccountLog(account.username, `Private API: ${err.message}`);
      console.log(`Private API @${account.username}:`, err.message);
      throw err;
    }
  }

  writeAccountLog(account.username,
    'Sem metodo de publicacao — importe cookies ou adicione senha nas credenciais'
  );
  throw new Error(
    `@${account.username}: sem metodo de publicacao. ` +
    'Importe cookies, adicione senha ou conecte via API.'
  );
}

// ── Worker BullMQ ─────────────────────────────────────────────────────────────
const worker = new Worker(
  'posts',
  async (job) => {
    console.log('JOB:', job.data);
    const { postId } = job.data;

    const post = await Post.findById(postId).populate('accounts');
    if (!post) { console.log('Post nao encontrado'); return; }

    post.status = 'processando';
    post.error  = '';
    await post.save();

    // ── Pre-processa o video UMA unica vez para todas as contas ──────────────
    // Isso evita que cada conta reconverta o mesmo arquivo simultaneamente,
    // o que causaria conflito de arquivo e CPU desnecessario.
    // Apos a conversao, todas as contas recebem a mesma URL e publicam em paralelo.
    let preProcessedVideoUrl = null;
    if (post.mediaType === 'video' || post.postType === 'reel') {
      try {
        console.log(`Pre-processando video "${post.media}" para ${post.accounts.length} conta(s)...`);
        preProcessedVideoUrl = await prepareVideo(post);
        console.log(`Video pre-processado: ${preProcessedVideoUrl}`);
      } catch (prepErr) {
        console.log(`Falha no pre-processamento do video: ${prepErr.message}`);
        post.status = 'erro';
        post.error  = `Falha ao processar video: ${traduzirErro(prepErr.message)}`;
        await post.save();
        return;
      }
    }

    let successCount = 0;
    let errorCount   = 0;
    const errors     = [];

    // Publica em uma unica conta.
    // preProcessedVideoUrl esta disponivel via closure (definido acima).
    async function publishOne(acc) {
      try {
        const account = await Account.findById(acc._id);
        if (!account) {
          errors.push(`@${acc.username}: conta nao encontrada`);
          errorCount++;
          return;
        }

        const hasGraph = !!(account.accessToken && account.igUserId);

        // Busy lock — necessario APENAS para Private API (sessao de browser compartilhada).
        // Graph API e stateless (requisicoes REST independentes com token OAuth),
        // nao precisa de mutex e nao conflita com publicacoes simultaneas na mesma conta.
        if (!hasGraph) {
          if (account.isBusy) {
            const lockAge = Date.now() - (account.busySince ? new Date(account.busySince).getTime() : 0);
            if (lockAge > 10 * 60 * 1000) {
              await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
            } else {
              errors.push(`@${acc.username}: conta em uso — aguarde ou tente novamente`);
              errorCount++;
              return;
            }
          }
          await Account.findByIdAndUpdate(account._id, { isBusy: true, busySince: new Date(), busyReason: 'Publicando' });
        }

        broadcast('accounts', { action: 'busy', accountId: account._id });
        writeAccountLog(acc.username, 'Iniciando publicacao');

        // Verifica limite diario
        if (!(await checkDailyLimit(account))) {
          const msg = `Limite diario atingido: ${account.postsToday}/${account.dailyPostLimit}`;
          console.log(`@${acc.username}: ${msg}`);
          writeAccountLog(acc.username, msg);
          if (!hasGraph) {
            await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
          }
          errors.push(`@${acc.username}: ${msg}`);
          errorCount++;
          return;
        }

        await publishWithRetry(post, account, preProcessedVideoUrl);
        await registerSuccess(account);

        if (!hasGraph) {
          await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
        }

        broadcast('accounts', { action: 'synced' });
        successCount++;

      } catch (err) {
        errorCount++;
        errors.push(`@${acc.username}: ${err.message}`);
        console.log(`Erro @${acc.username}:`, err.message);
        writeAccountLog(acc.username, `Erro: ${err.message}`);
        await registerError(acc, err.message);

        const healthStatus = classifyError(err);
        const healthUpdate = { isBusy: false, busySince: null, busyReason: '', lastError: traduzirErro(err.message) };
        if (healthStatus) {
          healthUpdate.healthStatus = healthStatus;
          if (healthStatus === 'banida') {
            healthUpdate.status = 'banida';
            writeAccountLog(acc.username, 'Conta BANIDA/DESATIVADA detectada ao publicar');
            console.log(`@${acc.username} — BANIDA detectada no worker`);
          }
        }
        await Account.findByIdAndUpdate(acc._id, healthUpdate);
        broadcast('accounts', {
          action:       'health_update',
          accountId:    String(acc._id),
          username:     acc.username,
          healthStatus: healthStatus || acc.healthStatus,
        });
      }
    }

    // Publica para TODAS as contas SIMULTANEAMENTE (em paralelo).
    // Cada conta cria seu proprio container no Instagram e aguarda processamento
    // de forma independente — sem esperar que a conta anterior termine.
    console.log(`Publicando para ${post.accounts.length} conta(s) simultaneamente...`);
    await Promise.allSettled(post.accounts.map(acc => publishOne(acc)));

    post.status = successCount > 0 && errorCount === 0 ? 'concluido'
                : successCount > 0                     ? 'parcial'
                :                                        'erro';
    post.error  = errors.join(' | ') || '';
    await post.save();

    console.log(`Job finalizado — sucessos: ${successCount}, erros: ${errorCount}`);
  },
  {
    connection,
    concurrency:     5,   // ate 5 lotes simultaneos processando ao mesmo tempo
    lockDuration:    600_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', job => console.log('Job concluido:', job.id));
worker.on('failed',    (job, err) => console.log('Job falhou:', err.message));

console.log('Worker rodando — Graph API + Private API (100% background, sem browser)');

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

const busyRetryMap = new Map(); // para legacy posts

// ── Manutenção de locks ──────────────────────────────────────────────────────

async function unlockStuck() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  await Account.updateMany(
    { isBusy: true, busySince: { $lt: cutoff } },
    { $set: { isBusy: false, busySince: null, busyReason: '' } }
  );
}

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

// Jobs em 'running' ao reiniciar o worker indicam crash durante execução.
// Jobs em 'waiting_interval' com nextRoundAt expirado indicam Redis reiniciado (sem persistência).
// Ambos são re-enfileirados automaticamente.
async function recoverStuckJobs() {
  const Job      = require('../models/Job');
  const postQueue = require('./postQueue');
  const cutoff   = new Date(Date.now() - 15 * 60 * 1000);

  // 1. Jobs travados em 'running' (crash durante execução)
  const stuck = await Job.find({ status: 'running', updatedAt: { $lt: cutoff } });
  for (const job of stuck) {
    try {
      const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: 0 });
      await Job.findByIdAndUpdate(job._id, { status: 'queued', bullMqJobId: String(bullJob.id) });
      console.log(`♻️  [Job] "${job.name}" (${job._id}) re-enfileirado após restart`);
    } catch (e) {
      console.error(`[Job] Falha ao recuperar job ${job._id}:`, e.message);
    }
  }

  // 2. Jobs em 'waiting_interval' cujo delayed job foi perdido (Redis restart sem AOF)
  const now = new Date();
  const stuckWaiting = await Job.find({ status: 'waiting_interval', nextRoundAt: { $lt: now } });
  for (const job of stuckWaiting) {
    try {
      const bullJob = await postQueue.add('job_round', { jobId: String(job._id) }, { delay: 0 });
      await Job.findByIdAndUpdate(job._id, { status: 'queued', bullMqJobId: String(bullJob.id) });
      console.log(`♻️  [Job] "${job.name}" (${job._id}) re-enfileirado após perda de delayed job`);
    } catch (e) {
      console.error(`[Job] Falha ao recuperar waiting_interval job ${job._id}:`, e.message);
    }
  }
}

// Campanhas: mesmo desenho do recoverStuckJobs — o plano vive no Mongo, então
// jobs perdidos num restart do Redis são reenfileirados a partir dele.
async function recoverCampaigns() {
  const { recuperarCampanhas } = require('../jobs/campaignRecovery');
  return recuperarCampanhas();
}

unlockStuck();
recoverStuckPosts().catch(e => console.error('recoverStuckPosts:', e.message));
recoverStuckJobs().catch(e => console.error('recoverStuckJobs:', e.message));
recoverCampaigns().catch(e => console.error('recoverCampaigns:', e.message));
setInterval(async () => { try { await unlockStuck(); } catch {} }, 60_000);
setInterval(async () => { try { await recoverStuckJobs(); } catch (e) { console.error('recoverStuckJobs interval:', e.message); } }, 5 * 60_000);
setInterval(async () => { try { await recoverCampaigns(); } catch (e) { console.error('recoverCampaigns interval:', e.message); } }, 5 * 60_000);

// ── Helpers de conta ────────────────────────────────────────────────────────

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
    postsToday:   (account.postsToday || 0) + 1,
    lastPostDate: new Date(),
    lastPostAt:   new Date(),
    healthStatus: 'ativa',
    lastError:    '',
  });
}

function isGraphApiPublishLimit(err) {
  return /número máximo de posts|content_publish_rate_limit|application request limit|maximum number of posts|too many publishes/i.test(err.message || '');
}

// ── Publicação instagrapi ─────────────────────────────────────────────────

// Mapeamento de erro instagrapi → healthStatus no MongoDB.
// Undefined = não altera healthStatus (erro de infraestrutura, não de sessão).
const _IG_HEALTH = {
  SESSION_EXPIRED:       'sessao_expirada',
  NO_INSTAGRAPI_SESSION: 'sessao_expirada',
  CHALLENGE_REQUIRED:    'restrita',
  FEEDBACK_REQUIRED:     'restrita',
  RATE_LIMITED:          'restrita',
};

// Exponential backoff with jitter for RATE_LIMITED responses.
const _IG_RATE_BACKOFF_BASE = 60_000;  // 1 min base
const _IG_RATE_BACKOFF_MAX  = 5 * 60_000;  // 5 min ceiling
const _IG_RATE_MAX_RETRIES  = 2;

async function publishViaInstagrapi(account, post) {
  const { getProvider }       = require('../providers/ProviderFactory');
  const { getSessionManager } = require('../services/instagrapi/SessionManager');
  const provider = getProvider(account);
  const sm       = getSessionManager();

  const postType = post.postType || 'reel';
  if (postType === 'story') {
    throw Object.assign(
      new Error('instagrapi não suporta stories — configure a conta com sessão mobile para histórias'),
      { code: 'UNSUPPORTED_TYPE' }
    );
  }

  let attempt = 0;
  while (true) {
    try {
      writeAccountLog(account.username, `Publicando via instagrapi (${postType})${attempt > 0 ? ` — tentativa ${attempt + 1}` : ''}...`);
      const r = postType === 'reel'
        ? await provider.publishReel(account, post)
        : await provider.publishPost(account, post);
      await sm.recordSuccess(String(account._id));
      writeAccountLog(account.username, 'Publicado com sucesso via instagrapi');
      // Devolve o id da mídia recém-criada. A campanha o guarda para comentar
      // exatamente nesta publicação, em vez de procurar a mais recente da conta.
      // Prefere a forma "pk_userid": com o pk puro, media_comment() gasta uma
      // requisição extra só para descobrir o dono da mídia.
      return { mediaId: String(r?.media_full_id || r?.media_id || '') };
    } catch (igErr) {
      if (igErr.code === 'RATE_LIMITED' && attempt < _IG_RATE_MAX_RETRIES) {
        attempt++;
        const jitter    = Math.random() * 30_000;
        const backoffMs = Math.min(_IG_RATE_BACKOFF_BASE * Math.pow(2, attempt) + jitter, _IG_RATE_BACKOFF_MAX);
        writeAccountLog(account.username, `Rate limited — aguardando ${Math.round(backoffMs / 1000)}s antes de tentar novamente`);
        await delay(backoffMs);
        continue;
      }
      await sm.recordFailure(String(account._id), igErr).catch(() => {});
      throw igErr;
    }
  }
}

// ── Publicação (Graph API → Private API fallback) ─────────────────────────

async function publishWithRetry(post, account, preProcessedVideoUrl) {
  const fs   = require('fs');
  const path = require('path');

  if (account.accessToken && account.igUserId) {
    writeAccountLog(account.username, 'Publicando via Graph API (Meta)...');
    try {
      const id = await postReelGraph(account, post, preProcessedVideoUrl || null);
      writeAccountLog(account.username, 'Publicado com sucesso via Graph API');
      return { mediaId: id ? String(id) : '' };
    } catch (err) {
      writeAccountLog(account.username, `Graph API: ${err.message}`);
      if (!isGraphApiPublishLimit(err)) throw err;
      writeAccountLog(account.username, 'Limite diário da Graph API atingido — usando Private API como fallback...');
    }
  }

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
    // A Private API não expõe o id de forma confiável — sem id, a campanha
    // marca o comentário como não suportado em vez de comentar no post errado.
    return { mediaId: '' };
  } catch (err) {
    writeAccountLog(account.username, `Private API: ${err.message}`);
    throw err;
  }
}

// ── Publicar para uma conta (helper compartilhado por legacy e Job) ─────────
// Retorna true em sucesso, lança erro em falha.

async function publishOneAccount(acc, post, preProcessedVideoUrl) {
  // Verifica se conta ainda existe e está em condições de publicar
  const accountCheck = await Account.findById(acc._id).lean();
  if (!accountCheck) throw new Error(`Conta não encontrada`);
  if (accountCheck.healthStatus === 'banida') {
    throw new Error(`Conta @${accountCheck.username} está banida — publicação cancelada`);
  }

  // Lock atômico: tenta adquirir isBusy em operação única.
  // Elimina race condition onde dois workers veem isBusy=false e ambos publicam.
  const MAX_WAIT  = 5 * 60 * 1000;
  const POLL      = 5_000;
  const startWait = Date.now();
  let account     = null;

  while (Date.now() - startWait <= MAX_WAIT) {
    // Libera locks expirados (>10min) de forma preemptiva
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    await Account.updateOne(
      { _id: acc._id, isBusy: true, busySince: { $lt: cutoff } },
      { $set: { isBusy: false, busySince: null, busyReason: '' } }
    );

    // Tenta adquirir o lock atomicamente — só sucede se isBusy === false
    account = await Account.findOneAndUpdate(
      { _id: acc._id, isBusy: false },
      { $set: { isBusy: true, busySince: new Date(), busyReason: 'Publicando' } },
      { new: true }
    );

    if (account) break;

    if (Date.now() - startWait < MAX_WAIT) {
      writeAccountLog(acc.username, 'Conta em uso por outro processo, aguardando...');
      await delay(POLL);
    }
  }

  if (!account) throw new Error(`conta em uso — tempo de espera esgotado (5min)`);

  broadcast('accounts', { action: 'busy', accountId: account._id });
  writeAccountLog(acc.username, 'Iniciando publicação');

  if (!(await checkDailyLimit(account))) {
    const msg = `Limite diário atingido: ${account.postsToday}/${account.dailyPostLimit}`;
    writeAccountLog(acc.username, msg);
    await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
    throw new Error(msg);
  }

  try {
    // `resultado` carrega o id da mídia publicada. Postar e Loop ignoram o
    // retorno (usam Promise.allSettled e só olham fulfilled/rejected); a
    // campanha o consome para amarrar o comentário à publicação certa.
    const resultado = account.provider === 'instagrapi'
      ? await publishViaInstagrapi(account, post)
      : await publishWithRetry(post, account, preProcessedVideoUrl);
    await registerSuccess(account);
    await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
    broadcast('accounts', { action: 'synced' });

    runPromoAfterPost(account._id).catch(e => console.log('[Promo] erro:', e.message));
    if (post.ctaComment?.trim())    postCTACommentForPost(account._id, post.ctaComment).catch(e => console.log('[CTA]:', e.message));
    if (post.engageComment?.trim()) postEngageCommentForPost(account._id, post.engageComment).catch(e => console.log('[Engage]:', e.message));

    return { ok: true, mediaId: String(resultado?.mediaId || '') };
  } catch (err) {
    writeAccountLog(acc.username, `Erro: ${err.message}`);
    const healthUpdate = {
      isBusy: false, busySince: null, busyReason: '',
      lastError: traduzirErro(err.message),
    };
    const provider = account?.provider || acc.provider;
    if (provider === 'instagrapi') {
      const igCode = err?.code || '';
      const igHealth = _IG_HEALTH[igCode];
      // Only update healthStatus for session/auth errors — not for infra/config issues
      if (igHealth) healthUpdate.healthStatus = igHealth;
      else if (!['INSTAGRAPI_SERVICE_UNAVAILABLE', 'UNSUPPORTED_TYPE'].includes(igCode)) {
        healthUpdate.healthStatus = classifyError(err) || 'sessao_expirada';
      }
    } else {
      const classified = classifyError(err);
      if (classified) healthUpdate.healthStatus = classified;
    }
    await Account.findByIdAndUpdate(acc._id, healthUpdate);
    broadcast('accounts', { action: 'health_update', accountId: String(acc._id), username: acc.username, healthStatus: healthUpdate.healthStatus || acc.healthStatus });
    throw err;
  }
}

// ── Processamento legado (postId) ─────────────────────────────────────────

async function processLegacyPost(postId) {
  const post = await Post.findById(postId).populate('accounts');
  if (!post) { console.log('Post não encontrado:', postId); return; }

  post.status = 'processando';
  post.error  = '';
  await post.save();

  let successCount = 0;
  let errorCount   = 0;
  const errors     = [];

  // Pré-processamento de vídeo para Graph API
  let preProcessedVideoUrl = null;
  const graphAccs = post.accounts.filter(a => a.accessToken && a.igUserId);
  if (graphAccs.length > 0) {
    try {
      preProcessedVideoUrl = await prepareVideo(post);
      console.log('Vídeo pré-processado:', preProcessedVideoUrl);
    } catch (e) {
      console.log('Aviso: pré-processamento falhou:', e.message);
    }
  }

  console.log(`[Legacy] Publicando para ${post.accounts.length} conta(s)...`);
  const results = await Promise.allSettled(
    post.accounts.map(acc => publishOneAccount(acc, post, preProcessedVideoUrl))
  );

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') successCount++;
    else {
      errorCount++;
      errors.push(`@${post.accounts[i].username}: ${r.reason?.message || 'Erro'}`);
    }
  });

  // Reagenda se todas as contas estavam ocupadas
  const pid        = String(post._id);
  const allBusy    = successCount === 0 && errors.length > 0 && errors.every(e => /conta em uso/i.test(e));
  const busyRetries = busyRetryMap.get(pid) || 0;

  if (allBusy && busyRetries < 3) {
    busyRetryMap.set(pid, busyRetries + 1);
    post.status = 'pendente';
    post.error  = '';
    await post.save();
    const postQueue = require('./postQueue');
    await postQueue.add('post', { postId: pid }, { delay: 30_000 });
    console.log(`[Legacy] Post ${pid} reagendado em 30s (tentativa ${busyRetries + 1}/3)`);
    return;
  }
  busyRetryMap.delete(pid);

  post.status = successCount > 0 && errorCount === 0 ? 'concluido'
              : successCount > 0                      ? 'parcial'
              :                                         'erro';
  post.error  = errors.join(' | ') || '';
  await post.save();

  broadcast('posts', { action: 'created' });
  console.log(`[Legacy] Finalizado — sucesso: ${successCount}, erro: ${errorCount}`);
}

// ── Processamento por Job (nova arquitetura) ──────────────────────────────

async function processJobRound(jobId) {
  const Job    = require('../models/Job');
  const postQueue = require('./postQueue');

  const jobDoc = await Job.findById(jobId).populate('accounts');
  if (!jobDoc) { console.log('[Job] não encontrado:', jobId); return; }

  if (['cancelled', 'completed', 'paused'].includes(jobDoc.status)) {
    console.log(`[Job] "${jobDoc.name}" está ${jobDoc.status} — rodada ignorada`);
    return;
  }

  // Se loop chegou ao final das mídias, reinicia do índice 0
  const totalMedia   = jobDoc.mediaFiles.length;
  let round          = jobDoc.currentRound;
  let startIdx       = round * jobDoc.simultaneousLimit;

  if (startIdx >= totalMedia) {
    if (jobDoc.type === 'loop') {
      round    = 0;
      startIdx = 0;
      jobDoc.currentRound    = 0;
      jobDoc.roundsCompleted = 0;
      console.log(`[Job] Loop "${jobDoc.name}" — ciclo completo, reiniciando`);
      broadcast('posts', { action: 'loop_cycled', jobId: String(jobDoc._id) });
    } else {
      jobDoc.status      = 'completed';
      jobDoc.completedAt = new Date();
      await jobDoc.save();
      broadcast('jobs', { action: 'job_updated', jobId: String(jobDoc._id) });
      console.log(`[Job] "${jobDoc.name}" — concluído (sem mais mídias)`);
      return;
    }
  }

  const endIdx     = Math.min(startIdx + jobDoc.simultaneousLimit, totalMedia);
  const roundMedia = jobDoc.mediaFiles.slice(startIdx, endIdx);

  // Update condicional: não sobrescreve pause/cancel emitido concorrentemente
  const activated = await Job.findOneAndUpdate(
    { _id: jobDoc._id, status: { $nin: ['paused', 'cancelled', 'completed'] } },
    { $set: { status: 'running', ...(!jobDoc.startedAt ? { startedAt: new Date() } : {}) } },
    { new: true }
  );
  if (!activated) {
    const fresh = await Job.findById(jobDoc._id).select('status').lean();
    console.log(`[Job] "${jobDoc.name}" foi ${fresh?.status || 'modificado'} antes de iniciar — rodada ignorada`);
    return;
  }
  jobDoc.startedAt = activated.startedAt;
  broadcast('jobs', { action: 'job_updated', jobId: String(jobDoc._id) });

  console.log(`[Job] "${jobDoc.name}" — rodada ${round + 1}/${jobDoc.totalRounds} (${roundMedia.length} mídia(s), ${jobDoc.accounts.length} conta(s))`);

  let roundSuccess = 0;
  let roundErrors  = 0;

  await Promise.allSettled(roundMedia.map(async (mediaFile) => {
    const isVideo   = /\.(mp4|mov|webm|avi|mkv)$/i.test(mediaFile);
    const mediaType = isVideo ? 'video' : 'image';
    let   postType  = jobDoc.postType || 'reel';
    if (postType === 'reel' && !isVideo) postType = 'post';

    // Pré-processa vídeo para contas Graph API
    let preProcessedVideoUrl = null;
    const graphAccs = jobDoc.accounts.filter(a => a.accessToken && a.igUserId);
    if (graphAccs.length > 0) {
      try {
        preProcessedVideoUrl = await prepareVideo({ media: mediaFile, mediaType, postType });
      } catch (e) {
        console.log('[Job] pré-processamento falhou:', e.message);
      }
    }

    // Cria Post document para esta mídia
    const post = await Post.create({
      media:         mediaFile,
      mediaType,
      postType,
      cover:         jobDoc.cover         || '',
      caption:       jobDoc.caption       || '',
      ctaComment:    jobDoc.ctaComment    || '',
      engageComment: jobDoc.engageComment || '',
      location:      jobDoc.location      || '',
      processMode:   jobDoc.processMode   || 'limpeza_leve',
      accounts:      jobDoc.accounts.map(a => a._id),
      status:        'processando',
      scheduledAt:   new Date(),
    });

    // Publica para todas as contas em paralelo
    const results = await Promise.allSettled(
      jobDoc.accounts.map(acc => publishOneAccount(acc, post, preProcessedVideoUrl))
    );

    let postSuccess = 0;
    const postErrorMsgs = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { postSuccess++; roundSuccess++; }
      else {
        roundErrors++;
        postErrorMsgs.push(`@${jobDoc.accounts[i].username}: ${r.reason?.message || 'Erro'}`);
      }
    });

    post.status = postSuccess === results.length ? 'concluido'
                : postSuccess > 0               ? 'parcial'
                :                                 'erro';
    post.error  = postErrorMsgs.join(' | ');
    await post.save();

    // Registra post no Job (push atômico para evitar conflito)
    await Job.findByIdAndUpdate(jobDoc._id, { $push: { postIds: post._id } });
  }));

  // Atualiza contadores
  const nextRound     = round + 1;
  const nextStartIdx  = nextRound * jobDoc.simultaneousLimit;
  const hasMoreRounds = nextStartIdx < totalMedia || jobDoc.type === 'loop';

  await Job.findByIdAndUpdate(jobDoc._id, {
    $inc: {
      postsPublished:  roundSuccess,
      postsErrors:     roundErrors,
      roundsCompleted: 1,
    },
    currentRound: nextRound,
  });

  broadcast('posts', { action: 'created' });

  if (!hasMoreRounds) {
    await Job.findByIdAndUpdate(jobDoc._id, { status: 'completed', completedAt: new Date() });
    broadcast('jobs', { action: 'job_updated', jobId: String(jobDoc._id) });
    console.log(`[Job] "${jobDoc.name}" — concluído`);
    return;
  }

  // Re-lê o status atual do DB antes de agendar a próxima rodada.
  // Garante que um Pause ou Cancel emitido durante a rodada seja respeitado.
  const freshStatus = (await Job.findById(jobDoc._id).select('status').lean())?.status;
  if (['paused', 'cancelled'].includes(freshStatus)) {
    console.log(`[Job] "${jobDoc.name}" — rodada ${round + 1} concluída mas job foi ${freshStatus}. Próxima rodada não agendada.`);
    broadcast('jobs', { action: 'job_updated', jobId: String(jobDoc._id) });
    return;
  }

  // Agenda próxima rodada
  const rawIntervalMs = (jobDoc.intervalMinutes || 0) * 60 * 1000;
  // Loops com intervalo=0 causariam tight loop consumindo todos os workers — mínimo 60s
  const intervalMs = (jobDoc.type === 'loop' && rawIntervalMs < 60_000) ? 60_000 : rawIntervalMs;
  const isLoopCycling = jobDoc.type === 'loop' && nextStartIdx >= totalMedia;

  if (isLoopCycling) {
    console.log(`[Job] Loop "${jobDoc.name}" — ciclo completo, próximo em ${jobDoc.intervalMinutes}min`);
    broadcast('posts', { action: 'loop_cycled', jobId: String(jobDoc._id) });
  }

  const bullJob = await postQueue.add(
    'job_round',
    { jobId: String(jobDoc._id) },
    { delay: intervalMs }
  );

  await Job.findByIdAndUpdate(jobDoc._id, {
    status:       intervalMs > 0 ? 'waiting_interval' : 'running',
    nextRoundAt:  new Date(Date.now() + intervalMs),
    bullMqJobId:  String(bullJob.id),
    ...(isLoopCycling ? { currentRound: 0, roundsCompleted: 0 } : {}),
  });

  broadcast('jobs', { action: 'job_updated', jobId: String(jobDoc._id) });
  console.log(`[Job] "${jobDoc.name}" — rodada ${round + 1} concluída (✓${roundSuccess} ✗${roundErrors}). Próxima ${intervalMs > 0 ? `em ${jobDoc.intervalMinutes}min` : 'imediatamente'}`);
}

// ── Processamento de campanha (fase 8) ────────────────────────────────────
//
// A regra de execução vive em services/campaignExecutor.js — aqui fica só a
// ligação. O executor recebe `publicarNaConta` por injeção porque o único
// caminho seguro de publicação é o publishOneAccount deste arquivo, com o lock
// atômico de isBusy e a checagem de limite diário. Importar o executor e deixá-lo
// chamar direto exigiria mover publishOneAccount para fora daqui (mexendo no que
// Postar e Loop usam) ou reescrevê-lo lá (dois locks de conta concorrendo pela
// mesma conta). Injetar mantém um caminho só.

async function processCampaignPublication(publicationId) {
  const executor = require('../services/campaignExecutor');
  return executor.processarPublicacao(publicationId, {
    publicarNaConta: (account, post) => publishOneAccount(account, post, null),
    broadcast,
  });
}

async function processCampaignComment(publicationId) {
  const executor = require('../services/campaignExecutor');
  return executor.processarComentario(publicationId, {
    comentarNaConta: publicarComentarioCampanha,
    broadcast,
  });
}

/**
 * Publica o comentário de uma publicação de campanha.
 *
 * Despacha pelo mesmo ProviderFactory da publicação: conta instagrapi comenta
 * pelo serviço Python (Client.media_comment), conta oficial pela Graph API. Os
 * dois caminhos não se misturam.
 *
 * O comentário vai para `mediaId` — o id que a própria publicação devolveu.
 * Nenhuma das vias procura "a mídia mais recente da conta".
 */
async function publicarComentarioCampanha(account, { mediaId, text }) {
  const { getProvider } = require('../providers/ProviderFactory');
  return getProvider(account).comment(account, { mediaId, text });
}

// ── Worker BullMQ ─────────────────────────────────────────────────────────

const worker = new Worker(
  'posts',
  async (job) => {
    if (job.data.campaignPublicationId) {
      // Campanha — uma publicação por job (fase 8)
      await processCampaignPublication(job.data.campaignPublicationId);
    } else if (job.data.campaignCommentId) {
      // Campanha — comentário agendado como tarefa própria
      await processCampaignComment(job.data.campaignCommentId);
    } else if (job.data.jobId) {
      // Nova arquitetura — Job-based
      await processJobRound(job.data.jobId);
    } else if (job.data.postId) {
      // Arquitetura legada — Post direto
      await processLegacyPost(job.data.postId);
    } else {
      console.log('[Worker] job sem postId nem jobId:', job.data);
    }
  },
  { connection, concurrency: 5, lockDuration: 1_200_000, stalledInterval: 60_000 }
);

worker.on('completed', job => console.log('[Worker] job concluído:', job.id));
worker.on('failed',    (job, err) => console.log('[Worker] job falhou:', err.message));

console.log('[Worker] rodando — suporte a Job-based e legado');

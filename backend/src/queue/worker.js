require('dotenv').config();

const { Worker }   = require('bullmq');
const connection   = require('./connection');
const connectDB    = require('../config/db');
const Post         = require('../models/Post');
const Account      = require('../models/Account');
const { postReel: postReelPrivate } = require('../services/instagramPrivateService');
const { postReel: postReelGraph, prepareVideo } = require('../services/instagramAPI');
/* Um arquivo por conta no caminho mobile — ver o cabeçalho do módulo para o
   porquê: até aqui todas as contas subiam o MESMO arquivo, byte a byte. */
const { prepararParaConta, descartar } = require('../services/midiaPorConta');
/* Teto diário e janela de horário. O teto nascia 999999 — sem limite — e não
   havia janela: a conta publicava de madrugada como publica de tarde. */
const { podePublicar } = require('../services/ritmoDaConta');
const { writeAccountLog } = require('../utils/accountLogger');
const { broadcast }       = require('../events/broadcaster');
const { classifyError }   = require('../jobs/healthCheck');
const traduzirErro        = require('../utils/traduzirErro');
const { runPromoAfterPost, postCTACommentForPost, postEngageCommentForPost } = require('../jobs/promoJob');
// Ordenação humanizada — as mesmas regras da campanha, para Postar e Loop não
// terem uma segunda implementação que divirja com o tempo.
const { criarRandom, embaralhar, espacarPorConta } = require('../services/publicationPlanner');

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

/**
 * A conta pode publicar agora?
 *
 * Era `postsToday < dailyPostLimit`, e `dailyPostLimit` nascia 999999 — na
 * prática, sem teto. Com o loop a cada 40 minutos, cada conta publicava umas
 * 36 vezes por dia, 24 horas por dia, sem parar de madrugada.
 *
 * Trinta e seis publicações distribuídas uniformemente pelas 24 horas é o
 * padrão mais característico de automação que existe: não depende de analisar
 * conteúdo, arquivo, IP ou dispositivo — basta contar publicações por hora.
 * Nenhuma humanização de pixel compensa isso.
 *
 * `ritmoDaConta` decide teto e janela; aqui fica só a virada do dia, que é
 * responsabilidade de quem tem o banco na mão.
 */
async function checkDailyLimit(account) {
  if (!isSameDay(account.lastPostDate)) {
    await Account.findByIdAndUpdate(account._id, { postsToday: 0, lastPostDate: new Date() });
    account.postsToday = 0;
  }
  return podePublicar(account).pode;
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
    // Story é desviado antes daqui. Se chegou, o desvio quebrou — e a mensagem
    // precisa dizer isso, não culpar o instagrapi, que publica story sem
    // problema pelo `storyService`.
    throw Object.assign(
      new Error('story chegou ao caminho de reel — o desvio em publishOneAccount não foi aplicado'),
      { code: 'STORY_MAL_ROTEADO' }
    );
  }

  /* ── A mídia desta conta ────────────────────────────────────────────────

     Este caminho mandava `post.media` cru para o `clip_upload`: o arquivo que
     a pessoa subiu, sem conversão, sem limpeza de metadados, e o MESMO para
     todas as contas. Todo o pipeline de vídeo vivia no ramo do Graph API, e
     estas contas não passam por lá.

     Agora cada conta recebe um arquivo próprio, derivado do par (post, conta):
     em spec de Reels, sem metadados de origem, e com as micro-variações do
     humanizador. Mesma conta reprocessando o mesmo post recebe o mesmo
     arquivo — ver o comentário sobre a semente em midiaPorConta.js.

     A conversão fica FORA do laço de tentativas de propósito: reconverter a
     cada 429 gastaria minutos de CPU para produzir exatamente o mesmo arquivo,
     já que a semente não muda. */
  const midia = await prepararParaConta(post, account);
  const postParaPublicar = midia.caminho === post.media
    ? post
    : { ...(post.toObject ? post.toObject() : post), media: midia.caminho };

  let attempt = 0;
  try {
  while (true) {
    try {
      writeAccountLog(account.username, `Publicando via instagrapi (${postType})${attempt > 0 ? ` — tentativa ${attempt + 1}` : ''}...`);
      const r = postType === 'reel'
        ? await provider.publishReel(account, postParaPublicar)
        : await provider.publishPost(account, postParaPublicar);
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
  } finally {
    /* O arquivo desta conta já cumpriu o papel, tenha subido ou não.

       Sem esta limpeza, cada volta do loop deixa um arquivo de dezenas de MB
       por conta. Um loop de 44 reels em 5 contas gera 220 arquivos por ciclo:
       o disco enche em dias, e o sintoma aparece como falha de publicação sem
       relação aparente com disco.

       No `finally` e não depois do `return`: o caminho de erro é justamente o
       que mais repete. */
    descartar(midia.caminho, midia.proprio);
  }
}

// ── Story ────────────────────────────────────────────────────────────────
// Delega ao serviço que a página de Stories usa, em vez de repetir a escolha
// de provedor aqui. Duas implementações da mesma decisão divergem, e foi assim
// que o caminho agendado ficou sem saber publicar story.

async function publicarStoryAgendado(account, post) {
  const { postStory } = require('../services/storyService');
  writeAccountLog(account.username, 'Publicando story...');

  const info = await postStory(account, {
    imageUrl: post.media,
    caption:  post.caption || '',
    linkUrl:  post.storyLink || null,
    linkText: post.storyLinkText || null,
  });

  writeAccountLog(account.username, `Story publicado via ${info.method}`);
  return { mediaId: String(info.id || '') };
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
    /* A mensagem diz o motivo REAL: teto atingido e fora da janela param a
       publicação do mesmo jeito, e consertam de formas diferentes. */
    const msg = podePublicar(account).motivo || 'Aguardando janela de publicação';
    writeAccountLog(acc.username, msg);
    await Account.findByIdAndUpdate(account._id, { isBusy: false, busySince: null, busyReason: '' });
    throw new Error(msg);
  }

  try {
    // `resultado` carrega o id da mídia publicada. Postar e Loop ignoram o
    // retorno (usam Promise.allSettled e só olham fulfilled/rejected); a
    // campanha o consome para amarrar o comentário à publicação certa.
    /* Story tem caminho próprio, antes da bifurcação por provedor.

       `publishWithRetry` e `publishViaInstagrapi` publicam REEL e POST; nenhum
       dos dois sabe fazer story, e o segundo recusava dizendo que "instagrapi
       não suporta stories" — afirmação falsa, porque o provider implementa
       `publishStory` e o serviço Python expõe `/publish/story`. O resultado era
       o story agendado nunca sair, com uma mensagem que mandava procurar no
       lugar errado.

       `storyService.postStory` é o caminho que a página de Stories já usa: ele
       escolhe entre instagrapi, Graph API, sessão privada e navegador conforme
       a conta, e cuida da figurinha de link. Usá-lo aqui faz o story agendado
       funcionar para TODO tipo de conta, não só para uma. */
    const ehStory = (post.postType || 'reel') === 'story';
    const resultado = ehStory
      ? await publicarStoryAgendado(account, post)
      : account.provider === 'instagrapi'
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
    const classificado = provider === 'instagrapi'
      ? (_IG_HEALTH[err?.code || ''] || classifyError(err))
      : classifyError(err);

    /* Só mexe na saúde da conta quando o erro foi RECONHECIDO como problema
       de sessão, de bloqueio ou de banimento. `classifyError` devolve null de
       propósito para o que é transitório — e o comentário dela diz isso com
       todas as letras.
       
       Antes existia um `|| 'sessao_expirada'` aqui, que descartava essa
       decisão: qualquer erro não mapeado — timeout de rede, ffmpeg falhando,
       arquivo grande demais, o serviço Python reiniciando — marcava a conta
       como sessão expirada. Bastava um tropeço para a conta ser dada como
       morta logo depois de conectar, que é exatamente o "conecto e já cai".
       
       Falha de publicação e saúde de conta são coisas diferentes: a
       publicação falha e é reprocessada; a conta só muda de estado quando o
       Instagram diz alguma coisa sobre ELA. */
    if (classificado) healthUpdate.healthStatus = classificado;
    else {
      console.log(
        `[worker] erro não classificado em @${acc.username} — saúde preservada. code=${err?.code || '-'} msg=${String(err?.message || '').slice(0, 120)}`
      );
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
  // Ordem sorteada, como nas rodadas do Job Engine: publicar sempre na ordem
  // gravada repete a mesma sequência de contas a cada post.
  const contasEmbaralhadas = embaralhar(post.accounts, criarRandom(`legacy:${post._id}`));
  const results = [];
  for (let i = 0; i < contasEmbaralhadas.length; i++) {
    const acc = contasEmbaralhadas[i];
    if (i > 0) {
      // Fase 16: Intercalação orgânica real de 3 a 7 minutos (180s a 420s)
      const humanDelayMs = Math.floor(Math.random() * 240000) + 180000;
      console.log(`[Legacy] Intervalo humanizado de ${(humanDelayMs / 1000).toFixed(1)}s antes de postar em @${acc.username}...`);
      await delay(humanDelayMs);
    }
    try {
      const res = await publishOneAccount(acc, post, preProcessedVideoUrl);
      results.push({ status: 'fulfilled', value: res });
    } catch (err) {
      results.push({ status: 'rejected', reason: err });
    }
  }

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') successCount++;
    else {
      errorCount++;
      errors.push(`@${contasEmbaralhadas[i].username}: ${r.reason?.message || 'Erro'}`);
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

  // ── Sequência da rodada ────────────────────────────────────────────────
  //
  // Antes: as mídias da rodada rodavam em paralelo e cada uma percorria as
  // contas com intervalo humano. O intervalo só existia ENTRE contas de uma
  // mesma mídia — a mesma conta recebia as N mídias do lote emendadas, sem
  // pausa nenhuma, serializadas só pela disputa do lock isBusy. Era o padrão
  // mais robotizado do sistema, e ainda arriscava estourar os 5 min de espera
  // do lock quando várias mídias caíam na mesma conta.
  //
  // Agora a rodada é uma sequência ÚNICA de (mídia × conta): ordem das contas
  // sorteada por rodada, espaçada para a mesma conta não aparecer duas vezes
  // seguidas, e intervalo humano entre TODAS as publicações.
  //
  // A seed é `jobId:rodada` — muda a cada rodada (a ordem não se repete) e é
  // reproduzível quando se precisa investigar o que saiu em que ordem.
  const rand           = criarRandom(`${jobDoc._id}:${round}`);
  const contasDaRodada = embaralhar(jobDoc.accounts, rand);

  // O preparo (documento Post e pré-processamento de vídeo) não fala com o
  // Instagram — segue em paralelo, antes de qualquer publicação.
  const preparadas = await Promise.all(roundMedia.map(async (mediaFile) => {
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

    return { mediaFile, post, preProcessedVideoUrl, sucessos: 0, erros: [] };
  }));

  const pares = [];
  for (const conta of contasDaRodada) {
    for (const preparada of preparadas) {
      pares.push({ accountId: String(conta._id), conta, preparada });
    }
  }
  const sequencia = espacarPorConta(embaralhar(pares, rand));

  for (let indice = 0; indice < sequencia.length; indice++) {
    const { conta, preparada } = sequencia[indice];

    if (indice > 0) {
      const humanDelayMs = Math.floor(Math.random() * 180000) + 120000;  // 2 a 5 min
      console.log(`[Job] Intervalo humanizado de ${(humanDelayMs / 1000).toFixed(1)}s antes de postar em @${conta.username}...`);
      await delay(humanDelayMs);
    }

    // Pause e cancel emitidos durante a rodada param a sequência: sem esta
    // checagem o job continuaria publicando por mais dezenas de minutos.
    const statusAtual = (await Job.findById(jobDoc._id).select('status').lean())?.status;
    if (['paused', 'cancelled'].includes(statusAtual)) {
      console.log(`[Job] "${jobDoc.name}" foi ${statusAtual} — sequência interrompida em ${indice}/${sequencia.length}`);
      break;
    }

    try {
      await publishOneAccount(conta, preparada.post, preparada.preProcessedVideoUrl);
      preparada.sucessos++;
      roundSuccess++;
    } catch (err) {
      preparada.erros.push(`@${conta.username}: ${err?.message || 'Erro'}`);
      roundErrors++;
    }
  }

  for (const preparada of preparadas) {
    const publicadas = preparada.sucessos + preparada.erros.length;
    preparada.post.status = publicadas === 0                     ? 'erro'
                          : preparada.sucessos === publicadas    ? 'concluido'
                          : preparada.sucessos > 0               ? 'parcial'
                          :                                        'erro';
    preparada.post.error  = preparada.erros.join(' | ');
    await preparada.post.save();

    // Registra post no Job (push atômico para evitar conflito)
    await Job.findByIdAndUpdate(jobDoc._id, { $push: { postIds: preparada.post._id } });
  }

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

  // Agenda a próxima rodada com jitter simétrico de ±12%, para as rodadas não
  // caírem sempre no mesmo minuto do relógio.
  //
  // Piso de 1 minuto mesmo com intervalMinutes = 0: jobs antigos (e o caminho
  // de repost dos insights) foram criados com 0 e emendavam uma rodada na
  // outra sem pausa nenhuma. O controller já recusa 0 na criação; este piso
  // cobre o que já está gravado no banco.
  const PISO_INTERVALO_MS = 60_000;
  const rawIntervalMs = Math.max(PISO_INTERVALO_MS, (jobDoc.intervalMinutes || 0) * 60 * 1000);
  const jitterFactor  = 1 + ((Math.random() * 0.24) - 0.12);
  const intervalMs    = Math.max(PISO_INTERVALO_MS, Math.round(rawIntervalMs * jitterFactor));

  const isLoopCycling = jobDoc.type === 'loop' && nextStartIdx >= totalMedia;

  if (isLoopCycling) {
    console.log(`[Job] Loop "${jobDoc.name}" — ciclo completo, próximo em ${(intervalMs / 60000).toFixed(1)}min`);
    broadcast('posts', { action: 'loop_cycled', jobId: String(jobDoc._id) });
  }

  const bullJob = await postQueue.add(
    'job_round',
    { jobId: String(jobDoc._id) },
    { delay: intervalMs }
  );

  await Job.findByIdAndUpdate(jobDoc._id, {
    status:       'waiting_interval',
    nextRoundAt:  new Date(Date.now() + intervalMs),
    bullMqJobId:  String(bullJob.id),
    ...(isLoopCycling ? { currentRound: 0, roundsCompleted: 0 } : {}),
  });

  broadcast('jobs', { action: 'job_updated', jobId: String(jobDoc._id) });
  console.log(`[Job] "${jobDoc.name}" — rodada ${round + 1} concluída (✓${roundSuccess} ✗${roundErrors}). Próxima em ${(intervalMs / 60000).toFixed(1)}min (jitter humanizado)`);
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

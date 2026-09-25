'use strict';

/**
 * Motor de execução da campanha.
 *
 * A unidade de execução é UMA publicação = UM trabalho na fila. Não existe
 * trabalho guarda-chuva da campanha: é isso que permite retry individual,
 * cancelar uma publicação sem tocar nas outras e sobreviver a um restart sem
 * reprocessar o que já saiu.
 *
 * `publicarNaConta` chega por injeção (worker.js): é o único caminho de
 * publicação, com a trava da conta e o ritmo — uma segunda implementação
 * significaria duas publicações simultâneas na mesma conta.
 */

const { sql } = require('../db');
const { campaigns, campaignPublications, media, posts } = require('../repos');
const accounts = require('../repos/accounts');
const fila = require('./campaignQueue');
const { resolveTemplate } = require('./templateResolver');

class ExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
  }
}

/** Estados dos quais uma publicação não sai mais sozinha. */
const TERMINAIS = new Set(['published', 'cancelled']);
/** Estados que ainda podem ser enfileirados. */
const AGENDAVEIS = ['pending', 'scheduled'];

// ── Classificação de erro ────────────────────────────────────────────────────
// O painel filtra e agrupa por estes códigos, então eles não podem depender do
// texto livre da mensagem.

function _porSaudeDaConta(err) {
  const c = require('./contas').classificarErro(err);
  if (!c) return null;
  if (c.status === 'token_invalido') return 'SESSION_EXPIRED';
  if (c.status === 'banida') return 'ACCOUNT_UNAVAILABLE';
  if (c.status === 'restrita') return /verifica/i.test(c.mensagem) ? 'ACCOUNT_CHALLENGE' : 'ACCOUNT_RESTRICTED';
  return null;
}

function classificarErro(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  if (code === 'SEM_TOKEN') return 'SESSION_EXPIRED';
  if (code === 'ACCOUNT_BUSY' || code === 'ACCOUNT_UNAVAILABLE') return code;
  if (/limite diário|daily limit|teto diário atingido/.test(msg)) return 'DAILY_LIMIT';
  if ([4, 17, 32, 613].includes(Number(err?.code)) || /rate.?limit|too many|please wait/.test(msg)) return 'RATE_LIMITED';
  const porSaude = _porSaudeDaConta(err);
  if (porSaude) return porSaude;
  if (/econnrefused|etimedout|enotfound|socket|network|fetch failed/.test(msg)) return 'NETWORK_ERROR';
  return 'PUBLISH_ERROR';
}

/** O padrão é COMMENT_FAILED: "erro desconhecido" esconde o que precisa ser investigado. */
function classificarErroComentario(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  if (code === 'SEM_TOKEN') return 'SESSION_EXPIRED';
  if (code === 'COMMENT_NOT_SUPPORTED' || code === 'COMMENT_MEDIA_NOT_FOUND') return code;
  // Timeout é separado de rede: a requisição chegou, a resposta é que demorou.
  if (/timeout|timed out|abort/.test(msg) || err?.name === 'TimeoutError') return 'TIMEOUT';
  if (/media not found|does not exist|invalid media|unsupported get request/.test(msg)) return 'COMMENT_MEDIA_NOT_FOUND';
  if ([4, 17, 32, 613].includes(Number(err?.code)) || /rate.?limit|too many|please wait/.test(msg)) return 'RATE_LIMITED';
  const porSaude = _porSaudeDaConta(err);
  if (porSaude) return porSaude === 'ACCOUNT_RESTRICTED' ? 'RATE_LIMITED' : porSaude;
  if (/econnrefused|etimedout|enotfound|socket|network|fetch failed/.test(msg)) return 'NETWORK_ERROR';
  return 'COMMENT_FAILED';
}

// ── Registro ─────────────────────────────────────────────────────────────────

/**
 * Loga e grava o evento no histórico da campanha. Só identificadores — nunca
 * a conta inteira, que carrega o token. Gravar não pode derrubar a execução.
 */
function registrarEvento(evento, dados = {}) {
  const linha = {
    evento,
    campaignId: dados.campaignId ? String(dados.campaignId) : undefined,
    publicationId: dados.publicationId ? String(dados.publicationId) : undefined,
    accountId: dados.accountId ? String(dados.accountId) : undefined,
    contentId: dados.contentId ? String(dados.contentId) : undefined,
    mediaId: dados.mediaId ? String(dados.mediaId) : undefined,
    attempt: dados.attempt,
    durationMs: dados.durationMs,
    errorCode: dados.errorCode,
    error: dados.error ? String(dados.error).slice(0, 300) : undefined,
    at: new Date().toISOString(),
  };
  for (const k of Object.keys(linha)) if (linha[k] === undefined) delete linha[k];
  console.log(`[Campaign] ${evento}`, JSON.stringify(linha));

  if (dados.campaignId) {
    sql`
      insert into campaign_events (campaign_id, publication_id, account_id, evento, error_code, error, media_id, attempt, duration_ms)
      values (${linha.campaignId}, ${linha.publicationId || null}, ${linha.accountId || null}, ${evento},
              ${linha.errorCode || ''}, ${linha.error || ''}, ${linha.mediaId || ''},
              ${linha.attempt || 0}, ${Math.round(linha.durationMs || 0)})`.catch(() => {});
  }
  return linha;
}

function emitir(broadcast, acao, dados, usuarioId) {
  if (typeof broadcast !== 'function') return;
  try { broadcast('campaigns', { action: acao, ...dados }, usuarioId); } catch { /* SSE não derruba a execução */ }
}

// ── Contadores ───────────────────────────────────────────────────────────────

/**
 * Recalcula os contadores CONTANDO as publicações — incremento acumulativo
 * diverge assim que um processo morre entre publicar e incrementar.
 */
async function recalcularContadores(campaignId) {
  const linhas = await sql`
    select status, count(*) as total from campaign_publications
    where campaign_id = ${campaignId} group by status`;
  const c = { total: 0, pending: 0, scheduled: 0, processing: 0, published: 0, failed: 0, cancelled: 0 };
  for (const l of linhas) {
    if (c[l.status] !== undefined) c[l.status] = l.total;
    c.total += l.total;
  }
  await campaigns.update(campaignId, {
    totalPublications: c.total,
    pendingPublications: c.pending + c.scheduled + c.processing,
    publishedPublications: c.published,
    failedPublications: c.failed,
  });
  return c;
}

/** Fecha a campanha quando tudo chegou a estado terminal: completed, partial ou failed. */
async function finalizarSeCompleta(campaignId, contadores = null) {
  const c = contadores || await recalcularContadores(campaignId);
  if (c.pending + c.scheduled + c.processing > 0 || c.total === 0) return null;

  const campanha = await campaigns.findById(campaignId);
  if (!campanha) return null;
  if (['cancelled', 'completed', 'partial', 'failed'].includes(campanha.status)) return campanha.status;

  const status = c.published === 0 ? 'failed' : c.failed === 0 && c.cancelled === 0 ? 'completed' : 'partial';
  await campaigns.update(campaignId, { status, completedAt: new Date() });
  registrarEvento('CAMPAIGN_FINISHED', { campaignId, errorCode: status });
  return status;
}

// ── Agendamento ──────────────────────────────────────────────────────────────

/**
 * Enfileira todas as publicações agendáveis. Idempotente: a chave do trabalho
 * vem do id da publicação. Publicação atrasada (horário já passou) é
 * espalhada em 5–10 min de distância, para não sair tudo de uma vez.
 */
async function agendarCampanha(campaignId, { agora = new Date() } = {}) {
  const campanha = await campaigns.findById(campaignId);
  if (!campanha) throw new ExecutionError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
  if (['paused', 'cancelled'].includes(campanha.status)) {
    throw new ExecutionError('INVALID_CAMPAIGN_STATE', `Campanha em "${campanha.status}" não pode agendar publicações.`);
  }

  const lista = await sql`
    select * from campaign_publications
    where campaign_id = ${campaignId} and status = any(${AGENDAVEIS})
    order by scheduled_at, id`;

  let agendadas = 0, jaExistiam = 0, atrasadas = 0;
  for (const pub of lista) {
    let quando = new Date(pub.scheduledAt);
    if (fila.calcularDelay(quando, agora) === 0) {
      quando = new Date(agora.getTime() + ((atrasadas * 5) + Math.floor(Math.random() * 5)) * 60_000);
      atrasadas++;
    }
    const { jobId, criado } = await fila.agendarPublicacao({ ...pub, scheduledAt: quando }, agora);
    if (criado) agendadas++; else jaExistiam++;
    await sql`
      update campaign_publications set status = 'scheduled', queue_job_id = ${jobId}, scheduled_at = ${quando}
      where id = ${pub.id} and status = any(${AGENDAVEIS})`;
    registrarEvento('PUBLICATION_SCHEDULED', { campaignId, publicationId: pub.id, accountId: pub.accountId, contentId: pub.contentId });
  }

  const contadores = await recalcularContadores(campaignId);
  return { agendadas, jaExistiam, total: lista.length, contadores };
}

/** Arquivo da capa escolhida (a do perfil vale acima da do conteúdo), ou ''. */
async function _arquivoDaCapa(campanha, contentId, accountId) {
  const capaId = campanha?.covers?.byAccount?.[String(accountId)] || campanha?.covers?.byContent?.[String(contentId)];
  if (!capaId) return '';
  const capa = await media.findById(String(capaId)).catch(() => null);
  return capa?.filename || '';
}

/** Atraso do comentário sorteado na faixa configurada — fixo vira padrão detectável. */
function _atrasoDoComentario(comments = {}) {
  const minutos = (v, padrao) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : padrao);
  const piso = minutos(comments.delayMinutes, 2);
  const teto = minutos(comments.delayMaxMinutes, 6);
  if (!(teto > piso)) return piso;
  return piso + Math.random() * (teto - piso);
}

// ── Execução de uma publicação ───────────────────────────────────────────────

/**
 * @param {Object} deps
 * @param {Function} deps.publicarNaConta  (conta, post) => Promise<{mediaId}>
 * @param {Function} [deps.broadcast]
 */
async function processarPublicacao(publicationId, deps = {}) {
  const { publicarNaConta, broadcast, agora = new Date() } = deps;
  if (typeof publicarNaConta !== 'function') throw new ExecutionError('MISSING_PUBLISHER', 'publicarNaConta não foi injetado.');
  const inicio = Date.now();

  const pub = await campaignPublications.findById(publicationId);
  if (!pub) return { skipped: true, reason: 'PUBLICATION_NOT_FOUND' };
  if (TERMINAIS.has(pub.status)) return { skipped: true, reason: `ALREADY_${pub.status.toUpperCase()}` };

  const campanha = await campaigns.findById(pub.campaignId);
  if (!campanha) return { skipped: true, reason: 'CAMPAIGN_NOT_FOUND' };

  if (campanha.status === 'cancelled') {
    await sql`update campaign_publications set status = 'cancelled'
              where id = ${pub.id} and status = any(${[...AGENDAVEIS, 'processing']})`;
    registrarEvento('PUBLICATION_CANCELLED', { campaignId: campanha.id, publicationId: pub.id, errorCode: 'CAMPAIGN_CANCELLED' });
    return { skipped: true, reason: 'CAMPAIGN_CANCELLED' };
  }
  // Pausada: volta a 'pending' (a pausa já tirou da fila) sem gastar tentativa.
  if (campanha.status === 'paused') {
    await sql`update campaign_publications set status = 'pending', queue_job_id = '' where id = ${pub.id} and status = 'scheduled'`;
    return { skipped: true, reason: 'CAMPAIGN_PAUSED' };
  }

  // Reivindicação atômica: só um executor sai de pending/scheduled para processing.
  const [tomada] = await sql`
    update campaign_publications set status = 'processing', error = '', error_code = '', attempts = attempts + 1
    where id = ${pub.id} and status = any(${AGENDAVEIS}) returning *`;
  if (!tomada) return { skipped: true, reason: 'ALREADY_CLAIMED' };

  registrarEvento('PUBLICATION_STARTED', {
    campaignId: campanha.id, publicationId: pub.id, accountId: pub.accountId, contentId: pub.contentId, attempt: tomada.attempts,
  });
  emitir(broadcast, 'publication_started', { campaignId: campanha.id, publicationId: pub.id }, campanha.usuarioId);

  const falhar = async (codigo, mensagem) => {
    await campaignPublications.update(pub.id, { status: 'failed', error: String(mensagem).slice(0, 500), errorCode: codigo });
    registrarEvento('PUBLICATION_FAILED', {
      campaignId: campanha.id, publicationId: pub.id, accountId: pub.accountId, contentId: pub.contentId,
      attempt: tomada.attempts, durationMs: Date.now() - inicio, errorCode: codigo, error: mensagem,
    });
    await finalizarSeCompleta(campanha.id, await recalcularContadores(campanha.id));
    emitir(broadcast, 'publication_failed', { campaignId: campanha.id, publicationId: pub.id, errorCode: codigo }, campanha.usuarioId);
    return { ok: false, errorCode: codigo };
  };

  /* Teto diário, janela e cota da API são pausas de TEMPO: a publicação volta
     para a fila no horário em que a conta pode publicar, em vez de falhar. */
  const adiar = async (motivo, ate) => {
    await campaignPublications.update(pub.id, { status: 'scheduled', error: motivo, errorCode: 'RHYTHM_WAIT' });
    const { jobId } = await fila.reagendarPublicacao({ id: pub.id, campaignId: pub.campaignId, scheduledAt: ate }, agora);
    await campaignPublications.update(pub.id, { queueJobId: jobId });
    registrarEvento('PUBLICATION_DEFERRED', {
      campaignId: campanha.id, publicationId: pub.id, accountId: pub.accountId, contentId: pub.contentId,
      attempt: tomada.attempts, error: motivo,
    });
    emitir(broadcast, 'publication_deferred', { campaignId: campanha.id, publicationId: pub.id, ate }, campanha.usuarioId);
    return { ok: false, deferred: true, ate };
  };

  const conta = await accounts.findById(pub.accountId);
  if (!conta || conta.usuarioId !== campanha.usuarioId) return falhar('ACCOUNT_UNAVAILABLE', 'A conta desta publicação não existe mais.');
  if (conta.healthStatus === 'banida') return falhar('ACCOUNT_UNAVAILABLE', `Conta @${conta.username} está banida.`);

  const midia = await media.findById(pub.contentId);
  if (!midia?.filename) return falhar('CONTENT_NOT_FOUND', 'O conteúdo desta publicação não existe mais.');

  const legendaFinal = resolveTemplate(pub.captionTemplate, {
    username: conta.username || '', name: conta.name || '', campaign: campanha.name || '',
    contentName: midia.originalName || midia.filename || '', now: pub.scheduledAt,
  }).text || pub.resolvedCaption || '';

  try {
    const video = /\.(mp4|mov|webm|avi|mkv)$/i.test(midia.filename);
    let postType = campanha.settings?.postType || 'reel';
    if (postType === 'reel' && !video) postType = 'post';

    // Um Post por publicação: a fila de postagens e o histórico por conta seguem valendo.
    const post = await posts.insert({
      usuarioId: campanha.usuarioId,
      media: midia.filename,
      mediaType: video ? 'video' : 'image',
      postType,
      cover: video ? await _arquivoDaCapa(campanha, pub.contentId, pub.accountId) : '',
      caption: legendaFinal,
      // `humanizador`: `limpeza_leve` é determinístico e daria o mesmo arquivo a todas as contas.
      processMode: campanha.settings?.processMode || 'humanizador',
      marcaDagua: campanha.settings?.marcaDagua?.ativa ? campanha.settings.marcaDagua : null,
      accountIds: [conta.id],
      status: 'processando',
      scheduledAt: pub.scheduledAt,
    });

    const { mediaId = '' } = await publicarNaConta(conta, post) || {};
    await posts.update(post.id, { status: 'concluido', error: '' });
    const publicada = await campaignPublications.update(pub.id, {
      status: 'published', publishedAt: new Date(), postId: post.id,
      instagramMediaId: String(mediaId), error: '', errorCode: '', resolvedCaption: legendaFinal,
    });

    registrarEvento('PUBLICATION_SUCCESS', {
      campaignId: campanha.id, publicationId: pub.id, accountId: conta.id, contentId: pub.contentId,
      attempt: tomada.attempts, durationMs: Date.now() - inicio, mediaId,
    });
    await agendarComentarioDe(publicada, campanha);
    await finalizarSeCompleta(campanha.id, await recalcularContadores(campanha.id));
    emitir(broadcast, 'publication_success', { campaignId: campanha.id, publicationId: pub.id }, campanha.usuarioId);
    return { ok: true, postId: post.id };
  } catch (err) {
    if (err.code === 'RHYTHM_WAIT' && err.retryAt) return adiar(err.message, err.retryAt);
    return falhar(classificarErro(err), err.message || 'Falha ao publicar');
  }
}

// ── Comentário ───────────────────────────────────────────────────────────────

async function agendarComentarioDe(pub, campanha) {
  if (campanha.commentMode === 'disabled') return null;
  if (!String(pub.resolvedComment || '').trim()) return null;
  const { jobId, criado } = await fila.agendarComentario(pub, _atrasoDoComentario(campanha.comments));
  await sql`
    update campaign_publications set comment_status = 'scheduled', comment_job_id = ${jobId}
    where id = ${pub.id} and comment_status in ('none', 'failed')`;
  return { jobId, criado };
}

/**
 * Publica o comentário na mídia que a PRÓPRIA publicação devolveu — nunca na
 * "mais recente da conta", que numa campanha raramente é a certa.
 * @param {Function} deps.comentarNaConta (conta, { mediaId, text }) => Promise
 */
async function processarComentario(publicationId, deps = {}) {
  const { comentarNaConta, broadcast } = deps;
  const inicio = Date.now();

  const pub = await campaignPublications.findById(publicationId);
  if (!pub) return { skipped: true, reason: 'PUBLICATION_NOT_FOUND' };
  if (pub.status !== 'published') return { skipped: true, reason: 'NOT_PUBLISHED' };
  if (pub.commentStatus === 'posted') return { skipped: true, reason: 'ALREADY_POSTED' };
  if (pub.commentStatus === 'cancelled') return { skipped: true, reason: 'CANCELLED' };

  const campanha = await campaigns.findById(pub.campaignId);
  if (!campanha) return { skipped: true, reason: 'CAMPAIGN_NOT_FOUND' };
  if (campanha.status === 'cancelled') {
    await campaignPublications.update(pub.id, { commentStatus: 'cancelled' });
    return { skipped: true, reason: 'CAMPAIGN_CANCELLED' };
  }

  // Falha de comentário NÃO reverte a publicação: o post já está no ar.
  const falharComentario = async (codigo, mensagem) => {
    await campaignPublications.update(pub.id, {
      commentStatus: 'failed', commentError: String(mensagem || '').slice(0, 500), commentErrorCode: codigo,
    });
    registrarEvento('COMMENT_FAILED', {
      campaignId: pub.campaignId, publicationId: pub.id, accountId: pub.accountId, mediaId: pub.instagramMediaId,
      durationMs: Date.now() - inicio, errorCode: codigo, error: mensagem,
    });
    emitir(broadcast, 'comment_failed', { campaignId: pub.campaignId, publicationId: pub.id, errorCode: codigo }, pub.usuarioId);
    return { ok: false, errorCode: codigo };
  };

  const conta = await accounts.findById(pub.accountId);
  if (!conta) return falharComentario('ACCOUNT_UNAVAILABLE', 'A conta desta publicação não existe mais.');

  const midia = await media.findById(pub.contentId);
  const texto = resolveTemplate(pub.commentTemplate, {
    username: conta.username || '', name: conta.name || '', campaign: campanha.name || '',
    contentName: midia?.originalName || midia?.filename || '', now: pub.scheduledAt,
  }).text.trim() || String(pub.resolvedComment || '').trim();
  if (!texto) return { skipped: true, reason: 'NO_COMMENT_TEXT' };

  const mediaId = String(pub.instagramMediaId || '');
  if (!mediaId) return falharComentario('COMMENT_MEDIA_NOT_FOUND', 'A publicação não registrou o id da mídia.');

  await sql`update campaign_publications set comment_attempts = comment_attempts + 1 where id = ${pub.id}`;
  try {
    if (typeof comentarNaConta !== 'function') throw new ExecutionError('COMMENT_NOT_SUPPORTED', 'Publicação de comentário não disponível.');
    const r = await comentarNaConta(conta, { mediaId, text: texto });
    await campaignPublications.update(pub.id, {
      commentStatus: 'posted', commentPostedAt: new Date(), commentError: '', commentErrorCode: '',
      commentId: String(r?.commentId || ''), resolvedComment: texto,
    });
    registrarEvento('COMMENT_POSTED', {
      campaignId: pub.campaignId, publicationId: pub.id, accountId: conta.id, mediaId, durationMs: Date.now() - inicio,
    });
    emitir(broadcast, 'comment_posted', { campaignId: pub.campaignId, publicationId: pub.id }, pub.usuarioId);
    return { ok: true, mediaId, commentId: String(r?.commentId || '') };
  } catch (err) {
    return falharComentario(classificarErroComentario(err), err.message || 'Falha ao comentar');
  }
}

// ── Pausa, retomada, cancelamento e retry ────────────────────────────────────

/** Tira da fila o que não começou. O que está em `processing` termina. */
async function pausarCampanha(campaignId) {
  const pendentes = await sql`select id from campaign_publications where campaign_id = ${campaignId} and status = any(${AGENDAVEIS})`;
  let removidos = 0;
  for (const p of pendentes) if (await fila.removerPublicacao(p.id)) removidos++;
  await sql`update campaign_publications set status = 'pending', queue_job_id = '' where campaign_id = ${campaignId} and status = 'scheduled'`;
  registrarEvento('CAMPAIGN_PAUSED', { campaignId });
  return { removidos, pendentes: pendentes.length };
}

async function retomarCampanha(campaignId, { agora = new Date() } = {}) {
  const r = await agendarCampanha(campaignId, { agora });
  registrarEvento('CAMPAIGN_RESUMED', { campaignId });
  return r;
}

async function cancelarCampanha(campaignId) {
  const alvos = await sql`
    select id, status, comment_status from campaign_publications
    where campaign_id = ${campaignId} and (status = any(${AGENDAVEIS}) or comment_status = 'scheduled')`;
  for (const p of alvos) {
    if (AGENDAVEIS.includes(p.status)) await fila.removerPublicacao(p.id);
    if (p.commentStatus === 'scheduled') await fila.removerComentario(p.id);
  }
  const r = await sql`
    update campaign_publications set status = 'cancelled', queue_job_id = ''
    where campaign_id = ${campaignId} and status = any(${AGENDAVEIS})`;
  await sql`
    update campaign_publications set comment_status = 'cancelled', comment_job_id = ''
    where campaign_id = ${campaignId} and comment_status = 'scheduled'`;
  const contadores = await recalcularContadores(campaignId);
  registrarEvento('CAMPAIGN_CANCELLED', { campaignId });
  return { canceladas: r.count, contadores };
}

/** Reprocessa UMA publicação, na mesma linha (o índice conta+conteúdo é único). */
async function reprocessarPublicacao(publicationId, { agora = new Date() } = {}) {
  const pub = await campaignPublications.findById(publicationId);
  if (!pub) throw new ExecutionError('PUBLICATION_NOT_FOUND', 'Publicação não encontrada.');
  if (pub.status === 'published') throw new ExecutionError('ALREADY_PUBLISHED', 'Esta publicação já foi publicada.');
  if (pub.status === 'processing') throw new ExecutionError('PUBLICATION_RUNNING', 'Esta publicação está em execução.');

  await campaignPublications.update(pub.id, { status: 'scheduled', error: '', errorCode: '' });
  const { jobId, delay } = await fila.reagendarPublicacao({ id: pub.id, campaignId: pub.campaignId, scheduledAt: agora }, agora);
  await campaignPublications.update(pub.id, { queueJobId: jobId });
  registrarEvento('PUBLICATION_RETRY', {
    campaignId: pub.campaignId, publicationId: pub.id, accountId: pub.accountId, contentId: pub.contentId, attempt: pub.attempts,
  });
  await recalcularContadores(pub.campaignId);
  return { jobId, delay };
}

/** Reprocessa UM comentário que falhou — o post já está no ar e não se republica. */
async function reprocessarComentario(publicationId) {
  const pub = await campaignPublications.findById(publicationId);
  if (!pub) throw new ExecutionError('PUBLICATION_NOT_FOUND', 'Publicação não encontrada.');
  if (pub.status !== 'published') throw new ExecutionError('NOT_PUBLISHED', 'Só é possível comentar em publicação que saiu.');
  if (pub.commentStatus === 'posted') throw new ExecutionError('ALREADY_POSTED', 'Este comentário já foi publicado.');
  if (!String(pub.instagramMediaId || '')) {
    throw new ExecutionError('COMMENT_MEDIA_NOT_FOUND', 'A publicação não registrou o id da mídia — não há onde comentar com segurança.');
  }

  await fila.removerComentario(pub.id);
  const { jobId } = await fila.agendarComentario(pub, 0);
  await campaignPublications.update(pub.id, { commentStatus: 'scheduled', commentJobId: jobId, commentError: '', commentErrorCode: '' });
  registrarEvento('COMMENT_RETRY', {
    campaignId: pub.campaignId, publicationId: pub.id, accountId: pub.accountId, mediaId: pub.instagramMediaId, attempt: pub.commentAttempts,
  });
  return { jobId };
}

module.exports = {
  ExecutionError, AGENDAVEIS, classificarErro, classificarErroComentario, registrarEvento,
  recalcularContadores, finalizarSeCompleta, agendarCampanha, processarPublicacao, agendarComentarioDe,
  processarComentario, pausarCampanha, retomarCampanha, cancelarCampanha, reprocessarPublicacao,
  reprocessarComentario, _atrasoDoComentario, _arquivoDaCapa,
};

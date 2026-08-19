'use strict';

/**
 * Enfileiramento das publicações de campanha.
 *
 * Reusa a fila `posts` que o Job Engine já usa — não existe segunda fila. O
 * worker distingue os tipos pelo payload, como já faz entre `jobId` (Postar/Loop)
 * e `postId` (legado).
 *
 * ── Idempotência ────────────────────────────────────────────────────────────
 *
 * O jobId é DETERMINÍSTICO, derivado do _id da CampaignPublication. É isso que
 * garante que dois cliques em "Publicar campanha" não gerem 32 jobs para 16
 * publicações: o BullMQ recusa um segundo job com jobId já existente e devolve
 * o que já estava lá.
 *
 * A alternativa — consultar antes e criar depois — tem janela de corrida entre
 * a consulta e a criação, exatamente o intervalo em que o duplo clique cai. Por
 * isso a garantia fica no Redis, não em código nosso.
 *
 * Consequência a conhecer: enquanto o job existir no Redis (inclusive já
 * concluído, se retido), o mesmo jobId não pode ser recriado. Reprocessar,
 * portanto, remove antes de adicionar — é o que `reagendarPublicacao` faz.
 */

const postQueue = require('../queue/postQueue');

/** Nomes dos jobs na fila — separados dos do Job Engine, que usa 'job_round'/'post'. */
const TIPO_PUBLICACAO = 'campaign_publication';
const TIPO_COMENTARIO = 'campaign_comment';

const idPublicacao = pubId => `campaign-publication:${pubId}`;
const idComentario = pubId => `campaign-comment:${pubId}`;

/**
 * Retenção dos jobs concluídos.
 *
 * Manter alguns permite inspecionar a fila depois de uma campanha grande sem
 * encher o Redis. Falhas ficam mais tempo porque são o que se investiga.
 */
const RETENCAO = {
  removeOnComplete: { count: 200 },
  removeOnFail:     { count: 500 },
};

/** Atraso em ms até `quando`, nunca negativo (horário passado = executa já). */
function calcularDelay(quando, agora = new Date()) {
  const alvo = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(alvo.getTime())) return 0;
  return Math.max(0, alvo.getTime() - agora.getTime());
}

/**
 * Enfileira uma publicação. Repetir a chamada não cria um segundo job.
 *
 * @returns {{ jobId: string, criado: boolean, delay: number }}
 *          criado=false significa que o job já existia — o chamador deve tratar
 *          isso como sucesso, não como erro.
 */
async function agendarPublicacao(pub, agora = new Date()) {
  const jobId = idPublicacao(pub._id);
  const delay = calcularDelay(pub.scheduledAt, agora);

  const existente = await postQueue.getJob(jobId);
  if (existente) return { jobId, criado: false, delay };

  await postQueue.add(
    TIPO_PUBLICACAO,
    { campaignPublicationId: String(pub._id), campaignId: String(pub.campaignId) },
    { jobId, delay, ...RETENCAO },
  );

  return { jobId, criado: true, delay };
}

/**
 * Enfileira o comentário de uma publicação já publicada.
 *
 * Existe como job separado justamente para o worker NÃO ficar dormindo à espera
 * do atraso: ele publica, agenda o comentário e libera o slot de concorrência.
 */
async function agendarComentario(pub, delayMinutos, agora = new Date()) {
  const jobId = idComentario(pub._id);

  const existente = await postQueue.getJob(jobId);
  if (existente) return { jobId, criado: false, delay: 0 };

  const delay = Math.max(0, Number(delayMinutos) || 0) * 60_000;

  await postQueue.add(
    TIPO_COMENTARIO,
    { campaignCommentId: String(pub._id), campaignId: String(pub.campaignId) },
    { jobId, delay, ...RETENCAO },
  );

  return { jobId, criado: true, delay };
}

/**
 * Remove um job da fila.
 *
 * Só remove o que ainda não rodou. Um job em execução não é interrompido no
 * meio — abortar uma publicação a meio caminho deixaria o post no Instagram sem
 * registro no banco, que é pior do que deixá-la terminar.
 */
async function removerJob(jobId) {
  try {
    const job = await postQueue.getJob(jobId);
    if (!job) return false;

    const estado = await job.getState();
    if (estado === 'active') return false;

    await job.remove();
    return true;
  } catch {
    // Fila indisponível não pode derrubar um cancelamento: o estado no Mongo já
    // impede a execução, o job órfão apenas encontrará a publicação cancelada.
    return false;
  }
}

const removerPublicacao = pubId => removerJob(idPublicacao(pubId));
const removerComentario = pubId => removerJob(idComentario(pubId));

/**
 * Reagenda uma publicação, descartando o job anterior.
 *
 * Usado pelo reprocessamento: como o jobId é determinístico, sem remover antes
 * o BullMQ devolveria o job velho (já concluído) e nada rodaria de novo.
 */
async function reagendarPublicacao(pub, agora = new Date()) {
  await removerPublicacao(pub._id);
  return agendarPublicacao(pub, agora);
}

module.exports = {
  TIPO_PUBLICACAO,
  TIPO_COMENTARIO,
  idPublicacao,
  idComentario,
  calcularDelay,
  agendarPublicacao,
  agendarComentario,
  reagendarPublicacao,
  removerJob,
  removerPublicacao,
  removerComentario,
};

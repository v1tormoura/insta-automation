'use strict';

/**
 * Enfileiramento das publicações de campanha, na mesma fila do resto.
 *
 * A chave do trabalho é DETERMINÍSTICA, derivada do id da publicação: dois
 * cliques em "Publicar campanha" não geram dois trabalhos para a mesma
 * publicação — a fila recusa a segunda chave igual.
 *
 * Reprocessar remove antes de enfileirar (`reagendarPublicacao`), para a chave
 * velha não segurar o trabalho novo.
 */

const fila = require('../queue');

const TIPO_PUBLICACAO = 'campanha_publicacao';
const TIPO_COMENTARIO = 'campanha_comentario';

const idPublicacao = pubId => `campaign-publication:${pubId}`;
const idComentario = pubId => `campaign-comment:${pubId}`;

/** Atraso em ms até `quando`, nunca negativo (horário passado = executa já). */
function calcularDelay(quando, agora = new Date()) {
  const alvo = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(alvo.getTime())) return 0;
  return Math.max(0, alvo.getTime() - agora.getTime());
}

/** @returns {Promise<{jobId: string, criado: boolean, delay: number}>} criado=false: já existia (não é erro). */
async function agendarPublicacao(pub, agora = new Date()) {
  const jobId = idPublicacao(pub.id);
  const delay = calcularDelay(pub.scheduledAt, agora);
  if (await fila.existe(jobId)) return { jobId, criado: false, delay };
  await fila.enfileirar(TIPO_PUBLICACAO, { campaignPublicationId: String(pub.id), campaignId: String(pub.campaignId) }, { atrasoMs: delay, chave: jobId });
  return { jobId, criado: true, delay };
}

/** O comentário é um trabalho à parte: o worker publica e libera a vaga, sem dormir esperando. */
async function agendarComentario(pub, delayMinutos) {
  const jobId = idComentario(pub.id);
  if (await fila.existe(jobId)) return { jobId, criado: false, delay: 0 };
  const delay = Math.max(0, Number(delayMinutos) || 0) * 60_000;
  await fila.enfileirar(TIPO_COMENTARIO, { campaignCommentId: String(pub.id), campaignId: String(pub.campaignId) }, { atrasoMs: delay, chave: jobId });
  return { jobId, criado: true, delay };
}

/** Tira da fila o que ainda não começou. O que está rodando termina. */
async function removerJob(jobId) {
  return (await fila.cancelar(jobId)) > 0;
}

const removerPublicacao = pubId => removerJob(idPublicacao(pubId));
const removerComentario = pubId => removerJob(idComentario(pubId));

async function reagendarPublicacao(pub, agora = new Date()) {
  await removerPublicacao(pub.id);
  return agendarPublicacao(pub, agora);
}

module.exports = {
  TIPO_PUBLICACAO, TIPO_COMENTARIO, idPublicacao, idComentario, calcularDelay,
  agendarPublicacao, agendarComentario, reagendarPublicacao, removerJob, removerPublicacao, removerComentario,
};

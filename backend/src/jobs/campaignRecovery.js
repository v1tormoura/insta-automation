'use strict';

/**
 * Recuperação das campanhas após restart.
 *
 * Cenário: o Redis reinicia sem persistência (ou o worker cai no meio de uma
 * publicação). O plano continua no Mongo, mas os jobs atrasados sumiram — sem
 * isto, uma campanha de 48 publicações pararia calada, com 30 itens eternamente
 * "agendados" e nenhum job para executá-los.
 *
 * Segue o mesmo desenho de `recoverStuckJobs` do worker: roda na subida e em
 * intervalo, procura registros cujo estado no banco não bate com a fila e
 * conserta. Nunca republica o que já saiu.
 */

const Campaign            = require('../models/Campaign');
const CampaignPublication = require('../models/CampaignPublication');
const fila                = require('../services/campaignQueue');
const { registrarEvento } = require('../services/campaignExecutor');

/** Status de campanha cujas publicações devem estar na fila. */
const CAMPANHAS_ATIVAS = ['scheduled', 'running'];

/**
 * Uma publicação em `processing` velha demais indica worker morto no meio da
 * execução — o job saiu da fila e ninguém vai terminá-la.
 *
 * O corte é generoso porque publicar um reel pode demorar: subir o vídeo, o
 * lock de conta espera até 5 min, e o backoff de rate limit chega a 5 min. Com
 * um corte curto, uma publicação lenta e saudável seria marcada como falha
 * enquanto ainda está publicando — e aí sim viraria post duplicado ao reprocessar.
 */
const CORTE_PROCESSING_MS = 30 * 60 * 1000;

/**
 * Devolve para 'failed' as publicações presas em `processing`.
 *
 * Não reenfileira automaticamente: se o worker morreu DEPOIS de o Instagram
 * aceitar o post, republicar criaria post duplicado. Marcar como falha deixa a
 * decisão com quem consegue verificar — o botão Reprocessar existe para isso.
 */
async function recuperarProcessando(agora = new Date()) {
  const corte = new Date(agora.getTime() - CORTE_PROCESSING_MS);

  const presas = await CampaignPublication
    .find({ status: 'processing', updatedAt: { $lt: corte } })
    .select('_id campaignId accountId contentId attempts')
    .lean();

  for (const p of presas) {
    await CampaignPublication.updateOne(
      { _id: p._id, status: 'processing' },
      {
        $set: {
          status:    'failed',
          errorCode: 'WORKER_RESTARTED',
          error:     'Processamento interrompido — worker reiniciado. Verifique no Instagram antes de reprocessar.',
        },
      },
    );
    registrarEvento('PUBLICATION_FAILED', {
      campaignId: p.campaignId, publicationId: p._id,
      accountId: p.accountId, contentId: p.contentId,
      attempt: p.attempts, errorCode: 'WORKER_RESTARTED',
    });
  }

  return presas.length;
}

/**
 * Reenfileira publicações agendadas que perderam o job.
 *
 * A checagem é feita job a job em vez de reagendar tudo: `agendarPublicacao` já
 * é idempotente pelo jobId, mas consultar antes evita escrever no Redis para as
 * dezenas que estão perfeitamente enfileiradas.
 */
async function recuperarAgendadas(agora = new Date(), { lote = 100 } = {}) {
  const ativas = await Campaign
    .find({ status: { $in: CAMPANHAS_ATIVAS } })
    .select('_id')
    .lean();
  if (!ativas.length) return { verificadas: 0, reenfileiradas: 0 };

  const ids = ativas.map(c => c._id);

  const pendentes = await CampaignPublication
    .find({ campaignId: { $in: ids }, status: { $in: ['pending', 'scheduled'] } })
    .select('_id campaignId scheduledAt accountId contentId')
    .sort({ scheduledAt: 1 })
    .limit(lote)
    .lean();

  let reenfileiradas = 0;

  for (const p of pendentes) {
    const { jobId, criado } = await fila.agendarPublicacao(p, agora);
    if (!criado) continue;                     // já estava na fila — nada a fazer

    reenfileiradas++;
    await CampaignPublication.updateOne(
      { _id: p._id, status: { $in: ['pending', 'scheduled'] } },
      { $set: { status: 'scheduled', bullMqJobId: jobId } },
    );
    registrarEvento('PUBLICATION_SCHEDULED', {
      campaignId: p.campaignId, publicationId: p._id,
      accountId: p.accountId, contentId: p.contentId, errorCode: 'RECOVERED',
    });
  }

  return { verificadas: pendentes.length, reenfileiradas };
}

/**
 * Reenfileira comentários agendados que perderam o job.
 *
 * Só entram publicações já publicadas — comentar exige o post no ar.
 */
async function recuperarComentarios(agora = new Date(), { lote = 100 } = {}) {
  const pendentes = await CampaignPublication
    .find({ commentStatus: 'scheduled', status: 'published' })
    .select('_id campaignId')
    .limit(lote)
    .lean();

  let reenfileirados = 0;

  for (const p of pendentes) {
    // Atraso zero: o horário original já passou enquanto o serviço estava fora.
    const { jobId, criado } = await fila.agendarComentario(p, 0, agora);
    if (!criado) continue;

    reenfileirados++;
    await CampaignPublication.updateOne({ _id: p._id }, { $set: { commentJobId: jobId } });
  }

  return { verificados: pendentes.length, reenfileirados };
}

/** Executa as três recuperações. Falha em uma não impede as outras. */
async function recuperarCampanhas(agora = new Date()) {
  const resultado = { processando: 0, agendadas: null, comentarios: null };

  try { resultado.processando = await recuperarProcessando(agora); }
  catch (e) { console.error('[Campaign] recuperarProcessando:', e.message); }

  try { resultado.agendadas = await recuperarAgendadas(agora); }
  catch (e) { console.error('[Campaign] recuperarAgendadas:', e.message); }

  try { resultado.comentarios = await recuperarComentarios(agora); }
  catch (e) { console.error('[Campaign] recuperarComentarios:', e.message); }

  const total = (resultado.agendadas?.reenfileiradas || 0)
              + (resultado.comentarios?.reenfileirados || 0)
              + resultado.processando;
  if (total > 0) {
    console.log(
      `♻️  [Campaign] recuperação: ${resultado.agendadas?.reenfileiradas || 0} publicação(ões) reenfileirada(s), ` +
      `${resultado.comentarios?.reenfileirados || 0} comentário(s), ` +
      `${resultado.processando} presa(s) em processing marcada(s) como falha`,
    );
  }

  return resultado;
}

module.exports = {
  CORTE_PROCESSING_MS,
  recuperarProcessando,
  recuperarAgendadas,
  recuperarComentarios,
  recuperarCampanhas,
};

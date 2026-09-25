'use strict';

/**
 * Recuperação das campanhas (na subida e a cada 5 min).
 *
 *  - Publicação presa em `processing` há mais de 30 min vira falha
 *    (WORKER_RESTARTED) e NÃO é republicada sozinha: se o processo morreu
 *    depois de a Meta aceitar o post, republicar duplicaria. O botão
 *    Reprocessar fica com quem pode conferir no Instagram.
 *  - Publicação ou comentário agendado sem trabalho na fila volta para ela.
 */

const { sql } = require('../db');
const fila = require('../services/campaignQueue');
const { registrarEvento } = require('../services/campaignExecutor');

const CORTE_PROCESSING_MS = 30 * 60 * 1000;

async function recuperarProcessando(agora = new Date()) {
  const corte = new Date(agora.getTime() - CORTE_PROCESSING_MS);
  const presas = await sql`
    update campaign_publications set status = 'failed', error_code = 'WORKER_RESTARTED',
      error = 'Processamento interrompido — servidor reiniciado. Verifique no Instagram antes de reprocessar.'
    where status = 'processing' and updated_at < ${corte}
      -- ainda rodando na fila (vídeo longo, conta ocupada): não é órfã
      and not exists (select 1 from queue_jobs q
                      where q.key = 'campaign-publication:' || campaign_publications.id and q.status = 'running')
    returning id, campaign_id, account_id, content_id, attempts`;
  for (const p of presas) {
    registrarEvento('PUBLICATION_FAILED', {
      campaignId: p.campaignId, publicationId: p.id, accountId: p.accountId, contentId: p.contentId,
      attempt: p.attempts, errorCode: 'WORKER_RESTARTED',
    });
  }
  return presas.length;
}

async function recuperarAgendadas(agora = new Date()) {
  const pendentes = await sql`
    select p.* from campaign_publications p
    join campaigns c on c.id = p.campaign_id
    where c.status in ('scheduled', 'running') and p.status in ('pending', 'scheduled')
    order by p.scheduled_at limit 100`;
  let reenfileiradas = 0;
  for (const p of pendentes) {
    const { jobId, criado } = await fila.agendarPublicacao(p, agora);
    if (!criado) continue;
    reenfileiradas++;
    await sql`update campaign_publications set status = 'scheduled', queue_job_id = ${jobId}
              where id = ${p.id} and status in ('pending', 'scheduled')`;
    registrarEvento('PUBLICATION_SCHEDULED', {
      campaignId: p.campaignId, publicationId: p.id, accountId: p.accountId, contentId: p.contentId, errorCode: 'RECOVERED',
    });
  }
  return { verificadas: pendentes.length, reenfileiradas };
}

async function recuperarComentarios() {
  const pendentes = await sql`
    select id, campaign_id from campaign_publications
    where comment_status = 'scheduled' and status = 'published' limit 100`;
  let reenfileirados = 0;
  for (const p of pendentes) {
    const { jobId, criado } = await fila.agendarComentario(p, 0);
    if (!criado) continue;
    reenfileirados++;
    await sql`update campaign_publications set comment_job_id = ${jobId} where id = ${p.id}`;
  }
  return { verificados: pendentes.length, reenfileirados };
}

/** As três recuperações; falha numa não impede as outras. */
async function recuperarCampanhas(agora = new Date()) {
  const r = { processando: 0, agendadas: null, comentarios: null };
  try { r.processando = await recuperarProcessando(agora); } catch (e) { console.error('[Campaign] recuperarProcessando:', e.message); }
  try { r.agendadas = await recuperarAgendadas(agora); } catch (e) { console.error('[Campaign] recuperarAgendadas:', e.message); }
  try { r.comentarios = await recuperarComentarios(agora); } catch (e) { console.error('[Campaign] recuperarComentarios:', e.message); }
  const total = (r.agendadas?.reenfileiradas || 0) + (r.comentarios?.reenfileirados || 0) + r.processando;
  if (total) {
    console.log(`♻️  [Campaign] recuperação: ${r.agendadas?.reenfileiradas || 0} publicação(ões), `
      + `${r.comentarios?.reenfileirados || 0} comentário(s), ${r.processando} presa(s) marcada(s) como falha`);
  }
  return r;
}

module.exports = { CORTE_PROCESSING_MS, recuperarProcessando, recuperarAgendadas, recuperarComentarios, recuperarCampanhas };

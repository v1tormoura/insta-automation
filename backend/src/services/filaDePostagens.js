'use strict';

/**
 * A fila de postagens — filtros, paginação e a linha que a tela mostra.
 *
 * Filtro desconhecido é IGNORADO em vez de virar consulta vazia: 'todos' e
 * 'bagunça' têm o mesmo efeito, que é não filtrar. Mandar o valor cru ao banco
 * devolveria zero linhas e pareceria "a fila está vazia".
 */

const { ehUuid } = require('../db');

/* Os status que o worker e os controllers gravam em posts.status. */
const STATUS = ['pendente', 'processando', 'concluido', 'parcial', 'erro', 'cancelado'];
const FORMATOS = ['reel', 'post', 'story'];

/* `parcial` NÃO entra: saiu em algumas contas, e apagá-lo perderia esse registro. */
const LIMPAVEIS = ['erro', 'cancelado'];

const LIMITE_PADRAO = 10;
const LIMITE_MAX = 100;

/** Filtros da tela → { status?, postType?, jobId? } só com valores válidos. */
function montarConsulta({ status, formato, job } = {}) {
  const q = {};
  if (STATUS.includes(status)) q.status = status;
  if (FORMATOS.includes(formato)) q.postType = formato;
  if (ehUuid(job)) q.jobId = job;
  return q;
}

/** Os filtros como condição SQL. */
function ondeSql(sql, filtros) {
  const partes = [];
  if (filtros.status) partes.push(sql`status = ${filtros.status}`);
  if (filtros.postType) partes.push(sql`post_type = ${filtros.postType}`);
  if (filtros.jobId) partes.push(sql`job_id = ${filtros.jobId}`);
  return partes.length ? partes.reduce((a, b) => sql`${a} and ${b}`) : sql`true`;
}

/** Página e limite dentro de faixas utilizáveis; não positivo conta como ausente. */
function montarPaginacao({ page, limit } = {}) {
  const utilizavel = valor => {
    const n = Math.floor(Number(valor));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const pagina = utilizavel(page) ?? 1;
  const porPagina = Math.min(LIMITE_MAX, utilizavel(limit) ?? LIMITE_PADRAO);
  return { pagina, porPagina, pular: (pagina - 1) * porPagina };
}

async function _insightsPorMidia(ids) {
  const { sql } = require('../db');
  return sql`select ig_media_id, video_views, reach from insights where ig_media_id = any(${ids})`;
}

/**
 * Views de cada publicação pelo id da mídia, numa consulta para o lote.
 * Sem métrica, a mídia fica fora do mapa e a tela mostra um traço — 0 seria
 * afirmar que não teve nenhuma.
 */
async function viewsPorMidia(posts, buscar = _insightsPorMidia) {
  const ids = [...new Set((posts || []).map(p => String(p?.igMediaId || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const rows = await buscar(ids);
    return new Map(rows.map(r => [
      String(r.igMediaId),
      // Reel recém-publicado costuma ter alcance antes de contabilizar reprodução.
      Number(r.videoViews) > 0 ? Number(r.videoViews) : Number(r.reach) || 0,
    ]));
  } catch (err) {
    console.log(`⚠️ [Fila] não deu para buscar views: ${err.message}`);
    return new Map();
  }
}

/** Uma linha da fila, como a tela precisa dela. */
function montarLinha(post, views) {
  const contas = (post.accounts || [])
    .filter(a => a && typeof a === 'object')
    .map(a => ({ id: String(a.id), username: a.username || '', avatar: a.avatar || '' }));
  const idDaMidia = String(post.igMediaId || '').trim();

  return {
    id: String(post.id),
    quando: post.scheduledAt || post.createdAt || null,
    envio: post.jobName || '',
    envioId: post.jobId ? String(post.jobId) : null,
    contas,
    formato: post.postType || 'reel',
    status: post.status || 'pendente',
    erro: post.error || '',
    views: idDaMidia && views.has(idDaMidia) ? views.get(idDaMidia) : null,
    midiaId: idDaMidia || null,
  };
}

module.exports = {
  montarConsulta, ondeSql, montarPaginacao, viewsPorMidia, montarLinha,
  STATUS, FORMATOS, LIMPAVEIS, LIMITE_PADRAO, LIMITE_MAX,
};

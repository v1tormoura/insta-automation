'use strict';

/**
 * Serialização das respostas da Campaign API.
 *
 * Lista de PERMISSÃO: só sai o que está listado aqui. A conta carrega o token
 * da API, e um campo sensível novo não pode vazar por esquecimento.
 */

const { sql } = require('../db');

function contaSegura(c) {
  if (!c) return null;
  return {
    id: c.id,
    username: c.username,
    name: c.name || '',
    avatar: c.avatar || '',
    healthStatus: c.healthStatus || 'ativa',
    postsToday: c.postsToday ?? 0,
  };
}

function conteudoSeguro(m) {
  if (!m) return null;
  return {
    id: m.id,
    filename: m.filename,
    originalName: m.originalName || m.filename,
    url: m.url || '',
    type: m.type || 'other',
    folder: m.folder || '',
  };
}

function campanhaSegura(campanha) {
  return campanha ? { ...campanha } : null;
}

/** Publicação com o necessário para a tela. `conta`/`conteudo` vêm de `comDetalhes`. */
function publicacaoSegura(p) {
  if (!p) return null;
  return {
    id: p.id,
    campaignId: p.campaignId,
    order: p.order,
    scheduledAt: p.scheduledAt,
    status: p.status,
    attempts: p.attempts ?? 0,
    error: p.error || '',
    errorCode: p.errorCode || '',
    publishedAt: p.publishedAt || null,
    // A tela só precisa saber que o comentário tem alvo definido.
    hasMediaLink: !!p.instagramMediaId,
    commentStatus: p.commentStatus || 'none',
    commentPostedAt: p.commentPostedAt || null,
    commentError: p.commentError || '',
    commentErrorCode: p.commentErrorCode || '',
    commentAttempts: p.commentAttempts ?? 0,
    postId: p.postId || null,
    captionTemplate: p.captionTemplate || '',
    commentTemplate: p.commentTemplate || '',
    resolvedCaption: p.resolvedCaption || '',
    resolvedComment: p.resolvedComment || '',
    // Conta/conteúdo apagados depois do planejamento aparecem como null.
    account: p.conta !== undefined ? contaSegura(p.conta) : p.accountId,
    content: p.conteudo !== undefined ? conteudoSeguro(p.conteudo) : p.contentId,
  };
}

/** Anexa conta e conteúdo a cada publicação, com uma consulta por tabela. */
async function comDetalhes(pubs) {
  const contaIds = [...new Set(pubs.map(p => p.accountId))];
  const midiaIds = [...new Set(pubs.map(p => p.contentId))];
  const [contas, midias] = await Promise.all([
    contaIds.length ? sql`select id, username, name, avatar, health_status, posts_today from accounts where id = any(${contaIds}::uuid[])` : [],
    midiaIds.length ? sql`select id, filename, original_name, url, type, folder from media where id = any(${midiaIds}::uuid[])` : [],
  ]);
  const porConta = new Map(contas.map(c => [c.id, c]));
  const porMidia = new Map(midias.map(m => [m.id, m]));
  return pubs.map(p => ({ ...p, conta: porConta.get(p.accountId) || null, conteudo: porMidia.get(p.contentId) || null }));
}

module.exports = { contaSegura, conteudoSeguro, campanhaSegura, publicacaoSegura, comDetalhes };

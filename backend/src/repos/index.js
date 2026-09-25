'use strict';

/**
 * Repositórios. As tabelas sem regra própria usam o CRUD genérico de db/;
 * contas têm módulo próprio (token cifrado, trava de publicação, aviso de saúde).
 */

const { sql, tabela } = require('../db');
const accounts = require('./accounts');

/** Campos de conta que as listas do painel mostram junto de envios e publicações. */
const RESUMO_DA_CONTA = ['id', 'username', 'name', 'avatar', 'healthStatus', 'accountType', 'followers', 'following', 'postsCount'];

/**
 * Anexa `accounts` (resumo de cada conta) a linhas que guardam `accountIds`.
 * Uma consulta para o lote inteiro; conta apagada simplesmente não aparece.
 */
async function comContas(rows, campos = RESUMO_DA_CONTA) {
  const lista = Array.isArray(rows) ? rows : [rows];
  const ids = lista.flatMap(r => r?.accountIds || []);
  const contas = await accounts.porIds(ids);
  const porId = new Map(contas.map(c => {
    const resumo = {};
    for (const k of campos) resumo[k] = c[k];
    resumo.hasApiToken = !!(c.accessToken && c.igUserId);
    return [c.id, resumo];
  }));
  for (const r of lista) {
    if (r) r.accounts = (r.accountIds || []).map(id => porId.get(id)).filter(Boolean);
  }
  return rows;
}

module.exports = {
  sql,
  accounts,
  comContas,
  campaignEvents: tabela('campaign_events'),
  campaignPublications: tabela('campaign_publications'),
  campaigns: tabela('campaigns'),
  convites: tabela('convites_de_acesso'),
  insights: tabela('insights'),
  jobs: tabela('jobs'),
  legends: tabela('legends'),
  media: tabela('media'),
  milestones: tabela('milestones'),
  notificacoes: tabela('notificacoes'),
  posts: tabela('posts'),
  pushSubscriptions: tabela('push_subscriptions'),
  seguidoresDoDia: tabela('seguidores_do_dia'),
  trilhas: tabela('trilhas'),
};

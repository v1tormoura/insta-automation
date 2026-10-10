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
  return anexarContas(rows, await accounts.porIds(lista.flatMap(r => r?.accountIds || [])), campos);
}

/**
 * O mesmo que `comContas`, com as contas já lidas — as rotas mais usadas
 * buscam as contas do usuário junto das outras consultas (`accounts.de(uid).findMany()`
 * no mesmo Promise.all) e economizam uma ida ao banco, que longe da VPS é o
 * que mais pesa no tempo da tela.
 */
function anexarContas(rows, contas, campos = RESUMO_DA_CONTA) {
  const lista = Array.isArray(rows) ? rows : [rows];
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
  anexarContas,
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
};

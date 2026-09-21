'use strict';

/**
 * Aviso quando a saúde de uma conta PIORA — em um lugar só.
 *
 * ── O problema
 *
 * A conta vira `restrita` (verificação pedida pelo Instagram), `banida`,
 * `sessao_expirada` ou `token_invalido` em SEIS pontos diferentes do código:
 * QuickCheck, sync da API, sync do instagrapi, keep-alive de sessão, a rota
 * de suspensão e a falha na hora de publicar. Só o último avisava. A pessoa
 * via a conta "restrita" no painel horas depois, sem ter recebido nada na
 * hora — e o que chegava depois, todo junto, eram os marcos da sincronização.
 *
 * ── Como funciona
 *
 * `Account.js` chama `avisarTransicao` num gancho de escrita: sempre que um
 * update ou save muda `healthStatus` para um estado ruim, vindo de um estado
 * diferente, sai UM aviso (`contaCaiu`) com o motivo legível. Piorar de um
 * estado ruim para outro também avisa (restrita → banida é notícia); repetir
 * o mesmo estado não. O anti-repetição de 6h por conta fica no notificador.
 *
 * Funções puras aqui, para os testes provarem a regra sem banco.
 */

const ESTADOS_RUINS = Object.freeze({
  restrita:        'o Instagram pediu verificação ou restringiu a atividade',
  banida:          'conta suspensa ou desativada pelo Instagram',
  sessao_expirada: 'a sessão expirou — precisa entrar de novo',
  token_invalido:  'o token da API ficou inválido — reconecte a conta',
  erro_login:      'não conseguiu entrar na conta',
});

/** É um estado que merece aviso? */
function ehRuim(status) {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(ESTADOS_RUINS, status);
}

/** Houve transição para (ou entre) estado ruim? */
function mudouParaRuim(de, para) {
  return ehRuim(para) && de !== para;
}

/** "o Instagram pediu verificação (challenge_required)" — o estado, e o detalhe se houver. */
function motivo(status, lastError) {
  const base = ESTADOS_RUINS[status] || `estado ${status || 'desconhecido'}`;
  const detalhe = String(lastError || '').trim().replace(/\s+/g, ' ');
  if (!detalhe || detalhe.toLowerCase() === base.toLowerCase()) return base;
  return `${base} (${detalhe.slice(0, 160)})`;
}

/**
 * O `healthStatus` que um update vai gravar, esteja ele solto ou dentro de
 * `$set` — o Mongoose aceita os dois e converte para `$set` só na hora.
 */
function novoStatusDoUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const solto = update.healthStatus;
  const emSet = update.$set && update.$set.healthStatus;
  const v = solto !== undefined ? solto : emSet;
  return typeof v === 'string' ? v : null;
}

/** Idem para `lastError`, que vira o detalhe do motivo. */
function lastErrorDoUpdate(update) {
  if (!update || typeof update !== 'object') return '';
  const v = update.lastError !== undefined ? update.lastError : update.$set && update.$set.lastError;
  return typeof v === 'string' ? v : '';
}

/**
 * Avisa se — e só se — houve transição para estado ruim.
 *
 * @param {object} p
 * @param {object} p.conta       { _id, username, avatar }
 * @param {string} p.de          estado anterior
 * @param {string} p.para        estado novo
 * @param {string} [p.lastError] detalhe
 * @param {Function} [p.notificar] injeção para testes; padrão: notificarContaCaiu
 * @returns {Promise<object|null>} a notificação criada, ou null
 */
async function avisarTransicao({ conta, de, para, lastError, notificar } = {}) {
  if (!conta || !mudouParaRuim(de, para)) return null;
  const fn = notificar || require('./smartActivity/eventosDePublicacao').notificarContaCaiu;
  return fn({ conta, motivo: motivo(para, lastError) });
}

module.exports = {
  ESTADOS_RUINS, ehRuim, mudouParaRuim, motivo, novoStatusDoUpdate, lastErrorDoUpdate, avisarTransicao,
};

'use strict';

/**
 * Aviso quando a saúde de uma conta muda — em um lugar só.
 *
 * O repositório de contas (repos/accounts.js) chama `avisarTransicao` sempre
 * que uma escrita muda `healthStatus`: indo para um estado ruim sai UM aviso
 * (`contaCaiu`) com o motivo legível; voltando a `ativa` sai o aviso de
 * recuperação. Piorar de um estado ruim para outro também avisa (restrita →
 * banida é notícia); repetir o mesmo estado não. O anti-repetição de 6h por
 * conta fica no notificador.
 *
 * Funções puras aqui, para os testes provarem a regra sem banco.
 */

const ESTADOS_RUINS = Object.freeze({
  restrita:        'o Instagram pediu verificação ou restringiu a atividade',
  banida:          'conta suspensa ou desativada pelo Instagram',
  token_invalido:  'o token da API ficou inválido — reconecte a conta',
});

/** Como cada estado ruim é chamado na frase de recuperação ("saiu de …"). */
const ROTULO_CURTO = Object.freeze({
  restrita: 'verificação/restrição', banida: 'suspensão', token_invalido: 'token inválido',
});

/** É um estado que merece aviso? */
function ehRuim(status) {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(ESTADOS_RUINS, status);
}

/** Houve transição para (ou entre) estado ruim? */
function mudouParaRuim(de, para) {
  return ehRuim(para) && de !== para;
}

/**
 * "o Instagram pediu verificação (challenge_required)" — o estado, e o
 * detalhe se houver. Um `lastError` longo já é uma frase escrita para gente
 * (o sync grava a instrução completa no caso da verificação); aí ele vale
 * sozinho, sem o estado na frente repetindo a mesma coisa.
 */
const DETALHE_JA_E_FRASE = 60;

function motivo(status, lastError) {
  const base = ESTADOS_RUINS[status] || `estado ${status || 'desconhecido'}`;
  const detalhe = String(lastError || '').trim().replace(/\s+/g, ' ');
  if (!detalhe || detalhe.toLowerCase() === base.toLowerCase()) return base;
  if (detalhe.length >= DETALHE_JA_E_FRASE) return detalhe.slice(0, 220);
  return `${base} (${detalhe.slice(0, 160)})`;
}

/** Saiu de um estado ruim e voltou a `ativa`? */
function recuperou(de, para) {
  return para === 'ativa' && ehRuim(de);
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
async function avisarTransicao({ conta, de, para, lastError, notificar, notificarVolta } = {}) {
  if (!conta) return null;
  if (mudouParaRuim(de, para)) {
    const fn = notificar || require('./smartActivity/eventosDePublicacao').notificarContaCaiu;
    return fn({ conta, motivo: motivo(para, lastError) });
  }
  /* A volta também é notícia — é o que fecha o ciclo "conta caiu": sem
     isto a pessoa fica olhando o painel para saber se a verificação pegou. */
  if (recuperou(de, para)) {
    const fn = notificarVolta || require('./smartActivity/eventosDePublicacao').notificarContaVoltou;
    return fn({ conta, motivo: `saiu de ${ROTULO_CURTO[de] || de} e voltou a publicar normalmente` });
  }
  return null;
}

module.exports = {
  ESTADOS_RUINS, ehRuim, mudouParaRuim, recuperou, motivo, avisarTransicao,
};

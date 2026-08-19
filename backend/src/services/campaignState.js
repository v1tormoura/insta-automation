'use strict';

/**
 * Máquina de estados da campanha.
 *
 * Centralizada aqui para que controller, execução e retry usem a MESMA tabela.
 * Espalhar `if (status === ...)` pelos handlers foi o que permitiu, no Job
 * Engine, que uma rodada continuasse depois de um cancel — aqui a transição é
 * verificada num lugar só.
 */

class CampaignStateError extends Error {
  constructor(de, para) {
    super(`Transição inválida: campanha em "${de}" não pode ir para "${para}".`);
    this.name   = 'CampaignStateError';
    this.code   = 'INVALID_CAMPAIGN_STATE';
    this.from   = de;
    this.to     = para;
  }
}

/** Estados finais — nenhuma transição sai daqui, exceto via retry-failed. */
const TERMINAIS = new Set(['completed', 'cancelled']);

const TRANSICOES = {
  draft:     ['planning', 'scheduled', 'cancelled'],
  planning:  ['scheduled', 'failed', 'cancelled'],
  scheduled: ['running', 'paused', 'cancelled'],
  running:   ['paused', 'completed', 'partial', 'failed', 'cancelled'],
  paused:    ['scheduled', 'running', 'cancelled'],
  // partial e failed aceitam voltar para scheduled: é o que retry-failed faz.
  partial:   ['scheduled', 'running', 'cancelled'],
  failed:    ['scheduled', 'cancelled'],
  completed: [],
  cancelled: [],
};

function podeTransicionar(de, para) {
  return (TRANSICOES[de] || []).includes(para);
}

/** Lança CampaignStateError se a transição não for permitida. */
function garantirTransicao(de, para) {
  if (de === para) return;                       // idempotente
  if (!podeTransicionar(de, para)) throw new CampaignStateError(de, para);
}

function ehTerminal(status) {
  return TERMINAIS.has(status);
}

module.exports = {
  TRANSICOES,
  CampaignStateError,
  podeTransicionar,
  garantirTransicao,
  ehTerminal,
};

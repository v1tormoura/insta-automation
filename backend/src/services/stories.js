'use strict';

/**
 * Stories em massa (tela de Stories): uma ou mais mídias em várias contas.
 *
 * Como a tela descreve — "N stories em M contas, um a cada X min": cada mídia
 * sai em todas as contas escolhidas, e o intervalo separa uma mídia da próxima
 * (±10%). Cada mídia é um trabalho na fila, então o lote continua se o
 * servidor reiniciar no meio. As contas saem em ordem sorteada, com alguns
 * segundos entre uma e outra.
 *
 * Só o que a API oficial publica: imagem ou vídeo, com o texto da tela
 * queimado na mídia. Figurinha de link não existe na API de conteúdo.
 */

const crypto = require('crypto');
const { accounts } = require('../repos');
const fila = require('../queue');
const { broadcast } = require('../events/broadcaster');
const { criarRandom, embaralhar } = require('./publicationPlanner');

const esperar = ms => new Promise(r => setTimeout(r, ms));
const ENTRE_CONTAS_MS = () => 5_000 + Math.floor(Math.random() * 15_000);

let _lote = { id: null, running: false, total: 0, completed: 0, errors: 0, results: [], startedAt: null };

function status() {
  return _lote;
}

async function publicarNaConta(conta, media, textoLivre) {
  const { publicarNaConta: publicar } = require('../worker');
  return publicar(conta, { postType: 'story', media, textoLivre }, { respeitarRitmo: false });
}

/** Uma conta e uma mídia: publica na hora e devolve o resultado. */
async function publicarAgora(accountId, media, textoLivre) {
  const conta = await accounts.findById(accountId);
  if (!conta) throw Object.assign(new Error('Conta não encontrada'), { status: 404 });
  await publicarNaConta(conta, media, textoLivre);
  broadcast('posts', { action: 'created' });
  return { accountId: conta.id, username: conta.username, status: 'success', method: 'graph' };
}

/** Enfileira o lote (um trabalho por mídia) e devolve na hora. */
async function iniciarLote(accountIds, midias, textoLivre, intervalMinutes) {
  const id = crypto.randomUUID();
  const intervaloMs = Math.max(0, Number(intervalMinutes) || 0) * 60_000;
  const total = midias.length * accountIds.length;

  _lote = { id, running: true, total, completed: 0, errors: 0, results: [], startedAt: new Date() };
  broadcast('stories', { action: 'started', total });

  let atraso = 0;
  for (const [i, media] of midias.entries()) {
    if (i > 0) atraso += Math.round(intervaloMs * (0.9 + Math.random() * 0.2));
    // Ordem sorteada por mídia: a mesma sequência de contas todo dia seria um padrão.
    const ordem = embaralhar(accountIds, criarRandom(`stories:${id}:${i}`));
    await fila.enfileirar('story', { lote: id, accountIds: ordem, media, textoLivre }, { atrasoMs: atraso });
  }
  return { id, total };
}

/** Handler da fila: publica uma mídia do lote em cada conta. */
async function processar({ lote, accountIds = [], media, textoLivre }) {
  const doLote = _lote.id === lote;
  const registrar = r => {
    if (!doLote) return;
    _lote.results.push(r);
    if (r.status === 'success') _lote.completed++; else _lote.errors++;
    if (r.status === 'success') {
      broadcast('stories', { action: 'progress', completed: _lote.completed, total: _lote.total, username: r.username });
    } else {
      broadcast('stories', { action: 'error', username: r.username, error: r.error });
    }
    if (_lote.completed + _lote.errors >= _lote.total) {
      _lote.running = false;
      broadcast('stories', { action: 'completed', results: _lote.results });
      broadcast('posts', { action: 'created' });
    }
  };

  for (const [i, accountId] of accountIds.entries()) {
    if (i > 0) await esperar(ENTRE_CONTAS_MS());
    const conta = await accounts.findById(accountId);
    if (!conta) { registrar({ accountId, status: 'error', error: 'Conta não encontrada' }); continue; }
    try {
      await publicarNaConta(conta, media, textoLivre);
      registrar({ accountId, username: conta.username, status: 'success', method: 'graph' });
    } catch (err) {
      console.error(`❌ [Story] @${conta.username}: ${err.message}`);
      registrar({ accountId, username: conta.username, status: 'error', error: err.message });
    }
  }
}

module.exports = { status, publicarAgora, iniciarLote, processar };

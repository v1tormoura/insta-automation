'use strict';

/**
 * Quantas publicações estão na fila.
 *
 * Duas origens: publicação avulsa (posts sem envio) e envio (jobs — Postar e
 * Loop). A unidade é PUBLICAÇÃO: cada mídia de um envio vale uma publicação
 * por conta.
 */

/** Soma a fila das duas origens. Origem que falhou (null) conta como zero. */
function somarFilas(posts, jobs) {
  const p = posts || {}, j = jobs || {};
  const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    agendados:   n(p.agendados),
    processando: n(p.processando) + n(j.rodando),
    pendentes:   n(p.pendentes)   + n(j.enfileirados),
  };
}

/**
 * Publicações de um envio saindo AGORA e as que ainda esperam.
 * `currentRound` é o índice da próxima rodada; cada rodada leva
 * `simultaneousLimit` mídias, e cada mídia sai em todas as contas do envio.
 */
function midiasDoJob(job) {
  if (!job) return { processando: 0, naFila: 0 };
  const total  = Array.isArray(job.mediaFiles) ? job.mediaFiles.length : 0;
  const limite = Math.max(1, Number(job.simultaneousLimit) || 1);
  const rodada = Math.max(0, Number(job.currentRound) || 0);
  const inicio = Math.min(total, rodada * limite);
  const ids    = job.accountIds || job.accounts;
  const contas = Math.max(1, Array.isArray(ids) ? ids.length : 1);
  const porConta = n => Math.max(0, n) * contas;

  if (job.status === 'running') {
    const nestaRodada = Math.min(limite, total - inicio);
    return { processando: porConta(nestaRodada), naFila: porConta(total - inicio - nestaRodada) };
  }
  if (job.status === 'waiting_interval' || job.status === 'queued') {
    return { processando: 0, naFila: porConta(total - inicio) };
  }
  return { processando: 0, naFila: 0 };
}

function contarJobs(jobs) {
  const soma = { rodando: 0, enfileirados: 0 };
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const m = midiasDoJob(j);
    soma.rodando      += m.processando;
    soma.enfileirados += m.naFila;
  }
  return soma;
}

module.exports = { somarFilas, midiasDoJob, contarJobs };

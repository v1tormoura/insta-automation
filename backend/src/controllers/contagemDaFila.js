'use strict';

/**
 * Quantas publicações estão na fila.
 *
 * Três origens: publicação avulsa (posts sem envio), envio (jobs — Postar e
 * Loop) e campanha (campaign_publications). A fila do painel precisa somar as
 * três, ou contradiz a tela de Campanhas logo ao lado. A unidade é PUBLICAÇÃO:
 * cada mídia de um envio vale uma publicação por conta.
 */

/** Soma a fila das três origens. Origem que falhou (null) conta como zero. */
function somarFilas(posts, jobs, campanhas) {
  const p = posts || {}, j = jobs || {}, c = campanhas || {};
  const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    agendados:   n(p.agendados)   + n(c.scheduled),
    processando: n(p.processando) + n(j.rodando)      + n(c.processing),
    pendentes:   n(p.pendentes)   + n(j.enfileirados) + n(c.pending),
  };
}

/** `[{status, n}]` → `{status: n}`. */
function porStatus(linhas) {
  return Object.fromEntries(
    (Array.isArray(linhas) ? linhas : [])
      .filter(r => r && r.status)
      .map(r => [r.status, Number(r.n) || 0])
  );
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

module.exports = { somarFilas, porStatus, midiasDoJob, contarJobs };

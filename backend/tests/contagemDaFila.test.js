'use strict';

/**
 * A fila do painel: publicações avulsas + envios (Postar e Loop).
 *
 * A soma morava no meio de um `Promise.all` de consultas. Ninguém revisa uma
 * aritmética escondida ali — por isso ela é uma função com testes.
 */

const { somarFilas } = require('../src/controllers/contagemDaFila');

describe('a fila soma as duas origens', () => {
  test('publicação avulsa e lote', () => {
    const r = somarFilas(
      { agendados: 2, processando: 1, pendentes: 3 },
      { rodando: 2, enfileirados: 5 },
    );
    expect(r).toEqual({ agendados: 2, processando: 3, pendentes: 8 });
  });

  test('origem ausente conta zero, não quebra', () => {
    expect(somarFilas()).toEqual({ agendados: 0, processando: 0, pendentes: 0 });
    expect(somarFilas(null, undefined)).toEqual({ agendados: 0, processando: 0, pendentes: 0 });
  });

  test('valor inválido não contamina a soma', () => {
    /* `undefined` numa soma vira NaN, e NaN na tela é pior que zero. */
    const r = somarFilas(
      { agendados: undefined, processando: null, pendentes: 'x' },
      { rodando: -3, enfileirados: 4 },
    );
    expect(r).toEqual({ agendados: 0, processando: 0, pendentes: 4 });
  });
});

/* ── Mídias que restam num Job, por rodada ─────────────────────────────────
   O painel somava mediaFiles.length inteiro: "Processando 30" da primeira à
   última rodada, "Na fila 0" sempre. Medido em produção com um envio de 30. */
describe('midiasDoJob / contarJobs — o que resta, não o total', () => {
  const { midiasDoJob, contarJobs } = require('../src/controllers/contagemDaFila');
  /* `contas: 1` por padrão para os casos que medem a ARITMÉTICA das rodadas;
     a multiplicação por conta tem testes próprios logo abaixo. */
  const job = (status, rodada, total = 30, limite = 1, contas = 1) => ({ status, currentRound: rodada, mediaFiles: Array(total).fill('m'), simultaneousLimit: limite, accounts: Array(contas).fill('c') });

  test('running: a rodada atual está saindo, o resto espera', () => {
    expect(midiasDoJob(job('running', 0))).toEqual({ processando: 1, naFila: 29 });
    expect(midiasDoJob(job('running', 29))).toEqual({ processando: 1, naFila: 0 });
    expect(midiasDoJob(job('running', 2, 30, 5))).toEqual({ processando: 5, naFila: 15 });
  });

  test('entre rodadas e antes de começar: tudo o que resta espera, nada "processando"', () => {
    expect(midiasDoJob(job('waiting_interval', 1))).toEqual({ processando: 0, naFila: 29 });
    expect(midiasDoJob(job('queued', 0))).toEqual({ processando: 0, naFila: 30 });
  });

  test('o número desce conforme o envio avança', () => {
    const serie = [0, 5, 10, 29, 30].map(r => midiasDoJob(job('waiting_interval', r)).naFila);
    expect(serie).toEqual([30, 25, 20, 1, 0]);
  });

  test('pausado, concluído e cancelado ficam fora da fila; job estragado não quebra', () => {
    for (const s of ['paused', 'completed', 'cancelled']) expect(midiasDoJob(job(s, 3))).toEqual({ processando: 0, naFila: 0 });
    expect(midiasDoJob(null)).toEqual({ processando: 0, naFila: 0 });
    expect(midiasDoJob({ status: 'running' })).toEqual({ processando: 0, naFila: 0 });
    expect(midiasDoJob({ status: 'running', mediaFiles: ['a'], currentRound: 7 })).toEqual({ processando: 0, naFila: 0 });
  });

  test('contarJobs soma os ativos', () => {
    expect(contarJobs([job('running', 0), job('waiting_interval', 10), job('queued', 0, 12)])).toEqual({ rodando: 1, enfileirados: 61 });
    expect(contarJobs(null)).toEqual({ rodando: 0, enfileirados: 0 });
  });
  test('a fila conta PUBLICACOES, nao midias: cada midia vale uma por conta', () => {
    /* Medido em producao: um envio de 20 midias para 10 contas produz 200
       publicacoes — e o proprio Job grava isso em postsTotal. O painel
       contava as 20 midias e mostrava "21" com 200 publicacoes pela frente. */
    expect(midiasDoJob(job('running', 0, 20, 1, 10))).toEqual({ processando: 10, naFila: 190 });
    const m = midiasDoJob(job('running', 0, 20, 1, 10));
    expect(m.processando + m.naFila).toBe(200);
    expect(midiasDoJob(job('waiting_interval', 5, 20, 1, 10))).toEqual({ processando: 0, naFila: 150 });
    expect(midiasDoJob(job('running', 2, 30, 5, 3))).toEqual({ processando: 15, naFila: 45 });
  });

  test('sem contas declaradas, uma publicacao por midia — nunca zera a fila', () => {
    expect(midiasDoJob({ status: 'running', currentRound: 0, mediaFiles: ['a', 'b'], simultaneousLimit: 1 }))
      .toEqual({ processando: 1, naFila: 1 });
    expect(midiasDoJob({ status: 'queued', currentRound: 0, mediaFiles: ['a'], simultaneousLimit: 1, accounts: [] }))
      .toEqual({ processando: 0, naFila: 1 });
  });

  test('o loop (job type loop) entra pela mesma conta, com as contas vindas de accountIds', () => {
    const loop = { status: 'waiting_interval', type: 'loop', currentRound: 4, mediaFiles: Array(10).fill('m'), simultaneousLimit: 1, accountIds: ['a', 'b', 'c'] };
    expect(midiasDoJob(loop)).toEqual({ processando: 0, naFila: 18 });
  });
});

'use strict';

/**
 * A fila do painel, e as postagens de hoje.
 *
 * ── O que motivou
 *
 * Subir uma campanha com trinta publicações não mudava nada na fila do painel:
 * ele somava `Post` e `Job` e não olhava para `CampaignPublication`, onde as
 * publicações planejadas vivem até a hora de executar.
 *
 * Do lado, a tela de Campanhas mostrava as trinta. Dois números do mesmo
 * produto discordando é pior que um número ausente — um deles está mentindo e
 * não dá para saber qual.
 *
 * ── Por que estes testes existem
 *
 * A soma morava no meio de um `Promise.all` de quinze consultas. Ninguém
 * revisa uma aritmética escondida ali, e foi assim que uma das três origens
 * ficou de fora sem que nada acusasse.
 */

const { somarFilas, postagensDeHoje, porStatus } =
  require('../src/controllers/contagemDaFila');

describe('a fila soma as três origens', () => {
  test('publicação avulsa, lote e campanha', () => {
    const r = somarFilas(
      { agendados: 2, processando: 1, pendentes: 3 },
      { rodando: 2, enfileirados: 5 },
      { scheduled: 30, processing: 1, pending: 7 },
    );
    expect(r).toEqual({ agendados: 32, processando: 4, pendentes: 15 });
  });

  test('a campanha sozinha aparece na fila', () => {
    /* O caso do relato: nenhuma publicação avulsa, nenhum lote, e uma campanha
       recém-subida. Antes isto dava zero em tudo. */
    const r = somarFilas({}, {}, { scheduled: 28, pending: 2 });
    expect(r.agendados).toBe(28);
    expect(r.pendentes).toBe(2);
  });

  test('origem ausente conta zero, não quebra', () => {
    /* O agrupamento por status devolve só os status que existem. Um painel que
       lança porque ninguém agendou nada seria pior que um número errado. */
    expect(somarFilas()).toEqual({ agendados: 0, processando: 0, pendentes: 0 });
    expect(somarFilas(null, undefined, {})).toEqual(
      { agendados: 0, processando: 0, pendentes: 0 });
  });

  test('valor inválido não contamina a soma', () => {
    /* `undefined` numa soma vira NaN, e NaN na tela é pior que zero: some do
       gráfico, quebra comparações, e não diz que veio de um campo ausente. */
    const r = somarFilas(
      { agendados: undefined, processando: null, pendentes: 'x' },
      { rodando: -3, enfileirados: 4 },
      {},
    );
    expect(r).toEqual({ agendados: 0, processando: 0, pendentes: 4 });
  });
});

describe('postagens de hoje', () => {
  test('sem sobreposição, o maior é o que existe', () => {
    expect(postagensDeHoje(12, 0)).toBe(12);
    expect(postagensDeHoje(0, 9)).toBe(9);
  });

  test('as duas fontes concordando não dobram o número', () => {
    /* A campanha cria um `Post` por conta ao publicar. Somar contaria a mesma
       publicação duas vezes, e o painel mostraria o dobro do que saiu. */
    expect(postagensDeHoje(9, 9)).toBe(9);
  });

  test('quando o Post falta, a campanha sustenta o número', () => {
    /* Publicação anterior a este código, ou falha ao criar o Post. O que saiu
       de fato foram 5 — dizer 2 esconderia três publicações reais. */
    expect(postagensDeHoje(2, 5)).toBe(5);
  });

  test('nada publicado é zero, não nulo', () => {
    expect(postagensDeHoje(0, 0)).toBe(0);
    expect(postagensDeHoje(undefined, null)).toBe(0);
  });
});

describe('agrupamento por status', () => {
  test('converte a saída do group by', () => {
    expect(porStatus([{ status: 'scheduled', n: 28 }, { status: 'pending', n: 2 }]))
      .toEqual({ scheduled: 28, pending: 2 });
  });

  test('agregado vazio ou com falha vira objeto vazio', () => {
    /* O `.catch(() => [])` da consulta entrega array vazio quando o banco
       tropeça. O painel precisa continuar de pé com os outros números. */
    for (const v of [[], null, undefined, 'não é lista']) {
      expect(porStatus(v)).toEqual({});
    }
  });

  test('linha sem status é descartada', () => {
    expect(porStatus([{ n: 5 }, { status: 'pending', n: 2 }])).toEqual({ pending: 2 });
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

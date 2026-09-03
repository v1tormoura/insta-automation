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
      { esperando: 10, rodando: 2, enfileirados: 5 },
      { scheduled: 30, processing: 1, pending: 7 },
    );
    expect(r).toEqual({ agendados: 42, processando: 4, pendentes: 15 });
  });

  test('a campanha sozinha aparece na fila', () => {
    /* O caso do relato: nenhuma publicação avulsa, nenhum lote, e uma campanha
       recém-subida. Antes isto dava zero em tudo. */
    const r = somarFilas({}, {}, { scheduled: 28, pending: 2 });
    expect(r.agendados).toBe(28);
    expect(r.pendentes).toBe(2);
  });

  test('origem ausente conta zero, não quebra', () => {
    /* O agregado do mongo devolve só os status que existem. Um painel que
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
      { esperando: NaN, rodando: -3, enfileirados: 4 },
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
  test('converte a saída do aggregate', () => {
    expect(porStatus([{ _id: 'scheduled', n: 28 }, { _id: 'pending', n: 2 }]))
      .toEqual({ scheduled: 28, pending: 2 });
  });

  test('agregado vazio ou com falha vira objeto vazio', () => {
    /* O `.catch(() => [])` da consulta entrega array vazio quando o banco
       tropeça. O painel precisa continuar de pé com os outros números. */
    for (const v of [[], null, undefined, 'não é lista']) {
      expect(porStatus(v)).toEqual({});
    }
  });

  test('linha sem _id é descartada', () => {
    expect(porStatus([{ n: 5 }, { _id: 'pending', n: 2 }])).toEqual({ pending: 2 });
  });
});

describe('o loop é a quarta origem', () => {
  const { pendentesDoLoop } = require('../src/controllers/contagemDaFila');

  test('conta o que falta do ciclo, não a lista inteira', () => {
    /* O loop é contínuo. Contar `mediaFiles.length` daria um número que nunca
       desce — num loop rodando há uma semana ele não descreveria nada. */
    const loops = [{ status: 'ativo', mediaFiles: new Array(44), currentIndex: 6 }];
    expect(pendentesDoLoop(loops)).toBe(38);
  });

  test('loop recém-criado conta a lista toda', () => {
    expect(pendentesDoLoop([{ status: 'ativo', mediaFiles: new Array(44), currentIndex: 0 }])).toBe(44);
  });

  test('loop pausado não entra na fila', () => {
    /* Uma fila que inclui o que está parado é uma fila que não se esvazia: a
       pessoa olha, vê 44, espera, e continua vendo 44. */
    const loops = [
      { status: 'pausado', mediaFiles: new Array(44), currentIndex: 0 },
      { status: 'ativo',   mediaFiles: new Array(10), currentIndex: 3 },
    ];
    expect(pendentesDoLoop(loops)).toBe(7);
  });

  test('índice além do fim não vira número negativo', () => {
    const loops = [{ status: 'ativo', mediaFiles: new Array(5), currentIndex: 9 }];
    expect(pendentesDoLoop(loops)).toBe(0);
  });

  test('entrada estranha devolve zero em vez de quebrar o painel', () => {
    for (const ruim of [null, undefined, 'x', 42, {}]) {
      expect(pendentesDoLoop(ruim)).toBe(0);
    }
    expect(pendentesDoLoop([null, { status: 'ativo' }, {}])).toBe(0);
  });

  test('a soma da fila inclui o loop em pendentes', () => {
    /* Em "pendentes" e não em "agendados": as mídias do loop não têm horário
       marcado, saem quando o ciclo chegar nelas. */
    const r = somarFilas(
      { agendados: 1, processando: 2, pendentes: 3 },
      { esperando: 0, rodando: 0, enfileirados: 0 },
      {},
      { pendentes: 38 },
    );
    expect(r.pendentes).toBe(41);
    expect(r.agendados).toBe(1);
  });

  test('sem o quarto argumento a soma continua valendo', () => {
    // Nenhum chamador antigo quebra por causa do parâmetro novo.
    const r = somarFilas({ pendentes: 3 }, { enfileirados: 2 }, { pending: 1 });
    expect(r.pendentes).toBe(6);
  });
});

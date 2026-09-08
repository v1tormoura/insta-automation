'use strict';

/**
 * Métricas dos perfis: o período, a série de seguidores e o controller.
 *
 * O que estes testes protegem, em uma frase cada:
 *
 *  1. O período devolve DUAS formas (etiqueta de calendário e instante), e
 *     confundi-las desloca "hoje" em três horas no fuso de Brasília.
 *  2. Um dia sem medição (`novos: null`) não pode ser somado como zero —
 *     "não sei" e "ninguém seguiu" são respostas diferentes.
 *  3. Seguidores é um ESTOQUE: não muda com o filtro de período.
 */

const mongoose = require('mongoose');
const periodo = require('../src/services/periodoDeMetricas');

describe('periodoDeMetricas — as duas formas', () => {
  /* Uma quinta-feira às 22h em Brasília: já é o dia SEGUINTE em UTC. É o
     horário em que a confusão entre etiqueta e instante aparece. */
  const noite = new Date('2026-09-10T22:30:00-03:00');

  test('hoje: a etiqueta é o dia local, não o dia em UTC', () => {
    const p = periodo.resolver({ periodo: 'hoje' }, noite);
    expect(p.diaDe).toBe('2026-09-10');
    expect(p.diaAte).toBe('2026-09-10');
    /* Se o código usasse `toISOString().slice(0,10)`, isto seria o dia 11. */
    expect(p.diaDe).not.toBe('2026-09-11');
  });

  test('hoje: o instante começa à meia-noite LOCAL', () => {
    const p = periodo.resolver({ periodo: 'hoje' }, noite);
    expect(p.desde.getHours()).toBe(0);
    expect(p.desde.getMinutes()).toBe(0);
    /* O fim é exclusivo — meia-noite do dia seguinte, para usar com `$lt`. */
    expect(p.ate.getTime() - p.desde.getTime()).toBe(86400000);
  });

  test('ontem é um dia só, não "de ontem até hoje"', () => {
    const p = periodo.resolver({ periodo: 'ontem' }, noite);
    expect(p.diaDe).toBe('2026-09-09');
    expect(p.diaAte).toBe('2026-09-09');
    expect(p.ate.getTime() - p.desde.getTime()).toBe(86400000);
  });

  test('7d e 30d incluem o dia em curso', () => {
    const sete = periodo.resolver({ periodo: '7d' }, noite);
    expect(sete.diaAte).toBe('2026-09-10');
    expect(sete.diaDe).toBe('2026-09-04');   // 7 dias contando hoje

    const trinta = periodo.resolver({ periodo: '30d' }, noite);
    expect(trinta.diaAte).toBe('2026-09-10');
    expect(trinta.diaDe).toBe('2026-08-12');
  });

  test('total não tem limite nenhum — e o filtro sai VAZIO', () => {
    const p = periodo.resolver({ periodo: 'total' }, noite);
    expect(p.diaDe).toBeNull();
    expect(p.desde).toBeNull();

    /* Este é o detalhe que quebraria a tela em silêncio: `{ postedAt: {} }`
       o Mongo entende como "nenhum documento casa", e o painel mostraria
       zeros no período que deveria mostrar tudo. */
    expect(periodo.filtroDeInstante(p)).toEqual({});
  });

  test('período desconhecido cai no padrão em vez de estourar', () => {
    const p = periodo.resolver({ periodo: 'trimestre' }, noite);
    expect(p.periodo).toBe(periodo.PADRAO);
  });

  test('a faixa explícita vence o atalho', () => {
    const p = periodo.resolver({ periodo: 'hoje', de: '2026-09-01', ate: '2026-09-03' }, noite);
    expect(p.periodo).toBe('faixa');
    expect(p.diaDe).toBe('2026-09-01');
    expect(p.diaAte).toBe('2026-09-03');
  });

  test('faixa invertida é corrigida, não recusada', () => {
    const p = periodo.resolver({ de: '2026-09-09', ate: '2026-09-02' }, noite);
    expect(p.diaDe).toBe('2026-09-02');
    expect(p.diaAte).toBe('2026-09-09');
  });

  test('faixa pela metade ou com data inválida volta ao atalho', () => {
    expect(periodo.resolver({ de: '2026-09-01' }, noite).periodo).toBe('hoje');
    expect(periodo.resolver({ de: '01/09/2026', ate: '03/09/2026' }, noite).periodo).toBe('hoje');
  });

  test('filtroDeInstante usa $gte/$lt — nunca $lte no fim exclusivo', () => {
    const p = periodo.resolver({ periodo: 'hoje' }, noite);
    const f = periodo.filtroDeInstante(p);
    expect(f.postedAt.$gte).toEqual(p.desde);
    expect(f.postedAt.$lt).toEqual(p.ate);
    expect(f.postedAt.$lte).toBeUndefined();
  });
});

describe('serieDeSeguidores — dia sem medição não é dia com zero', () => {
  const SeguidoresDoDia = require('../src/models/SeguidoresDoDia');
  const serie = require('../src/services/serieDeSeguidores');

  const contaA = new mongoose.Types.ObjectId();
  const contaB = new mongoose.Types.ObjectId();

  const mockLinhas = linhas => jest.spyOn(SeguidoresDoDia, 'find').mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(linhas) }),
  });

  afterEach(() => jest.restoreAllMocks());

  test('soma só os dias com `novos` numérico', async () => {
    mockLinhas([
      { accountId: contaA, novos: 12 },
      { accountId: contaA, novos: null },   // primeiro registro da conta
      { accountId: contaB, novos: 5 },
    ]);

    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA, contaB]);
    expect(r.novos).toBe(17);
    expect(r.comHistorico).toBe(true);
  });

  test('perda de seguidores entra como número negativo', async () => {
    mockLinhas([{ accountId: contaA, novos: 30 }, { accountId: contaA, novos: -8 }]);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA]);
    expect(r.novos).toBe(22);
  });

  test('só dias `null`: comHistorico é false — a tela mostra "—", não "+0"', async () => {
    mockLinhas([{ accountId: contaA, novos: null }]);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA]);
    expect(r.novos).toBe(0);
    expect(r.comHistorico).toBe(false);
  });

  test('conta sem nenhuma linha é contada como sem histórico', async () => {
    mockLinhas([{ accountId: contaA, novos: 3 }]);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA, contaB]);
    expect(r.contasSemHistorico).toBe(1);
  });

  test('sem contas não vai ao banco', async () => {
    const find = mockLinhas([]);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', []);
    expect(find).not.toHaveBeenCalled();
    expect(r).toEqual({ novos: 0, comHistorico: false, contasSemHistorico: 0 });
  });

  test('erro no banco não derruba a tela', async () => {
    jest.spyOn(SeguidoresDoDia, 'find').mockImplementation(() => { throw new Error('desconectado'); });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA]);
    expect(r.comHistorico).toBe(false);
    expect(r.contasSemHistorico).toBe(1);
  });

  test('registrar é um efeito colateral: falha em silêncio, não lança', async () => {
    jest.spyOn(SeguidoresDoDia, 'findOne').mockImplementation(() => { throw new Error('sem banco'); });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    /* Importa porque isto roda dentro do accountFastSync: uma exceção aqui
       derrubaria a sincronização de métricas para gravar um histórico. */
    await expect(serie.registrar({ _id: contaA, username: 'x', followers: 10 })).resolves.toBeNull();
  });

  test('registrar sem conta devolve null sem tocar no banco', async () => {
    const findOne = jest.spyOn(SeguidoresDoDia, 'findOne');
    await expect(serie.registrar(null)).resolves.toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});

describe('getMetricasDosPerfis', () => {
  const Account = require('../src/models/Account');
  const Insight = require('../src/models/Insight');
  const SeguidoresDoDia = require('../src/models/SeguidoresDoDia');
  const { getMetricasDosPerfis } = require('../src/controllers/analyticsController');

  const a = new mongoose.Types.ObjectId();
  const b = new mongoose.Types.ObjectId();

  const responder = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

  const mockContas = contas => jest.spyOn(Account, 'find').mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(contas) }),
  });

  beforeEach(() => {
    jest.spyOn(SeguidoresDoDia, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('sem contas devolve zeros e não afirma crescimento', async () => {
    mockContas([]);
    const res = responder();
    await getMetricasDosPerfis({ query: {} }, res);

    const corpo = res.json.mock.calls[0][0];
    expect(corpo.seguidores).toBe(0);
    expect(corpo.contas).toEqual([]);
    expect(corpo.novosSeguidoresMedido).toBe(false);
  });

  test('exclui contas banidas ou com sessão morta da soma', async () => {
    const find = mockContas([]);
    await getMetricasDosPerfis({ query: {} }, responder());

    const filtro = find.mock.calls[0][0];
    expect(filtro.healthStatus.$nin).toEqual(expect.arrayContaining(['banida', 'sessao_expirada']));
  });

  test('seguidores é estoque: o mesmo total em "hoje" e em "total"', async () => {
    mockContas([
      { _id: a, username: 'um',  followers: 1200 },
      { _id: b, username: 'dois', followers: 800 },
    ]);
    jest.spyOn(Insight, 'aggregate').mockResolvedValue([]);

    for (const p of ['hoje', 'total']) {
      const res = responder();
      await getMetricasDosPerfis({ query: { periodo: p } }, res);
      expect(res.json.mock.calls[0][0].seguidores).toBe(2000);
    }
  });

  test('story fica fora das views dos posts e ganha total próprio', async () => {
    mockContas([{ _id: a, username: 'um', followers: 10 }]);
    jest.spyOn(Insight, 'aggregate').mockImplementation(pipeline => {
      /* A primeira consulta é a dos totais e traz `$ne: STORY` no $match;
         a segunda separa os dois com `$cond` e agrupa por conta. */
      const agrupaPorConta = pipeline.some(e => e.$group && e.$group._id === '$accountId');
      return Promise.resolve(agrupaPorConta
        ? [{ _id: a, curtidas: 40, viewsPosts: 900, viewsStories: 250, sincronizado: new Date('2026-09-08T10:00:00Z') }]
        : [{ _id: null, curtidas: 40, views: 900 }]);
    });

    const res = responder();
    await getMetricasDosPerfis({ query: { periodo: '7d' } }, res);
    const corpo = res.json.mock.calls[0][0];

    expect(corpo.viewsPosts).toBe(900);
    expect(corpo.viewsStories).toBe(250);
    /* Somar os dois daria 1150 — foi o erro que este teste existe para pegar. */
    expect(corpo.viewsPosts).not.toBe(1150);
    expect(corpo.contas[0].viewsStories).toBe(250);
  });

  test('a consulta dos totais exclui STORY no $match', async () => {
    mockContas([{ _id: a, username: 'um', followers: 10 }]);
    const agg = jest.spyOn(Insight, 'aggregate').mockResolvedValue([]);
    await getMetricasDosPerfis({ query: {} }, responder());

    const totais = agg.mock.calls[0][0];
    expect(totais[0].$match.mediaType).toEqual({ $ne: 'STORY' });
  });

  test('contas vêm ordenadas por seguidores, da maior para a menor', async () => {
    mockContas([
      { _id: a, username: 'menor', followers: 100 },
      { _id: b, username: 'maior', followers: 9000 },
    ]);
    jest.spyOn(Insight, 'aggregate').mockResolvedValue([]);

    const res = responder();
    await getMetricasDosPerfis({ query: {} }, res);
    expect(res.json.mock.calls[0][0].contas.map(c => c.username)).toEqual(['maior', 'menor']);
  });

  test('conta sem métrica no período cai no lastSync, não em "nunca"', async () => {
    const sync = new Date('2026-09-08T09:00:00Z');
    mockContas([{ _id: a, username: 'um', followers: 10, lastSync: sync }]);
    jest.spyOn(Insight, 'aggregate').mockResolvedValue([]);

    const res = responder();
    await getMetricasDosPerfis({ query: {} }, res);
    expect(res.json.mock.calls[0][0].contas[0].sincronizadoEm).toEqual(sync);
  });

  test('erro no banco devolve 500 em vez de pendurar a requisição', async () => {
    mockContas([{ _id: a, username: 'um', followers: 10 }]);
    jest.spyOn(Insight, 'aggregate').mockRejectedValue(new Error('timeout'));

    const res = responder();
    await getMetricasDosPerfis({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('A tela é honesta sobre o que não mediu', () => {
  const fs = require('fs');
  const path = require('path');
  const tela = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/pages/MetricasDosPerfis.jsx'), 'utf8');

  test('mostra "—" quando não há série, em vez de afirmar "+0"', () => {
    expect(tela).toMatch(/novosSeguidoresMedido/);
    /* A âncora é a sintaxe do ternário, não a prosa dos comentários: já
       escrevi asserção negativa que casava com o meu próprio comentário
       explicando o problema. */
    expect(tela).toMatch(/d\.novosSeguidoresMedido\s*\n?\s*\?/);
  });

  test('o cartão de seguidores não promete um período', () => {
    /* Seguidores é estoque. Um rótulo com o período ali estaria dizendo
       "seguidores de ontem", que é um dado que não existe. */
    const cartao = tela.slice(tela.indexOf("rotulo: 'Seguidores totais'"));
    const nota = cartao.slice(0, cartao.indexOf('},'));
    expect(nota).not.toMatch(/d\.rotulo/);
  });

  test('Filtrar exige as duas datas', () => {
    expect(tela).toMatch(/disabled=\{!de \|\| !ate\}/);
  });
});

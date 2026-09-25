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

const periodo = require('../src/services/periodoDeMetricas');
const banco = require('./helpers/banco');
const USER = { id: require('./helpers/banco').DONO_ID, papel: 'admin' };

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

  test('total não tem limite nenhum', () => {
    /* Sem `desde`/`ate` o controller não aplica filtro de data — um filtro
       vazio mal montado mostraria zeros no período que deveria mostrar tudo
       (coberto por "o período filtra pela data da publicação", abaixo). */
    const p = periodo.resolver({ periodo: 'total' }, noite);
    expect(p.diaDe).toBeNull();
    expect(p.desde).toBeNull();
    expect(p.ate).toBeNull();
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

});

describe('serieDeSeguidores — dia sem medição não é dia com zero', () => {
  const serie = require('../src/services/serieDeSeguidores');
  let contaA, contaB;
  const linha = (conta, dia, novos) =>
    banco.sql`insert into seguidores_do_dia ${banco.sql({ accountId: conta.id, dia, novos })}`;

  beforeEach(async () => {
    await banco.limpar();
    contaA = await banco.criarConta({ username: 'a' });
    contaB = await banco.criarConta({ username: 'b' });
  });

  test('soma só os dias com `novos` numérico', async () => {
    await linha(contaA, '2026-09-02', 12);
    await linha(contaA, '2026-09-01', null);   // primeiro registro da conta
    await linha(contaB, '2026-09-03', 5);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA.id, contaB.id]);
    expect(r.novos).toBe(17);
    expect(r.comHistorico).toBe(true);
  });

  test('perda de seguidores entra como número negativo', async () => {
    await linha(contaA, '2026-09-02', 30);
    await linha(contaA, '2026-09-03', -8);
    expect((await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA.id])).novos).toBe(22);
  });

  test('só dias `null`: comHistorico é false — a tela mostra "—", não "+0"', async () => {
    await linha(contaA, '2026-09-02', null);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA.id]);
    expect(r.novos).toBe(0);
    expect(r.comHistorico).toBe(false);
  });

  test('conta sem nenhuma linha é contada como sem histórico', async () => {
    await linha(contaA, '2026-09-02', 3);
    const r = await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA.id, contaB.id]);
    expect(r.contasSemHistorico).toBe(1);
  });

  test('fora da faixa de dias não conta', async () => {
    await linha(contaA, '2026-08-30', 100);
    await linha(contaA, '2026-09-05', 1);
    expect((await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [contaA.id])).novos).toBe(1);
  });

  test('sem contas: zero, sem histórico', async () => {
    expect(await serie.novosNoPeriodo('2026-09-01', '2026-09-10', [])).toEqual({ novos: 0, comHistorico: false, contasSemHistorico: 0 });
  });

  test('registrar grava o dia e calcula quantos entraram desde o último registro', async () => {
    const ontem = new Date(Date.now() - 86_400_000);
    await serie.registrar({ ...contaA, followers: 100 }, ontem);
    const hoje = await serie.registrar({ ...contaA, followers: 130 });
    expect(hoje.novos).toBe(30);
    // Idempotente no mesmo dia: atualiza a mesma linha.
    await serie.registrar({ ...contaA, followers: 140 });
    const linhas = await banco.sql`select dia, seguidores, novos from seguidores_do_dia where account_id = ${contaA.id} order by dia`;
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toMatchObject({ seguidores: 140, novos: 40 });
  });

  test('primeiro registro da conta: novos é null, não 0', async () => {
    expect((await serie.registrar({ ...contaA, followers: 50 })).novos).toBeNull();
  });

  test('registrar sem conta devolve null', async () => {
    await expect(serie.registrar(null)).resolves.toBeNull();
  });
});

describe('getMetricasDosPerfis', () => {
  const { getMetricasDosPerfis } = require('../src/controllers/analyticsController');
  const responder = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });
  const pedir = async query => {
    const res = responder();
    await getMetricasDosPerfis({ user: USER,  query }, res);
    return res.json.mock.calls[0][0];
  };
  const insight = campos => banco.sql`insert into insights ${banco.sql({ igMediaId: `m${Math.random()}`, postedAt: new Date(), ...campos })}`;

  beforeEach(() => banco.limpar());

  test('sem contas devolve zeros e não afirma crescimento', async () => {
    const corpo = await pedir({});
    expect(corpo.seguidores).toBe(0);
    expect(corpo.contas).toEqual([]);
    expect(corpo.novosSeguidoresMedido).toBe(false);
  });

  test('exclui contas banidas ou com token inválido da soma', async () => {
    await banco.criarConta({ username: 'ok', followers: 100 });
    await banco.criarConta({ username: 'ban', followers: 5000, healthStatus: 'banida' });
    await banco.criarConta({ username: 'tok', followers: 7000, healthStatus: 'token_invalido' });
    const corpo = await pedir({});
    expect(corpo.seguidores).toBe(100);
    expect(corpo.contas.map(c => c.username)).toEqual(['ok']);
  });

  test('seguidores é estoque: o mesmo total em "hoje" e em "total"', async () => {
    await banco.criarConta({ username: 'um', followers: 1200 });
    await banco.criarConta({ username: 'dois', followers: 800 });
    for (const p of ['hoje', 'total']) expect((await pedir({ periodo: p })).seguidores).toBe(2000);
  });

  test('story fica fora das views dos posts e ganha total próprio', async () => {
    const a = await banco.criarConta({ username: 'um', followers: 10 });
    await insight({ accountId: a.id, mediaType: 'VIDEO', videoViews: 900, likeCount: 40 });
    await insight({ accountId: a.id, mediaType: 'STORY', videoViews: 250 });
    const corpo = await pedir({ periodo: '7d' });
    expect(corpo.viewsPosts).toBe(900);
    expect(corpo.viewsStories).toBe(250);
    /* Somar os dois daria 1150 — foi o erro que este teste existe para pegar. */
    expect(corpo.curtidas).toBe(40);
    expect(corpo.contas[0].viewsStories).toBe(250);
  });

  test('o período filtra pela data da publicação', async () => {
    const a = await banco.criarConta({ username: 'um', followers: 10 });
    await insight({ accountId: a.id, mediaType: 'VIDEO', videoViews: 5, postedAt: new Date() });
    await insight({ accountId: a.id, mediaType: 'VIDEO', videoViews: 700, postedAt: new Date(Date.now() - 40 * 86_400_000) });
    expect((await pedir({ periodo: 'hoje' })).viewsPosts).toBe(5);
    expect((await pedir({ periodo: 'total' })).viewsPosts).toBe(705);
  });

  test('contas vêm ordenadas por seguidores, da maior para a menor', async () => {
    await banco.criarConta({ username: 'menor', followers: 100 });
    await banco.criarConta({ username: 'maior', followers: 9000 });
    expect((await pedir({})).contas.map(c => c.username)).toEqual(['maior', 'menor']);
  });

  test('conta sem métrica no período cai no lastSync, não em "nunca"', async () => {
    const sync = new Date('2026-09-08T09:00:00Z');
    await banco.criarConta({ username: 'um', followers: 10, lastSync: sync });
    expect((await pedir({})).contas[0].sincronizadoEm).toEqual(sync);
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

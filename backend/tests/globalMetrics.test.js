'use strict';

/**
 * Métricas globais — só as contas em serviço entram, e STORY fica fora do
 * "melhor post" e do alcance do feed (tem total próprio).
 */

const banco = require('./helpers/banco');
const { getGlobalMetrics } = require('../src/controllers/analyticsController');

async function pedir(period = '30d') {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await getGlobalMetrics(await banco.req({ query: { ...(period ? { period } : {}), force: 'true' } }), res);
  return res.json.mock.calls[0][0];
}
const insight = campos => banco.sql`insert into insights ${banco.sql({ igMediaId: `m${Math.random()}`, postedAt: new Date(), ...campos })}`;

beforeEach(() => banco.limpar());

test('zeros quando não há contas', async () => {
  expect(await pedir()).toEqual(expect.objectContaining({
    connectedAccountsCount: 0, totalFollowers: 0, totalReach: 0, totalStoryViews: 0,
    bestPost: null, bestPostByAccount: [],
  }));
});

test('soma só as contas em serviço e calcula o período', async () => {
  const c1 = await banco.criarConta({ username: 'conta1', followers: 50000 });
  await banco.criarConta({ username: 'conta2', followers: 30000 });
  const fora = await banco.criarConta({ username: 'banida', followers: 99999, healthStatus: 'banida' });

  await insight({ accountId: c1.id, username: 'conta1', igMediaId: 'media_123', mediaType: 'VIDEO', videoViews: 120000, reach: 90000 });
  await insight({ accountId: c1.id, mediaType: 'IMAGE', reach: 160000, impressions: 160000 });
  await insight({ accountId: c1.id, mediaType: 'STORY', impressions: 15000, videoViews: 999999 });
  await insight({ accountId: fora.id, mediaType: 'VIDEO', videoViews: 5000000 });
  // Fora do período: não conta.
  await insight({ accountId: c1.id, mediaType: 'VIDEO', videoViews: 777, postedAt: new Date(Date.now() - 60 * 86_400_000) });

  const r = await pedir();
  expect(r.connectedAccountsCount).toBe(2);
  expect(r.totalFollowers).toBe(80000);
  expect(r.totalReach).toBe(250000);
  expect(r.totalViews).toBe(120000);
  expect(r.totalStoryViews).toBe(15000);
  // O story com muita audiência não vira o "melhor post".
  expect(r.bestPost).toEqual(expect.objectContaining({ username: 'conta1', igMediaId: 'media_123', videoViews: 120000 }));
  expect(r.bestPostByAccount.find(b => b.username === 'conta2').hasPost).toBe(false);
});

test('"Hoje" (o padrão) conta só o que foi publicado desde a meia-noite', async () => {
  const c = await banco.criarConta({ username: 'conta1', followers: 100 });
  const meiaNoite = new Date(new Date().setHours(0, 0, 0, 0));
  await insight({ accountId: c.id, mediaType: 'VIDEO', videoViews: 300, postedAt: new Date(meiaNoite.getTime() + 60_000) });
  await insight({ accountId: c.id, mediaType: 'VIDEO', videoViews: 5000, postedAt: new Date(meiaNoite.getTime() - 60_000) }); // ontem

  const hoje = await pedir('hoje');
  expect(hoje).toMatchObject({ period: 'hoje', periodLabel: 'Hoje', totalViews: 300 });
  expect(await pedir(null)).toMatchObject({ period: 'hoje', totalViews: 300 }); // sem período = hoje
  expect(await pedir('7d')).toMatchObject({ periodLabel: 'Últimos 7 dias', totalViews: 5300 });
  expect((await pedir('inventado')).period).toBe('hoje');
});

test('seguidores: o ganho do período, além do total (que não muda com o período)', async () => {
  const c = await banco.criarConta({ username: 'conta1', followers: 543 });
  const { etiqueta } = require('../src/services/periodoDeMetricas');
  const dia = n => etiqueta(new Date(Date.now() - n * 86_400_000));
  const ponto = (d, novos) => banco.sql`insert into seguidores_do_dia ${banco.sql({ accountId: c.id, usuarioId: c.usuarioId, dia: d, username: 'conta1', seguidores: 500, novos })}`;
  await ponto(dia(3), 20);
  await ponto(dia(0), 7);

  expect(await pedir('hoje')).toMatchObject({ totalFollowers: 543, novosSeguidores: 7, novosSeguidoresMedido: true });
  expect(await pedir('7d')).toMatchObject({ totalFollowers: 543, novosSeguidores: 27 });
});

test('sem série ainda: o ganho vem como não medido (a tela mostra o total)', async () => {
  await banco.criarConta({ username: 'nova', followers: 80 });
  expect(await pedir('hoje')).toMatchObject({ totalFollowers: 80, novosSeguidores: 0, novosSeguidoresMedido: false });
});

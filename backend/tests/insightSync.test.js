'use strict';

/**
 * Métricas das publicações (o botão "Atualizar" do Top posts e o ciclo de 30 min).
 *
 * O que estes testes protegem: a leitura passou a ser em paralelo e a gravação
 * em lote. Nada disso pode mudar O QUE é gravado — cada mídia com as suas
 * métricas, uma mídia repetida pela paginação sem derrubar o lote, e o tempo
 * assistido antigo mantido quando a leitura nova não o traz.
 */

const mockGet = jest.fn();
jest.mock('../src/services/instagramAPI', () => ({ get: (...a) => mockGet(...a) }));

const banco = require('./helpers/banco');
const { syncAccountInsights } = require('../src/services/insightSyncService');

const gravado = async id => (await banco.sql`select * from insights where ig_media_id = ${id}`)[0];
const espera = ms => new Promise(r => setTimeout(r, ms));

/** Uma conta com N mídias; a segunda página repete a última da primeira. */
function grafoFalso(n, { atraso = 0, semTempo = false } = {}) {
  const midias = Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, media_type: i % 2 ? 'IMAGE' : 'VIDEO', caption: `post ${i}`,
    timestamp: '2026-10-01T12:00:00Z', like_count: i, comments_count: 1,
  }));
  const metade = Math.ceil(n / 2);
  let emVoo = 0;
  const estado = { maxSimultaneas: 0 };
  mockGet.mockImplementation(async (caminho, params) => {
    emVoo++;
    estado.maxSimultaneas = Math.max(estado.maxSimultaneas, emVoo);
    try {
      await espera(atraso);
      if (caminho === '/ig1/media') return { data: midias.slice(0, metade), paging: { next: 'pagina-2' } };
      if (caminho === 'pagina-2') return { data: midias.slice(metade - 1) };
      const id = caminho.split('/')[1];
      const i = Number(id.slice(1));
      if (params.metric.startsWith('ig_reels')) {
        if (semTempo) throw new Error('sem permissão');
        return { data: [{ name: 'ig_reels_avg_watch_time', values: [{ value: 1000 + i }] }, { name: 'ig_reels_video_view_total_time', values: [{ value: 9000 }] }] };
      }
      return { data: [{ name: 'reach', values: [{ value: 100 + i }] }, { name: 'views', values: [{ value: 500 + i }] }, { name: 'likes', values: [{ value: i }] }] };
    } finally {
      emVoo--;
    }
  });
  return estado;
}

describe('syncAccountInsights — leitura em paralelo, gravação em lote', () => {
  let conta;
  beforeEach(async () => {
    await banco.limpar();
    mockGet.mockReset();
    const c = await banco.criarConta({ username: 'loja', igUserId: 'ig1' });
    conta = { ...c, accessToken: 'tok' };
  });

  test('grava cada mídia com as suas métricas, sem duplicar a repetida', async () => {
    grafoFalso(9);
    const r = await syncAccountInsights(conta);
    expect(r).toEqual({ synced: 9, total: 9 });
    expect(await banco.sql`select count(*)::int as n from insights`).toEqual([{ n: 9 }]);

    const video = await gravado('m4');
    expect(video).toMatchObject({ accountId: conta.id, username: 'loja', mediaType: 'VIDEO', reach: 104, videoViews: 504, likeCount: 4, avgWatchTimeMs: 1004, totalWatchTimeMs: 9000 });
    const foto = await gravado('m3');
    expect(foto).toMatchObject({ mediaType: 'IMAGE', reach: 103, avgWatchTimeMs: null });
  });

  test('lê várias mídias ao mesmo tempo', async () => {
    const estado = grafoFalso(12, { atraso: 20 });
    await syncAccountInsights(conta);
    expect(estado.maxSimultaneas).toBeGreaterThan(1);
  });

  test('o tempo assistido já gravado fica quando a leitura nova não o traz', async () => {
    grafoFalso(2);
    await syncAccountInsights(conta);
    grafoFalso(2, { semTempo: true });
    await syncAccountInsights(conta);
    expect((await gravado('m0')).avgWatchTimeMs).toBe(1000);
  });

  test('a lista de mídias falhando não grava nada e devolve o erro', async () => {
    mockGet.mockRejectedValue(new Error('token expirado'));
    expect(await syncAccountInsights(conta)).toEqual({ error: 'token expirado' });
    expect(await banco.sql`select count(*)::int as n from insights`).toEqual([{ n: 0 }]);
  });
});

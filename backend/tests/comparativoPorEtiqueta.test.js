
describe('comparativo por etiqueta', () => {
  const { agrupar } = require('../src/services/alcancePorEnvio');
  const posts = [
    { igMediaId: 'a1', jobId: 'j1', jobName: 'Lote A', jobRotulo: 'Original', duracaoMs: 10000 },
    { igMediaId: 'a2', jobId: 'j1', jobName: 'Lote A', jobRotulo: 'Original', duracaoMs: 10000 },
    { igMediaId: 'b1', jobId: 'j2', jobName: 'Lote B', jobRotulo: 'Repost', duracaoMs: 20000 },
  ];
  const insights = [
    { igMediaId: 'a1', username: 'x', reach: 1000, videoViews: 1000, shareCount: 10, savedCount: 5, likeCount: 50, avgWatchTimeMs: 8000 },
    { igMediaId: 'a2', username: 'y', reach: 3000, videoViews: 3000, shareCount: 30, savedCount: 15, likeCount: 150, avgWatchTimeMs: 12000 },
    { igMediaId: 'b1', username: 'x', reach: 100, videoViews: 100, shareCount: 0, savedCount: 0, likeCount: 2, avgWatchTimeMs: 4000 },
    { igMediaId: 'z9', username: 'x', reach: 50, videoViews: 50 },
  ];

  test('agrupa pela etiqueta do envio, com retenção em % ponderada por views', () => {
    const { etiquetas, reels } = agrupar(insights, posts);
    expect(reels.find(r => r.igMediaId === 'a1').retencao).toBe(80);
    const [orig, repost, sem] = etiquetas;
    expect(orig).toMatchObject({ rotulo: 'Original', reels: 2, envios: 1, contas: 2, reachMedio: 2000, retencao: 110, sharesPor1k: 10, savesPor1k: 5 });
    expect(repost).toMatchObject({ rotulo: 'Repost', reels: 1, reachMedio: 100, retencao: 20 });
    expect(sem).toMatchObject({ rotulo: '', reels: 1, retencao: null });
  });
});

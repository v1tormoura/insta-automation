'use strict';

/**
 * O que está subindo, e quem viu.
 *
 * Duas perguntas que os números do banco já respondiam e a tela não mostrava.
 *
 * `alcancePorEnvio`: o elo Insight ↔ Post ↔ envio. O que este teste protege é
 * o elo POR CONTA (`midiasPublicadas`): o Post é um só para N contas e o campo
 * antigo guardava só a última mídia — duas de três contas ficavam sem métrica.
 *
 * `publicoDaConta`: a leitura do formato da Graph e a regra do vazio. Medido
 * com token real: conta com 9 seguidores devolve `data: []` em todo recorte,
 * sem erro. A tela tem que dizer isso com o número, não ficar em branco.
 */

const { agrupar, indiceDeEnvios, SEM_ENVIO } = require('../src/services/alcancePorEnvio');
const { interpretar, comPercentual, rotularGenero, agregar, MINIMO_SEGUIDORES } = require('../src/services/publicoDaConta');

const ins = (id, extra = {}) => ({ igMediaId: id, username: 'a', reach: 0, videoViews: 0, likeCount: 0, savedCount: 0, postedAt: new Date('2026-09-17'), ...extra });

describe('alcance por envio — o elo', () => {
  test('midiasPublicadas liga TODAS as contas do mesmo Post, não só a última', () => {
    /* Três contas, um Post. igMediaId guarda só m3 (a última); m1 e m2 só
       existem em midiasPublicadas. Sem o array, m1 e m2 cairiam em "sem envio". */
    const posts = [{ igMediaId: 'm3', jobId: 'J', jobName: 'Escala 6x1', midiasPublicadas: [
      { igMediaId: 'm1' }, { igMediaId: 'm2' }, { igMediaId: 'm3' },
    ] }];
    const idx = indiceDeEnvios(posts);
    expect(idx.get('m1')?.jobName).toBe('Escala 6x1');
    expect(idx.get('m2')?.jobName).toBe('Escala 6x1');
    expect(idx.get('m3')?.jobName).toBe('Escala 6x1');
  });

  test('mídia sem Post entra em "sem envio" em vez de sumir', () => {
    const r = agrupar([ins('x', { reach: 40 })], []);
    expect(r.envios).toHaveLength(1);
    expect(r.envios[0].jobId).toBe(SEM_ENVIO);
    expect(r.envios[0].reach).toBe(40);
  });

  test('envios ordenados por alcance MÉDIO — é o que diz qual tipo sobe', () => {
    /* O envio "corpo" tem mais reels e mais alcance TOTAL; o "tema" tem
       alcance médio maior. Total premiaria volume; médio premia o vídeo. */
    const insights = [
      ins('t1', { reach: 2000 }), ins('t2', { reach: 1000 }),
      ins('c1', { reach: 200 }), ins('c2', { reach: 100 }), ins('c3', { reach: 50 }), ins('c4', { reach: 20 }), ins('c5', { reach: 5 }), ins('c6', { reach: 0 }), ins('c7', { reach: 0 }), ins('c8', { reach: 0 }), ins('c9', { reach: 0 }), ins('c10', { reach: 0 }), ins('c11', { reach: 0 }), ins('c12', { reach: 0 }), ins('c13', { reach: 0 }), ins('c14', { reach: 0 }), ins('c15', { reach: 0 }), ins('c16', { reach: 0 }), ins('c17', { reach: 0 }), ins('c18', { reach: 0 }), ins('c19', { reach: 0 }), ins('c20', { reach: 0 }), ins('c21', { reach: 0 }), ins('c22', { reach: 0 }), ins('c23', { reach: 0 }), ins('c24', { reach: 0 }), ins('c25', { reach: 0 }), ins('c26', { reach: 0 }), ins('c27', { reach: 0 }), ins('c28', { reach: 0 }), ins('c29', { reach: 0 }), ins('c30', { reach: 0 }), ins('c31', { reach: 0 }), ins('c32', { reach: 0 }), ins('c33', { reach: 3000 }),
    ];
    const posts = [
      { igMediaId: 't1', jobId: 'T', jobName: 'tema', midiasPublicadas: [{ igMediaId: 't1' }, { igMediaId: 't2' }] },
      { igMediaId: 'c1', jobId: 'C', jobName: 'corpo', midiasPublicadas: insights.filter(i => i.igMediaId.startsWith('c')).map(i => ({ igMediaId: i.igMediaId })) },
    ];
    const r = agrupar(insights, posts);
    const tema = r.envios.find(e => e.jobName === 'tema');
    const corpo = r.envios.find(e => e.jobName === 'corpo');
    expect(corpo.reach).toBeGreaterThan(tema.reach);      // total: corpo ganha
    expect(tema.reachMedio).toBeGreaterThan(corpo.reachMedio); // médio: tema ganha
    expect(r.envios[0].jobName).toBe('tema');
  });

  test('a taxa é (likes+saves)/views, igual à da tela de Performance', () => {
    const r = agrupar([ins('m', { videoViews: 5017, likeCount: 47, savedCount: 4 })], [{ igMediaId: 'm', jobId: 'J', jobName: 'x' }]);
    expect(r.reels[0].taxa).toBe(1);
    expect(r.envios[0].taxa).toBe(1);
  });

  test('os top reels de cada envio são os de maior alcance, no máximo N', () => {
    const insights = [ins('a', { reach: 5 }), ins('b', { reach: 500 }), ins('c', { reach: 50 }), ins('d', { reach: 5000 })];
    const posts = [{ igMediaId: 'a', jobId: 'J', jobName: 'x', midiasPublicadas: insights.map(i => ({ igMediaId: i.igMediaId })) }];
    const r = agrupar(insights, posts, { topReelsPorEnvio: 2 });
    expect(r.envios[0].top.map(t => t.igMediaId)).toEqual(['d', 'b']);
  });

  test('campos ausentes não quebram e não viram NaN', () => {
    const r = agrupar([{ igMediaId: 'z', reach: 'lixo', videoViews: null }], []);
    expect(r.reels[0].reach).toBe(0);
    expect(r.reels[0].taxa).toBeNull();
    expect(r.envios[0].reachMedio).toBe(0);
  });
});

describe('público — o formato da Graph', () => {
  const resposta = { data: [{ name: 'reached_audience_demographics', total_value: { breakdowns: [{
    dimension_keys: ['gender'],
    results: [
      { dimension_values: ['F'], value: 620 },
      { dimension_values: ['M'], value: 360 },
      { dimension_values: ['U'], value: 20 },
    ],
  }] } }] };

  test('lê breakdowns em lista ordenada por valor', () => {
    const l = interpretar(resposta);
    expect(l.map(x => x.chave)).toEqual(['F', 'M', 'U']);
    expect(l[0].valor).toBe(620);
  });

  test('vazio sem erro (conta pequena) vira lista vazia, não exceção', () => {
    expect(interpretar({ data: [] })).toEqual([]);
    expect(interpretar(null)).toEqual([]);
    expect(interpretar({ data: [{ total_value: { value: 12 } }] })).toEqual([]);
  });

  test('percentual soma 100 e gênero ganha rótulo em português', () => {
    const g = rotularGenero(comPercentual(interpretar(resposta)));
    expect(g.map(x => x.rotulo)).toEqual(['Mulheres', 'Homens', 'Não informado']);
    expect(g[0].pct).toBe(62);
    expect(Math.round(g.reduce((s, x) => s + x.pct, 0))).toBe(100);
  });

  test('o agregado soma valores absolutos — conta grande pesa mais', () => {
    /* Média de percentuais daria peso igual a 100 e a 10.000 alcançados. */
    const a = { disponivel: true, alcancados: { genero: [{ chave: 'F', valor: 90 }, { chave: 'M', valor: 10 }], paises: [{ chave: 'BR', valor: 100 }], idades: [] } };
    const b = { disponivel: true, alcancados: { genero: [{ chave: 'F', valor: 1000 }, { chave: 'M', valor: 9000 }], paises: [{ chave: 'BR', valor: 9000 }, { chave: 'US', valor: 1000 }], idades: [] } };
    const c = { disponivel: false, alcancados: null };
    const ag = agregar([a, b, c]);
    expect(ag.contas).toBe(2);
    const homens = ag.genero.find(x => x.chave === 'M');
    expect(homens.pct).toBeCloseTo(89.1, 0); // 9010 / 10100
    expect(ag.paises[0].chave).toBe('BR');
  });

  test('sem nenhuma conta com dados, o agregado é null', () => {
    expect(agregar([{ disponivel: false }])).toBeNull();
    expect(agregar([])).toBeNull();
  });

  test('a linha do Instagram está documentada onde a tela lê', () => {
    expect(MINIMO_SEGUIDORES).toBe(100);
  });
});

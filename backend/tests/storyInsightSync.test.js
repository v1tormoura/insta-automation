'use strict';

/**
 * Audiência dos stories.
 *
 * O que estes testes protegem: story vive 24h e some. A contagem gravada só
 * pode subir — uma coleta parcial ou um erro momentâneo não podem rebaixar o
 * total que o painel mostra, porque o número original não volta mais.
 */

jest.mock('../src/queue/postQueue', () => ({ add: jest.fn(), getJob: jest.fn(), remove: jest.fn() }));

const mockGGet = jest.fn();
jest.mock('../src/services/insightSyncService', () => ({
  gGet: (...a) => mockGGet(...a),
  graphBase: () => 'https://graph.facebook.com/v21.0',
  syncAllInsights: jest.fn(),
  syncAccountInsights: jest.fn(),
  startInsightAutoSync: jest.fn(),
}));

const Insight = require('../src/models/Insight');
const { _gravar, _metricasGraph } = require('../src/services/storyInsightSync');

const conta = { _id: 'conta1', username: 'teste' };

describe('_gravar — a contagem só sobe', () => {
  let original;
  beforeEach(() => {
    original = Insight.updateOne;
    Insight.updateOne = jest.fn(async () => ({ acknowledged: true }));
  });
  afterEach(() => { Insight.updateOne = original; });

  test('usa $max, não $set, para a audiência', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 42, taken_at: 1787000000 });

    const [filtro, update, opcoes] = Insight.updateOne.mock.calls[0];
    expect(filtro).toEqual({ igMediaId: 's1' });
    expect(update.$max).toEqual({ impressions: 42, reach: 42 });
    // $set não pode conter a audiência — senão uma leitura menor rebaixaria.
    expect(update.$set.impressions).toBeUndefined();
    expect(update.$set.reach).toBeUndefined();
    expect(opcoes.upsert).toBe(true);
  });

  test('grava como STORY, que é o que o painel soma', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 5 });
    expect(Insight.updateOne.mock.calls[0][1].$set.mediaType).toBe('STORY');
  });

  test('taken_at em segundos vira Date', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 5, taken_at: 1787000000 });
    const postedAt = Insight.updateOne.mock.calls[0][1].$set.postedAt;
    expect(postedAt).toBeInstanceOf(Date);
    expect(postedAt.getTime()).toBe(1787000000 * 1000);
  });

  test('sem taken_at, usa agora em vez de data inválida', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 5 });
    const postedAt = Insight.updateOne.mock.calls[0][1].$set.postedAt;
    expect(Number.isNaN(postedAt.getTime())).toBe(false);
  });

  test('audiência ausente não vira zero gravado', async () => {
    await expect(_gravar(conta, { story_id: 's1', viewers: null })).resolves.toBe(false);
    await expect(_gravar(conta, { story_id: 's1' })).resolves.toBe(false);
    await expect(_gravar(conta, { story_id: 's1', viewers: 'muitas' })).resolves.toBe(false);
    // Number(null) e Number('') valem 0 — sem checagem explícita, story sem
    // audiência conhecida entraria como zero e rebaixaria o total do painel.
    await expect(_gravar(conta, { story_id: 's1', viewers: '' })).resolves.toBe(false);
    await expect(_gravar(conta, { story_id: 's1', viewers: undefined })).resolves.toBe(false);
    expect(Insight.updateOne).not.toHaveBeenCalled();
  });

  test('zero legítimo é gravado — story sem visualização existe', async () => {
    await expect(_gravar(conta, { story_id: 's1', viewers: 0 })).resolves.toBe(true);
    expect(Insight.updateOne.mock.calls[0][1].$max.impressions).toBe(0);
  });

  test('valor negativo é recusado', async () => {
    await expect(_gravar(conta, { story_id: 's1', viewers: -3 })).resolves.toBe(false);
  });
});

describe('_metricasGraph — cadeia de fallback', () => {
  beforeEach(() => mockGGet.mockReset());

  test('usa a lista completa quando ela é aceita', async () => {
    mockGGet.mockResolvedValueOnce({ data: [
      { name: 'impressions', values: [{ value: 120 }] },
      { name: 'reach',       values: [{ value: 100 }] },
    ]});

    const m = await _metricasGraph('s1', 'tok');
    expect(m.impressions).toBe(120);
    expect(mockGGet).toHaveBeenCalledTimes(1);
    expect(mockGGet.mock.calls[0][1].metric).toContain('impressions');
  });

  test('métrica recusada cai para o conjunto seguinte, não devolve vazio', async () => {
    // `impressions` foi descontinuado para story e derruba a chamada inteira.
    mockGGet
      .mockRejectedValueOnce(new Error('(#100) impressions is deprecated'))
      .mockResolvedValueOnce({ data: [{ name: 'views', values: [{ value: 88 }] }] });

    const m = await _metricasGraph('s1', 'tok');
    expect(m.views).toBe(88);
    expect(mockGGet).toHaveBeenCalledTimes(2);
  });

  test('cai até `reach` sozinho antes de desistir', async () => {
    mockGGet
      .mockRejectedValueOnce(new Error('erro 1'))
      .mockRejectedValueOnce(new Error('erro 2'))
      .mockResolvedValueOnce({ data: [{ name: 'reach', values: [{ value: 30 }] }] });

    const m = await _metricasGraph('s1', 'tok');
    expect(m.reach).toBe(30);
    expect(mockGGet).toHaveBeenCalledTimes(3);
  });

  test('todas recusadas devolve objeto vazio, não exceção', async () => {
    mockGGet.mockRejectedValue(new Error('sem permissão'));
    await expect(_metricasGraph('s1', 'tok')).resolves.toEqual({});
  });

  test('resposta sem métrica nenhuma continua tentando', async () => {
    mockGGet
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ name: 'reach', values: [{ value: 7 }] }] });

    const m = await _metricasGraph('s1', 'tok');
    expect(m.reach).toBe(7);
  });
});

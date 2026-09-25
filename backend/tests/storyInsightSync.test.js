'use strict';

/**
 * Audiência dos stories.
 *
 * O que estes testes protegem: story vive 24h e some. A contagem gravada só
 * pode subir — uma coleta parcial ou um erro momentâneo não podem rebaixar o
 * total que o painel mostra, porque o número original não volta mais.
 */

const mockGet = jest.fn();
jest.mock('../src/services/instagramAPI', () => ({ get: (...a) => mockGet(...a) }));

const banco = require('./helpers/banco');
const { _gravar, _metricasGraph } = require('../src/services/storyInsightSync');

let conta;
const gravado = async id => (await banco.sql`select * from insights where ig_media_id = ${id}`)[0];

describe('_gravar — a contagem só sobe', () => {
  beforeEach(async () => {
    await banco.limpar();
    conta = await banco.criarConta({ username: 'teste' });
  });

  test('uma leitura menor não rebaixa o que já foi contado', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 42, taken_at: 1787000000 });
    await _gravar(conta, { story_id: 's1', viewers: 10 });
    await _gravar(conta, { story_id: 's1', viewers: 55 });
    const s = await gravado('s1');
    expect(s.impressions).toBe(55);
    expect(s.reach).toBe(55);
    await _gravar(conta, { story_id: 's1', viewers: 3 });
    expect((await gravado('s1')).impressions).toBe(55);
  });

  test('grava como STORY, que é o que o painel soma', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 5 });
    expect((await gravado('s1')).mediaType).toBe('STORY');
  });

  test('taken_at em segundos vira a data da publicação', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 5, taken_at: 1787000000 });
    expect((await gravado('s1')).postedAt.getTime()).toBe(1787000000 * 1000);
  });

  test('sem taken_at, usa agora em vez de data inválida', async () => {
    await _gravar(conta, { story_id: 's1', viewers: 5 });
    expect(Number.isNaN((await gravado('s1')).postedAt.getTime())).toBe(false);
  });

  test('audiência ausente não vira zero gravado', async () => {
    for (const viewers of [null, undefined, 'muitas', '']) {
      await expect(_gravar(conta, { story_id: 's1', viewers })).resolves.toBe(false);
    }
    // Number(null) e Number('') valem 0 — sem checagem explícita, story sem
    // audiência conhecida entraria como zero e rebaixaria o total do painel.
    expect(await gravado('s1')).toBeUndefined();
  });

  test('zero legítimo é gravado — story sem visualização existe', async () => {
    await expect(_gravar(conta, { story_id: 's1', viewers: 0 })).resolves.toBe(true);
    expect((await gravado('s1')).impressions).toBe(0);
  });

  test('valor negativo é recusado', async () => {
    await expect(_gravar(conta, { story_id: 's1', viewers: -3 })).resolves.toBe(false);
  });
});

describe('_metricasGraph — cadeia de fallback', () => {
  beforeEach(() => mockGet.mockReset());

  test('usa a lista completa quando ela é aceita', async () => {
    mockGet.mockResolvedValueOnce({ data: [
      { name: 'impressions', values: [{ value: 120 }] },
      { name: 'reach',       values: [{ value: 100 }] },
    ]});

    const m = await _metricasGraph('s1', 'tok');
    expect(m.impressions).toBe(120);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][1].metric).toContain('impressions');
  });

  test('métrica recusada cai para o conjunto seguinte, não devolve vazio', async () => {
    // `impressions` foi descontinuado para story e derruba a chamada inteira.
    mockGet
      .mockRejectedValueOnce(new Error('(#100) impressions is deprecated'))
      .mockResolvedValueOnce({ data: [{ name: 'views', values: [{ value: 88 }] }] });

    const m = await _metricasGraph('s1', 'tok');
    expect(m.views).toBe(88);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('cai até `reach` sozinho antes de desistir', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('erro 1'))
      .mockRejectedValueOnce(new Error('erro 2'))
      .mockResolvedValueOnce({ data: [{ name: 'reach', values: [{ value: 30 }] }] });

    const m = await _metricasGraph('s1', 'tok');
    expect(m.reach).toBe(30);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  test('todas recusadas devolve objeto vazio, não exceção', async () => {
    mockGet.mockRejectedValue(new Error('sem permissão'));
    await expect(_metricasGraph('s1', 'tok')).resolves.toEqual({});
  });

  test('resposta sem métrica nenhuma continua tentando', async () => {
    mockGet
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ name: 'reach', values: [{ value: 7 }] }] });

    const m = await _metricasGraph('s1', 'tok');
    expect(m.reach).toBe(7);
  });
});

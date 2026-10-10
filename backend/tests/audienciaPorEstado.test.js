'use strict';

/** A demografia por cidade da Meta, somada no estado do mapa. */

const a = require('../src/services/audienciaPorEstado');

test('cidade → sigla do estado', () => {
  expect(a.ufDaCidade('Campinas, São Paulo (state)')).toBe('sp');
  expect(a.ufDaCidade('Brasília, Federal District')).toBe('df');
  expect(a.ufDaCidade('Belém, Pará (state)')).toBe('pa');
  expect(a.ufDaCidade('Lisbon, Lisbon District')).toBeNull();
  expect(a.ufDaCidade('sem vírgula')).toBeNull();
});

test('soma as cidades de cada estado e ignora o exterior', () => {
  expect(a.somarPorEstado([
    { dimension_values: ['São Paulo, São Paulo (state)'], value: 120 },
    { dimension_values: ['Campinas, São Paulo (state)'], value: 30 },
    { dimension_values: ['Rio de Janeiro, Rio de Janeiro (state)'], value: 50 },
    { dimension_values: ['Miami, Florida'], value: 9 },
  ])).toEqual({ sp: 150, rj: 50 });
});

test('soma as contas, e conta sem demografia fica como "sem dados"', async () => {
  a._cache.clear();
  global.fetch = jest.fn(async url => {
    const u = String(url);
    const corpo = u.includes('/111/')
      ? { data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ['Recife, Pernambuco (state)'], value: 10 }] }] } }] }
      : { error: { message: 'Not enough followers', code: 100 } };
    return { ok: !corpo.error, status: corpo.error ? 400 : 200, text: async () => JSON.stringify(corpo) };
  });
  const r = await a.doUsuario([
    { id: 'a', username: 'a', igUserId: '111', accessToken: 't' },
    { id: 'b', username: 'b', igUserId: '222', accessToken: 't' },
  ], 'engajados');
  expect(r).toMatchObject({ metrica: 'engajados', estados: { pe: 10 }, total: 10, contasComDados: 1, contasSemDados: 1 });
  expect(String(global.fetch.mock.calls[0][0])).toContain('metric=engaged_audience_demographics');
  expect(String(global.fetch.mock.calls[0][0])).toContain('breakdown=city');
});

/* O formato que a Meta devolve de verdade nos recortes demográficos: o
   período vem como primeira dimensão. Lido pela posição, toda conta caía em
   "sem dados" — inclusive as de milhares de seguidores. */
const comPeriodo = cidades => ({ data: [{ name: 'reached_audience_demographics', total_value: { breakdowns: [{
  dimension_keys: ['timeframe', 'city'],
  results: cidades.map(([cidade, value]) => ({ dimension_values: ['THIS_MONTH', cidade], value })),
}] } }] });
const resposta = corpo => ({ ok: !corpo.error, status: corpo.error ? 400 : 200, text: async () => JSON.stringify(corpo) });

describe('com o período antes da cidade (formato real da Meta)', () => {
  beforeEach(() => a._cache.clear());

  test('soma pela cidade, não pelo período', () => {
    expect(a.somarPorEstado(comPeriodo([['Recife, Pernambuco (state)', 40], ['Olinda, Pernambuco (state)', 2], ['São Paulo, São Paulo (state)', 7]])
      .data[0].total_value.breakdowns[0].results)).toEqual({ pe: 42, sp: 7 });
  });

  test('cada conta diz por que ficou de fora do mapa', async () => {
    global.fetch = jest.fn(async url => {
      const u = String(url);
      if (u.includes('/1/')) return resposta(comPeriodo([['Recife, Pernambuco (state)', 300], ['Salvador, Bahia (state)', 120]]));
      if (u.includes('/2/')) return resposta(comPeriodo([['Lisbon, Lisbon District', 80]]));
      if (u.includes('/3/')) return resposta({ data: [] });
      if (u.includes('/4/')) return resposta({ data: [] });
      return resposta({ error: { message: 'Application does not have permission for this action', code: 10 } });
    });
    const r = await a.doUsuario([
      { id: 'a', username: 'grande', followers: 5000, igUserId: '1', accessToken: 't' },
      { id: 'b', username: 'portugal', followers: 900, igUserId: '2', accessToken: 't' },
      { id: 'c', username: 'pequena', followers: 40, igUserId: '3', accessToken: 't' },
      { id: 'd', username: 'parada', followers: 800, igUserId: '4', accessToken: 't' },
      { id: 'e', username: 'semPermissao', followers: 300, igUserId: '5', accessToken: 't' },
    ]);
    expect(r).toMatchObject({ estados: { pe: 300, ba: 120 }, total: 420, contasComDados: 1, contasSemDados: 4 });
    expect(Object.fromEntries(r.contas.map(c => [c.username, c.situacao]))).toEqual({
      grande: 'ok', portugal: 'fora_do_brasil', pequena: 'poucos_seguidores', parada: 'sem_dados', semPermissao: 'erro',
    });
    expect(r.contas.find(c => c.username === 'semPermissao').erro).toMatch(/permission/);
    // Erro de permissão não é de parâmetro: não fica tentando outros períodos.
    expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/5/'))).toHaveLength(1);
  });

  test('erro não fica guardado; dado fica', async () => {
    let falha = true;
    global.fetch = jest.fn(async () => (falha
      ? resposta({ error: { message: 'Erro temporário', code: 2 } })
      : resposta(comPeriodo([['Natal, Rio Grande do Norte (state)', 5]]))));
    const conta = { id: 'x', username: 'x', followers: 500, igUserId: '9', accessToken: 't' };
    expect((await a.doUsuario([conta])).contas[0].situacao).toBe('erro');
    falha = false;
    expect((await a.doUsuario([conta])).estados).toEqual({ rn: 5 });
    falha = true;
    expect((await a.doUsuario([conta])).estados).toEqual({ rn: 5 });
  });
});

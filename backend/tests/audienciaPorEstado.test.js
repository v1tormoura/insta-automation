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

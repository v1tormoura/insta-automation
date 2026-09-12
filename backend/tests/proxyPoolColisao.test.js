'use strict';

/**
 * Detecção de colisão de IP no pool de proxies.
 *
 * O índice único do modelo barra URLs idênticas — mas não barra duas URLs
 * DIFERENTES que saem pelo MESMO IP. Foi exatamente o que o "Replicar Conexão"
 * do Axtron produziu: credenciais que mudam no texto e não no endereço. Sem
 * detectar isso, o pool parece cheio e entrega o mesmo IP a várias contas —
 * o problema que ele existe para resolver, de volta por outra porta.
 */

const mockRegistros = [];

jest.mock('../src/models/ProxyPool', () => ({
  find: () => ({ lean: async () => mockRegistros.map(r => ({ ...r })) }),
  async updateOne() { return { modifiedCount: 1 }; },
}));

// testarLote é quem mede o IP de saída de cada proxy — aqui devolvemos um IP
// controlado por URL, sem rede.
const mockIpPorUrl = {};
jest.mock('../src/services/proxyAssignment', () => ({
  parseLista: () => ({ urls: [], invalidas: [] }),
  testarLote: async (urls) => urls.map(url => ({
    url, ok: true, ip: mockIpPorUrl[url] || '', rotativo: false, erro: '',
  })),
}));

const pool = require('../src/services/proxyPool');

beforeEach(() => { mockRegistros.length = 0; for (const k of Object.keys(mockIpPorUrl)) delete mockIpPorUrl[k]; });

test('duas URLs distintas no mesmo IP são reportadas como colisão', async () => {
  mockRegistros.push({ url: 'http://a@h:1' }, { url: 'http://b@h:1' }, { url: 'http://c@h:1' });
  mockIpPorUrl['http://a@h:1'] = '191.1.1.1';
  mockIpPorUrl['http://b@h:1'] = '191.1.1.1';   // mesma saída de a — colisão
  mockIpPorUrl['http://c@h:1'] = '191.2.2.2';

  const r = await pool.testarTodos();

  expect(r.ipsDistintos).toBe(2);
  expect(r.colisoes).toHaveLength(1);
  expect(r.colisoes[0]).toEqual({ ip: '191.1.1.1', quantidade: 2 });
});

test('IPs todos distintos — nenhuma colisão (o estado desejado)', async () => {
  mockRegistros.push({ url: 'http://a@h:1' }, { url: 'http://b@h:1' });
  mockIpPorUrl['http://a@h:1'] = '191.1.1.1';
  mockIpPorUrl['http://b@h:1'] = '191.2.2.2';

  const r = await pool.testarTodos();

  expect(r.ipsDistintos).toBe(2);
  expect(r.colisoes).toHaveLength(0);
});

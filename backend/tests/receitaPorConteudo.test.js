'use strict';

/** Receita por Reel: último toque — a última publicação da conta antes do lead, até 72h. */

const { atribuir } = require('../src/services/receitaPorConteudo');

const h = n => new Date(Date.UTC(2026, 9, 1, 0) + n * 3_600_000).toISOString();
const pubs = [
  { accountId: 'A', igMediaId: 'R1', em: h(0), jobId: 'j1', jobName: 'Lote 1', rotulo: 'Original' },
  { accountId: 'A', igMediaId: 'R2', em: h(10), jobId: 'j2', jobName: 'Lote 2', rotulo: 'Repost' },
  { accountId: 'B', igMediaId: 'R3', em: h(0), jobId: 'j1', jobName: 'Lote 1', rotulo: 'Original' },
];
const insights = new Map([['R1', { reach: 2000, username: 'a' }], ['R2', { reach: 500, username: 'a' }], ['R3', { reach: 1000, username: 'b' }]]);

test('cada lead vai para a última publicação da conta antes dele', () => {
  const leads = [
    { contaId: 'A', primeiro: h(5), etapa: 'comprou', valor: 30 },   // depois de R1, antes de R2 → R1
    { contaId: 'A', primeiro: h(12), etapa: 'comprou', valor: 50 },  // depois de R2 → R2
    { contaId: 'A', primeiro: h(11), etapa: 'checkout' },            // → R2
    { contaId: 'B', primeiro: h(80), etapa: 'comprou', valor: 20 },  // R3 há 80h: fora da janela
    { contaId: null, primeiro: h(1), etapa: 'entrou' },              // sem conta
  ];
  const r = atribuir(leads, pubs, insights);
  const porId = Object.fromEntries(r.reels.map(x => [x.igMediaId, x]));
  expect(porId.R1).toMatchObject({ leads: 1, vendas: 1, receita: 30, receitaPor1k: 15, rotulo: 'Original' });
  expect(porId.R2).toMatchObject({ leads: 2, checkout: 2, vendas: 1, receita: 50, conversao: 50 });
  expect(porId.R3).toBeUndefined();
  expect(r.semAtribuicao).toMatchObject({ leads: 2, vendas: 1, receita: 20 });
  expect(r.cobertura).toBe(60);
  expect(r.reels[0].igMediaId).toBe('R2'); // ordenado por receita
  expect(r.porEtiqueta.map(e => [e.chave, e.receita])).toEqual([['Repost', 50], ['Original', 30]]);
  expect(r.porEnvio.find(e => e.chave === 'j1')).toMatchObject({ jobName: 'Lote 1', receita: 30 });
});

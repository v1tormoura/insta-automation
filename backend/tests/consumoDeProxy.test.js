/**
 * Consumo do proxy.
 *
 * A cota acabou sem aviso porque ninguém a media. Não havia painel, número nem
 * tendência: a primeira notícia foi o serviço parar, e aí já eram quatro dias
 * e meio de produto fora do ar.
 *
 * ── O que estes testes protegem
 *
 * A honestidade do método. Bytes só o fornecedor sabe, e a tentação é estimar
 * um número plausível — que daria uma projeção convincente e ERRADA sobre
 * quando o serviço vai parar. Uma projeção errada é pior que nenhuma, porque
 * ela é confiada.
 */

const mockUso = [];
const mockPlano = { valor: null };

jest.mock('../src/models/ProxyUso', () => ({
  async updateOne(filtro, up) {
    let d = mockUso.find(x => x.dia === filtro.dia);
    if (!d) { d = { dia: filtro.dia, operacoes: 0, porOrigem: { conta: 0, pool: 0, global: 0 } }; mockUso.push(d); }
    for (const [k, v] of Object.entries(up.$inc || {})) {
      if (k.startsWith('porOrigem.')) d.porOrigem[k.split('.')[1]] += v;
      else d[k] = (d[k] || 0) + v;
    }
    return { ok: 1 };
  },
  find: (f) => ({ sort: () => ({ lean: async () => mockUso.filter(d => d.dia >= f.dia.$gte) }) }),
  aggregate: async () => [{ _id: null, n: mockUso.reduce((s, d) => s + d.operacoes, 0) }],
}));

jest.mock('../src/models/Setting', () => ({
  findOne: () => ({ lean: async () => (mockPlano.valor ? { value: mockPlano.valor } : null) }),
  updateOne: async (_f, up) => { mockPlano.valor = up.$set.value; return { ok: 1 }; },
}));

const consumo = require('../src/services/consumoDeProxy');

beforeEach(() => {
  mockUso.length = 0;
  mockPlano.valor = null;
  consumo.bancoConectado = () => true;
});

describe('contagem', () => {
  test('conta a operação e a origem', async () => {
    await consumo.registrar('pool');
    await consumo.registrar('pool');
    await consumo.registrar('global');

    expect(mockUso[0].operacoes).toBe(3);
    expect(mockUso[0].porOrigem.pool).toBe(2);
    expect(mockUso[0].porOrigem.global).toBe(1);
  });

  test('separa por origem porque o diagnóstico muda', async () => {
    /* Mil operações pelo pool são mil IPs distintos; mil pelo global são mil
       saídas do MESMO endereço — o padrão que faz o Instagram sinalizar. O
       total sozinho não distingue os dois. */
    await consumo.registrar('conta');
    expect(mockUso[0].porOrigem.conta).toBe(1);
    expect(mockUso[0].porOrigem.global).toBe(0);
  });

  test('origem desconhecida não vira linha', async () => {
    await consumo.registrar('inventada');
    await consumo.registrar('nenhum');
    expect(mockUso).toHaveLength(0);
  });

  test('sem banco não tenta gravar', async () => {
    consumo.bancoConectado = () => false;
    await consumo.registrar('pool');
    expect(mockUso).toHaveLength(0);
  });
});

describe('projeção', () => {
  test('sem leituras, diz que não sabe em vez de chutar', async () => {
    /* O ponto do módulo inteiro. Um número aqui sem base seria adivinhação com
       cara de medição, e alguém decidiria quando renovar o plano com base
       nele. */
    mockPlano.valor = { totalGb: 50, marcas: [] };
    const p = await consumo.projetar();
    expect(p.conhecido).toBe(false);
    expect(p.motivo).toMatch(/duas vezes/i);
  });

  test('uma leitura só ainda não basta', async () => {
    mockPlano.valor = { totalGb: 50, marcas: [{ em: 'x', usadoGb: 10, operacoes: 100 }] };
    expect((await consumo.projetar()).conhecido).toBe(false);
  });

  test('sem total do plano, também não projeta', async () => {
    mockPlano.valor = { totalGb: 0, marcas: [
      { em: 'a', usadoGb: 1, operacoes: 10 }, { em: 'b', usadoGb: 2, operacoes: 20 }] };
    expect((await consumo.projetar()).conhecido).toBe(false);
  });

  test('duas leituras dão a conversão e os dias restantes', async () => {
    // 100 operações consumiram 1 GB -> 10,24 MB por operação.
    mockUso.push({ dia: consumo.hoje(), operacoes: 50, porOrigem: {} });
    mockPlano.valor = { totalGb: 10, marcas: [
      { em: 'a', usadoGb: 1, operacoes: 100 },
      { em: 'b', usadoGb: 2, operacoes: 200 },
    ] };

    const p = await consumo.projetar();
    expect(p.conhecido).toBe(true);
    expect(p.restanteGb).toBe(8);
    expect(p.percentualUsado).toBe(20);
    expect(p.mbPorOperacao).toBeCloseTo(10.24, 1);
    expect(p.diasRestantes).toBeGreaterThan(0);
  });

  test('leituras sem consumo entre elas não viram divisão por zero', async () => {
    mockPlano.valor = { totalGb: 10, marcas: [
      { em: 'a', usadoGb: 2, operacoes: 100 },
      { em: 'b', usadoGb: 2, operacoes: 200 },
    ] };
    const p = await consumo.projetar();
    expect(p.conhecido).toBe(false);
    expect(p.motivo).toMatch(/não mostram consumo/i);
  });
});

describe('as leituras se acumulam', () => {
  test('cada leitura vira uma marca com a contagem daquele instante', async () => {
    // Sem as duas pontas não há taxa: guardar só a última impediria qualquer
    // cálculo de ritmo.
    await consumo.registrar('pool');
    await consumo.gravarPlano({ totalGb: 20, usadoGb: 1 });
    await consumo.registrar('pool');
    await consumo.gravarPlano({ usadoGb: 3 });

    expect(mockPlano.valor.marcas).toHaveLength(2);
    expect(mockPlano.valor.marcas[0].usadoGb).toBe(1);
    expect(mockPlano.valor.marcas[1].operacoes).toBeGreaterThan(mockPlano.valor.marcas[0].operacoes);
    expect(mockPlano.valor.totalGb).toBe(20);   // preservado sem reenviar
  });
});

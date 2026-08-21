'use strict';

/**
 * Regras de humanização compartilhadas.
 *
 * O que estes testes protegem: nenhuma conta pode receber duas publicações
 * seguidas quando existe alternativa, a ordem das contas não pode ser a mesma
 * em toda rodada, e nenhum atraso pode ser um valor fixo repetido em série —
 * são exatamente os padrões que denunciam automação.
 */

// A fila real abre conexão com o Redis só de ser importada — o executor a
// carrega em cadeia e o processo de teste ficaria pendurado.
jest.mock('../src/queue/postQueue', () => ({
  add: jest.fn(), getJob: jest.fn(), remove: jest.fn(),
}));

const {
  criarRandom, embaralhar, espacarPorConta,
} = require('../src/services/publicationPlanner');

const { _atrasoDoComentario } = require('../src/services/campaignExecutor');

describe('espacarPorConta — nenhuma conta duas vezes seguidas', () => {
  function pares(mapa) {
    const saida = [];
    for (const [accountId, quantidade] of Object.entries(mapa)) {
      for (let i = 0; i < quantidade; i++) saida.push({ accountId, item: `${accountId}-${i}` });
    }
    return saida;
  }

  function repeticoesConsecutivas(sequencia) {
    let repeticoes = 0;
    for (let i = 1; i < sequencia.length; i++) {
      if (sequencia[i].accountId === sequencia[i - 1].accountId) repeticoes++;
    }
    return repeticoes;
  }

  test('lote de 3 mídias × 3 contas sai sem nenhuma repetição', () => {
    const sequencia = espacarPorConta(pares({ a: 3, b: 3, c: 3 }));
    expect(sequencia).toHaveLength(9);
    expect(repeticoesConsecutivas(sequencia)).toBe(0);
  });

  test('carga desigual ainda evita repetições enquanto há alternativa', () => {
    const sequencia = espacarPorConta(pares({ a: 5, b: 2, c: 1 }));
    expect(sequencia).toHaveLength(8);
    // Com 5 de 8 itens numa conta só, o melhor arranjo possível tem 1 repetição.
    expect(repeticoesConsecutivas(sequencia)).toBeLessThanOrEqual(1);
  });

  test('conta única não trava — aceita a repetição em vez de entrar em laço', () => {
    const sequencia = espacarPorConta(pares({ a: 4 }));
    expect(sequencia).toHaveLength(4);
  });

  test('nenhum item é perdido nem duplicado', () => {
    const entrada = pares({ a: 3, b: 4, c: 2 });
    const saida = espacarPorConta(entrada);
    expect(saida.map(p => p.item).sort()).toEqual(entrada.map(p => p.item).sort());
  });

  test('carrega qualquer payload extra — só accountId é lido', () => {
    const entrada = [
      { accountId: 'a', post: { id: 1 }, video: 'x.mp4' },
      { accountId: 'b', post: { id: 2 }, video: 'y.mp4' },
    ];
    const saida = espacarPorConta(entrada);
    expect(saida.every(p => p.post && p.video)).toBe(true);
  });
});

describe('embaralhar — ordem das contas muda a cada rodada', () => {
  const contas = ['a', 'b', 'c', 'd', 'e', 'f'];

  test('mesma seed devolve a mesma ordem (rodada auditável)', () => {
    const um   = embaralhar(contas, criarRandom('job1:0'));
    const dois = embaralhar(contas, criarRandom('job1:0'));
    expect(um).toEqual(dois);
  });

  test('rodadas diferentes do mesmo job produzem ordens diferentes', () => {
    const ordens = [0, 1, 2, 3, 4].map(r => embaralhar(contas, criarRandom(`job1:${r}`)).join(','));
    expect(new Set(ordens).size).toBeGreaterThan(1);
  });

  test('não perde nem duplica contas', () => {
    const saida = embaralhar(contas, criarRandom('seed'));
    expect(saida.slice().sort()).toEqual(contas.slice().sort());
  });

  test('não altera a lista original', () => {
    const original = contas.slice();
    embaralhar(contas, criarRandom('seed'));
    expect(contas).toEqual(original);
  });
});

describe('_atrasoDoComentario — atraso sorteado, não fixo', () => {
  test('fica dentro da faixa configurada', () => {
    for (let i = 0; i < 200; i++) {
      const minutos = _atrasoDoComentario({ delayMinutes: 2, delayMaxMinutes: 6 });
      expect(minutos).toBeGreaterThanOrEqual(2);
      expect(minutos).toBeLessThanOrEqual(6);
    }
  });

  test('produz valores diferentes — é isso que quebra o padrão', () => {
    const valores = new Set();
    for (let i = 0; i < 50; i++) valores.add(_atrasoDoComentario({ delayMinutes: 2, delayMaxMinutes: 6 }));
    expect(valores.size).toBeGreaterThan(10);
  });

  test('teto igual ou menor que o piso mantém o atraso fixo', () => {
    expect(_atrasoDoComentario({ delayMinutes: 3, delayMaxMinutes: 3 })).toBe(3);
    expect(_atrasoDoComentario({ delayMinutes: 5, delayMaxMinutes: 1 })).toBe(5);
  });

  test('padrões do model quando nada é informado', () => {
    const minutos = _atrasoDoComentario({});
    expect(minutos).toBeGreaterThanOrEqual(2);
    expect(minutos).toBeLessThanOrEqual(6);
  });

  test('valores inválidos não viram NaN', () => {
    expect(Number.isFinite(_atrasoDoComentario({ delayMinutes: 'x', delayMaxMinutes: null }))).toBe(true);
    expect(_atrasoDoComentario({ delayMinutes: -5, delayMaxMinutes: -1 })).toBe(0);
  });
});

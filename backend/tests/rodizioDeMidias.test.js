'use strict';

/**
 * Rodízio de mídias entre as contas.
 *
 * O que estes testes protegem: a promessa do modo — toda conta publica TUDO,
 * e em nenhuma rodada duas contas estão com a mesma mídia. E, do outro lado, a
 * garantia de que desligado nada muda: a mesma fatia de antes, igual para
 * todas as contas.
 *
 * O caso que não cabe na promessa (mais contas que mídias) tem teste próprio,
 * porque ali a repetição é aritmética, não defeito — e o código não pode
 * fingir que resolveu.
 */

const { midiasDaRodada, pontosDePartida } = require('../src/services/rodizioDeMidias');

const midias = n => Array.from({ length: n }, (_, i) => 'm' + (i + 1));
const contas = n => Array.from({ length: n }, (_, i) => ({ _id: 'c' + (i + 1) }));

describe('pontos de partida', () => {
  test('espaçamento proporcional: 20 mídias e 10 contas partem de 2 em 2', () => {
    expect(pontosDePartida(20, 10)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  test('o espaçamento é o maior que a fila permite — não 1 por conta', () => {
    /* De 1 em 1, uma rodada de atraso em qualquer conta a põe no conteúdo da
       vizinha. Dividindo a fila pelo número de contas, um atraso não encosta. */
    expect(pontosDePartida(40, 4)).toEqual([0, 10, 20, 30]);
  });

  test('mais contas que mídias: passo 1, e a repetição é aritmética', () => {
    expect(pontosDePartida(3, 10)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });

  test('sem mídia ou sem conta, nada', () => {
    expect(pontosDePartida(0, 5)).toEqual([]);
    expect(pontosDePartida(5, 0)).toEqual([]);
  });
});

describe('desligado — nada muda', () => {
  test('a fatia da rodada, igual para todas as contas', () => {
    const r = midiasDaRodada({ midias: midias(20), contas: contas(3), rodada: 0, porRodada: 2, rodizio: false });
    expect(r.distintas).toEqual(['m1', 'm2']);
    expect([...r.porConta.values()].every(v => v === r.distintas)).toBe(true);
  });

  test('rodada além do fim devolve vazio — quem chama decide se é fim ou recomeço', () => {
    const r = midiasDaRodada({ midias: midias(3), contas: contas(2), rodada: 9, porRodada: 1, rodizio: false });
    expect(r.distintas).toEqual([]);
  });
});

describe('ligado — a promessa do modo', () => {
  const M = midias(20), C = contas(10);

  test('na rodada 0 cada conta pega uma mídia diferente, espaçadas na fila', () => {
    const { distintas, porConta } = midiasDaRodada({ midias: M, contas: C, rodada: 0, porRodada: 1, rodizio: true });
    expect(porConta.get('c1')).toEqual(['m1']);
    expect(porConta.get('c2')).toEqual(['m3']);
    expect(porConta.get('c10')).toEqual(['m19']);
    expect(distintas).toHaveLength(10);
  });

  test('NUNCA duas contas com a mesma mídia na mesma rodada', () => {
    for (let r = 0; r < 20; r++) {
      const todas = [...midiasDaRodada({ midias: M, contas: C, rodada: r, porRodada: 1, rodizio: true }).porConta.values()].flat();
      expect(new Set(todas).size).toBe(todas.length);
    }
  });

  test('ao fim do ciclo, toda conta publicou TODAS as mídias — nada se perde', () => {
    const vistos = new Map(C.map(c => [c._id, new Set()]));
    for (let r = 0; r < 20; r++) {
      for (const [id, ms] of midiasDaRodada({ midias: M, contas: C, rodada: r, porRodada: 1, rodizio: true }).porConta) {
        ms.forEach(m => vistos.get(id).add(m));
      }
    }
    for (const s of vistos.values()) expect(s.size).toBe(20);
  });

  test('o total de publicações é o mesmo dos dois modos', () => {
    const conta = (rodizio) => {
      let n = 0;
      for (let r = 0; r < 20; r++) {
        for (const ms of midiasDaRodada({ midias: M, contas: C, rodada: r, porRodada: 1, rodizio }).porConta.values()) n += ms.length;
      }
      return n;
    };
    expect(conta(true)).toBe(200);
    expect(conta(false)).toBe(200);
  });

  test('a fila dá a volta: passado o fim, a conta recomeça do começo', () => {
    const { porConta } = midiasDaRodada({ midias: M, contas: C, rodada: 2, porRodada: 1, rodizio: true });
    expect(porConta.get('c10')).toEqual(['m1']);   // partiu de m19, deu a volta
  });

  test('mais de uma mídia por rodada: cada conta leva as suas, em sequência', () => {
    const { porConta, distintas } = midiasDaRodada({ midias: M, contas: contas(2), rodada: 0, porRodada: 3, rodizio: true });
    expect(porConta.get('c1')).toEqual(['m1', 'm2', 'm3']);
    expect(porConta.get('c2')).toEqual(['m11', 'm12', 'm13']);
    expect(distintas).toEqual(['m1', 'm2', 'm3', 'm11', 'm12', 'm13']);   // na ordem da fila
  });

  test('mais contas que mídias: reparte o melhor possível, sem quebrar', () => {
    const { porConta } = midiasDaRodada({ midias: midias(3), contas: contas(5), rodada: 0, porRodada: 1, rodizio: true });
    expect([...porConta.values()].flat()).toEqual(['m1', 'm2', 'm3', 'm1', 'm2']);
  });

  test('entrada vazia não quebra', () => {
    expect(midiasDaRodada({ midias: [], contas: contas(3), rodizio: true }).distintas).toEqual([]);
    expect(midiasDaRodada({ midias: midias(3), contas: [], rodizio: true }).distintas).toEqual([]);
    expect(midiasDaRodada({}).distintas).toEqual([]);
  });

  test('aceita conta como id cru, não só como documento', () => {
    const { porConta } = midiasDaRodada({ midias: midias(4), contas: ['a', 'b'], rodada: 0, porRodada: 1, rodizio: true });
    expect(porConta.get('a')).toEqual(['m1']);
    expect(porConta.get('b')).toEqual(['m3']);
  });
});

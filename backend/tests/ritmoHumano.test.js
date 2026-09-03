'use strict';

/**
 * O ritmo das publicações.
 *
 * O defeito que motivou o módulo: o Loop agendava a próxima rodada em
 * `agora + intervalo`, exato. Um post a cada 40min00s, para sempre — e essa
 * regularidade se detecta contando timestamps, sem olhar o conteúdo. O motor
 * de Jobs já tinha jitter de ±12%; o Loop não tinha nenhum.
 */

const {
  comJitter, intervaloEntreContas, embaralharContas, rodizio, proximaRodada,
} = require('../src/services/ritmoHumano');

/** Gerador de sequência fixa, para o teste não depender de sorte. */
const fixo = (...valores) => {
  let i = 0;
  return () => valores[i++ % valores.length];
};

describe('jitter', () => {
  test('o mínimo do sorteio é base menos a amplitude', () => {
    expect(comJitter(100_000, { amplitude: 0.12, aleatorio: () => 0, pisoMs: 0 })).toBe(88_000);
  });

  test('o máximo do sorteio é base mais a amplitude', () => {
    expect(comJitter(100_000, { amplitude: 0.12, aleatorio: () => 0.999999, pisoMs: 0 }))
      .toBeCloseTo(112_000, -1);
  });

  test('o meio do sorteio é a base', () => {
    /* Simétrico de propósito. Jitter só para cima empurraria a média, e quem
       pediu 40 min passaria a ter 44 sem nunca ter pedido. */
    expect(comJitter(100_000, { amplitude: 0.12, aleatorio: () => 0.5, pisoMs: 0 })).toBe(100_000);
  });

  test('a média de muitos sorteios fica na base', () => {
    let soma = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) soma += comJitter(600_000, { pisoMs: 0 });
    const media = soma / N;
    // ±1% é folga suficiente para 20 mil amostras e apertado o bastante para
    // pegar um jitter assimétrico.
    expect(media).toBeGreaterThan(600_000 * 0.99);
    expect(media).toBeLessThan(600_000 * 1.01);
  });

  test('o piso protege intervalos curtos', () => {
    expect(comJitter(10_000, { pisoMs: 60_000, aleatorio: () => 0 })).toBe(60_000);
  });

  test('entrada inválida cai no piso em vez de virar NaN', () => {
    /* `new Date(NaN)` é uma data inválida: o loop gravaria `nextRunAt` inválido
       e a consulta `nextRunAt <= now` nunca mais o encontraria — o loop pararia
       de rodar em silêncio, para sempre. */
    for (const ruim of [undefined, null, 'x', NaN, -5, 0]) {
      const r = comJitter(ruim, { pisoMs: 60_000 });
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBe(60_000);
    }
  });
});

describe('próxima rodada do loop', () => {
  test('não é mais o intervalo exato', () => {
    /* O teste que descreve o defeito original: duas rodadas seguidas com o
       mesmo intervalo configurado não podem cair no mesmo milissegundo. */
    const agora = 1_700_000_000_000;
    const vistos = new Set();
    for (let i = 0; i < 200; i++) {
      vistos.add(proximaRodada(40, { agora }).getTime());
    }
    expect(vistos.size).toBeGreaterThan(50);
  });

  test('fica dentro de ±12% do intervalo pedido', () => {
    const agora = 1_700_000_000_000;
    const base = 40 * 60_000;
    for (let i = 0; i < 500; i++) {
      const delta = proximaRodada(40, { agora }).getTime() - agora;
      expect(delta).toBeGreaterThanOrEqual(base * 0.88 - 1);
      expect(delta).toBeLessThanOrEqual(base * 1.12 + 1);
    }
  });

  test('devolve uma data válida sempre', () => {
    for (const ruim of [undefined, null, 0, -3, 'abc']) {
      const d = proximaRodada(ruim);
      expect(d instanceof Date).toBe(true);
      expect(Number.isNaN(d.getTime())).toBe(false);
    }
  });

  test('intervalo de 1 minuto continua sendo cerca de 1 minuto', () => {
    /* O piso não pode transformar em silêncio o intervalo pedido em outro:
       o loop aceita `intervalMinutes: 1`. */
    const agora = Date.now();
    const delta = proximaRodada(1, { agora }).getTime() - agora;
    expect(delta).toBeGreaterThanOrEqual(60_000 - 1);
    expect(delta).toBeLessThanOrEqual(60_000 * 1.12 + 1);
  });
});

describe('intervalo entre contas', () => {
  test('fica entre 3 e 7 minutos', () => {
    for (let i = 0; i < 1000; i++) {
      const ms = intervaloEntreContas();
      expect(ms).toBeGreaterThanOrEqual(180_000);
      expect(ms).toBeLessThanOrEqual(420_000);
    }
  });

  test('as pontas são alcançáveis', () => {
    expect(intervaloEntreContas({ aleatorio: () => 0 })).toBe(180_000);
    expect(intervaloEntreContas({ aleatorio: () => 0.999999 })).toBeGreaterThan(419_000);
  });
});

describe('ordem das contas', () => {
  test('embaralhar mantém todos os elementos', () => {
    const contas = ['a', 'b', 'c', 'd', 'e'];
    const r = embaralharContas(contas, fixo(0.9, 0.1, 0.7, 0.3));
    expect([...r].sort()).toEqual([...contas].sort());
  });

  test('embaralhar não altera o array recebido', () => {
    /* O chamador guarda essa lista no documento. Embaralhar no lugar mudaria
       a ordem gravada no banco como efeito colateral de uma leitura. */
    const contas = ['a', 'b', 'c'];
    embaralharContas(contas, fixo(0.9, 0.1));
    expect(contas).toEqual(['a', 'b', 'c']);
  });

  test('rodízio faz cada conta abrir a rodada na sua vez', () => {
    /* O sorteio sozinho, com duas contas, acerta a mesma primeira metade das
       vezes. Sem o rodízio uma conta pode ficar semanas sempre em segundo,
       publicando sempre com o mesmo atraso em relação à outra. */
    const contas = ['a', 'b', 'c'];
    expect(rodizio(contas, 0)[0]).toBe('a');
    expect(rodizio(contas, 1)[0]).toBe('b');
    expect(rodizio(contas, 2)[0]).toBe('c');
    expect(rodizio(contas, 3)[0]).toBe('a');
  });

  test('rodízio preserva todas as contas', () => {
    const contas = ['a', 'b', 'c', 'd'];
    expect([...rodizio(contas, 7)].sort()).toEqual(contas);
  });

  test('rodízio com uma conta ou vazio não quebra', () => {
    expect(rodizio(['a'], 5)).toEqual(['a']);
    expect(rodizio([], 5)).toEqual([]);
    expect(rodizio(null, 5)).toEqual([]);
  });

  test('rodada negativa ou inválida não sai do array', () => {
    const contas = ['a', 'b', 'c'];
    for (const r of [-1, NaN, undefined, 'x']) {
      expect(contas).toContain(rodizio(contas, r)[0]);
      expect(rodizio(contas, r)).toHaveLength(3);
    }
  });
});

describe('o loop usa o módulo', () => {
  test('nenhum nextRunAt cru sobrou no loopJob', () => {
    /* O defeito estava em QUATRO lugares do mesmo arquivo — corrigir três e
       esquecer um deixaria o caminho de erro sem jitter, que é justamente o
       que mais repete. */
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '../src/jobs/loopJob.js'), 'utf8'
    );
    expect(fonte).not.toContain('intervalMinutes * 60 * 1000');
    expect(fonte).toContain('proximaRodada');
  });
});

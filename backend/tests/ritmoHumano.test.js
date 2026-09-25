'use strict';

/**
 * O ritmo das publicações.
 *
 * O defeito que motivou o módulo: o Loop agendava a próxima rodada em
 * `agora + intervalo`, exato. Um post a cada 40min00s, para sempre — e essa
 * regularidade se detecta contando timestamps, sem olhar o conteúdo. O motor
 * de Jobs já tinha jitter de ±12%; o Loop não tinha nenhum.
 */

const { comJitter } = require('../src/services/ritmoHumano');

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

describe('o worker usa o módulo', () => {
  test('a próxima rodada do envio sai com jitter, não com o intervalo exato', () => {
    const fonte = require('fs').readFileSync(require('path').resolve(__dirname, '../src/worker.js'), 'utf8');
    expect(fonte).toContain("require('./services/ritmoHumano')");
    expect(fonte).toMatch(/comJitter\(\(job\.intervalMinutes/);
  });
});

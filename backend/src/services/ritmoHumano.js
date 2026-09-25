'use strict';

/**
 * O ritmo das publicações: jitter simétrico sobre o intervalo pedido.
 *
 * Um post a cada 40min00s, para sempre, na mesma conta, é o tipo de
 * regularidade que se detecta contando timestamps. O worker agenda a próxima
 * rodada com ±12% em volta do intervalo configurado.
 */

/**
 * Aplica jitter simétrico a um intervalo.
 *
 * Simétrico de propósito: jitter só para cima empurra a média para cima e o
 * intervalo configurado deixa de ser o que acontece na prática — quem pediu
 * 40 min passaria a ter 44. Assim a média continua sendo a configurada, e o
 * que muda é a previsibilidade.
 *
 * @param {number} baseMs    Intervalo pedido.
 * @param {number} amplitude Fração do desvio (0.12 = ±12%).
 * @param {number} pisoMs    Nunca menos que isto, mesmo que o sorteio peça.
 */
function comJitter(baseMs, { amplitude = 0.12, pisoMs = 60_000, aleatorio = Math.random } = {}) {
  const base = Number(baseMs);
  if (!Number.isFinite(base) || base <= 0) return pisoMs;
  const fator = 1 + ((aleatorio() * 2 * amplitude) - amplitude);
  return Math.max(pisoMs, Math.round(base * fator));
}

module.exports = { comJitter };

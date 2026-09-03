'use strict';

/**
 * O ritmo das publicações — um lugar só.
 *
 * ── Por que centralizar
 *
 * As três formas de publicar (Loop, Postar, Campanha) chegaram ao produto em
 * momentos diferentes e cada uma inventou o próprio ritmo:
 *
 *   - o motor de Jobs sorteia a ordem das contas e espera de 2 a 5 min entre
 *     publicações, e agenda a rodada seguinte com jitter de ±12%;
 *   - o caminho legado (que é por onde o Loop passa) sorteia a ordem e espera
 *     de 3 a 7 min;
 *   - o Loop agendava a próxima rodada em `agora + intervalo`, exato, sem
 *     jitter nenhum.
 *
 * O último é o que aparece de fora: um post a cada 40min00s, para sempre, na
 * mesma conta. Nenhuma pessoa publica assim, e é o tipo de regularidade que se
 * detecta contando timestamps — não é preciso olhar o conteúdo.
 *
 * ── O que este módulo NÃO faz
 *
 * Não promete que o Instagram não vá sinalizar a conta. Ritmo irregular tira
 * um sinal da mesa; não tira os outros (mesma mídia em várias contas, volume,
 * idade da conta, proxy). Ver `intervaloEntreContas` para o segundo sinal.
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

/**
 * Quanto esperar entre publicar numa conta e na seguinte.
 *
 * Duas contas publicando no mesmo minuto, com a mesma mídia, é o padrão mais
 * fácil de casar do lado do Instagram: não depende de analisar o conteúdo,
 * basta correlacionar horários. O intervalo entre contas é o que quebra essa
 * correlação.
 *
 * De 3 a 7 minutos porque é a faixa que o caminho legado já usava e que
 * funcionou até aqui — e mexer nela sem dado é trocar um número testado por um
 * palpite.
 */
function intervaloEntreContas({ aleatorio = Math.random } = {}) {
  const MIN_MS = 180_000;   // 3 min
  const MAX_MS = 420_000;   // 7 min
  return Math.floor(aleatorio() * (MAX_MS - MIN_MS)) + MIN_MS;
}

/**
 * A ordem das contas nesta rodada.
 *
 * Publicar sempre na ordem gravada repete a mesma sequência a cada rodada — e
 * a sequência é tão característica quanto o intervalo. Fisher-Yates com
 * gerador injetável para o teste poder fixar a semente.
 */
function embaralharContas(contas, aleatorio = Math.random) {
  const copia = [...contas];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Qual conta abre a rodada, para o rodízio não ter sempre a mesma primeira.
 *
 * O sorteio já muda a ordem, mas com duas contas ele acerta a mesma primeira
 * metade das vezes. O rodízio garante que, ao longo de N rodadas, cada conta
 * abre N/contas vezes — sem isso, uma conta pode ficar semanas sempre em
 * segundo, publicando sempre com o mesmo atraso em relação à outra.
 *
 * @param {number} rodada  Contador que só cresce (`postsCount` do loop).
 */
function rodizio(contas, rodada) {
  if (!Array.isArray(contas) || contas.length < 2) return contas || [];
  const inicio = Math.abs(Number(rodada) || 0) % contas.length;
  return [...contas.slice(inicio), ...contas.slice(0, inicio)];
}

/**
 * O horário da próxima rodada de um loop.
 *
 * @param {number} intervalMinutes  O que a pessoa configurou.
 * @returns {Date}
 */
function proximaRodada(intervalMinutes, { agora = Date.now(), aleatorio = Math.random } = {}) {
  const baseMs = Math.max(1, Number(intervalMinutes) || 1) * 60_000;
  /* Piso de 1 minuto e não os 60s do padrão: o loop aceita `intervalMinutes: 1`
     e um piso maior transformaria em silêncio o intervalo pedido em outro. */
  return new Date(agora + comJitter(baseMs, { amplitude: 0.12, pisoMs: 60_000, aleatorio }));
}

module.exports = {
  comJitter,
  intervaloEntreContas,
  embaralharContas,
  rodizio,
  proximaRodada,
};

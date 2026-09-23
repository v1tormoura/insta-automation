'use strict';

/**
 * Qual mídia cada conta publica nesta rodada.
 *
 * ── O que existia
 *
 * Uma rodada pegava `porRodada` mídias e publicava CADA UMA em TODAS as
 * contas. Com 20 mídias e 10 contas, a rodada 0 mandava a mídia 1 para as dez
 * — as dez contas subindo o mesmo reel no mesmo intervalo de tempo. Para quem
 * olha de fora (e para quem calcula risco do lado do Instagram), dez perfis
 * que publicam sempre a mesma coisa na mesma hora são um perfil só, dez vezes.
 *
 * ── O rodízio
 *
 * Cada conta percorre a MESMA fila de mídias, mas começando de um ponto
 * diferente dela. Com 20 mídias e 10 contas, os pontos de partida ficam de
 * dois em dois: a conta 1 começa na mídia 1, a conta 2 na 3, a conta 3 na 5…
 * Na rodada seguinte todas avançam uma casa, sempre mantendo a distância.
 *
 * O resultado: toda conta publica todas as mídias (nada se perde, o total é o
 * mesmo — 20 × 10 = 200), e em nenhum momento duas contas estão com o mesmo
 * reel. O ciclo fecha quando cada uma deu a volta completa.
 *
 * ── Por que o espaçamento é proporcional, e não 1 por conta
 *
 * Com 10 contas e 20 mídias, avançar de 1 em 1 deixaria as contas 1 e 2
 * separadas por uma única mídia — e uma rodada de atraso em qualquer uma põe
 * as duas no mesmo conteúdo. Dividindo a fila pelo número de contas, a
 * distância entre vizinhas é a maior possível, e um atraso não as encosta.
 *
 * Mais contas que mídias é o caso em que a promessa não cabe: com 3 mídias e
 * 10 contas, alguma repetição é aritmética, não escolha. Aí o espaçamento vira
 * 1 e as contas se distribuem o melhor que a fila permite.
 */

/** O ponto de partida de cada conta na fila de mídias. */
function pontosDePartida(totalDeMidias, totalDeContas) {
  const m = Math.max(0, Math.floor(totalDeMidias) || 0);
  const c = Math.max(0, Math.floor(totalDeContas) || 0);
  if (!m || !c) return [];
  const passo = Math.max(1, Math.floor(m / c));
  return Array.from({ length: c }, (_, i) => (i * passo) % m);
}

/**
 * O que cada conta publica nesta rodada.
 *
 * @param {object} p
 * @param {string[]} p.midias      a fila de mídias, na ordem já definida pelo envio
 * @param {Array}    p.contas      as contas do envio, na ordem estável dele
 * @param {number}   p.rodada      0-based
 * @param {number}   p.porRodada   quantas mídias cada conta publica por rodada
 * @param {boolean}  p.rodizio     false = comportamento de sempre (mesma mídia para todas)
 * @returns {{ distintas: string[], porConta: Map<string, string[]> }}
 *   `distintas` é o que a rodada precisa preparar (converter, gerar Post);
 *   `porConta` diz, para cada id de conta, quais mídias são dela nesta rodada.
 */
function midiasDaRodada({ midias = [], contas = [], rodada = 0, porRodada = 1, rodizio = false } = {}) {
  const fila = Array.isArray(midias) ? midias : [];
  const lista = Array.isArray(contas) ? contas : [];
  const n = Math.max(1, Math.floor(porRodada) || 1);
  const r = Math.max(0, Math.floor(rodada) || 0);
  const porConta = new Map();
  if (!fila.length || !lista.length) return { distintas: [], porConta };

  const idDe = c => String(c && (c._id || c.id || c));

  if (!rodizio) {
    /* O de sempre: a fatia da rodada, igual para todas as contas. Fatia vazia
       (a fila acabou) devolve vazio — quem chama decide se é fim ou recomeço. */
    const inicio = r * n;
    const distintas = fila.slice(inicio, inicio + n);
    for (const c of lista) porConta.set(idDe(c), distintas);
    return { distintas, porConta };
  }

  const partidas = pontosDePartida(fila.length, lista.length);
  const usadas = new Set();
  lista.forEach((c, i) => {
    const daConta = [];
    for (let k = 0; k < n; k++) {
      /* O módulo faz a conta dar a volta na fila — é o que mantém o rodízio
         girando sem que alguém fique sem mídia no fim da lista. */
      const idx = (r * n + partidas[i] + k) % fila.length;
      daConta.push(fila[idx]);
      usadas.add(fila[idx]);
    }
    porConta.set(idDe(c), daConta);
  });

  /* Na ordem da fila, e não na de inserção: o preparo converte nessa ordem, e
     ver o log seguir a fila é mais fácil de conferir do que vê-lo pular. */
  const distintas = fila.filter(m => usadas.has(m));
  return { distintas, porConta };
}

module.exports = { midiasDaRodada, pontosDePartida };

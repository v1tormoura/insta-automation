'use strict';

/**
 * Demografia de uma conta pela API oficial — `reached_audience_demographics`
 * (quem o conteúdo alcançou), `engaged_audience_demographics` (quem interagiu)
 * e `follower_demographics` (quem segue). Usada pelo mapa do Dashboard e pela
 * tela de Público.
 *
 * ── O formato
 *
 * Nesses recortes a Meta põe o PERÍODO como primeira dimensão:
 *
 *   dimension_keys:   ['timeframe', 'city']
 *   dimension_values: ['THIS_MONTH', 'Recife, Pernambuco (state)']
 *
 * Ler `dimension_values[0]` como se fosse a cidade dava "THIS_MONTH" para toda
 * linha — nenhuma cidade era reconhecida e toda conta aparecia "sem dados",
 * mesmo com milhares de seguidores.
 *
 * ── O período
 *
 * Desde a v20 da Graph, essas métricas só aceitam `this_week` e `this_month`;
 * `last_30_days`, `last_90_days` e `prev_month` voltam erro de parâmetro. O
 * período pedido é tentado primeiro e, se a Meta recusar, o mais próximo que
 * ela aceita — e a resposta diz qual valeu.
 */

const EH_PERIODO = /^(THIS|LAST|PREV)_[A-Z0-9_]+$/;

/** Os valores de uma linha sem a dimensão do período, na ordem em que vieram. */
function semPeriodo(resultado, chaves) {
  const valores = resultado?.dimension_values || [];
  if (Array.isArray(chaves) && chaves.length === valores.length) {
    return valores.filter((_, i) => chaves[i] !== 'timeframe');
  }
  return valores.filter(v => !EH_PERIODO.test(String(v)));
}

/** `total_value.breakdowns[0]` da Graph em `[{ valores: [...], valor }]`, sem o período. */
function linhas(resposta) {
  const b = resposta?.data?.[0]?.total_value?.breakdowns?.[0];
  if (!b || !Array.isArray(b.results)) return [];
  return b.results.map(r => ({ valores: semPeriodo(r, b.dimension_keys), valor: Number(r.value) || 0 }));
}

/* O que tentar quando a Meta recusa o período pedido. `null` = sem timeframe
   (o follower_demographics, em algumas versões, não aceita nenhum). */
const ALTERNATIVAS = Object.freeze({
  this_week: ['this_month'],
  this_month: ['this_week'],
  last_14_days: ['this_month', 'this_week'],
  last_30_days: ['this_month', 'this_week'],
  last_90_days: ['this_month', 'this_week'],
  prev_month: ['this_month', 'this_week'],
});

/** Erro de parâmetro (código 100): vale tentar outra combinação. Token, permissão e limite não. */
const recusouParametro = err => Number(err?.code) === 100;

/**
 * Pede uma métrica demográfica com uma quebra (city, country, gender, age).
 * @returns {Promise<{ linhas: Array<{valores: string[], valor: number}>, timeframe: string|null }>}
 * @throws o erro da Meta quando nenhuma combinação foi aceita
 */
async function pedir(conta, metrica, breakdown, timeframe = 'this_month') {
  const { get } = require('./instagramAPI');
  const tentativas = [...new Set([timeframe, ...(ALTERNATIVAS[timeframe] || ['this_month']),
    ...(metrica === 'follower_demographics' ? [null] : [])])];
  let ultimo;
  for (const tf of tentativas) {
    try {
      const r = await get(`/${conta.igUserId}/insights`, {
        metric: metrica, period: 'lifetime', metric_type: 'total_value', breakdown,
        ...(tf ? { timeframe: tf } : {}),
      }, conta.accessToken);
      return { linhas: linhas(r), timeframe: tf };
    } catch (err) {
      ultimo = err;
      if (!recusouParametro(err)) break;
    }
  }
  throw ultimo;
}

module.exports = { pedir, linhas, semPeriodo, EH_PERIODO, ALTERNATIVAS };

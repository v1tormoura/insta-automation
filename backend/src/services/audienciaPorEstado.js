'use strict';

/**
 * Audiência por estado — para o mapa do Dashboard.
 *
 * A API oficial não entrega "views por estado". O que ela entrega é a
 * demografia da conta por CIDADE (`breakdown=city`), em três recortes:
 *
 *   alcancados  → reached_audience_demographics  (quem viu o conteúdo)
 *   engajados   → engaged_audience_demographics  (quem interagiu)
 *   seguidores  → follower_demographics          (quem segue)
 *
 * A cidade vem como "Cidade, Estado (state)"; aqui ela é somada no estado.
 * Números reais da Meta, sem estimativa. Contas com menos de 100 seguidores
 * não têm demografia — a Meta recusa, e elas entram como "sem dados".
 *
 * Cache de 6 h por conta e recorte: a Meta só atualiza isso uma vez por dia.
 */

const { get } = require('./instagramAPI');

const METRICAS = Object.freeze({
  alcancados: 'reached_audience_demographics',
  engajados: 'engaged_audience_demographics',
  seguidores: 'follower_demographics',
});

const CACHE_MS = 6 * 60 * 60 * 1000;
const _cache = new Map();

const sem = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Nome do estado (como a Meta escreve) → sigla. */
const UF = Object.freeze(Object.fromEntries([
  ['Acre', 'ac'], ['Alagoas', 'al'], ['Amapá', 'ap'], ['Amazonas', 'am'], ['Bahia', 'ba'], ['Ceará', 'ce'],
  ['Distrito Federal', 'df'], ['Federal District', 'df'], ['Espírito Santo', 'es'], ['Goiás', 'go'], ['Maranhão', 'ma'],
  ['Mato Grosso', 'mt'], ['Mato Grosso do Sul', 'ms'], ['Minas Gerais', 'mg'], ['Pará', 'pa'], ['Paraíba', 'pb'],
  ['Paraná', 'pr'], ['Pernambuco', 'pe'], ['Piauí', 'pi'], ['Rio de Janeiro', 'rj'], ['Rio Grande do Norte', 'rn'],
  ['Rio Grande do Sul', 'rs'], ['Rondônia', 'ro'], ['Roraima', 'rr'], ['Santa Catarina', 'sc'], ['São Paulo', 'sp'],
  ['Sergipe', 'se'], ['Tocantins', 'to'],
].map(([nome, uf]) => [sem(nome), uf])));

/** "Campinas, São Paulo (state)" → "sp". `null` fora do Brasil ou irreconhecível. */
function ufDaCidade(rotulo) {
  const partes = String(rotulo || '').split(',');
  if (partes.length < 2) return null;
  const estado = partes[partes.length - 1].replace(/\((state|estado)\)/i, '');
  return UF[sem(estado)] || null;
}

/** Soma por estado as linhas `{dimension_values: [cidade], value}` da Meta. */
function somarPorEstado(resultados = []) {
  const porUf = {};
  for (const r of resultados) {
    const uf = ufDaCidade(r?.dimension_values?.[0]);
    const v = Number(r?.value) || 0;
    if (uf && v > 0) porUf[uf] = (porUf[uf] || 0) + v;
  }
  return porUf;
}

async function _daConta(conta, metrica) {
  const chave = `${conta.id}:${metrica}`;
  const c = _cache.get(chave);
  if (c && Date.now() - c.em < CACHE_MS) return c.valor;
  const d = await get(`/${conta.igUserId}/insights`, {
    metric: METRICAS[metrica], period: 'lifetime', metric_type: 'total_value',
    breakdown: 'city', timeframe: 'this_month',
  }, conta.accessToken);
  const resultados = d?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  const valor = somarPorEstado(resultados);
  _cache.set(chave, { em: Date.now(), valor });
  return valor;
}

/**
 * @param {Array} contas  — contas do usuário (com token)
 * @param {string} metrica — alcancados | engajados | seguidores
 */
async function doUsuario(contas, metrica = 'alcancados') {
  if (!METRICAS[metrica]) metrica = 'alcancados';
  const estados = {};
  let comDados = 0, semDados = 0;
  const conectadas = contas.filter(c => c.accessToken && c.igUserId && c.status !== 'banida');
  await Promise.all(conectadas.map(async conta => {
    try {
      const porUf = await _daConta(conta, metrica);
      if (!Object.keys(porUf).length) { semDados++; return; }
      comDados++;
      for (const [uf, v] of Object.entries(porUf)) estados[uf] = (estados[uf] || 0) + v;
    } catch (err) {
      semDados++;
      console.log(`[Audiência] @${conta.username}: ${err.message}`);
    }
  }));
  const total = Object.values(estados).reduce((a, b) => a + b, 0);
  return { metrica, estados, total, contasComDados: comDados, contasSemDados: semDados, atualizadoEm: new Date().toISOString() };
}

module.exports = { doUsuario, somarPorEstado, ufDaCidade, METRICAS, _cache };

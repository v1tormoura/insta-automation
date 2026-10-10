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
 * Números reais da Meta, sem estimativa. O formato da resposta e o período
 * que a Meta aceita estão em demografiaDaMeta.js.
 *
 * Cada conta volta com a sua situação — no mapa, poucos seguidores, sem
 * público no Brasil no mês, ou o erro exato da Meta. Antes tudo isso aparecia
 * como "menos de 100 seguidores", e um defeito de leitura passou meses por
 * falta de audiência.
 *
 * Cache por conta e recorte: 6 h com dados (a Meta atualiza uma vez por dia),
 * 30 min sem dados (a conta pode passar da linha), erro não fica guardado.
 */

const demografia = require('./demografiaDaMeta');

const METRICAS = Object.freeze({
  alcancados: 'reached_audience_demographics',
  engajados: 'engaged_audience_demographics',
  seguidores: 'follower_demographics',
});

const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_VAZIO_MS = 30 * 60 * 1000;
const MINIMO_SEGUIDORES = 100;
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

/**
 * A cidade de uma linha da Meta: o valor que for "Cidade, Estado". Não depende
 * da posição — o período ("THIS_MONTH") pode vir antes dela.
 */
function cidadeDa(valores = []) {
  return valores.find(v => ufDaCidade(v)) || valores.find(v => String(v).includes(',')) || valores[valores.length - 1] || '';
}

/** Soma por estado as linhas `{dimension_values: [..., cidade], value}` da Meta. */
function somarPorEstado(resultados = []) {
  const porUf = {};
  for (const r of resultados) {
    const uf = ufDaCidade(cidadeDa(demografia.semPeriodo(r)));
    const v = Number(r?.value) || 0;
    if (uf && v > 0) porUf[uf] = (porUf[uf] || 0) + v;
  }
  return porUf;
}

/** `{ porUf, cidades }` da conta: `cidades` é quantas a Meta devolveu (no Brasil ou fora). */
async function _daConta(conta, metrica) {
  const chave = `${conta.id}:${metrica}`;
  const c = _cache.get(chave);
  if (c && Date.now() - c.em < c.validade) return c.valor;
  const { linhas } = await demografia.pedir(conta, METRICAS[metrica], 'city', 'this_month');
  const porUf = {};
  for (const l of linhas) {
    const uf = ufDaCidade(cidadeDa(l.valores));
    if (uf && l.valor > 0) porUf[uf] = (porUf[uf] || 0) + l.valor;
  }
  const valor = { porUf, cidades: linhas.length };
  _cache.set(chave, { em: Date.now(), valor, validade: Object.keys(porUf).length ? CACHE_MS : CACHE_VAZIO_MS });
  return valor;
}

/**
 * @param {Array} contas  — contas do usuário (com token)
 * @param {string} metrica — alcancados | engajados | seguidores
 */
async function doUsuario(contas, metrica = 'alcancados') {
  if (!METRICAS[metrica]) metrica = 'alcancados';
  const estados = {};
  const situacoes = [];
  const conectadas = contas.filter(c => c.accessToken && c.igUserId && c.status !== 'banida');
  await Promise.all(conectadas.map(async conta => {
    const quem = { username: conta.username, seguidores: Number(conta.followers) || 0 };
    try {
      const { porUf, cidades } = await _daConta(conta, metrica);
      if (Object.keys(porUf).length) {
        situacoes.push({ ...quem, situacao: 'ok' });
        for (const [uf, v] of Object.entries(porUf)) estados[uf] = (estados[uf] || 0) + v;
      } else if (cidades) {
        situacoes.push({ ...quem, situacao: 'fora_do_brasil' });
      } else {
        situacoes.push({ ...quem, situacao: quem.seguidores < MINIMO_SEGUIDORES ? 'poucos_seguidores' : 'sem_dados' });
      }
    } catch (err) {
      situacoes.push({ ...quem, situacao: 'erro', erro: err.message });
      console.log(`[Audiência] @${conta.username}: ${err.message}`);
    }
  }));
  situacoes.sort((a, b) => b.seguidores - a.seguidores);
  const total = Object.values(estados).reduce((a, b) => a + b, 0);
  const comDados = situacoes.filter(s => s.situacao === 'ok').length;
  return {
    metrica, estados, total,
    contasComDados: comDados, contasSemDados: situacoes.length - comDados,
    contas: situacoes,
    atualizadoEm: new Date().toISOString(),
  };
}

module.exports = { doUsuario, somarPorEstado, ufDaCidade, cidadeDa, METRICAS, MINIMO_SEGUIDORES, _cache };

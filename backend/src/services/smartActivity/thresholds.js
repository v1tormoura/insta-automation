'use strict';

/**
 * Marcos de métrica — a configuração central.
 *
 * ── Por que não ficam espalhados no código
 *
 * Um número de marco escrito dentro do detector é um número que só muda com
 * deploy. Aqui eles são dados: a lista padrão vive neste arquivo, e o painel
 * pode sobrescrevê-la gravando em `Setting`, sem tocar em nada.
 *
 * ── Por que a leitura tolera o banco fora do ar
 *
 * Este módulo é chamado no fim de cada ciclo de sincronização, que roda em
 * segundo plano. Sem conexão, o Mongoose ENFILEIRA a consulta e só desiste
 * depois de `bufferTimeoutMS` — dez segundos por padrão. Travar a sincronização
 * de métricas por dez segundos para descobrir uma lista de números seria um
 * mau negócio; sem banco, o padrão serve.
 */

const CHAVE = 'smartActivity';

/**
 * Padrões. Escolhidos para a curva ser densa onde o crescimento é lento e
 * esparsa onde ele é rápido: os primeiros marcos de story chegam em minutos e
 * são o que dá sensação de movimento; os últimos levam dias e não deveriam
 * disparar a cada mil visualizações.
 */
const PADRAO = Object.freeze({
  thresholds: Object.freeze({
    storyViews:   Object.freeze([30, 50, 100, 250, 500, 1000, 2500, 5000, 10000]),
    contentViews: Object.freeze([100, 500, 1000, 5000, 10000, 25000, 50000, 100000]),
    reach:        Object.freeze([500, 1000, 5000, 10000, 50000, 100000]),
  }),

  /** O que está ligado. Desligado não detecta — nem grava histórico. */
  ativos: Object.freeze({
    storyViews: true,
    contentViews: true,
    reach: false,
    global: false,      // preparado, desligado por padrão (§28)
  }),

  /** Aparência e comportamento do aviso na tela. */
  exibicao: Object.freeze({
    duracaoMs: 6000,
    posicao: 'topo-direita',
    som: false,
    maxSimultaneos: 3,
  }),
});

/**
 * Métrica → onde ela mora no documento de Insight.
 *
 * Story usa `impressions` porque é o que a coleta grava com `$max` — a
 * audiência de um story só cresce enquanto ele vive. Conteúdo usa `videoViews`
 * com `impressions` de reserva: post de imagem não tem contagem de vídeo, e
 * sem a reserva ele nunca cruzaria marco nenhum.
 */
const CAMPO_DA_METRICA = Object.freeze({
  storyViews:   ['impressions', 'reach'],
  contentViews: ['videoViews', 'impressions', 'reach'],
  reach:        ['reach'],
});

/** Lê o valor da métrica num Insight, na ordem de preferência. */
function valorDaMetrica(insight, metricType) {
  const campos = CAMPO_DA_METRICA[metricType] || [];
  for (const campo of campos) {
    const v = Number(insight?.[campo]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

/**
 * Configuração efetiva: o padrão com o que o painel tiver sobrescrito por
 * cima. A mesclagem é por seção, não profunda — quem grava `thresholds`
 * substitui a lista inteira, e é isso que se quer: uma lista pela metade
 * seria pior que a original.
 */
async function carregar() {
  if (!module.exports.bancoConectado()) return PADRAO;

  try {
    const Setting = require('../../models/Setting');
    const doc = await Setting.findOne({ key: CHAVE }).lean();
    const v = doc?.value;
    if (!v || typeof v !== 'object') return PADRAO;

    return {
      thresholds: { ...PADRAO.thresholds, ...(v.thresholds || {}) },
      ativos:     { ...PADRAO.ativos,     ...(v.ativos     || {}) },
      exibicao:   { ...PADRAO.exibicao,   ...(v.exibicao   || {}) },
      mensagens:  v.mensagens || {},
    };
  } catch {
    // Configuração ilegível não pode derrubar a detecção.
    return PADRAO;
  }
}

/**
 * Marcos cruzados entre o teto já disparado e o valor atual.
 *
 * É aqui que mora a regra de não repetir, e ela não depende de saber o valor
 * ANTERIOR da métrica — só do teto que já foi notificado. Isso é o que torna
 * a operação idempotente: rodar duas vezes com o mesmo valor não dispara nada
 * na segunda, e um salto de 95 para 145 detecta o 100 sem lógica especial.
 *
 * @param {number} teto   maior marco já disparado (0 se nunca)
 * @param {number} atual  valor da métrica agora
 * @param {number[]} marcos
 * @returns {number[]} marcos a disparar, do menor para o maior
 */
function marcosCruzados(teto, atual, marcos) {
  const piso = Number(teto) || 0;
  const valor = Number(atual) || 0;
  return (marcos || [])
    .filter(m => m > piso && m <= valor)
    .sort((a, b) => a - b);
}

/** Exportado como função para o teste poder substituir. Ver proxyPool.js. */
function bancoConectado() {
  return require('mongoose').connection?.readyState === 1;
}

module.exports = {
  CHAVE, PADRAO, CAMPO_DA_METRICA,
  carregar, marcosCruzados, valorDaMetrica, bancoConectado,
};

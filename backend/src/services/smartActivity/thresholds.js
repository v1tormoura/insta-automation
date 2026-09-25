'use strict';

/**
 * Marcos de métrica — a configuração central.
 *
 * ── Por que não ficam espalhados no código
 *
 * Um número de marco escrito dentro do detector é um número que só muda com
 * deploy. Aqui eles são dados: a lista padrão vive neste arquivo, e o painel
 * pode sobrescrevê-la gravando em `settings`, sem tocar em nada.
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
    storyViews: false,
    contentViews: false,
    reach: false,
    global: true,       // resumo do dia

    /* Publicação em si: dispara na hora, um por publicação/erro — não
       compete com os marcos de audiência, que são sobre desempenho DEPOIS
       de publicado. Ligados por padrão porque são o par mínimo que
       responde "saiu?" e "deu problema?" sem esperar métrica nenhuma
       chegar do Instagram. */
    postPublicado: true,
    erroPublicacao: true,

    /* Avisos do vigia do sistema (contas sem conectar, fila presa, erros
       do dia) — desligados por padrão. Desligado, a verificação nem roda. */
    sessoes: false,
    fila: false,
    erros: false,
    normalizado: false,
  }),

  /**
   * O resumo do dia: a que hora sai. Era uma constante (22h) no detector;
   * agora é dado, como os marcos — quem prefere o fechamento às 20h ou à
   * meia-noite muda na tela. Fuso do contêiner (America/Sao_Paulo).
   */
  resumo: Object.freeze({
    hora: '22:00',
  }),

  /** Aparência e comportamento do aviso na tela. */
  exibicao: Object.freeze({
    duracaoMs: 6000,
    posicao: 'topo-direita',
    som: false,
    maxSimultaneos: 3,
  }),

  /**
   * O que o aviso pode revelar.
   *
   * Ligado por padrão porque é o comportamento que sempre existiu, e mudar o
   * padrão esconderia dado de quem nunca pediu para esconder. Quem desliga
   * está resolvendo um problema concreto: a notificação aparece na tela de
   * bloqueio, onde quem estiver perto do aparelho lê o @ e o número.
   */
  privacidade: Object.freeze({
    mostrarNome: true,
    mostrarValor: true,
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
 * O que o aviso pode revelar, do documento do usuário.
 *
 * Falha em silêncio para o padrão: um erro ao ler uma preferência não pode
 * derrubar a detecção. Mas note a direção da falha — o padrão MOSTRA. Se um
 * dia o padrão passar a esconder, este `catch` vira um vazamento silencioso, e
 * a proteção certa aí seria falhar escondendo.
 */
async function _privacidade() {
  try {
    const u = await require('../../repos/usuario').carregar();
    return {
      mostrarNome:  u?.notificacoes?.mostrarNome  !== false,
      mostrarValor: u?.notificacoes?.mostrarValor !== false,
    };
  } catch {
    return { ...PADRAO.privacidade };
  }
}

async function carregar() {
  try {
    /* A privacidade mora no usuário, não em `settings`: é preferência pessoal e
       é onde a tela de Minha Conta a mostra. Buscada em paralelo para não
       somar uma ida ao banco no caminho da detecção. */
    const [v, privacidade] = await Promise.all([
      require('../../repos/settings').ler(CHAVE),
      _privacidade(),
    ]);
    if (!v || typeof v !== 'object') return { ...PADRAO, privacidade };

    return {
      thresholds: { ...PADRAO.thresholds, ...(v.thresholds || {}) },
      ativos:     { ...PADRAO.ativos,     ...(v.ativos     || {}) },
      exibicao:   { ...PADRAO.exibicao,   ...(v.exibicao   || {}) },
      resumo:     { ...PADRAO.resumo,     ...(v.resumo     || {}) },
      mensagens:  v.mensagens || {},
      privacidade,
    };
  } catch {
    // Configuração ilegível não pode derrubar a detecção.
    return PADRAO;
  }
}

/* ── Duas formas de dizer "quando avisar" ───────────────────────────────────

   MARCOS FIXOS: uma lista — 100, 500, 1.000 … 100.000. Um aviso por marco,
   uma vez, e depois do último marco o reel silencia para sempre. Era a única
   forma, e é o que a pessoa não queria: "se passar dessa views, já não
   aparece mais".

   CONTÍNUO: { modo: 'continuo', aPartirDe, passo }. A partir de `aPartirDe`,
   um degrau a cada `passo`, sem teto: 1.000, 2.000, 3.000 … enquanto o reel
   crescer. Os degraus não existem como lista em lugar nenhum — são
   calculados do valor atual. O detector continua vendo "marcos cruzados" e
   "o maior"; só a origem dos números muda.

   Um reel que pula de 5 mil para 50 mil numa sincronização cruza 45 degraus
   de mil, e o detector avisa só o maior (regra 1 do detector) — então o
   contínuo não vira metralhadora; vira "50.000 visualizações", uma vez. */

const LIMITE_LISTA = 100;

/**
 * Normaliza a regra de UMA métrica, venha do padrão, do banco ou da tela.
 * Lista (marcos fixos) ou objeto contínuo; qualquer outra coisa é null =
 * nada a detectar para esta métrica.
 */
function normalizarRegra(bruto) {
  if (Array.isArray(bruto)) {
    const lista = [...new Set(bruto.map(Number).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
    return lista.length ? { modo: 'marcos', lista } : null;
  }
  if (bruto && typeof bruto === 'object' && bruto.modo === 'continuo') {
    const aPartirDe = Math.floor(Number(bruto.aPartirDe));
    const passo     = Math.floor(Number(bruto.passo));
    if (!Number.isFinite(aPartirDe) || aPartirDe < 1) return null;
    if (!Number.isFinite(passo) || passo < 1) return null;
    return { modo: 'continuo', aPartirDe, passo };
  }
  return null;
}

/** A regra da métrica na configuração efetiva. */
function regraDe(cfg, metricType) {
  return normalizarRegra(cfg?.thresholds?.[metricType]);
}

/**
 * Marcos cruzados entre o teto já disparado e o valor atual.
 *
 * É aqui que mora a regra de não repetir, e ela não depende de saber o valor
 * ANTERIOR da métrica — só do teto que já foi notificado. Isso é o que torna
 * a operação idempotente: rodar duas vezes com o mesmo valor não dispara nada
 * na segunda, e um salto de 95 para 145 detecta o 100 sem lógica especial.
 *
 * No modo contínuo a lista devolvida é limitada aos últimos `LIMITE_LISTA`
 * degraus: o detector usa só "há algum?" e "o maior", e um reel de 5 milhões
 * com passo de mil não precisa de 5.000 números na memória para isso.
 *
 * @param {number} teto   maior marco já disparado (0 se nunca)
 * @param {number} atual  valor da métrica agora
 * @param {number[]|object} regra  lista de marcos, ou a regra normalizada
 * @returns {number[]} marcos a disparar, do menor para o maior
 */
function marcosCruzados(teto, atual, regra) {
  const piso  = Number(teto) || 0;
  const valor = Number(atual) || 0;
  const r = (regra && regra.modo) ? regra : normalizarRegra(regra);
  if (!r) return [];

  if (r.modo === 'marcos') return r.lista.filter(m => m > piso && m <= valor);

  if (valor < r.aPartirDe) return [];
  const maior = r.aPartirDe + Math.floor((valor - r.aPartirDe) / r.passo) * r.passo;
  if (maior <= piso) return [];
  const kMin = piso < r.aPartirDe ? 0 : Math.floor((piso - r.aPartirDe) / r.passo) + 1;
  const primeiro = r.aPartirDe + kMin * r.passo;
  const inicio = Math.max(primeiro, maior - (LIMITE_LISTA - 1) * r.passo);
  const saida = [];
  for (let t = inicio; t <= maior; t += r.passo) saida.push(t);
  return saida;
}

/**
 * O maior degrau já alcançado por um valor — o que a semeadura grava como
 * "já avisado" para uma conta nova não despejar o histórico inteiro.
 */
function pisoDe(valor, regra) {
  const v = Number(valor) || 0;
  const r = (regra && regra.modo) ? regra : normalizarRegra(regra);
  if (!r || !v) return 0;
  if (r.modo === 'marcos') return r.lista.filter(m => m <= v).pop() || 0;
  if (v < r.aPartirDe) return 0;
  return r.aPartirDe + Math.floor((v - r.aPartirDe) / r.passo) * r.passo;
}

/**
 * "HH:MM" válido, ou null. Aceita "22", "22:0", "9:05"; devolve sempre com
 * dois dígitos. É o formato do `<input type="time">` da tela.
 */
function normalizarHora(bruto) {
  const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(String(bruto ?? ''));
  if (!m) return null;
  const h = Number(m[1]); const min = m[2] == null ? 0 : Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Minutos desde a meia-noite de um "HH:MM" já normalizado. */
function minutosDe(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}


module.exports = {
  CHAVE, PADRAO, CAMPO_DA_METRICA, LIMITE_LISTA,
  carregar, marcosCruzados, valorDaMetrica,
  normalizarRegra, regraDe, pisoDe, normalizarHora, minutosDe,
};

'use strict';

/**
 * Modelos de mensagem com `{{variáveis}}`.
 *
 * ── Por que uma variável desconhecida não vira texto vazio
 *
 * O caminho fácil é trocar `{{inexistente}}` por string vazia. O resultado é
 * uma notificação que diz "@ chegou a  visualizações" e ninguém descobre por
 * quê — o erro fica invisível justamente para quem escreveu o modelo.
 *
 * Aqui a validação é explícita: `validar()` devolve as variáveis que o modelo
 * usa e o sistema não conhece, para o editor recusar antes de salvar. E se uma
 * escapar mesmo assim, `render()` deixa o marcador literal na tela — feio de
 * propósito, porque um `{{typo}}` visível é consertado no mesmo dia e um espaço
 * em branco não é consertado nunca.
 */

/** Variáveis disponíveis, com o que cada uma significa — o editor mostra esta lista. */
const VARIAVEIS = Object.freeze({
  username:    'Nome de usuário da conta, sem @',
  account:     'Mesmo que username, com @ na frente',
  views:       'Valor atual da métrica, já formatado (1.024)',
  threshold:   'O marco atingido, já formatado (1.000)',
  storyId:     'Identificador do story no Instagram',
  content:     'Identificador do conteúdo no Instagram',
  contentType: 'Story, Reel, Imagem…',
  time:        'Quando o conteúdo foi publicado, em linguagem corrente',
  likes:       'Curtidas',
  comments:    'Comentários',
  shares:      'Compartilhamentos',
  reach:       'Alcance',

  /* Só do resumo do dia. Aparecem na lista do editor porque escondê-las
     obrigaria quem edita o resumo a adivinhar que existem. */
  publicacoes: 'Publicações do dia (só no Resumo)',
  contas:      'Contas que publicaram hoje (só no Resumo)',
});

/** Modelos padrão por métrica. Substituíveis pelo painel. */
const PADRAO = Object.freeze({
  storyViews: Object.freeze({
    titulo: 'Seu Story está bombando 🚀',
    mensagem: '{{account}} chegou a {{views}} visualizações.',
    tema: 'story',
  }),
  contentViews: Object.freeze({
    titulo: '{{threshold}} visualizações 🔥',
    mensagem: '{{account}} passou de {{threshold}} em um {{contentType}}.',
    tema: 'viral',
  }),
  reach: Object.freeze({
    titulo: 'Alcance de {{threshold}} pessoas',
    mensagem: '{{account}} alcançou {{views}} contas únicas.',
    tema: 'reach',
  }),
  resumo: Object.freeze({
    titulo: 'Resumo do dia',
    mensagem: '{{publicacoes}} publicações em {{contas}} conta(s). {{views}} visualizações hoje.',
    tema: 'info',
  }),
});

const MARCADOR = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Números em português: 1024 → "1.024". */
function formatarNumero(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString('pt-BR');
}

/**
 * "há 7m", "há 2h", "ontem".
 *
 * Relativo e não absoluto porque a pergunta que a pessoa faz olhando uma
 * notificação é "isso é recente?", e não "que horas eram".
 */
function tempoRelativo(data) {
  if (!data) return 'agora';
  const ms = Date.now() - new Date(data).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/**
 * Monta o dicionário de variáveis a partir do evento.
 *
 * Tudo já formatado: o modelo é escrito por quem não programa, e obrigar
 * `{{views | numero}}` seria inventar uma linguagem para resolver um problema
 * que a formatação na origem resolve.
 */
function contexto({ conta = {}, insight = {}, threshold = 0, valor = 0, metricType = '' } = {}) {
  const username = conta.username || '';
  const tipo = metricType === 'storyViews'
    ? 'Story'
    : (insight.mediaType === 'VIDEO' || insight.mediaType === 'REELS') ? 'Reel'
    : insight.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel'
    : 'post';

  return {
    username,
    account:     username ? `@${username}` : 'a conta',
    views:       formatarNumero(valor),
    threshold:   formatarNumero(threshold),
    storyId:     insight.igMediaId || '',
    content:     insight.igMediaId || '',
    contentType: tipo,
    time:        tempoRelativo(insight.postedAt),
    likes:       formatarNumero(insight.likeCount),
    comments:    formatarNumero(insight.commentsCount),
    shares:      formatarNumero(insight.shareCount),
    reach:       formatarNumero(insight.reach),
  };
}

/**
 * Variáveis usadas pelo modelo que o sistema não conhece.
 * Vazio significa modelo válido.
 */
function validar(texto) {
  const desconhecidas = new Set();
  for (const m of String(texto || '').matchAll(MARCADOR)) {
    if (!(m[1] in VARIAVEIS)) desconhecidas.add(m[1]);
  }
  return [...desconhecidas];
}

/**
 * Renderiza. Variável desconhecida permanece VISÍVEL como `{{nome}}` — ver o
 * comentário no topo do arquivo.
 */
function render(texto, vars = {}) {
  return String(texto || '').replace(MARCADOR, (inteiro, nome) =>
    (nome in vars && vars[nome] !== undefined && vars[nome] !== null)
      ? String(vars[nome])
      : inteiro
  );
}

/** Modelo efetivo para uma métrica: o do painel, ou o padrão. */
function modeloDe(metricType, mensagensDoPainel = {}) {
  const custom = mensagensDoPainel?.[metricType];
  const base = PADRAO[metricType] || PADRAO.contentViews;
  if (!custom) return base;
  return {
    titulo:   custom.titulo   || base.titulo,
    mensagem: custom.mensagem || base.mensagem,
    tema:     custom.tema     || base.tema,
  };
}

module.exports = {
  VARIAVEIS, PADRAO,
  formatarNumero, tempoRelativo, contexto, validar, render, modeloDe,
};

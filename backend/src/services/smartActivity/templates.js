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

  /* ── Avisos de sistema ─────────────────────────────────────────────────
     Estes vêm do vigia, não de uma métrica do Instagram. Ficam no mesmo
     dicionário porque `validar()` sem tipo confere contra ele — mas cada
     aviso oferece só as suas, por `VARIAVEIS_POR_TIPO`. */
  erro:          'O que o serviço respondeu quando falhou',
  proxies:       'Quantos proxies existem no pool',
  contasRuins:   'Contas que não conseguem conectar',
  contasTotal:   'Total de contas cadastradas',
  presas:        'Publicações presas na fila',
  errosHoje:     'Erros de publicação no dia',
  percentual:    'Percentual da cota de proxy já usado',
  restanteGb:    'GB restantes da cota',
  totalGb:       'GB totais da cota',
  diasRestantes: 'Dias estimados até a cota acabar',
  previsao:      'A estimativa em linguagem corrente',
  aviso:         'Nome do aviso que voltou ao normal',
  horas:         'Por quantas horas o problema durou',
});

/**
 * Quais variáveis cada aviso oferece.
 *
 * ── Por que não basta a lista única
 *
 * `{{presas}}` num aviso de story nunca vai ter valor: a fila não faz parte
 * daquele evento. Com uma lista só, o editor ofereceria a variável, a
 * validação aprovaria, e a notificação sairia com `{{presas}}` escrito na
 * tela — o marcador literal, que é o comportamento correto do render e uma
 * surpresa desagradável para quem escreveu.
 *
 * Então o editor mostra só o que aquele aviso sabe preencher, e a rota confere
 * contra o mesmo mapa. É a diferença entre "esta variável existe" e "esta
 * variável existe AQUI".
 */
const VARIAVEIS_POR_TIPO = Object.freeze({
  storyViews:   Object.freeze(['account', 'username', 'views', 'threshold', 'storyId', 'contentType', 'time']),
  contentViews: Object.freeze(['account', 'username', 'views', 'threshold', 'content', 'contentType', 'time',
                               'likes', 'comments', 'shares', 'reach']),
  reach:        Object.freeze(['account', 'username', 'views', 'threshold', 'content', 'contentType', 'time', 'reach']),
  resumo:       Object.freeze(['publicacoes', 'contas', 'views']),

  /* Avisos do vigia do sistema. */
  cota:    Object.freeze(['percentual', 'restanteGb', 'totalGb', 'diasRestantes', 'previsao']),
  proxy:   Object.freeze(['erro']),
  pool:    Object.freeze(['proxies']),
  sessoes: Object.freeze(['contasRuins', 'contasTotal']),
  fila:    Object.freeze(['presas']),
  erros:   Object.freeze(['errosHoje']),

  /* O aviso de que um problema passou. Um só modelo para os seis, porque a
     frase é a mesma e `{{aviso}}` já diz qual foi — seis modelos idênticos
     seriam seis lugares para manter a mesma frase. */
  normalizado: Object.freeze(['aviso', 'horas']),
});

/** Os tipos que vêm do vigia, e não de uma métrica do Instagram. */
const TIPOS_DE_SISTEMA = Object.freeze(['cota', 'proxy', 'pool', 'sessoes', 'fila', 'erros', 'normalizado']);

/**
 * `{ nome: descrição }` das variáveis de um aviso — é o que o editor lista.
 *
 * Tipo desconhecido devolve o dicionário inteiro em vez de vazio: uma lista
 * vazia pareceria "este aviso não aceita variáveis", que é uma afirmação
 * errada sobre um tipo que simplesmente ainda não foi mapeado.
 */
function variaveisDe(tipo) {
  const nomes = VARIAVEIS_POR_TIPO[tipo];
  if (!nomes) return { ...VARIAVEIS };
  return Object.fromEntries(nomes.map(n => [n, VARIAVEIS[n]]));
}

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

  /* ── Avisos do vigia do sistema ────────────────────────────────────────
     O texto abaixo é o que o vigia já escrevia embutido no código, movido
     para cá sem uma palavra mudada. Quem não editar nada continua recebendo
     exatamente a mesma frase de antes — a mudança é passar a poder editar,
     não passar a receber outra coisa. */
  cota: Object.freeze({
    titulo: 'Cota do proxy em {{percentual}}%',
    mensagem: '{{restanteGb}} GB de {{totalGb}} GB restantes. {{previsao}} '
            + 'Renove antes de acabar — quando acaba, tudo para de uma vez.',
    tema: 'warning',
  }),
  proxy: Object.freeze({
    titulo: 'O proxy parou de responder',
    mensagem: '{{erro}}',
    tema: 'warning',
  }),
  pool: Object.freeze({
    titulo: 'O pool de proxies acabou',
    mensagem: 'Os {{proxies}} proxies estão reservados. A próxima conta vai sair pelo IP global, '
            + 'dividindo endereço com as outras — o padrão que o Instagram lê como automação.',
    tema: 'warning',
  }),
  sessoes: Object.freeze({
    titulo: '{{contasRuins}} de {{contasTotal}} contas sem conseguir conectar',
    mensagem: 'Quando é a maioria de uma vez, a causa costuma ser comum a todas — '
            + 'proxy, rede ou serviço — e não cada conta individualmente.',
    tema: 'warning',
  }),
  fila: Object.freeze({
    titulo: '{{presas}} publicação(ões) presa(s) na fila',
    mensagem: 'Em processamento há mais de uma hora. Normalmente leva segundos — '
            + 'quando passa disso, alguma coisa travou no meio.',
    tema: 'info',
  }),
  erros: Object.freeze({
    titulo: '{{errosHoje}} erros de publicação hoje',
    mensagem: 'Muitos erros no mesmo dia raramente são coincidência. '
            + 'Vale olhar se todos têm o mesmo motivo.',
    tema: 'info',
  }),
  normalizado: Object.freeze({
    titulo: 'Normalizado: {{aviso}}',
    mensagem: 'Ficou fora por cerca de {{horas}} h e voltou a funcionar.',
    tema: 'success',
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
 * Valores de exemplo, para a prévia.
 *
 * Ficam aqui e viajam na resposta do `/config` porque a prévia é local — o
 * editor renderiza a cada tecla, sem ida ao servidor. A alternativa era o
 * frontend guardar a sua própria cópia desta lista, e duas listas da mesma
 * coisa em arquivos diferentes divergem na primeira variável nova.
 */
const EXEMPLOS = Object.freeze({
  username: 'oliviapaganini', account: '@oliviapaganini',
  views: '1.024', threshold: '1.000',
  storyId: '178551331', content: '178551331',
  contentType: 'Story', time: 'há 2h',
  likes: '87', comments: '12', shares: '4', reach: '940',
  publicacoes: '6', contas: '3',

  erro: 'Tempo de conexão esgotado ao sair para o Instagram.',
  proxies: '8',
  contasRuins: '5', contasTotal: '9',
  presas: '2', errosHoje: '23',
  percentual: '87', restanteGb: '12', totalGb: '100',
  diasRestantes: '4', previsao: 'No ritmo atual, acaba em cerca de 4 dia(s).',
  aviso: 'proxy', horas: '3',
});

/**
 * Variáveis usadas pelo modelo que o sistema não conhece.
 * Vazio significa modelo válido.
 *
 * Com `tipo`, confere contra as variáveis DAQUELE aviso — ver o comentário de
 * `VARIAVEIS_POR_TIPO`. Sem ele, contra o dicionário inteiro, que é o que os
 * chamadores antigos esperam.
 */
function validar(texto, tipo) {
  const conhece = VARIAVEIS_POR_TIPO[tipo]
    ? nome => VARIAVEIS_POR_TIPO[tipo].includes(nome)
    : nome => nome in VARIAVEIS;

  const desconhecidas = new Set();
  for (const m of String(texto || '').matchAll(MARCADOR)) {
    if (!conhece(m[1])) desconhecidas.add(m[1]);
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
  VARIAVEIS, VARIAVEIS_POR_TIPO, TIPOS_DE_SISTEMA, PADRAO, EXEMPLOS,
  formatarNumero, tempoRelativo, contexto, validar, render, modeloDe, variaveisDe,
};

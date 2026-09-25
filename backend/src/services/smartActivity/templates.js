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
  publicacoes:  'Publicações do dia (só no Resumo)',
  contas:       'Contas envolvidas (no Resumo: que publicaram hoje; no resumo de marcos: com marcos nesta varredura)',
  viewsStories: 'Visualizações de stories no dia (só no Resumo)',
  porConta:     'Visualizações do dia, uma linha por conta (só no Resumo)',

  /* ── Avisos de sistema ─────────────────────────────────────────────────
     Estes vêm do vigia, não de uma métrica do Instagram. Ficam no mesmo
     dicionário porque `validar()` sem tipo confere contra ele — mas cada
     aviso oferece só as suas, por `VARIAVEIS_POR_TIPO`. */
  erro:          'O que o serviço respondeu quando falhou',
  dias:          'Quantos dias faltam para o token vencer',
  motivo:        'Por que a conta parou (token inválido, banida…)',
  usado:         'Publicações feitas pela API nas últimas 24h',
  limite:        'Quantas a API do Instagram aceita em 24h (50)',
  libera:        'Horário estimado em que a cota volta a aceitar',
  quantidade:    'Quantos conteúdos cruzaram marcos além dos 3 avisados',
  maior:         'O maior valor entre eles, já formatado',
  contasRuins:   'Contas que não conseguem conectar',
  contasTotal:   'Total de contas cadastradas',
  presas:        'Publicações presas na fila',
  errosHoje:     'Erros de publicação no dia',
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
  resumo:       Object.freeze(['publicacoes', 'contas', 'views', 'viewsStories', 'porConta']),

  /* Publicação em si — dispara na hora, por publicação, não por métrica. */
  postPublicado:  Object.freeze(['account', 'username', 'contentType', 'time']),
  erroPublicacao: Object.freeze(['account', 'username', 'contentType', 'erro', 'time']),
  tokenExpirando: Object.freeze(['account', 'username', 'dias']),
  contaCaiu:      Object.freeze(['account', 'username', 'motivo']),
  contaVoltou:    Object.freeze(['account', 'username', 'motivo']),
  cotaApi:        Object.freeze(['account', 'username', 'usado', 'limite', 'libera']),
  resumoMarcos:   Object.freeze(['account', 'username', 'quantidade', 'contas', 'maior']),

  /* Avisos do vigia do sistema. */
  sessoes: Object.freeze(['contasRuins', 'contasTotal']),
  fila:    Object.freeze(['presas']),
  erros:   Object.freeze(['errosHoje']),

  /* O aviso de que um problema passou. Um só modelo para os seis, porque a
     frase é a mesma e `{{aviso}}` já diz qual foi — seis modelos idênticos
     seriam seis lugares para manter a mesma frase. */
  normalizado: Object.freeze(['aviso', 'horas']),
});

/** Os tipos que vêm do vigia, e não de uma métrica do Instagram. */
const TIPOS_DE_SISTEMA = Object.freeze(['sessoes', 'fila', 'erros', 'normalizado']);

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
    mensagem: '{{publicacoes}} publicações em {{contas}} conta(s). {{views}} visualizações '
            + 'em posts e {{viewsStories}} em stories hoje.\n{{porConta}}',
    tema: 'info',
  }),

  /* ── Publicação em si ─────────────────────────────────────────────────
     Diferente dos marcos: não espera métrica nenhuma chegar do Instagram,
     dispara no instante em que a publicação sai (ou falha) de verdade. */
  postPublicado: Object.freeze({
    titulo: 'Publicado ✅',
    mensagem: '{{account}} publicou um {{contentType}}.',
    tema: 'success',
  }),
  erroPublicacao: Object.freeze({
    titulo: 'Falha ao publicar ⚠️',
    mensagem: '{{account}}: {{erro}}',
    tema: 'warning',
  }),

  /* ── Avisos que faltavam ───────────────────────────────────────────────
     Os três nasceram de problemas reais que passaram despercebidos até doer:
     token vencendo sem ninguém ver (a conta parava de publicar do nada), conta
     caindo no meio de um lote, e envio terminando sem dizer o placar. */
  tokenExpirando: Object.freeze({
    titulo: 'Token vence em {{dias}} dias 🔑',
    mensagem: '{{account}} precisa ser reconectada antes disso, ou para de publicar.',
    tema: 'warning',
  }),
  contaCaiu: Object.freeze({
    titulo: 'Conta parou ⛔',
    mensagem: '{{account}}: {{motivo}}',
    tema: 'danger',
  }),
  contaVoltou: Object.freeze({
    titulo: 'Conta voltou ✅',
    mensagem: '{{account}} {{motivo}}.',
    tema: 'success',
  }),
  /* A cota da API do Meta: 50 publicações por conta em 24h. O envio para por
     horas sem erro nenhum na fila — sem este aviso, parece que travou. */
  /* Vários reels cruzando marcos na mesma sincronização: os 3 maiores saem
     inteiros, o resto vira este resumo. Sem ele era uma avalanche. */
  resumoMarcos: Object.freeze({
    titulo: 'Mais {{quantidade}} marcos 🚀',
    mensagem: 'Mais {{quantidade}} conteúdos de {{contas}} conta(s) passaram de marcos nesta sincronização — o maior foi {{account}}, com {{maior}}.',
    tema: 'viral',
  }),
  cotaApi: Object.freeze({
    titulo: 'Cota da API do Instagram cheia ⏳',
    mensagem: '{{account}} publicou {{usado}}/{{limite}} pela API em 24h. O envio segue sozinho quando liberar, por volta de {{libera}}.',
    tema: 'warning',
  }),

  /* ── Avisos do vigia do sistema ────────────────────────────────────────
     O texto abaixo é o que o vigia já escrevia embutido no código, movido
     para cá sem uma palavra mudada. Quem não editar nada continua recebendo
     exatamente a mesma frase de antes — a mudança é passar a poder editar,
     não passar a receber outra coisa. */
  sessoes: Object.freeze({
    titulo: '{{contasRuins}} de {{contasTotal}} contas sem conseguir conectar',
    mensagem: 'Quando é a maioria de uma vez, a causa costuma ser comum a todas — '
            + 'o app da Meta ou o token — e não cada conta individualmente.',
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
function contexto({ conta = {}, insight = {}, threshold = 0, valor = 0, metricType = '',
                    privacidade } = {}) {
  const username = conta.username || '';
  const tipo = metricType === 'storyViews'
    ? 'Story'
    : (insight.mediaType === 'VIDEO' || insight.mediaType === 'REELS') ? 'Reel'
    : insight.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel'
    : 'post';

  const vars = {
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

  return privacidade ? discretas(vars, privacidade) : vars;
}

/**
 * Troca o que a pessoa pediu para não aparecer.
 *
 * ── Por que substituir e não remover
 *
 * Removendo a variável, `render` deixaria `{{account}}` literal na tela — o
 * comportamento correto dele para variável desconhecida, e péssimo aqui: quem
 * desligou o nome veria `{{account}}` em vez de uma frase. Então o valor é
 * trocado por um termo genérico, e a frase continua sendo uma frase.
 *
 * ── Onde isto vale
 *
 * Na notificação que aparece na tela de bloqueio do celular, onde quem estiver
 * perto do aparelho lê. Vale também na Central, para os dois textos não
 * divergirem: um aviso que esconde o @ no push e o mostra no painel esconde
 * pela metade.
 *
 * Não vale para os avisos do sistema — "8 proxies reservados" não tem nome de
 * conta, e esconder o número deixaria o alerta sem a informação que é a razão
 * dele existir.
 */
function discretas(vars, { mostrarNome = true, mostrarValor = true } = {}) {
  const saida = { ...vars };

  if (!mostrarNome) {
    saida.username = 'sua conta';
    saida.account  = 'sua conta';
  }

  if (!mostrarValor) {
    /* Todo número, e não só `views`: esconder o valor e deixar `{{likes}}`
       aberto no mesmo texto não esconde nada.

       `•••` e não uma palavra: o modelo padrão é `chegou a {{views}}
       visualizacoes`, e qualquer substantivo ali produz "chegou a um marco
       visualizacoes". O ponto suspensivo se le como "escondido" e nao
       atropela a frase em volta. */
    for (const campo of ['views', 'threshold', 'likes', 'comments', 'shares', 'reach', 'viewsStories', 'maior']) {
      saida[campo] = '•••';
    }
  }

  return saida;
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
  viewsStories: '412',
  porConta: '@oliviapaganini: 1.024 · @lauramendes: 380',

  erro: 'Tempo de conexão esgotado ao sair para o Instagram.',
  contasRuins: '5', contasTotal: '9',
  presas: '2', errosHoje: '23',
  aviso: 'fila de publicação', horas: '3',
  dias: '6', motivo: 'Token inválido — reconecte pela API.',
  usado: '50', limite: '50', libera: '14:35',
  quantidade: '9', maior: '194.000',
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
  formatarNumero, tempoRelativo, contexto, discretas, validar, render,
  modeloDe, variaveisDe,
};

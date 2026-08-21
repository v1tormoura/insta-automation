'use strict';

/**
 * Geração de legendas e comentários por IA (Claude).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * Escrever legenda para dezenas de combinações conta × conteúdo é o gargalo
 * manual da campanha. Aqui o modelo devolve N variações prontas; quem edita
 * continua sendo o usuário — nada é publicado direto.
 *
 * ── Decisões ────────────────────────────────────────────────────────────────
 * • Saída estruturada (`output_config.format`) em vez de pedir JSON no prompt e
 *   torcer: o schema é validado pela própria API, então não há parse defensivo
 *   de texto solto nem sugestão perdida por uma vírgula a mais.
 *
 * • As marcações do templateResolver ({username}, {campaign}…) entram no prompt
 *   como vocabulário permitido. Sem isso o modelo escreveria "@seuperfil" em
 *   texto puro e a legenda sairia igual em todas as contas.
 *
 * • Sem chave configurada, `disponivel()` devolve false e a rota responde 503
 *   com instrução — em vez de estourar um erro cru na tela do usuário.
 */

const MODELO = 'claude-opus-5';

// Marcações que o templateResolver sabe resolver na publicação. Manter em
// sincronia com VARIAVEIS em templateResolver.js: uma marcação inventada aqui
// sairia publicada como texto literal.
const MARCACOES = [
  '{username}', '{name}', '{campaign}', '{content}', '{date}', '{time}',
];

const TONS = {
  neutro:      'natural e direto, sem exageros',
  vendedor:    'persuasivo, com foco em conversão e chamada para ação clara',
  descontraido:'informal e leve, com gírias brasileiras naturais',
  premium:     'sofisticado e enxuto, transmitindo exclusividade',
  educativo:   'didático, entregando uma informação útil antes da chamada',
  provocativo: 'com gancho forte na primeira linha, criando curiosidade',
};

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

/** Há chave configurada? A rota usa isto para responder antes de tentar. */
function disponivel() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
}

let _cliente = null;

function cliente() {
  if (!disponivel()) {
    throw new AiError(
      'AI_NOT_CONFIGURED',
      'IA não configurada — defina ANTHROPIC_API_KEY no .env e reinicie o backend.',
    );
  }
  if (!_cliente) {
    let Anthropic;
    try {
      Anthropic = require('@anthropic-ai/sdk');
    } catch {
      throw new AiError(
        'AI_SDK_MISSING',
        'Pacote @anthropic-ai/sdk ausente — rode npm install no backend e refaça a imagem.',
      );
    }
    _cliente = new (Anthropic.default || Anthropic)();
  }
  return _cliente;
}

const ESQUEMA = {
  type: 'object',
  properties: {
    legendas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          texto:    { type: 'string' },
          gancho:   { type: 'string' },   // resumo do ângulo, para o usuário escolher
        },
        required: ['texto', 'gancho'],
        additionalProperties: false,
      },
    },
  },
  required: ['legendas'],
  additionalProperties: false,
};

const SISTEMA = [
  'Você escreve legendas de Instagram em português do Brasil para um painel de',
  'automação de contas. Cada sugestão precisa ser publicável como está.',
  '',
  'Regras:',
  '• Escreva para leitura no celular: primeira linha é o gancho, o resto vem depois.',
  '• Nada de "Confira o link na bio" genérico repetido em todas as variações —',
  '  cada sugestão tem um ângulo diferente.',
  '• Emojis com parcimônia: no máximo 3 por legenda, e só quando somam.',
  '• Hashtags só se forem pedidas, sempre no fim.',
  '• Nunca invente dados concretos (preço, prazo, número de clientes, resultado)',
  '  que não estejam no briefing — texto publicitário falso gera problema real',
  '  para quem publica.',
  `• Marcações disponíveis, que serão substituídas na publicação: ${MARCACOES.join(', ')}.`,
  '  Use-as quando personalizarem de verdade; não force nenhuma.',
  '• O campo "gancho" descreve o ângulo em até 6 palavras — é rótulo de escolha,',
  '  não parte da legenda.',
].join('\n');

/**
 * Gera variações de legenda.
 *
 * @param {Object}   opcoes
 * @param {string}   opcoes.briefing     do que o post trata (obrigatório)
 * @param {string}   [opcoes.tom]        chave de TONS
 * @param {number}   [opcoes.quantidade] 1..6 (padrão 3)
 * @param {number}   [opcoes.limite]     máximo de caracteres por legenda
 * @param {string}   [opcoes.exemplo]    legenda de referência, para imitar o estilo
 * @param {boolean}  [opcoes.hashtags]   incluir hashtags
 * @param {string}   [opcoes.publico]    público-alvo
 * @returns {Promise<{legendas: Array<{texto: string, gancho: string}>, modelo: string}>}
 */
async function gerarLegendas(opcoes = {}) {
  const briefing = String(opcoes.briefing || '').trim();
  if (!briefing) {
    throw new AiError('AI_EMPTY_BRIEF', 'Descreva do que o post trata para a IA escrever.');
  }
  if (briefing.length > 2000) {
    throw new AiError('AI_BRIEF_TOO_LONG', 'Briefing muito longo — resuma em até 2000 caracteres.');
  }

  const quantidade = Math.min(6, Math.max(1, Number(opcoes.quantidade) || 3));
  const limite     = Math.min(2200, Math.max(60, Number(opcoes.limite) || 600));
  const tom        = TONS[opcoes.tom] || TONS.neutro;

  const pedido = [
    `Escreva ${quantidade} variações de legenda.`,
    `Tom: ${tom}.`,
    `Limite: ${limite} caracteres por legenda.`,
    opcoes.publico ? `Público: ${String(opcoes.publico).slice(0, 200)}.` : '',
    opcoes.hashtags ? 'Inclua de 3 a 6 hashtags no fim de cada legenda.' : 'Sem hashtags.',
    '',
    'Briefing:',
    briefing,
    opcoes.exemplo ? `\nLegenda de referência (imite o estilo, não copie o conteúdo):\n${String(opcoes.exemplo).slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n');

  // O cliente é resolvido FORA do try: erros de configuração (chave ausente,
  // SDK não instalado) são acionáveis e precisam chegar com o próprio código —
  // dentro do try, `_traduzir` os transformaria num "AI_ERROR" genérico.
  const anthropic = cliente();

  let resposta;
  try {
    resposta = await anthropic.messages.create({
      model: MODELO,
      // Saída curta e delimitada: o teto existe para não pagar por texto que a
      // interface não mostraria de qualquer forma.
      max_tokens: 4000,
      system: SISTEMA,
      messages: [{ role: 'user', content: pedido }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: ESQUEMA },
      },
    });
  } catch (err) {
    throw _traduzir(err);
  }

  // Uma recusa por política vem como HTTP 200 — sem esta checagem, `content`
  // seria lido como se fosse resposta normal.
  if (resposta.stop_reason === 'refusal') {
    throw new AiError(
      'AI_REFUSED',
      'A IA recusou este briefing. Reescreva sem pedir alegações que não possa comprovar.',
    );
  }

  const bruto = resposta.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let dados;
  try {
    dados = JSON.parse(bruto);
  } catch {
    throw new AiError('AI_BAD_OUTPUT', 'A IA devolveu um formato inesperado. Tente novamente.');
  }

  const legendas = (dados.legendas || [])
    .map(l => ({
      texto:  String(l.texto || '').trim().slice(0, 2200),
      gancho: String(l.gancho || '').trim().slice(0, 60),
    }))
    .filter(l => l.texto);

  if (!legendas.length) {
    throw new AiError('AI_BAD_OUTPUT', 'A IA não devolveu nenhuma legenda. Tente novamente.');
  }

  return { legendas, modelo: MODELO };
}

/**
 * Traduz o erro do SDK para algo acionável na tela.
 *
 * A mensagem crua da API cita `x-api-key` e nomes de parâmetro — informação de
 * quem integra, não de quem está escrevendo uma legenda.
 */
function _traduzir(err) {
  const status = err?.status || err?.statusCode;
  if (status === 401 || status === 403) {
    return new AiError('AI_UNAUTHORIZED', 'Chave da IA inválida ou sem permissão. Revise ANTHROPIC_API_KEY.');
  }
  if (status === 429) {
    return new AiError('AI_RATE_LIMITED', 'Limite de uso da IA atingido. Tente de novo em alguns instantes.');
  }
  if (status === 400) {
    return new AiError('AI_BAD_REQUEST', `A IA recusou a requisição: ${String(err?.message || '').slice(0, 200)}`);
  }
  if (status >= 500) {
    return new AiError('AI_UPSTREAM', 'O serviço de IA está indisponível no momento. Tente novamente.');
  }
  return new AiError('AI_ERROR', `Falha ao falar com a IA: ${String(err?.message || err).slice(0, 200)}`);
}

module.exports = {
  gerarLegendas,
  disponivel,
  AiError,
  MODELO,
  TONS,
  MARCACOES,
  // Exportado para teste — evita montar uma requisição só para conferir a
  // tradução de erro.
  _traduzir,
};

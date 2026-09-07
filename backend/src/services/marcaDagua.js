'use strict';

/**
 * A marca d'água com o @ de cada conta.
 *
 * ── Por que ela é por conta, e não do job
 *
 * O texto é o @ de quem publica. Guardar o texto no job faria a marca de uma
 * conta aparecer no vídeo de outra — e num sistema cujo propósito é as contas
 * não se parecerem, isso é o pior defeito possível: seria a assinatura de que
 * as duas saem do mesmo lugar. Por isso o job guarda só COMO desenhar
 * (opacidade, posição, tamanho) e o @ é resolvido na hora de publicar.
 *
 * ── Por que ela entra na mesma passada do ffmpeg
 *
 * `convertToReelFormat` já monta uma cadeia de filtros e encoda uma vez. A
 * marca entra no fim dessa cadeia. Uma segunda passada custaria o dobro de CPU
 * e, pior, re-encodaria um vídeo já comprimido — perda de qualidade em cima de
 * perda de qualidade, no material que o Instagram vai comprimir de novo.
 *
 * ── Por que o @ não precisa ser escapado
 *
 * `drawtext` trata `:` como separador de opção e `'` e `\` como escape; texto
 * livre ali é uma injeção esperando acontecer, e foi o que obrigou o
 * `escaparDrawtext` do story. Aqui o texto passa antes por `normalizarArroba`,
 * que só deixa passar `[a-z0-9._]` — nenhum caractere que o drawtext interprete
 * sobrevive. O que não passa não vira marca: sem @ válido, sem filtro.
 *
 * ── A área que o Instagram cobre
 *
 * O reel tem interface por cima do vídeo: cerca de 120px no topo e 250px na
 * base de um 1080×1920, onde ficam o autor, a legenda e os botões. Marca posta
 * ali é marca escondida — as posições abaixo respeitam essa margem.
 */

const { acharFonte } = require('./storyStickerRenderer');
const { normalizarArroba } = require('./arrobaDoInstagram');

/* A altura da tela do reel depois da cadeia de escala. Todos os modos de
   processamento terminam em 1080×1920 — inclusive o humanizador, que corta
   alguns pixels e volta a escalar. */
const LARGURA = 1080;
const ALTURA  = 1920;

/* Quanto da tela a interface do Instagram cobre. Medido no aplicativo, não
   estimado: acima e abaixo destas linhas o vídeo aparece, mas com botões e
   texto do próprio Instagram em cima. */
const MARGEM_TOPO = 150;
const MARGEM_BASE = 270;

/** Corpo da letra por tamanho, num 1080 de largura. */
const TAMANHOS = { pequena: 34, media: 48, grande: 66 };

const POSICOES = ['superior', 'centro', 'inferior'];
const PADRAO = { ativa: false, opacidade: 40, posicao: 'centro', tamanho: 'pequena' };

/**
 * Normaliza o que veio da tela ou do banco.
 *
 * Nunca lança e nunca devolve `undefined` no meio: um campo estragado precisa
 * degradar para o padrão, porque a alternativa é a conversão do vídeo falhar —
 * e perder a publicação por causa de um enfeite é troca ruim.
 */
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};

  /* ── Por que o tipo é conferido antes do Number ──────────────────────────

     `Number(null)` é 0. `Number([])` é 0. `Number('')` é 0. Os três são
     finitos, então `Number.isFinite` os aprova — e um campo vazio no formulário
     viraria opacidade 5% em vez do padrão 40%. A pessoa mexeria em outra coisa
     procurando por que a marca sumiu.

     É o mesmo defeito que o texto livre do story já teve, com o mesmo
     `Number(null) === 0` no meio. Só número e texto entram. */
  const cru = b.opacidade;
  const opacidadeNum = (typeof cru === 'number' || (typeof cru === 'string' && cru.trim() !== ''))
    ? Number(cru)
    : NaN;
  return {
    ativa: b.ativa === true,
    /* 5 é o piso porque abaixo disso a marca não é visível nem no escuro — a
       pessoa acharia que não funcionou. 100 é o teto do próprio formato. */
    opacidade: Number.isFinite(opacidadeNum) ? Math.min(100, Math.max(5, Math.round(opacidadeNum))) : PADRAO.opacidade,
    posicao: POSICOES.includes(b.posicao) ? b.posicao : PADRAO.posicao,
    tamanho: Object.prototype.hasOwnProperty.call(TAMANHOS, b.tamanho) ? b.tamanho : PADRAO.tamanho,
  };
}

/**
 * A coordenada vertical, como expressão do drawtext.
 *
 * Expressão e não número no centro: `text_h` só é conhecido pelo ffmpeg depois
 * de medir a fonte, então centralizar de verdade precisa da conta feita lá.
 */
function alturaDe(posicao, corpo) {
  if (posicao === 'superior') return String(MARGEM_TOPO);
  if (posicao === 'inferior') {
    /* Da margem para cima, descontando a própria altura da letra: sem o
       desconto, a base do texto ficaria dentro da área dos botões. */
    return String(ALTURA - MARGEM_BASE - corpo);
  }
  return '(h-text_h)/2';
}

/**
 * O filtro `drawtext` desta conta, ou `null` quando não há marca a desenhar.
 *
 * `null` em vez de string vazia de propósito: quem chama concatena o resultado
 * numa cadeia de filtros separada por vírgula, e uma string vazia viraria uma
 * vírgula solta — que o ffmpeg recusa, derrubando a conversão inteira por causa
 * de uma marca desligada.
 *
 * @param {object} config — `{ ativa, opacidade, posicao, tamanho }`
 * @param {string} username — o @ da conta que vai publicar
 * @param {string} [fonte] — caminho da fonte; descoberto no sistema se omitido
 * @returns {string|null}
 */
function filtroDaMarca(config, username, fonte = acharFonte()) {
  const c = normalizar(config);
  if (!c.ativa) return null;

  const arroba = normalizarArroba(username);
  if (!arroba) return null;

  /* Sem fonte no sistema não há como desenhar. Devolver null publica o vídeo
     sem marca, que é melhor que não publicar. O log dá o motivo, senão o
     sintoma seria "liguei a marca e ela não aparece". */
  if (!fonte) {
    console.log('⚠️ [MarcaDagua] nenhuma fonte encontrada no sistema — vídeo sai sem marca');
    return null;
  }

  const corpo = TAMANHOS[c.tamanho];
  const alfa = (c.opacidade / 100).toFixed(2);
  /* A sombra acompanha a opacidade do texto. Fixa, uma marca a 10% ficaria com
     um contorno duro a 35% — a sombra apareceria mais que a marca. */
  const alfaSombra = (Math.min(1, (c.opacidade / 100) * 0.9)).toFixed(2);

  /* O caminho da fonte é a única parte que precisa de escape: no Windows ele
     tem `C:` e `\`, e os dois são sintaxe do drawtext. */
  const caminho = String(fonte).replace(/\\/g, '/').replace(/:/g, '\\:');

  return [
    `drawtext=fontfile='${caminho}'`,
    `text='@${arroba}'`,
    `fontsize=${corpo}`,
    `fontcolor=white@${alfa}`,
    /* Sombra e não caixa: sobre vídeo claro o texto branco desaparece, e uma
       caixa opaca atrás dele grita "marca colada depois". */
    `shadowcolor=black@${alfaSombra}`,
    'shadowx=2',
    'shadowy=2',
    `x=(w-text_w)/2`,
    `y=${alturaDe(c.posicao, corpo)}`,
  ].join(':');
}

/**
 * A configuração que chegou no corpo da requisição, ou `null`.
 *
 * O Postar envia como `multipart/form-data` (por causa dos arquivos), e ali
 * todo campo é texto — o objeto chega como JSON numa string. O Loop e a
 * campanha enviam JSON e o objeto chega pronto. Aceitar as duas formas num só
 * lugar evita cada controller inventar o seu parse, que é como se acumulam três
 * comportamentos diferentes para a mesma opção.
 *
 * `null` quando a marca está desligada: assim quem chama só grava o campo
 * quando há algo a gravar, e nada muda para quem nunca pediu marca.
 */
function lerDoCorpo(valor) {
  let bruto = valor;
  if (typeof bruto === 'string') {
    /* String vazia é o campo não enviado, não um JSON quebrado. */
    if (!bruto.trim()) return null;
    try { bruto = JSON.parse(bruto); }
    catch { return null; }   // corpo malformado não derruba a publicação
  }
  if (!bruto || typeof bruto !== 'object') return null;

  const c = normalizar(bruto);
  return c.ativa ? c : null;
}

module.exports = {
  filtroDaMarca, normalizar, lerDoCorpo, alturaDe,
  TAMANHOS, POSICOES, PADRAO, LARGURA, ALTURA, MARGEM_TOPO, MARGEM_BASE,
};

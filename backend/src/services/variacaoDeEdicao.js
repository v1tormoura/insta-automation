'use strict';

/**
 * Variação de EDIÇÃO por conta.
 *
 * ── O problema que isto resolve, e o que ele NÃO é
 *
 * `midiaPorConta` já faz cada conta subir um arquivo único em bytes. Isso
 * derrota comparação de arquivo, e só isso: o vídeo continua sendo o MESMO
 * vídeo — mesma abertura, mesmo texto, mesmo áudio. Para quem assiste (e para
 * um reconhecimento por conteúdo) cinco contas postando o mesmo material são
 * cinco vezes o mesmo material, e cada uma disputa o mesmo público com a mesma
 * ideia.
 *
 * Aqui a edição em si muda por conta. O eixo que mais pesa é o PRIMEIRO
 * SEGUNDO: o Instagram mostra o reel a um público-teste e expande conforme a
 * retenção, que se decide na abertura. Começar 0,8s depois é outro gancho.
 *
 * ── Por que é determinístico
 *
 * A variação sai de `aleatorio`, o mesmo gerador semeado em (post, conta) que
 * `midiaPorConta` usa. Duas consequências que importam: contas diferentes
 * recebem edições diferentes, e uma reconversão da MESMA publicação (um retry)
 * reproduz a mesma edição — senão o retry publicaria um corte diferente do que
 * já tinha subido.
 *
 * ── O que isto não promete
 *
 * Alcance. Se o vídeo-base não segura atenção, nenhuma variação salva. Isto
 * melhora a chance de cada conta ser tratada como material próprio; não
 * transforma repost em conteúdo original.
 */

const PADRAO = Object.freeze({
  ativa: false,
  /* Segundos cortados do início. O 0 fica na lista de propósito: sem ele,
     NENHUMA conta receberia a abertura original. */
  inicios: Object.freeze([0, 0.6, 1.2]),
  /* Fator de velocidade. Acima de ~1.1 a voz começa a soar acelerada. */
  velocidades: Object.freeze([1, 1.04, 1.07]),
  /* Frases de gancho sobrepostas nos primeiros segundos. Vazio = sem texto. */
  ganchos: Object.freeze([]),
  /* Quanto tempo o gancho fica na tela. */
  segundosDoGancho: 2.5,
});

const MAX_INICIO = 5;        // cortar mais que isso já é outro vídeo
const MIN_VEL = 0.9;
const MAX_VEL = 1.15;
const MAX_GANCHOS = 20;
const MAX_CHARS_GANCHO = 60;

/** Número finito dentro de limites, ou `null` quando o valor não serve. */
function _num(v, min, max) {
  if (typeof v !== 'number' && !(typeof v === 'string' && String(v).trim() !== '')) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normaliza a configuração vinda da tela ou do banco.
 *
 * Nunca lança: campo estragado vira o padrão, porque a alternativa é a
 * conversão do vídeo falhar — e perder a publicação por causa de um ajuste de
 * edição seria troca ruim. É a mesma regra de `marcaDagua.normalizar`.
 */
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};

  const inicios = Array.isArray(b.inicios)
    ? b.inicios.map(v => _num(v, 0, MAX_INICIO)).filter(v => v !== null)
    : [];
  const velocidades = Array.isArray(b.velocidades)
    ? b.velocidades.map(v => _num(v, MIN_VEL, MAX_VEL)).filter(v => v !== null)
    : [];
  const ganchos = Array.isArray(b.ganchos)
    ? b.ganchos.map(t => String(t || '').trim().slice(0, MAX_CHARS_GANCHO))
        .filter(Boolean).slice(0, MAX_GANCHOS)
    : [];

  return {
    ativa: b.ativa === true,
    inicios:     inicios.length     ? inicios     : [...PADRAO.inicios],
    velocidades: velocidades.length ? velocidades : [...PADRAO.velocidades],
    ganchos,
    segundosDoGancho: _num(b.segundosDoGancho, 1, 8) ?? PADRAO.segundosDoGancho,
  };
}

/**
 * A edição desta conta.
 *
 * @param {object}   config     `{ ativa, inicios, velocidades, ganchos }`
 * @param {function} aleatorio  gerador semeado em (post, conta) — ver midiaPorConta
 * @returns {{trimInicio:number, velocidade:number, gancho:string, segundosDoGancho:number}|null}
 *          `null` quando a variação está desligada — quem chama não muda nada.
 */
function resolver(config, aleatorio) {
  const c = normalizar(config);
  if (!c.ativa) return null;
  const sorteia = typeof aleatorio === 'function' ? aleatorio : Math.random;

  const escolhe = lista => lista[Math.floor(sorteia() * lista.length) % lista.length];

  return {
    trimInicio: escolhe(c.inicios),
    velocidade: escolhe(c.velocidades),
    gancho:     c.ganchos.length ? escolhe(c.ganchos) : '',
    segundosDoGancho: c.segundosDoGancho,
  };
}

/**
 * A configuração que chegou no corpo da requisição, ou `null`.
 *
 * O Postar envia `multipart/form-data` (por causa dos arquivos), e ali todo
 * campo é texto — o objeto chega como JSON numa string. Mesmo contrato de
 * `marcaDagua.lerDoCorpo`.
 */
function lerDoCorpo(valor) {
  let bruto = valor;
  if (typeof bruto === 'string') {
    if (!bruto.trim()) return null;
    try { bruto = JSON.parse(bruto); } catch { return null; }
  }
  if (!bruto || typeof bruto !== 'object') return null;
  const c = normalizar(bruto);
  return c.ativa ? c : null;
}

/**
 * O filtro `drawtext` do gancho, pronto para entrar na cadeia do ffmpeg.
 *
 * Fica AQUI e não no `videoProcessor` pelo mesmo motivo da marca d'água: montar
 * `drawtext` exige escapar o caminho da fonte (`:` e `\` são sintaxe do filtro)
 * e o texto livre (que vem de quem digitou, e é injeção esperando acontecer).
 * Esse conhecimento já é delicado num lugar só; em dois, um dos dois erra.
 *
 * Devolve `null` quando não há o que desenhar — e `null` vira `undefined` na
 * opção, então o vídeo sai sem gancho em vez de a conversão falhar.
 *
 * @param {string} texto  a frase sorteada para esta conta
 * @param {number} segundos  por quanto tempo fica na tela
 * @param {string} [fonte]  caminho da fonte; descoberto no sistema se omitido
 */
function filtroDoGancho(texto, segundos = 2.5, fonte) {
  const { acharFonte, escaparDrawtext } = require('./textoNoStory');
  const caminhoFonte = fonte || acharFonte();
  if (!caminhoFonte) {
    console.log('⚠️ [Variação] nenhuma fonte no sistema — vídeo sai sem gancho');
    return null;
  }

  const limpo = escaparDrawtext(texto);
  if (!limpo) return null;

  /* `:` separa opções do drawtext e `\` é escape — num caminho do Windows os
     dois aparecem. Mesma normalização de marcaDagua.filtroDaMarca. */
  const caminho = String(caminhoFonte).replace(/\\/g, '/').replace(/:/g, '\\:');
  const seg = Math.min(8, Math.max(1, Number(segundos) || 2.5));

  return [
    `drawtext=fontfile='${caminho}'`,
    `text='${limpo}'`,
    'fontsize=72',
    'fontcolor=white',
    /* Contorno em vez de caixa: sobre vídeo claro o texto branco some, e uma
       caixa opaca atrás grita "legenda colada depois". */
    'borderw=5',
    'bordercolor=black@0.85',
    'x=(w-text_w)/2',
    /* 16% do topo: abaixo da faixa que o Instagram cobre com o autor. */
    'y=h*0.16',
    `enable='between(t,0,${seg})'`,
  ].join(':');
}

module.exports = {
  resolver, normalizar, lerDoCorpo, filtroDoGancho,
  PADRAO, MAX_INICIO, MIN_VEL, MAX_VEL, MAX_CHARS_GANCHO,
};

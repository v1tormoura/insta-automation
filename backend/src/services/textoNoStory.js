'use strict';

/**
 * Texto livre queimado na mídia do story.
 *
 * A API oficial publica story a partir de uma imagem ou vídeo prontos — não
 * existe figurinha de texto. Então o texto que a pessoa escreve na tela de
 * Stories é desenhado nos pixels pelo ffmpeg (`drawtext`) antes do upload,
 * numa passada só.
 *
 * Story = 1080×1920; x/y são o CENTRO do bloco em coordenadas normalizadas
 * (0..1), o mesmo sistema do posicionador da tela.
 */

const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { FFMPEG_BIN } = require('./ffmpegBin');

ffmpeg.setFfmpegPath(FFMPEG_BIN);

const PROCESSED_DIR = path.resolve(__dirname, '../../uploads/processed');
const STORY_W = 1080;
const STORY_H = 1920;
const MARGIN_PX = 28;
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
const TIMEOUT_FFMPEG_MS = 180_000;

// ── O que chega da rede ──────────────────────────────────────────────────────

/* Tetos: o texto termina dentro de uma linha de comando do ffmpeg. O corte é
   por caractere, que é o que protege o comando; 6 × 80 é mais do que cabe
   legível num story. */
const MAX_LINHAS = 6;
const MAX_POR_LINHA = 80;

const TAMANHOS = ['pequeno', 'medio', 'grande'];
const CORES = ['branco', 'preto'];

/**
 * Converte o que veio no body num objeto de texto confiável, ou `null`.
 *
 * `null` quando não há texto de verdade — e a diferença importa: o serviço usa
 * a ausência para decidir se vale reprocessar a mídia. Um objeto com string
 * vazia dentro faria o ffmpeg rodar para desenhar nada.
 *
 * @param {any} bruto  O `req.body.textoLivre`, de tipo desconhecido.
 * @returns {{texto:string, x:number, y:number, tamanho:string, cor:string}|null}
 */
function limparTextoLivre(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;

  if (typeof bruto.texto !== 'string') return null;

  const texto = bruto.texto
    /* Caracteres de controle fora, menos a quebra de linha — que é a única
       formatação que este campo tem. Um \r sozinho, ou um byte nulo no meio,
       não aparecem na tela e mudam o que o ffmpeg lê da string. */
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
    .split('\n')
    .map(l => l.trim().slice(0, MAX_POR_LINHA))
    .filter(Boolean)
    .slice(0, MAX_LINHAS)
    .join('\n');

  if (!texto) return null;

  return {
    texto,
    x: fracao(bruto.x, 0.5),
    y: fracao(bruto.y, 0.35),
    tamanho: TAMANHOS.includes(bruto.tamanho) ? bruto.tamanho : 'medio',
    cor: CORES.includes(bruto.cor) ? bruto.cor : 'branco',
  };
}

/**
 * Número entre 0 e 1, ou o padrão.
 *
 * `null`, `undefined` e `''` são ausência, não zero — `Number(null)` vale 0, e
 * zero é uma posição legítima (encostar na borda). Confundir os dois joga o
 * texto para o canto de quem só não mexeu no controle.
 */
function fracao(valor, padrao) {
  /* Só número ou string. `Number([])` vale 0 e `Number([7])` vale 7 — finitos
     os dois, e um array chegando como coordenada colocaria o texto na borda
     esquerda sem que ninguém tivesse pedido. O tipo entra na validação porque
     `Number()` aceita coisas demais. */
  if (typeof valor !== 'number' && typeof valor !== 'string') return padrao;
  if (valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(1, Math.max(0, n));
}

// ── Desenho ──────────────────────────────────────────────────────────────────

/** Executa um comando ffmpeg com teto de tempo, matando o processo no estouro. */
function executarFfmpeg(comando, limiteMs = TIMEOUT_FFMPEG_MS) {
  return new Promise((resolve, reject) => {
    const cronometro = setTimeout(() => {
      try { comando.kill('SIGKILL'); } catch { /* já morreu */ }
      reject(new Error(`ffmpeg passou de ${Math.round(limiteMs / 1000)}s e foi encerrado`));
    }, limiteMs);

    comando
      .on('end', () => { clearTimeout(cronometro); resolve(); })
      .on('error', err => { clearTimeout(cronometro); reject(err); })
      .run();
  });
}

function clamp(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

const FONTES_CANDIDATAS = [
  '/usr/share/fonts/truetype/inter/Inter-Bold.ttf',
  '/usr/share/fonts/truetype/inter/InterDisplay-Bold.ttf',
  '/usr/share/fonts/opentype/inter/Inter-Bold.otf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
];

function acharFonte() {
  return FONTES_CANDIDATAS.find(f => {
    try { return fs.existsSync(f); } catch { return false; }
  }) || null;
}

/** drawtext trata `:` como separador e `'`/`\\` como escape — precisam sair. */
function escaparDrawtext(txt) {
  return String(txt)
    // A libfreetype não desenha emoji colorido: sem ele é melhor que com um quadrado vazio.
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\\/g, '').replace(/'/g, '').replace(/:/g, ' -').replace(/%/g, '');
}

const TAMANHOS_TEXTO = Object.freeze({
  pequeno: 0.045,
  medio:   0.065,
  grande:  0.095,
});

function filtrosDeTexto(textoLivre, fonte) {
  if (!textoLivre || !String(textoLivre.texto || '').trim() || !fonte) return [];

  const linhas = String(textoLivre.texto)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 6);                       // teto: um story não é um documento
  if (!linhas.length) return [];

  const fracao  = TAMANHOS_TEXTO[textoLivre.tamanho] || TAMANHOS_TEXTO.medio;
  const tamanho = Math.round(STORY_W * fracao);
  const alturaLinha = Math.round(tamanho * 1.35);

  /* Padrão quando a posição não vem: centro na horizontal, um pouco acima do
     meio na vertical — onde o texto não disputa com a figurinha de link, que
     mora embaixo por padrão.

     Sem isto, `Number(undefined)` vira NaN, o `clamp` propaga o NaN, e o filtro
     sai com `x=(NaN-text_w/2)`. O ffmpeg falha, e a mensagem dele não menciona
     posição nenhuma — o story sairia sem texto e sem explicação. */
  /* `Number.isFinite(Number(v))` sozinho não basta: `Number(null)` e
     `Number('')` valem 0 — finitos, e 0 é uma posição válida. Um campo
     vazio no formulário chega como '' e jogaria o texto para a borda
     esquerda; no `y`, para fora da tela por cima. Ausente é ausente; zero
     só quando alguém escreveu zero. */
  const num = (v, padrao) => {
    if (v === null || v === undefined || v === '') return padrao;
    const n = Number(v);
    return Number.isFinite(n) ? n : padrao;
  };
  const x = clamp(num(textoLivre.x, 0.5),  0, 1);
  const y = clamp(num(textoLivre.y, 0.35), 0, 1);

  /* O bloco é centrado no ponto pedido: o primeiro `y` sobe metade da altura
     total. Sem isso, arrastar para o meio deixaria o texto começando no meio e
     descendo — e a posição vista no preview não seria a obtida. */
  const alturaTotal = alturaLinha * linhas.length;

  /* O bloco fica preso dentro da mídia, como a figurinha de link já ficava
     (`computeStickerBox` faz o mesmo com a pílula).

     Sem isto, arrastar o texto até a borda de baixo desenhava metade dele
     fora do quadro: o ffmpeg aceita coordenada negativa e simplesmente corta
     o que passa do limite. O resultado é um story com meia linha de texto — e
     como o preview espelhava a mesma conta, ele mostrava a mesma metade e a
     pessoa achava que era assim que ficava. Espelhar um defeito não é
     fidelidade. */
  const topo = Math.round(
    clamp(y * STORY_H - alturaTotal / 2, MARGIN_PX, STORY_H - alturaTotal - MARGIN_PX)
  );

  const cor = textoLivre.cor === 'preto' ? 'black' : 'white';
  const corCaixa = textoLivre.cor === 'preto' ? 'white' : 'black';

  return linhas.map((linha, i) => {
    const texto = escaparDrawtext(linha);
    const linhaY = topo + i * alturaLinha;
    return (
      `drawtext=fontfile='${fonte.replace(/\\/g, '/').replace(/:/g, '\\:')}'` +
      `:text='${texto}'` +
      `:fontsize=${tamanho}` +
      `:fontcolor=${cor}` +
      /* `x` centraliza ESTA linha: a expressão usa `text_w`, que o ffmpeg
         resolve por chamada. É isso que faz linhas de comprimentos diferentes
         ficarem centradas entre si. */
      /* Na horizontal quem prende é o próprio ffmpeg: a largura do texto só
         existe em `text_w`, resolvida por ele na hora de desenhar — daqui não
         dá para saber quanto ocupa uma linha na fonte carregada. `max(min())`
         é expressão válida de drawtext e faz o corte no mesmo lugar que a
         conta de cima faz na vertical. */
      `:x=max(${MARGIN_PX}\\,min(${STORY_W - MARGIN_PX}-text_w\\,${Math.round(x * STORY_W)}-text_w/2))` +
      `:y=${linhaY}` +
      `:box=1:boxcolor=${corCaixa}@0.45:boxborderw=${Math.round(tamanho * 0.28)}`
    );
  });
}

/**
 * Queima o texto na mídia e devolve o caminho do arquivo novo (em processed/).
 * Sem texto, devolve a própria entrada. Falhando, devolve a entrada também — o
 * story sai sem o texto em vez de não sair.
 *
 * @returns {Promise<{caminho: string, queimado: boolean}>}
 */
async function queimarTexto(entrada, textoLivre) {
  const desenhos = filtrosDeTexto(textoLivre, acharFonte());
  if (!desenhos.length) return { caminho: entrada, queimado: false };

  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const ext = path.extname(entrada).toLowerCase();
  const video = VIDEO_EXTS.includes(ext);
  const saida = path.join(PROCESSED_DIR, `${path.basename(entrada, ext)}_texto_${Date.now()}${video ? '.mp4' : '.jpg'}`);

  const escala = `scale=${STORY_W}:${STORY_H}:force_original_aspect_ratio=increase,crop=${STORY_W}:${STORY_H},setsar=1`;
  const opcoes = video
    ? ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'fast', '-crf', '19', '-c:a', 'aac', '-b:a', '192k',
       '-ar', '44100', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    : ['-q:v', '2', '-frames:v', '1'];

  try {
    await executarFfmpeg(ffmpeg(entrada).videoFilters(`${escala},${desenhos.join(',')}`).outputOptions(opcoes).output(saida));
    return { caminho: saida, queimado: true };
  } catch (err) {
    console.error(`💥 [Story] texto não pôde ser queimado: ${err.message} — o story sai sem ele`);
    return { caminho: entrada, queimado: false };
  }
}

module.exports = {
  limparTextoLivre, filtrosDeTexto, queimarTexto, acharFonte, escaparDrawtext,
  MAX_LINHAS, MAX_POR_LINHA, TAMANHOS, CORES, TAMANHOS_TEXTO, STORY_W, STORY_H,
};

'use strict';

/**
 * Figurinha de link do story — renderização visual.
 *
 * ── Por que isto existe ──────────────────────────────────────────────────────
 * O Instagram NÃO desenha figurinhas no servidor: quem desenha é o app de quem
 * assiste, a partir dos metadados da mídia. A instagrapi 2.18.16 monta o link
 * apenas em `tap_models` (mixins/photo.py, bloco `if links:`), que cria a ÁREA
 * CLICÁVEL mas não é o campo que o app usa para desenhar a figurinha. Resultado:
 * o story sai com o link funcionando e invisível.
 *
 * A solução determinística é queimar a pílula nos pixels da mídia, na MESMA
 * geometria enviada como área de toque. Quem assiste vê a pílula (nossa) e toca
 * nela (área nativa) — a experiência completa da figurinha de link.
 *
 * ── Contrato de geometria ────────────────────────────────────────────────────
 * Story = 1080x1920. x/y são o CENTRO da figurinha em coordenadas normalizadas
 * (0..1), o mesmo sistema do Instagram e do posicionador da tela de Stories.
 * `computeStickerBox()` é a fonte única dessa conta — o valor devolvido é o que
 * vai para o ffmpeg E para o payload do sticker nativo.
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const PROCESSED_DIR = path.resolve(__dirname, '../../uploads/processed');
const STICKERS_DIR  = path.resolve(__dirname, '../../uploads/stickers');

// Resolução canônica do story. Toda a matemática de posição vive nesta escala.
const STORY_W = 1080;
const STORY_H = 1920;

// Limites da pílula, em pixels do story.
const PILL_H_DEFAULT = 96;
const PILL_H_MIN     = 64;
const PILL_H_MAX     = 160;
const PILL_W_MIN     = 360;
const PILL_W_MAX     = 900;
const MARGIN_PX      = 28;   // respiro mínimo até a borda do story

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];

// Teto para o ffmpeg. Um arquivo corrompido faz o processo ficar preso sem
// nunca emitir 'end' nem 'error' — e a fila de stories pararia atrás dele.
const TIMEOUT_FFMPEG_MS = Number(process.env.STORY_FFMPEG_TIMEOUT_MS || 180000);

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

function ensureDirs() {
  if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  if (!fs.existsSync(STICKERS_DIR))  fs.mkdirSync(STICKERS_DIR,  { recursive: true });
}

/**
 * Texto exibido na pílula. Sem texto customizado, usa o domínio do link — é o
 * que o próprio Instagram mostra quando o usuário não personaliza.
 */
function formatStickerLabel(linkUrl, customText) {
  if (customText && String(customText).trim()) {
    // Corte por grafema: `.slice()` conta unidades UTF-16 e parte um emoji ao
    // meio, deixando meio caractere quebrado no fim da pílula.
    return grafemas(String(customText).trim()).slice(0, 35).join('');
  }
  try {
    const parsed = new URL(String(linkUrl).startsWith('http') ? linkUrl : `https://${linkUrl}`);
    const host = parsed.hostname.replace(/^www\./i, '');
    const rota = parsed.pathname.replace(/\/$/, '');
    if (rota && rota.length <= 18) return `${host}${rota}`.toUpperCase();
    return host.toUpperCase();
  } catch {
    return 'ACESSAR LINK';
  }
}

function clamp(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

/** Reconhece emoji e pictogramas — eles ocupam quase o dobro de uma letra. */
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Divide o texto em grafemas (o que a pessoa enxerga como "um caractere").
 *
 * `[...texto]` quebra por code point, o que separa emoji compostos: bandeiras,
 * tons de pele e sequências com ZWJ (👨‍👩‍👧) viram vários pedaços e, no corte
 * por tamanho, sairiam partidos ao meio. `Intl.Segmenter` agrupa corretamente.
 */
function grafemas(texto) {
  const s = String(texto);
  try {
    const seg = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
    return [...seg.segment(s)].map(g => g.segment);
  } catch {
    return [...s];
  }
}

/**
 * Largura estimada do texto em pixels do story, para a pílula nascer do
 * tamanho do rótulo.
 *
 * Os coeficientes vêm de medição no próprio Chromium com a fonte da pílula:
 * maiúsculas e dígitos ficam em ~23px, minúsculas em ~18px e o espaço em ~12px.
 * Emoji são quadrados e ocupam ~40px — contá-los como letra encolhia a pílula e
 * o texto saía cortado com reticências.
 */
function larguraTextoPx(texto, hPx) {
  const escala = hPx / PILL_H_DEFAULT;
  const soma = grafemas(texto).reduce((acc, c) => {
    if (c === ' ') return acc + 12;
    if (EMOJI.test(c)) return acc + 40;
    const minuscula = c === c.toLowerCase() && c !== c.toUpperCase();
    return acc + (minuscula ? 18 : 23);
  }, 0);
  return soma * escala;
}

/**
 * Geometria final da figurinha — fonte única para o overlay e para a área de toque.
 *
 * Largura/altura vêm do chamador quando informadas (normalizadas 0..1); senão a
 * largura acompanha o texto, como no app. O centro é reposicionado para que a
 * pílula caiba inteira dentro do story: figurinha cortada na borda é figurinha
 * que sai pela metade.
 *
 * @returns {{wPx:number,hPx:number,xPx:number,yPx:number,
 *            x:number,y:number,width:number,height:number}}
 */
function computeStickerBox({ label = '', linkX, linkY, linkWidth, linkHeight } = {}) {
  const texto = String(label || 'ACESSAR LINK');

  const hPx = Number.isFinite(Number(linkHeight)) && Number(linkHeight) > 0
    ? Math.round(clamp(Number(linkHeight) * STORY_H, PILL_H_MIN, PILL_H_MAX))
    : PILL_H_DEFAULT;

  // Texto medido + o cromo fixo da pílula (glifo de corrente, gap e paddings).
  const larguraAuto = Math.round(larguraTextoPx(texto, hPx) + 165 * (hPx / PILL_H_DEFAULT));
  const wPx = Number.isFinite(Number(linkWidth)) && Number(linkWidth) > 0
    ? Math.round(clamp(Number(linkWidth) * STORY_W, PILL_W_MIN, PILL_W_MAX))
    : Math.round(clamp(larguraAuto, PILL_W_MIN, PILL_W_MAX));

  const centroXBruto = Number.isFinite(Number(linkX)) ? Number(linkX) : 0.5;
  const centroYBruto = Number.isFinite(Number(linkY)) ? Number(linkY) : 0.8;

  const meiaL = wPx / 2;
  const meiaA = hPx / 2;
  const xPx = Math.round(clamp(centroXBruto * STORY_W, meiaL + MARGIN_PX, STORY_W - meiaL - MARGIN_PX));
  const yPx = Math.round(clamp(centroYBruto * STORY_H, meiaA + MARGIN_PX, STORY_H - meiaA - MARGIN_PX));

  return {
    wPx, hPx, xPx, yPx,
    x:      Number((xPx / STORY_W).toFixed(6)),
    y:      Number((yPx / STORY_H).toFixed(6)),
    width:  Number((wPx / STORY_W).toFixed(6)),
    height: Number((hPx / STORY_H).toFixed(6)),
  };
}

function caminhoCache(label, wPx, hPx, engine) {
  const hash = crypto.createHash('sha1')
    .update(`${label}|${wPx}|${hPx}|${engine}`)
    .digest('hex').slice(0, 20);
  return path.join(STICKERS_DIR, `sticker_${engine}_${hash}.png`);
}

// ── Motor 1: Chromium (visual do app) ────────────────────────────────────────

/**
 * PNG da pílula pelo Chromium, no tamanho EXATO em que será sobreposta.
 *
 * deviceScaleFactor fica em 1 de propósito: o destino é a tela 1080x1920, então
 * renderizar em 2x devolveria uma imagem com o dobro dos pixels e o overlay
 * sairia com o dobro do tamanho pedido.
 */
async function gerarPngChromium(label, wPx, hPx) {
  const destino = caminhoCache(label, wPx, hPx, 'cr');
  if (fs.existsSync(destino)) return destino;

  const safeText = String(label)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // ── Proporções da figurinha ──────────────────────────────────────────────
  //
  // Copiadas do sticker de link do app: pílula branca totalmente arredondada,
  // glifo de corrente escuro em linha com o texto e CAIXA ALTA com peso médio.
  // A versão anterior tinha um ícone dentro de um círculo azul e um chevron à
  // direita — dois elementos que o Instagram não desenha, e que era justamente
  // o que fazia a figurinha parecer "de outro app".
  const raio     = Math.round(hPx / 2);
  const fonte    = Math.round(hPx * 0.34);
  const glifo    = Math.round(fonte * 1.02);
  const gap      = Math.round(hPx * 0.11);
  const padLado  = Math.round(hPx * 0.30);
  const maxTexto = wPx - glifo - gap - padLado * 2;

  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>',
    '* { margin:0; padding:0; box-sizing:border-box; }',
    `html, body { width:${wPx}px; height:${hPx}px; background:transparent; overflow:hidden;`,
    '  display:flex; align-items:center; justify-content:center; }',
    // "Noto Color Emoji" precisa estar na pilha: sem ela o Chromium desenha uma
    // caixa vazia no lugar do emoji, mesmo com a fonte instalada no sistema.
    `.pill { display:inline-flex; align-items:center; gap:${gap}px;`,
    `  max-width:${wPx - 4}px; height:${hPx - 4}px; padding:0 ${padLado}px;`,
    `  background:#FFFFFF; border-radius:${raio}px;`,
    '  box-shadow:0 2px 12px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.10);',
    '  font-family:-apple-system,"SF Pro Text","Segoe UI",Roboto,"Noto Sans",',
    '    Helvetica,Arial,"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif; }',
    `.ic { width:${glifo}px; height:${glifo}px; flex-shrink:0; display:block; }`,
    `.tx { font-size:${fonte}px; font-weight:600; letter-spacing:.005em; color:#0B0B0B;`,
    `  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:${maxTexto}px;`,
    '  line-height:1; }',
    '</style></head><body><div class="pill">',
    // Glifo de corrente do próprio sticker: dois elos inclinados, traço redondo.
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="#0B0B0B" stroke-width="2.1"',
    ' stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>',
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    `<span class="tx">${safeText}</span>`,
    '</div></body></html>',
  ].join('\n');

  const puppeteer = require('puppeteer');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  let browser;
  let cronometro;
  try {
    const lancamento = puppeteer.launch({
      headless: 'new',
      executablePath,
      timeout: 20000,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--disable-extensions',
        '--disable-background-networking', '--hide-scrollbars',
      ],
    });
    // Cinto de segurança: launch já tem timeout próprio, mas um Chromium que
    // trava antes de responder deixaria a promise pendurada e o story parado.
    // O timer é cancelado no finally — senão segura o event loop por 25s a cada
    // figurinha e o worker demora a encerrar.
    const estouro = new Promise((_, rej) => {
      cronometro = setTimeout(() => rej(new Error('Chromium nao respondeu em 25s')), 25000);
    });

    browser = await Promise.race([lancamento, estouro]);

    const page = await browser.newPage();
    await page.setViewport({ width: wPx, height: hPx, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 8000 });
    await page.screenshot({ path: destino, type: 'png', omitBackground: true });
  } finally {
    clearTimeout(cronometro);
    if (browser) await browser.close().catch(() => {});
  }

  return destino;
}

// ── Motor 2: ffmpeg puro (sem navegador) ─────────────────────────────────────

const FONTES_CANDIDATAS = [
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

/** drawtext trata `:` como separador e `'`/`\` como escape — precisam sair. */
function escaparDrawtext(txt) {
  return String(txt)
    // O drawtext usa libfreetype, que não desenha emoji colorido: cada emoji
    // sairia como um quadrado vazio. Sem emoji é melhor do que com tofu — e
    // este é só o motor reserva, quando o Chromium não sobe.
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\\/g, '').replace(/'/g, '').replace(/:/g, ' -').replace(/%/g, '');
}

/**
 * PNG da pílula sem Chromium.
 *
 * Os cantos arredondados saem de uma máscara alpha em `geq`: distância ao
 * retângulo interno menor que o raio = opaco. Sem navegador e sem dependência
 * nova — o ffmpeg já é obrigatório neste serviço.
 */
async function gerarPngFfmpeg(label, wPx, hPx) {
  const destino = caminhoCache(label, wPx, hPx, 'ff');
  if (fs.existsSync(destino)) return destino;

  const fonte = acharFonte();
  if (!fonte) throw new Error('nenhuma fonte TTF disponivel para o motor ffmpeg');

  const raio    = hPx / 2;
  const tamanho = Math.round(hPx * 0.34);
  // Corta o texto no que cabe na pílula: drawtext não tem ellipsis.
  const maxChars = Math.max(6, Math.floor((wPx - hPx * 1.1) / (tamanho * 0.58)));
  const texto    = escaparDrawtext(label).slice(0, maxChars);

  const alpha =
    `if(lte(pow(max(0\\,abs(X-${wPx / 2})-${wPx / 2 - raio})\\,2)` +
    `+pow(abs(Y-${hPx / 2})\\,2)\\,${raio * raio})\\,255\\,0)`;

  const filtros = [
    `[0:v]format=rgba,geq=r='255':g='255':b='255':a='${alpha}'[pill]`,
    `[pill]drawtext=fontfile='${fonte}':text='${texto}':fontcolor=#111827:` +
      `fontsize=${tamanho}:x=(w-text_w)/2:y=(h-text_h)/2[out]`,
  ];

  await executarFfmpeg(
    ffmpeg()
      .input(`color=c=white:s=${wPx}x${hPx}:d=1`)
      .inputFormat('lavfi')
      .complexFilter(filtros)
      .outputOptions(['-map', '[out]', '-frames:v', '1'])
      .output(destino),
    30000,
  );

  return destino;
}

/**
 * PNG da figurinha. Chromium primeiro (visual do app); ffmpeg como rede de
 * segurança para que a figurinha nunca dependa de um navegador funcionando.
 *
 * @returns {Promise<{path: string, engine: 'chromium'|'ffmpeg'}>}
 */
async function generateStickerPng(label, wPx = 620, hPx = PILL_H_DEFAULT) {
  ensureDirs();
  try {
    return { path: await gerarPngChromium(label, wPx, hPx), engine: 'chromium' };
  } catch (err) {
    console.warn(`⚠️ [StorySticker] Chromium indisponivel (${err.message}) — usando motor ffmpeg`);
    return { path: await gerarPngFfmpeg(label, wPx, hPx), engine: 'ffmpeg' };
  }
}

// ── Queima na mídia ──────────────────────────────────────────────────────────

/**
 * Sobrepõe a figurinha na imagem ou vídeo, normalizando para 1080x1920.
 *
 * @param {string} inputPath  caminho absoluto da mídia original
 * @param {Object} options    { linkUrl, linkText, linkX, linkY, linkWidth, linkHeight }
 * @returns {Promise<{path:string, rendered:boolean, box:Object, engine:string|null, error?:string}>}
 *          `rendered:false` devolve a mídia original — o story ainda sai, com o
 *          link nativo (invisível), em vez de falhar a publicação inteira.
 */
/* Tamanhos do texto livre, em fração da largura do story.

   Nomes e não pixels: "grande" sobrevive a uma mudança de resolução, "72px"
   não. E são três porque a escolha é de ênfase, não de tipografia — quem está
   publicando um story não quer decidir corpo de fonte. */
const TAMANHOS_TEXTO = Object.freeze({
  pequeno: 0.045,
  medio:   0.065,
  grande:  0.095,
});

/**
 * Filtros `drawtext` para o texto livre sobre a mídia.
 *
 * ── Por que drawtext e não outro PNG
 *
 * A figurinha vira PNG porque tem forma — cantos arredondados, ícone, chevron.
 * Texto é só texto: o ffmpeg desenha direto, sem gerar arquivo, sem cache e
 * sem uma segunda dependência. E entra na MESMA passada do overlay, o que
 * importa em vídeo: duas passadas re-codificariam tudo duas vezes, perdendo
 * qualidade e dobrando o tempo.
 *
 * ── Por que a caixa atrás
 *
 * Texto branco sobre foto clara some, e sobre foto escura o preto some. Não dá
 * para saber qual é o caso sem analisar a imagem. A caixa semitransparente
 * resolve os dois de uma vez, e é o mesmo recurso que o Instagram oferece.
 *
 * ── Por que uma linha por filtro
 *
 * `drawtext` centraliza cada chamada isoladamente. Passando o texto inteiro
 * com quebras, as linhas saem alinhadas à esquerda dentro de um bloco
 * centralizado — que não é o que se espera de um texto centralizado.
 */
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

async function renderStoryWithLinkSticker(inputPath, options = {}) {
  ensureDirs();

  const { linkUrl, linkText, textoLivre } = options;
  const label = formatStickerLabel(linkUrl, linkText);
  const box   = computeStickerBox({ label, ...options });

  const temTexto = !!(textoLivre && String(textoLivre.texto || '').trim());

  /* Sem link E sem texto não há o que queimar. Antes bastava não ter link —
     e com isso um story só com texto passava direto, devolvendo a mídia
     original como se tivesse sido processada. */
  if (!linkUrl && !temTexto) {
    return { path: inputPath, rendered: false, box, engine: null };
  }

  let sticker = null;
  if (linkUrl) {
    try {
      sticker = await generateStickerPng(label, box.wPx, box.hPx);
    } catch (err) {
      console.error(`💥 [StorySticker] Nao foi possivel gerar a figurinha: ${err.message}`);
      /* Com texto pedido, a falha da figurinha não cancela o resto: perder o
         link é ruim, perder o link E o texto é pior. */
      if (!temTexto) {
        return { path: inputPath, rendered: false, box, engine: null, error: err.message };
      }
    }
  }

  const ext     = path.extname(inputPath).toLowerCase();
  const isVideo = VIDEO_EXTS.includes(ext);
  const base    = path.basename(inputPath, ext);
  const saida   = path.join(PROCESSED_DIR, `${base}_link_${Date.now()}${isVideo ? '.mp4' : '.jpg'}`);

  // Canto superior esquerdo do overlay: centro pedido menos meia figurinha.
  const overlayX = box.xPx - Math.round(box.wPx / 2);
  const overlayY = box.yPx - Math.round(box.hPx / 2);

  /* O texto vai ANTES da figurinha na cadeia: se os dois se sobrepuserem, a
     figurinha fica por cima — ela é clicável e o texto não, e esconder o alvo
     do toque atrás de um texto decorativo seria trocar função por enfeite. */
  const desenhos = filtrosDeTexto(textoLivre, acharFonte());

  const escala =
    `[0:v]scale=${STORY_W}:${STORY_H}:force_original_aspect_ratio=increase,` +
    `crop=${STORY_W}:${STORY_H},setsar=1`;

  const filtros = [];
  if (sticker) {
    filtros.push(`${escala}${desenhos.length ? ',' + desenhos.join(',') : ''}[bg]`);
    filtros.push('[1:v]format=rgba[st]');
    filtros.push(`[bg][st]overlay=x=${overlayX}:y=${overlayY}:eval=init[outv]`);
  } else {
    // Só texto: nenhuma segunda entrada, nenhum overlay.
    filtros.push(`${escala},${desenhos.join(',')}[outv]`);
  }

  const opcoes = isVideo
    ? ['-map', '[outv]', '-map', '0:a?', '-c:v', 'libx264', '-profile:v', 'high',
       '-preset', 'fast', '-crf', '19', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
       '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    : ['-map', '[outv]', '-q:v', '2', '-frames:v', '1'];

  try {
    await executarFfmpeg(
      (() => {
        const cmd = ffmpeg().input(inputPath);
        if (sticker) cmd.input(sticker.path);
        return cmd;
      })()
        .complexFilter(filtros)
        .outputOptions(opcoes)
        .output(saida)
    );
  } catch (err) {
    console.error(`💥 [StorySticker] Overlay falhou: ${err.message}`);
    return { path: inputPath, rendered: false, box,
             engine: sticker ? sticker.engine : 'drawtext', error: err.message };
  }

  console.log(
    `✅ [StorySticker] ${sticker ? `"${label}" via ${sticker.engine}` : 'sem figurinha'}` +
    `${desenhos.length ? ` + ${desenhos.length} linha(s) de texto` : ''} → ${path.basename(saida)}`
  );
  return {
    path: saida, rendered: true, box,
    engine: sticker ? sticker.engine : 'drawtext',
    linhasDeTexto: desenhos.length,
  };
}

module.exports = {
  filtrosDeTexto,
  TAMANHOS_TEXTO,
  acharFonte,
  renderStoryWithLinkSticker,
  computeStickerBox,
  formatStickerLabel,
  generateStickerPng,
  STORY_W,
  STORY_H,
};

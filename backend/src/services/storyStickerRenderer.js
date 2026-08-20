'use strict';

const path   = require('path');
const fs     = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const PROCESSED_DIR = path.resolve(__dirname, '../../uploads/processed');
const STICKERS_DIR  = path.resolve(__dirname, '../../uploads/stickers');

function ensureDirs() {
  if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  if (!fs.existsSync(STICKERS_DIR))  fs.mkdirSync(STICKERS_DIR,  { recursive: true });
}

/**
 * Formata o texto exibido no sticker caso o usuário não tenha passado um texto personalizado.
 * Ex: https://meusite.com/oferta?ref=123 -> MEUSITE.COM
 */
function formatStickerLabel(linkUrl, customText) {
  if (customText && String(customText).trim()) {
    return String(customText).trim();
  }
  try {
    const parsed = new URL(linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`);
    let host = parsed.hostname.replace(/^www\./i, '');
    let pathname = parsed.pathname.replace(/\/$/, '');
    if (pathname && pathname.length <= 18) {
      return `${host}${pathname}`.toUpperCase();
    }
    return host.toUpperCase();
  } catch {
    return 'ACESSO AO LINK';
  }
}

/**
 * Gera o arquivo PNG do sticker com a estética oficial do Instagram
 * (Pill branca arredondada, ícone de corrente azul, texto em negrito e chevron).
 */
async function generateStickerPng(labelText) {
  ensureDirs();
  const hash = Buffer.from(labelText).toString('hex').slice(0, 16);
  const stickerPath = path.join(STICKERS_DIR, `sticker_${hash}.png`);

  if (fs.existsSync(stickerPath)) {
    return stickerPath;
  }

  // Largura dinâmica calculada a partir do texto
  const safeText = String(labelText || 'ACESSO AO LINK')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const charCount = safeText.length;
  // Largura mínima 340px, máxima 680px
  const widthPx = Math.min(680, Math.max(340, charCount * 18 + 140));
  const heightPx = 90;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: ${widthPx}px;
  height: ${heightPx}px;
  background: transparent;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.pill {
  width: ${widthPx - 8}px;
  height: ${heightPx - 8}px;
  background: #FFFFFF;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px 0 20px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.18);
}
.left-group {
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
}
.icon-box {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #EFF6FF;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.icon-box svg {
  width: 20px;
  height: 20px;
  stroke: #2563EB;
}
.label {
  font-size: 23px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: ${widthPx - 130}px;
}
.arrow {
  color: #6B7280;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.arrow svg {
  width: 18px;
  height: 18px;
  stroke: #6B7280;
}
</style>
</head>
<body>
  <div class="pill">
    <div class="left-group">
      <div class="icon-box">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      </div>
      <span class="label">${safeText}</span>
    </div>
    <div class="arrow">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </div>
  </div>
</body>
</html>`;

  let puppeteer;
  try { puppeteer = require('puppeteer-extra'); }
  catch { puppeteer = require('puppeteer'); }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage',
      `--window-size=${widthPx},${heightPx}`,
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: widthPx, height: heightPx, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.screenshot({
      path: stickerPath,
      type: 'png',
      omitBackground: true,
    });
  } finally {
    await browser.close().catch(() => {});
  }

  return stickerPath;
}

/**
 * Aplica o sticker sobre a imagem ou vídeo 1080x1920.
 *
 * @param {string} inputPath      - Caminho absoluto do arquivo original
 * @param {Object} options
 * @param {string} options.linkUrl   - URL do link
 * @param {string} [options.linkText] - Texto customizado (opcional)
 * @param {number} [options.linkX]   - Centro X normalizado (0..1, padrão 0.5)
 * @param {number} [options.linkY]   - Centro Y normalizado (0..1, padrão 0.8)
 * @returns {Promise<string>}       - Caminho absoluto da mídia com sticker visual
 */
async function renderStoryWithLinkSticker(inputPath, options = {}) {
  ensureDirs();

  const { linkUrl, linkText, linkX = 0.5, linkY = 0.8 } = options;
  if (!linkUrl) return inputPath;

  const label = formatStickerLabel(linkUrl, linkText);
  let stickerPngPath;
  try {
    stickerPngPath = await generateStickerPng(label);
  } catch (err) {
    console.error('[StorySticker] Falha ao gerar PNG do sticker:', err.message);
    return inputPath;
  }

  const ext = path.extname(inputPath).toLowerCase();
  const isVid = ['.mp4', '.mov', '.webm', '.avi', '.mkv'].includes(ext);
  const baseName = path.basename(inputPath, ext);
  const outName = `${baseName}_sticker_${Date.now()}${isVid ? '.mp4' : '.jpg'}`;
  const outputPath = path.join(PROCESSED_DIR, outName);

  // Calcula a posição do overlay em pixels para resolução de Story (1080x1920)
  const normX = Math.min(0.95, Math.max(0.05, Number(linkX) || 0.5));
  const normY = Math.min(0.95, Math.max(0.05, Number(linkY) || 0.8));

  const overlayXExpr = `(${normX}*main_w)-(overlay_w/2)`;
  const overlayYExpr = `(${normY}*main_h)-(overlay_h/2)`;

  return new Promise((resolve) => {
    if (isVid) {
      ffmpeg()
        .input(inputPath)
        .input(stickerPngPath)
        .complexFilter([
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]`,
          `[bg][1:v]overlay=x='${overlayXExpr}':y='${overlayYExpr}':eval=init[outv]`,
        ])
        .outputOptions([
          '-map', '[outv]',
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-profile:v', 'high',
          '-preset', 'fast',
          '-crf', '19',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
        ])
        .output(outputPath)
        .on('end', () => {
          console.log(`✅ [StorySticker] Vídeo gerado com sticker visível: ${path.basename(outputPath)}`);
          resolve(outputPath);
        })
        .on('error', err => {
          console.error(`💥 [StorySticker] Erro no overlay de vídeo:`, err.message);
          resolve(inputPath);
        })
        .run();
    } else {
      ffmpeg()
        .input(inputPath)
        .input(stickerPngPath)
        .complexFilter([
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]`,
          `[bg][1:v]overlay=x='${overlayXExpr}':y='${overlayYExpr}':eval=init[outv]`,
        ])
        .outputOptions([
          '-map', '[outv]',
          '-q:v', '1',
          '-frames:v', '1',
        ])
        .output(outputPath)
        .on('end', () => {
          console.log(`✅ [StorySticker] Imagem gerada com sticker visível: ${path.basename(outputPath)}`);
          resolve(outputPath);
        })
        .on('error', err => {
          console.error(`💥 [StorySticker] Erro no overlay de imagem:`, err.message);
          resolve(inputPath);
        })
        .run();
    }
  });
}

module.exports = {
  renderStoryWithLinkSticker,
  formatStickerLabel,
  generateStickerPng,
};

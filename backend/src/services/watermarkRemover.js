'use strict';

/**
 * Removedor de marca d'água via análise temporal + FFmpeg delogo.
 *
 * Algoritmo:
 *  1. Extrai 3 frames do vídeo (25%, 50%, 75%)
 *  2. Cria imagem "média" de f1 e f3 (blend=average)
 *  3. Computa diferença entre f2 e a média → pixels estáticos = baixo valor
 *  4. Analisa os 4 cantos da imagem de diferença com signalstats
 *  5. O canto com menor variação + conteúdo visível = candidato a watermark
 *  6. Aplica FFmpeg delogo nesse canto + escala para 1080×1920
 */

const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegBin    = require('ffmpeg-static');
const ffmpeg       = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegBin);

const run = promisify(execFile);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getVideoInfo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      if (err) return reject(err);
      const vs = meta.streams.find(s => s.codec_type === 'video');
      if (!vs) return reject(new Error('Sem stream de vídeo'));
      resolve({
        width:    vs.width,
        height:   vs.height,
        duration: parseFloat(vs.duration || meta.format?.duration || 10),
      });
    });
  });
}

async function extractFrame(inputPath, seekSec, outPath) {
  await run(ffmpegBin, [
    '-ss', String(Math.max(0, seekSec)),
    '-i', inputPath,
    '-frames:v', '1',
    '-q:v', '2',
    '-y', outPath,
  ]);
}

async function blendTwo(img1, img2, blendMode, outPath) {
  await run(ffmpegBin, [
    '-i', img1,
    '-i', img2,
    '-filter_complex', `[0:v][1:v]blend=all_mode=${blendMode}`,
    '-frames:v', '1',
    '-y', outPath,
  ]);
}

async function getYAVG(imagePath, x, y, w, h, statsFile) {
  await run(ffmpegBin, [
    '-i', imagePath,
    '-vf', `crop=${w}:${h}:${x}:${y},signalstats=stat=TOUT,metadata=print:file=${statsFile}`,
    '-frames:v', '1',
    '-f', 'null', '-',
  ]).catch(() => {}); // ignora erros de crop fora dos limites

  if (!fs.existsSync(statsFile)) return 128;
  const txt = fs.readFileSync(statsFile, 'utf8');
  fs.unlinkSync(statsFile);
  const m = txt.match(/YAVG=([0-9.]+)/);
  return m ? parseFloat(m[1]) : 128;
}

// ── Detecção ──────────────────────────────────────────────────────────────────

async function detectWatermarkRegion(inputPath) {
  const { width, height, duration } = await getVideoInfo(inputPath);

  const tmp = path.join(path.dirname(inputPath), `.wm_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });

  try {
    const safe = t => Math.min(Math.max(t, 0.5), duration - 0.5);
    const f1 = path.join(tmp, 'f1.png');
    const f2 = path.join(tmp, 'f2.png');
    const f3 = path.join(tmp, 'f3.png');

    await Promise.all([
      extractFrame(inputPath, safe(duration * 0.25), f1),
      extractFrame(inputPath, safe(duration * 0.50), f2),
      extractFrame(inputPath, safe(duration * 0.75), f3),
    ]);

    const avg  = path.join(tmp, 'avg.png');
    const diff = path.join(tmp, 'diff.png');
    await blendTwo(f1, f3, 'average', avg);
    await blendTwo(f2, avg, 'difference', diff);

    // Cantos: 30% da largura, 25% da altura
    const cw = Math.round(width  * 0.30);
    const ch = Math.round(height * 0.25);

    const corners = [
      { name: 'top-left',     x: 0,           y: 0            },
      { name: 'top-right',    x: width  - cw,  y: 0            },
      { name: 'bottom-left',  x: 0,           y: height - ch   },
      { name: 'bottom-right', x: width  - cw,  y: height - ch  },
    ];

    const results = await Promise.all(corners.map(async (c, i) => {
      const sf1 = path.join(tmp, `s_diff_${i}.txt`);
      const sf2 = path.join(tmp, `s_content_${i}.txt`);
      const [diffAvg, contentAvg] = await Promise.all([
        getYAVG(diff, c.x, c.y, cw, ch, sf1),
        getYAVG(f2,   c.x, c.y, cw, ch, sf2),
      ]);
      const score = diffAvg / (contentAvg + 1);
      return { ...c, cw, ch, diffAvg, contentAvg, score };
    }));

    // Se todos os cantos têm scores muito parecidos = vídeo estático, sem WM claro
    const scores = results.map(r => r.score);
    const scoreRange = Math.max(...scores) - Math.min(...scores);
    if (scoreRange < 0.08) return null;

    results.sort((a, b) => a.score - b.score);
    const best = results[0];

    // Sem conteúdo visível no canto ou score alto demais = não é WM
    if (best.contentAvg < 10 || best.score > 0.55) return null;

    return {
      x: best.x, y: best.y,
      w: cw, h: ch,
      corner: best.name,
      confidence: Math.round((1 - best.score / 0.55) * 100),
    };

  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Remoção ───────────────────────────────────────────────────────────────────

function applyDelogoAndConvert(inputPath, outputPath, region) {
  return new Promise((resolve, reject) => {
    const vf = [
      `delogo=x=${region.x}:y=${region.y}:w=${region.w}:h=${region.h}`,
      'scale=1080:1920:force_original_aspect_ratio=decrease',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    ].join(',');

    ffmpeg(inputPath)
      .videoFilter(vf)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions(['-crf 20', '-preset fast', '-movflags +faststart', '-pix_fmt yuv420p'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// ── Presets de plataforma ─────────────────────────────────────────────────────
// Cada preset define regiões como fração da largura/altura do vídeo.
// Múltiplas regiões = múltiplos delogo em cadeia.

const PRESETS = {
  kwai: [
    { xPct: 0.00, yPct: 0.82, wPct: 0.50, hPct: 0.18 }, // username (baixo-esquerda)
    { xPct: 0.62, yPct: 0.82, wPct: 0.38, hPct: 0.18 }, // logo Kwai (baixo-direita)
  ],
  tiktok: [
    { xPct: 0.00, yPct: 0.76, wPct: 0.68, hPct: 0.24 }, // username + info (baixo-esquerda)
  ],
  youtube: [
    { xPct: 0.00, yPct: 0.00, wPct: 0.28, hPct: 0.11 }, // logo (topo-esquerda)
  ],
  instagram: [
    { xPct: 0.00, yPct: 0.84, wPct: 1.00, hPct: 0.16 }, // barra inferior
  ],
  corner_tl: [{ xPct: 0.00, yPct: 0.00,  wPct: 0.32, hPct: 0.22 }],
  corner_tr: [{ xPct: 0.68, yPct: 0.00,  wPct: 0.32, hPct: 0.22 }],
  corner_bl: [{ xPct: 0.00, yPct: 0.78,  wPct: 0.32, hPct: 0.22 }],
  corner_br: [{ xPct: 0.68, yPct: 0.78,  wPct: 0.32, hPct: 0.22 }],
};

async function applyPreset(inputPath, outputPath, presetKey) {
  const def = PRESETS[presetKey];
  if (!def) throw new Error(`Preset desconhecido: ${presetKey}`);

  const { width, height } = await getVideoInfo(inputPath);

  const regions = def.map(r => ({
    x: Math.round(r.xPct * width),
    y: Math.round(r.yPct * height),
    w: Math.round(r.wPct * width),
    h: Math.round(r.hPct * height),
  }));

  console.log(`[WM] Preset ${presetKey}: ${regions.length} região(ões) definidas`);

  return new Promise((resolve, reject) => {
    // Encadeia um delogo por região + escala para 1080×1920
    const delogos = regions.map(r =>
      `delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}`
    );
    const vf = [
      ...delogos,
      'scale=1080:1920:force_original_aspect_ratio=decrease',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    ].join(',');

    ffmpeg(inputPath)
      .videoFilter(vf)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions(['-crf 20', '-preset fast', '-movflags +faststart', '-pix_fmt yuv420p'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// ── API pública ───────────────────────────────────────────────────────────────

async function detectAndRemove(inputPath, outputPath, preset = 'auto') {
  if (preset && preset !== 'auto') {
    return applyPreset(inputPath, outputPath, preset);
  }

  const region = await detectWatermarkRegion(inputPath);
  if (!region) {
    throw new Error(
      'Marca d\'água não detectada automaticamente. ' +
      'Selecione a plataforma (Kwai, TikTok…) ou o canto onde está o logo.'
    );
  }
  console.log(
    `[WM] Detectada em ${region.corner} (confiança ${region.confidence}%):`,
    `x=${region.x} y=${region.y} ${region.w}×${region.h}`
  );
  await applyDelogoAndConvert(inputPath, outputPath, region);
  return { region, outputPath };
}

module.exports = { detectAndRemove, detectWatermarkRegion, applyDelogoAndConvert, applyPreset, PRESETS };

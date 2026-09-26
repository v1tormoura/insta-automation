const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
/* NÃO usa ffmpeg-static direto: o build dele não tem o filtro `drawtext`, e a
   marca d'água (drawtext) derrubava a conversão inteira com "Filter not found".
   `ffmpegBin` escolhe um ffmpeg que tenha drawtext. Ver ffmpegBin.js. */
const { FFMPEG_BIN } = require('./ffmpegBin');

ffmpeg.setFfmpegPath(FFMPEG_BIN);

// Deduplicação de conversão concorrente: evita que dois workers convertam o mesmo arquivo simultaneamente
const _inProgress = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isVideo(file) {
  const name = file.toLowerCase();
  return name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.webm') || name.endsWith('.avi') || name.endsWith('.mkv');
}

function isImage(file) {
  const name = file.toLowerCase();
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
}

/**
 * Analisa o vídeo de entrada e retorna metadados.
 */
function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta);
    });
  });
}

/**
 * Converte o vídeo para o formato de Reel que a API aceita: 1080×1920,
 * H.264 High, AAC 44,1 kHz estéreo, yuv420p, +faststart.
 *
 * Só é chamado quando o original não serve como está (formato fora do que a
 * API aceita) ou quando há marca d'água a desenhar. Nada é sorteado: a mesma
 * entrada dá a mesma saída.
 *
 * @param {string} inputPath
 * @param {{ quality?: 'max'|'high'|'fast', sufixo?: string, marcaDagua?: string }} options
 *   `sufixo` separa o arquivo de cada conta; `marcaDagua` é o filtro drawtext
 *   já montado (marcaDagua.js) — este módulo não conhece contas.
 * @returns {Promise<string>} caminho do arquivo convertido
 */
function convertToReelFormat(inputPath, options = {}) {
  if (!isVideo(inputPath)) return Promise.resolve(inputPath);

  const outputDir = path.resolve(__dirname, '../../uploads/processed');
  ensureDir(outputDir);

  const filename = path.basename(inputPath, path.extname(inputPath));
  const marca = typeof options.marcaDagua === 'string' ? options.marcaDagua.trim() : '';
  let suffix = options.sufixo ? `-${options.sufixo}` : '-reel';
  /* Com marca, o texto entra na digital do nome: duas contas nunca dividem o
     arquivo — o @ de uma apareceria no vídeo da outra. */
  if (marca) suffix += `-m${require('crypto').createHash('sha256').update(marca).digest('hex').slice(0, 8)}`;
  const outputPath = path.join(outputDir, `${filename}${suffix}.mp4`);

  if (fs.existsSync(outputPath)) return Promise.resolve(outputPath);
  if (_inProgress.has(outputPath)) return _inProgress.get(outputPath);

  const configs = {
    max:  { crf: '15', preset: 'slow',     audioBitrate: '256k' },
    high: { crf: '18', preset: 'slow',     audioBitrate: '192k' },
    fast: { crf: '23', preset: 'veryfast', audioBitrate: '128k' },
  };
  const cfg = configs[options.quality] || configs.high;

  const promise = new Promise(async (resolve, reject) => {
    let probe;
    try { probe = await probeVideo(inputPath); } catch { /* segue com o padrão */ }
    const vStream = probe?.streams?.find(s => s.codec_type === 'video');
    const w = vStream?.width || 1080;
    const h = vStream?.height || 1920;

    /* Já em 9:16: só redimensiona (borda preta se sobrar). Fora disso: corte
       centrado para 9:16, o enquadramento do Reels. Lanczos na reamostragem. */
    let filtro = (h > w && Math.abs(w / h - 1080 / 1920) < 0.05)
      ? 'scale=1080:1920:flags=lanczos:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'
      : 'scale=1080:1920:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1920';
    if (marca) filtro += `,${marca}`;

    const opcoes = (preset, crf, audio) => [
      '-vf', filtro,
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1',
      '-preset', preset, '-crf', crf,
      '-c:a', 'aac', '-b:a', audio, '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', '-pix_fmt', 'yuv420p',
      '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '9999',
    ];

    console.log(`🎬 Convertendo ${path.basename(inputPath)} (${w}×${h}) → ${path.basename(outputPath)}`);
    ffmpeg(inputPath)
      .outputOptions(opcoes(cfg.preset, cfg.crf, cfg.audioBitrate))
      .on('end', () => { console.log(`✅ Vídeo convertido: ${path.basename(outputPath)}`); resolve(outputPath); })
      .on('error', err => {
        console.error(`💥 Erro na conversão: ${err.message}`);
        if (cfg.preset !== 'slow') return reject(err);
        // Uma segunda tentativa mais leve antes de desistir.
        ffmpeg(inputPath)
          .outputOptions(opcoes('veryfast', '23', '128k'))
          .on('end', () => resolve(outputPath))
          .on('error', reject)
          .save(outputPath);
      })
      .save(outputPath);
  });

  _inProgress.set(outputPath, promise);
  promise.finally(() => _inProgress.delete(outputPath)).catch(() => {});
  return promise;
}

/**
 * Imagem no formato que a API oficial aceita: JPEG, até 1440 px de largura e
 * proporção entre 4:5 e 1,91:1 no feed (9:16 no story).
 *
 * Imagem já dentro da proporção só é recodificada em JPEG — nada é cortado.
 * Fora dela, ganha borda preta até caber, em vez de o Instagram recusar.
 *
 * @param {'feed'|'story'} tipo
 * @returns {Promise<string>} caminho do JPEG em uploads/processed
 */
function jpegParaInstagram(inputPath, tipo = 'feed') {
  const outputDir = path.resolve(__dirname, '../../uploads/processed');
  ensureDir(outputDir);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${base}-ig-${tipo}.jpg`);

  const filtro = tipo === 'story'
    ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'
    : "scale='min(1440,iw)':-2,"
      + "pad=w='max(iw,ceil(ih*0.8/2)*2)':h='max(ih,ceil(iw/1.91/2)*2)':x=(ow-iw)/2:y=(oh-ih)/2:color=black,"
      + "scale='min(1440,iw)':-2";

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf', filtro, '-q:v', '2', '-frames:v', '1'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

module.exports = {
  convertToReelFormat,
  probeVideo,
  jpegParaInstagram,
  isVideo,
  isImage,
};

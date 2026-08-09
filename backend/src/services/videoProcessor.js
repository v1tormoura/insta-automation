const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

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
 * Converte vídeo para formato Reel Instagram com MÁXIMA QUALIDADE.
 *
 * Configurações de alta qualidade para viralização:
 * - Resolução: 1080×1920 (9:16 vertical)
 * - Codec: H.264 High Profile (máxima compatibilidade)
 * - CRF: 18 (quase lossless, menor = melhor qualidade)
 * - Preset: slow (melhor compressão = mais qualidade para mesmo tamanho)
 * - Bitrate áudio: 192k AAC (alta fidelidade)
 * - Sample rate: 44100 Hz (padrão Instagram)
 * - Pixel format: yuv420p (compatível universalmente)
 * - movflags: +faststart (streaming eficiente)
 * - Profile: high (H.264 High = melhor qualidade)
 */
function convertToReelFormat(inputPath, options = {}) {
  if (!isVideo(inputPath)) return Promise.resolve(inputPath);

  const outputDir = path.resolve(__dirname, '../../uploads/processed');
  ensureDir(outputDir);

  const filename = path.basename(inputPath, path.extname(inputPath));
  const quality = options.quality || 'high';
  const processMode = options.processMode || 'sem_limpeza';

  let suffix;
  if (processMode === 'limpeza_leve') {
    suffix = `-reel-clean-${Date.now().toString(36).slice(-5)}`;
  } else if (processMode === 'ultra_clean') {
    suffix = `-reel-ultra-${Date.now().toString(36).slice(-5)}`;
  } else if (processMode === 'humanizador') {
    suffix = `-reel-human-${Date.now().toString(36).slice(-6)}`;
  } else {
    suffix = quality === 'max' ? '-reel-max' : quality === 'fast' ? '-reel-fast' : '-reel-hq';
  }

  const outputPath = path.join(outputDir, `${filename}${suffix}.mp4`);

  // Cache + deduplicação apenas para sem_limpeza (os outros modos geram arquivo único por design)
  if (processMode === 'sem_limpeza') {
    if (fs.existsSync(outputPath)) {
      console.log(`♻️ Reutilizando vídeo já convertido: ${path.basename(outputPath)}`);
      return Promise.resolve(outputPath);
    }
    // Se conversão já está em progresso para este arquivo, aguarda a mesma Promise
    if (_inProgress.has(outputPath)) {
      console.log(`⏳ Aguardando conversão em progresso: ${path.basename(outputPath)}`);
      return _inProgress.get(outputPath);
    }
  }

  const promise = new Promise(async (resolve, reject) => {

    // Detecta orientação do vídeo original
    let probe;
    try { probe = await probeVideo(inputPath); } catch {}
    const vStream = probe?.streams?.find(s => s.codec_type === 'video');
    const w = vStream?.width || 1080;
    const h = vStream?.height || 1920;
    const isPortrait = h > w;

    // Parâmetros por nível de qualidade
    const configs = {
      max: {
        crf: '15',        // Quase lossless
        preset: 'slow',
        audioBitrate: '256k',
        description: 'Máxima qualidade (arquivo maior)',
      },
      high: {
        crf: '18',        // Alta qualidade, excelente para redes sociais
        preset: 'slow',
        audioBitrate: '192k',
        description: 'Alta qualidade (recomendado)',
      },
      fast: {
        crf: '23',        // Padrão - processamento rápido
        preset: 'veryfast',
        audioBitrate: '128k',
        description: 'Qualidade padrão (processamento rápido)',
      },
    };

    const cfg = configs[quality] || configs.high;

    // Filtro de escala: preserva conteúdo original, faz pad se necessário
    // Para vídeos vertical já em 9:16, evita crop agressivo
    let scaleFilter;
    if (isPortrait && Math.abs(w / h - 1080 / 1920) < 0.05) {
      // Já está em 9:16 — só redimensiona sem crop
      scaleFilter = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black';
    } else {
      // Converte para 9:16 com crop centrado (padrão Reels)
      scaleFilter = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
    }

    // Ultra clean: micro-variação de brilho garante hash de pixel único por publicação
    if (processMode === 'ultra_clean') {
      const micro = (Math.random() * 0.004 + 0.001).toFixed(5);
      scaleFilter += `,eq=brightness=${micro}`;
    }

    // Humanizador: transformações invisíveis que tornam o vídeo único em múltiplas dimensões
    let humanAudioFilter = null;
    if (processMode === 'humanizador') {
      // Micro-crop aleatório (2-5px) + resize de volta — desloca todos os pixels
      const cropPx = Math.floor(Math.random() * 4) + 2;
      const cropX  = Math.floor(Math.random() * (cropPx + 1));
      const cropY  = Math.floor(Math.random() * (cropPx + 1));
      // Micro-ajuste de cor imperceptível
      const microBright = ((Math.random() - 0.5) * 0.006).toFixed(5);
      const microSat    = (1 + (Math.random() - 0.5) * 0.04).toFixed(4);
      const microContr  = (1 + (Math.random() - 0.5) * 0.02).toFixed(4);
      scaleFilter += `,crop=iw-${cropPx}:ih-${cropPx}:${cropX}:${cropY},scale=1080:1920,eq=brightness=${microBright}:saturation=${microSat}:contrast=${microContr}`;
      // Pitch de áudio micro-shift (±0.5%) — muda fingerprint de áudio sem ser audível
      const pitchFactor = (1 + (Math.random() - 0.5) * 0.01).toFixed(5);
      const newRate     = Math.round(44100 * Number(pitchFactor));
      humanAudioFilter  = `asetrate=${newRate},aresample=44100`;
    }

    const modeLabel = processMode === 'limpeza_leve' ? ' [Limpeza Leve]'
                    : processMode === 'ultra_clean'  ? ' [Ultra Clean]'
                    : processMode === 'humanizador'  ? ' [Humanizador]'
                    : '';
    console.log(`🎬 Convertendo vídeo [${cfg.description}]${modeLabel}...`);
    console.log(`   Entrada: ${path.basename(inputPath)} (${w}×${h})`);
    console.log(`   Saída: ${path.basename(outputPath)}`);

    // limpeza_leve, ultra_clean e humanizador removem todos os metadados do container
    const metadataOpts = (processMode === 'limpeza_leve' || processMode === 'ultra_clean' || processMode === 'humanizador')
      ? ['-map_metadata', '-1']
      : [];

    // Humanizador: CRF aleatório (17–20) para encoding ligeiramente diferente a cada vez
    const finalCrf = processMode === 'humanizador'
      ? String(17 + Math.floor(Math.random() * 4))
      : cfg.crf;

    const audioFilterOpts = humanAudioFilter ? ['-af', humanAudioFilter] : [];

    ffmpeg(inputPath)
      .outputOptions([
        '-vf', scaleFilter,
        '-c:v', 'libx264',
        '-profile:v', 'high',           // H.264 High Profile
        '-level', '4.1',                // Nível compatível com Instagram
        '-preset', cfg.preset,
        '-crf', finalCrf,
        '-c:a', 'aac',
        '-b:a', cfg.audioBitrate,
        '-ar', '44100',
        '-ac', '2',                     // Stereo
        '-movflags', '+faststart',      // Streaming progressivo
        '-pix_fmt', 'yuv420p',
        '-metadata:s:v:0', 'rotate=0', // Força orientação correta
        '-avoid_negative_ts', 'make_zero',
        '-max_muxing_queue_size', '9999',
        ...audioFilterOpts,
        ...metadataOpts,
      ])
      .on('start', cmd => console.log(`   FFmpeg: ${cmd.slice(0, 120)}...`))
      .on('progress', p => {
        if (p.percent) process.stdout.write(`\r   Progresso: ${Math.floor(p.percent)}%  `);
      })
      .on('end', () => {
        console.log(`\n✅ Vídeo convertido [${cfg.description}]: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', err => {
        console.error(`\n💥 Erro na conversão: ${err.message}`);
        // Fallback: tenta com preset mais rápido se slow falhar
        if (cfg.preset === 'slow') {
          console.log('🔄 Tentando fallback com preset veryfast...');
          const fallbackPath = path.join(outputDir, `${filename}-reel-fallback.mp4`);
          ffmpeg(inputPath)
            .outputOptions([
              '-vf', scaleFilter,
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '23',
              '-c:a', 'aac',
              '-b:a', '128k',
              '-ar', '44100',
              '-movflags', '+faststart',
              '-pix_fmt', 'yuv420p',
            ])
            .on('end', () => { console.log('✅ Fallback OK'); resolve(fallbackPath); })
            .on('error', e2 => reject(e2))
            .save(fallbackPath);
        } else {
          reject(err);
        }
      })
      .save(outputPath);
  });

  if (processMode === 'sem_limpeza') {
    _inProgress.set(outputPath, promise);
    promise.finally(() => _inProgress.delete(outputPath));
  }

  return promise;
}

/**
 * Otimiza imagem para feed/stories (máxima qualidade JPEG/PNG).
 * Redimensiona para 1080×1080 (feed) ou 1080×1920 (stories) sem perda visível.
 */
function convertImageForInstagram(inputPath, type = 'feed') {
  return new Promise((resolve, reject) => {
    if (!isImage(inputPath)) return resolve(inputPath);

    const outputDir = path.resolve(__dirname, '../../uploads/processed');
    ensureDir(outputDir);

    const filename = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${filename}-ig-${type}.jpg`);

    if (fs.existsSync(outputPath)) return resolve(outputPath);

    const dimensions = type === 'story' ? '1080:1920' : '1080:1080';
    const scaleFilter = `scale=${dimensions}:force_original_aspect_ratio=decrease,pad=${dimensions}:(ow-iw)/2:(oh-ih)/2:black`;

    ffmpeg(inputPath)
      .outputOptions([
        '-vf', scaleFilter,
        '-q:v', '1',       // Máxima qualidade JPEG (1=melhor, 31=pior)
        '-frames:v', '1',  // Apenas 1 frame
      ])
      .on('end', () => {
        console.log(`✅ Imagem processada [${type}]: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', err => {
        console.error(`Erro ao processar imagem: ${err.message}`);
        resolve(inputPath); // Usa original em caso de erro
      })
      .save(outputPath);
  });
}

/**
 * Limpa arquivos processados mais antigos que maxAgeHours horas.
 */
function cleanProcessedFiles(maxAgeHours = 24) {
  const dir = path.resolve(__dirname, '../../uploads/processed');
  if (!fs.existsSync(dir)) return;

  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    try {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; }
    } catch {}
  }
  if (removed) console.log(`🧹 Limpeza: ${removed} arquivo(s) processado(s) removido(s)`);
}

module.exports = {
  convertToReelFormat,
  convertImageForInstagram,
  cleanProcessedFiles,
  isVideo,
  isImage,
};

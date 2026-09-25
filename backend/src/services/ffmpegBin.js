'use strict';

/**
 * O binário do ffmpeg — um que tenha o filtro `drawtext`.
 *
 * Marca d'água e texto do story são `drawtext`; um ffmpeg sem ele falha a
 * passada inteira com "Filter not found". O ffmpeg do Debian (instalado no
 * Dockerfile) tem. `FFMPEG_PATH` escolhe outro, se preciso.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

function temDrawtext(bin) {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], {
      encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /\bdrawtext\b/.test(out);
  } catch {
    return false;
  }
}

function resolver() {
  const candidatos = [process.env.FFMPEG_PATH, '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean);
  return candidatos.find(c => fs.existsSync(c) && temDrawtext(c)) || 'ffmpeg';
}

function existe(bin) {
  try { execFileSync(bin, ['-version'], { timeout: 8000, stdio: 'ignore' }); return true; } catch { return false; }
}

const FFMPEG_BIN = resolver();
if (!process.env.JEST_WORKER_ID) {
  const aviso = temDrawtext(FFMPEG_BIN) ? ''
    : existe(FFMPEG_BIN) ? ' — SEM drawtext: marca d\'água e texto do story indisponíveis'
    : ' — NÃO ENCONTRADO: vídeos, capas e stories não serão processados';
  console.log(`🎬 [ffmpeg] ${FFMPEG_BIN}${aviso}`);
}

module.exports = { FFMPEG_BIN, temDrawtext };

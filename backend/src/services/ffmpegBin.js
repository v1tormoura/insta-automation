'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

/**
 * O binário do ffmpeg que o sistema deve usar — o que TEM o filtro `drawtext`.
 *
 * ── O bug que este módulo corrige
 *
 * O pacote `ffmpeg-static` (johnvansickle) que o projeto instala vem com um
 * build SEM o filtro `drawtext`. A marca d'água usa `drawtext`; sem ele, o
 * ffmpeg responde "Filter not found" e a passada inteira falha com código 8.
 * Como a marca entra na MESMA passada que humaniza e formata o reel, o efeito
 * não é "sai sem marca" — é o reel não sair (ou sair sem humanização nenhuma,
 * pelo caminho do original). Medido em produção: `ffmpeg-static -filters` não
 * lista `drawtext`; o ffmpeg do sistema (Debian, instalado no Dockerfile) lista.
 *
 * ── A escolha
 *
 * Prefere um ffmpeg do sistema que comprovadamente tenha `drawtext` (testado na
 * hora, não suposto). Só cai no `ffmpeg-static` se nenhum servir — porque um
 * ffmpeg sem drawtext ainda converte todo o resto, e travar tudo por causa da
 * marca seria pior. A verificação roda uma vez, na carga do módulo.
 */
function temDrawtext(bin) {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /\bdrawtext\b/.test(out);
  } catch {
    return false;
  }
}

function resolver() {
  const candidatos = [
    process.env.FFMPEG_PATH,
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter(Boolean);

  for (const c of candidatos) {
    try {
      if (fs.existsSync(c) && temDrawtext(c)) return c;
    } catch { /* tenta o próximo */ }
  }

  /* Último recurso: o estático. Pode não ter drawtext, mas converte o resto —
     e a marca degrada para "sem marca" em vez de derrubar a publicação. */
  try {
    const estatico = require('ffmpeg-static');
    if (estatico) return estatico;
  } catch { /* sem o pacote — cai no PATH */ }

  return 'ffmpeg';
}

const FFMPEG_BIN = resolver();
console.log(`🎬 [ffmpeg] binário escolhido: ${FFMPEG_BIN}${temDrawtext(FFMPEG_BIN) ? ' (com drawtext)' : ' (SEM drawtext — marca d\'água indisponível)'}`);

module.exports = { FFMPEG_BIN, temDrawtext };

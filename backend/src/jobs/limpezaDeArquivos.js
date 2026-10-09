'use strict';

/**
 * Limpeza do que ninguém apaga, a cada 6h (a primeira 2 min depois de subir):
 *
 *   uploads/tmp/        > 48h                          → apaga
 *   uploads/processed/  > RETENCAO_PROCESSED_DIAS (7)  → apaga (o vídeo por
 *                         conta que a Meta já baixou; refazer custa segundos)
 *
 * Nada aqui lança: pasta ausente ou arquivo que sumiu no meio é ignorado.
 */

const fs = require('fs');
const path = require('path');

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');
const TMP_MAX_MS = 48 * 60 * 60 * 1000;
const RETENCAO_PROCESSED_DIAS = Math.max(1, parseInt(process.env.RETENCAO_PROCESSED_DIAS, 10) || 7);
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const ATRASO_INICIAL_MS = 2 * 60 * 1000;

/** Todos os arquivos (recursivo) de uma pasta, com mtime. Pasta ausente = []. */
function listar(pasta) {
  const saida = [];
  const anda = dir => {
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) anda(p);
      else if (it.isFile()) {
        try { saida.push({ caminho: p, mtime: fs.statSync(p).mtimeMs, tamanho: fs.statSync(p).size }); } catch {}
      }
    }
  };
  anda(pasta);
  return saida;
}

function apagar(lista) {
  let n = 0, bytes = 0;
  for (const f of lista) {
    try { fs.unlinkSync(f.caminho); n++; bytes += f.tamanho; } catch {}
  }
  return { n, bytes };
}

async function executar({ agora = Date.now(), log = console.log } = {}) {
  const resumo = { tmp: { n: 0, bytes: 0 }, processed: { n: 0, bytes: 0 } };

  resumo.tmp = apagar(listar(path.join(RAIZ_UPLOADS, 'tmp')).filter(f => agora - f.mtime > TMP_MAX_MS));

  const limiteProcessed = RETENCAO_PROCESSED_DIAS * 24 * 60 * 60 * 1000;
  const processedVelhos = listar(path.join(RAIZ_UPLOADS, 'processed')).filter(f => agora - f.mtime > limiteProcessed);
  resumo.processed = apagar(processedVelhos);

  const mb = b => (b / 1024 / 1024).toFixed(0);
  if (resumo.tmp.n || resumo.processed.n) {
    log(`🧹 [Limpeza] tmp: ${resumo.tmp.n} arquivo(s), ${mb(resumo.tmp.bytes)} MB` +
        ` · processed >${RETENCAO_PROCESSED_DIAS}d: ${resumo.processed.n} arquivo(s), ${mb(resumo.processed.bytes)} MB`);
  }
  return resumo;
}

function startLimpezaDeArquivos() {
  const roda = () => executar().catch(e => console.log('[Limpeza] falhou:', e.message));
  setTimeout(roda, ATRASO_INICIAL_MS);
  setInterval(roda, INTERVALO_MS);
}

module.exports = { startLimpezaDeArquivos, executar, listar, TMP_MAX_MS, RETENCAO_PROCESSED_DIAS };

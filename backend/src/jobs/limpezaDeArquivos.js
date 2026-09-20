'use strict';

/**
 * Limpeza de arquivos que ninguém apaga.
 *
 * ── O vazamento
 *
 * Medido em 20/09/2026, depois de UM dia de uso do editor em lote:
 * `uploads/tmp/batch-uploads` com 141 arquivos e 382 MB, todos com mais de
 * 24h. O multer grava o vídeo ali, o render lê de lá e ninguém remove — o
 * caminho de saída existia, o de entrada não tinha fim. No ritmo de lotes de
 * 50 vídeos, isso é ~400 MB por dia de arquivo morto, ~12 GB por mês.
 *
 * E `uploads/processed` — o vídeo convertido por conta que o Meta baixa na
 * publicação — só cresce: 1,9 GB no mesmo dia. Depois que o Meta buscou, o
 * arquivo não serve para mais nada além de re-publicação, e uma nova
 * conversão custa segundos.
 *
 * ── As regras
 *
 *  tmp/        > 48h e sem render pendente apontando para ele  → apaga
 *  processed/  > RETENCAO_PROCESSED_DIAS (7)                    → apaga
 *
 * Duas salvaguardas: um render `pending`/`queued`/`processing` ainda precisa
 * da entrada, então o caminho dele é poupado mesmo velho; e nada aqui lança —
 * uma pasta que não existe ou um arquivo que sumiu no meio do laço é
 * ignorado, não derruba o ciclo.
 *
 * Roda 2 min depois de subir (para não competir com o boot) e a cada 6h.
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

/** Caminhos de entrada que renders ainda por fazer vão precisar. */
async function entradasEmUso() {
  try {
    const VideoRenderJob = require('../models/VideoRenderJob');
    const docs = await VideoRenderJob.find({ status: { $in: ['pending', 'queued', 'processing'] } }).select('inputPath').lean();
    return new Set(docs.map(d => path.resolve(String(d.inputPath || ''))));
  } catch {
    /* Sem banco, não dá para saber o que está em uso: não apaga nada do tmp
       neste ciclo. Errar para o lado de guardar custa disco por 6h; errar para
       o lado de apagar custa um render. */
    return null;
  }
}

function apagar(lista) {
  let n = 0, bytes = 0;
  for (const f of lista) {
    try { fs.unlinkSync(f.caminho); n++; bytes += f.tamanho; } catch {}
  }
  return { n, bytes };
}

async function executar({ agora = Date.now(), log = console.log } = {}) {
  const emUso = await entradasEmUso();
  const resumo = { tmp: { n: 0, bytes: 0 }, processed: { n: 0, bytes: 0 }, pulados: 0 };

  if (emUso !== null) {
    const velhos = listar(path.join(RAIZ_UPLOADS, 'tmp')).filter(f => agora - f.mtime > TMP_MAX_MS);
    const apagaveis = velhos.filter(f => !emUso.has(path.resolve(f.caminho)));
    resumo.pulados = velhos.length - apagaveis.length;
    resumo.tmp = apagar(apagaveis);
  }

  const limiteProcessed = RETENCAO_PROCESSED_DIAS * 24 * 60 * 60 * 1000;
  const processedVelhos = listar(path.join(RAIZ_UPLOADS, 'processed')).filter(f => agora - f.mtime > limiteProcessed);
  resumo.processed = apagar(processedVelhos);

  const mb = b => (b / 1024 / 1024).toFixed(0);
  if (resumo.tmp.n || resumo.processed.n || resumo.pulados) {
    log(`🧹 [Limpeza] tmp: ${resumo.tmp.n} arquivo(s), ${mb(resumo.tmp.bytes)} MB` +
        (resumo.pulados ? ` (${resumo.pulados} poupado(s): render pendente)` : '') +
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

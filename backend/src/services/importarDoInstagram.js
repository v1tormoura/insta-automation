'use strict';

/**
 * Importar para a Biblioteca o que as CONTAS CONECTADAS já publicaram.
 *
 * Só pela API oficial: GET /{ig-user-id}/media lista as publicações da própria
 * conta, com `media_url` (o arquivo) e `children` nos carrosséis. A Meta só
 * entrega isso para contas autorizadas no app — perfis de terceiros não entram.
 *
 * O `media_url` expira em algumas horas, então a importação pede cada mídia
 * de novo na hora de baixar. Depois do download, a conversão opcional:
 *
 *   qualidade  original | 720 | 480 | 360   (menor lado do vídeo, sem ampliar)
 *   formato    mp4 | webm | mp3             (mp3 = só o áudio)
 *
 * Imagens entram como vieram (JPEG). Roda na fila, mídia a mídia, avisando o
 * progresso pelo SSE ('media').
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { FFMPEG_BIN } = require('./ffmpegBin');
const { get } = require('./instagramAPI');

ffmpeg.setFfmpegPath(FFMPEG_BIN);

const UPLOADS = path.resolve(__dirname, '../../uploads');
const CAMPOS = 'id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,caption';
const QUALIDADES = ['original', '720', '480', '360'];
const FORMATOS = ['mp4', 'webm', 'mp3'];
const MAX_POR_IMPORTACAO = 200;

function exigirConexao(conta) {
  if (!conta?.accessToken || !conta?.igUserId) {
    throw Object.assign(new Error(`@${conta?.username || '?'} não está conectada pela API oficial`), { status: 400 });
  }
}

/** Uma página das publicações da conta. */
async function listar(conta, { depois = null, limite = 24 } = {}) {
  exigirConexao(conta);
  const d = await get(`/${conta.igUserId}/media`, {
    fields: `${CAMPOS},children{id,media_type,media_url,thumbnail_url}`,
    limit: Math.min(50, Math.max(1, Number(limite) || 24)),
    ...(depois ? { after: depois } : {}),
  }, conta.accessToken);
  const itens = (d?.data || []).map(m => ({
    id: String(m.id),
    tipo: m.media_type,                     // IMAGE | VIDEO | CAROUSEL_ALBUM
    produto: m.media_product_type || '',    // FEED | REELS | STORY
    miniatura: m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : '') || m.children?.data?.[0]?.thumbnail_url || m.children?.data?.[0]?.media_url || '',
    link: m.permalink || '',
    quando: m.timestamp || null,
    legenda: String(m.caption || '').slice(0, 140),
    itens: m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data?.length || 0) : 1,
  }));
  return { itens, depois: d?.paging?.next ? d?.paging?.cursors?.after || null : null };
}

/** Os arquivos de uma publicação (vários, se for carrossel), com URL fresca. */
async function arquivosDe(conta, mediaId) {
  const m = await get(`/${mediaId}`, { fields: `${CAMPOS},children{id,media_type,media_url}` }, conta.accessToken);
  if (m.media_type === 'CAROUSEL_ALBUM') {
    return (m.children?.data || []).filter(c => c.media_url).map((c, i) => ({ url: c.media_url, video: c.media_type === 'VIDEO', sufixo: `-${i + 1}` }));
  }
  return m.media_url ? [{ url: m.media_url, video: m.media_type === 'VIDEO', sufixo: '' }] : [];
}

async function baixar(url, destino) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`download recusado (HTTP ${res.status})`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
}

/** Filtro de escala: o menor lado vira `alvo`, sem ampliar vídeo menor. */
function escala(alvo) {
  return `scale='if(gt(iw,ih),-2,min(iw,${alvo}))':'if(gt(iw,ih),min(ih,${alvo}),-2)'`;
}

function converter(origem, destino, { qualidade, formato }) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(origem);
    if (formato === 'mp3') {
      cmd.noVideo().audioCodec('libmp3lame').audioBitrate('192k');
    } else {
      const opcoes = qualidade !== 'original' ? ['-vf', escala(qualidade)] : [];
      if (formato === 'webm') {
        cmd.videoCodec('libvpx-vp9').audioCodec('libopus')
          .outputOptions([...opcoes, '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1']);
      } else {
        cmd.videoCodec('libx264').audioCodec('aac')
          .outputOptions([...opcoes, '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']);
      }
    }
    cmd.on('end', resolve).on('error', reject).save(destino);
  });
}

/**
 * Importa as publicações escolhidas para a Biblioteca do usuário.
 * @returns {Promise<{importados: object[], erros: string[]}>}
 */
async function importar({ usuarioId, conta, ids, qualidade = 'original', formato = 'mp4', pasta = 'Importados', aoProgredir }) {
  exigirConexao(conta);
  if (!QUALIDADES.includes(String(qualidade))) qualidade = 'original';
  if (!FORMATOS.includes(formato)) formato = 'mp4';
  const lista = [...new Set((ids || []).map(String))].slice(0, MAX_POR_IMPORTACAO);
  const { media } = require('../repos');
  const importados = [], erros = [];
  const dir = path.join(UPLOADS, 'importados');
  fs.mkdirSync(dir, { recursive: true });

  for (const [i, id] of lista.entries()) {
    try {
      for (const arq of await arquivosDe(conta, id)) {
        const base = `${conta.username}-${id}${arq.sufixo}-${crypto.randomBytes(3).toString('hex')}`;
        const bruto = path.join(dir, `${base}.${arq.video ? 'mp4' : 'jpg'}`);
        await baixar(arq.url, bruto);

        let final = bruto;
        const precisaConverter = arq.video && (qualidade !== 'original' || formato !== 'mp4');
        if (precisaConverter) {
          final = path.join(dir, `${base}-${formato === 'mp3' ? 'audio' : qualidade}.${formato}`);
          await converter(bruto, final, { qualidade, formato });
          fs.rmSync(bruto, { force: true });
        }

        const nome = path.relative(UPLOADS, final).split(path.sep).join('/');
        const ext = path.extname(final).slice(1);
        const mime = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', jpg: 'image/jpeg' }[ext] || 'application/octet-stream';
        const item = await media.de(usuarioId).insert({
          filename: nome, originalName: `@${conta.username} · ${id}${arq.sufixo}.${ext}`,
          path: nome, url: `/uploads/${nome}`, mimeType: mime, size: fs.statSync(final).size,
          type: mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'other',
          folder: String(pasta || 'Importados').slice(0, 60),
        });
        importados.push(item);
        if (item.type === 'video') {
          require('./miniaturaDeVideo').garantirMiniatura(UPLOADS, nome).catch(() => {});
        }
      }
    } catch (err) {
      erros.push(`${id}: ${err.message}`);
      console.log(`⚠️ [Importar] @${conta.username} ${id}: ${err.message}`);
    }
    aoProgredir?.({ feitas: i + 1, total: lista.length, importados: importados.length, erros: erros.length });
  }
  return { importados, erros };
}

module.exports = { listar, importar, arquivosDe, escala, _converter: converter, QUALIDADES, FORMATOS, MAX_POR_IMPORTACAO };

'use strict';

/**
 * O arquivo que vai para cada conta.
 *
 * Por padrão, o que a pessoa enviou — byte a byte, como se publicasse pelo
 * celular. O arquivo só é refeito em dois casos:
 *
 *   formato fora do que a API aceita → convertido para o padrão do Reels
 *                                      (videoProcessor), sem nada sorteado
 *   marca d'água ligada              → desenhada por conta (o texto é o @),
 *                                      num arquivo próprio da conta
 *
 * Nunca lança por causa da conversão: um vídeo que não converteu ainda pode
 * ser publicado como está — perder o post por causa de um enfeite seria troca
 * ruim.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { convertToReelFormat, isVideo, probeVideo } = require('./videoProcessor');

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');

/* Formato que a API de Reels aceita sem conversão. Fora disto (webm, mkv,
   vp9, áudio que não é AAC), converte. */
const CONTEINER_OK = /\.(mp4|mov)$/i;
const VIDEO_OK = new Set(['h264', 'hevc']);

/**
 * Os limites do Reels na API (fora deles a Meta devolve status ERROR, sem
 * dizer o motivo): lado maior até 1920 px, 23–60 fps, yuv420p 8 bits, até
 * 25 Mbps, áudio AAC até 48 kHz, e o índice (moov) no começo do arquivo.
 */
const LIMITES = { lado: 1920, fpsMin: 23, fpsMax: 60, bitrate: 25_000_000, audioHz: 48_000 };

function fpsDe(v) {
  const [n, d] = String(v?.avg_frame_rate || v?.r_frame_rate || '0/1').split('/').map(Number);
  return d ? n / d : 0;
}

/** O índice (moov) vem antes dos dados (mdat)? A Meta baixa por URL e precisa dele no começo. */
function moovNoComeco(absoluto) {
  let fd;
  try {
    fd = fs.openSync(absoluto, 'r');
    const tamanho = fs.fstatSync(fd).size;
    const cab = Buffer.alloc(16);
    let pos = 0;
    for (let i = 0; i < 50 && pos + 8 <= tamanho; i++) {
      fs.readSync(fd, cab, 0, 16, pos);
      let len = cab.readUInt32BE(0);
      const tipo = cab.toString('latin1', 4, 8);
      if (tipo === 'moov') return true;
      if (tipo === 'mdat') return false;
      if (len === 1) len = Number(cab.readBigUInt64BE(8));
      if (len < 8) return false;
      pos += len;
    }
    return false;
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Por que o original NÃO serve (lista vazia = serve como está). */
async function motivosParaConverter(absoluto) {
  if (!CONTEINER_OK.test(absoluto)) return ['contêiner'];
  let probe;
  try { probe = await probeVideo(absoluto); } catch { return ['não deu para ler o vídeo']; }
  const v = probe?.streams?.find(x => x.codec_type === 'video');
  const a = probe?.streams?.find(x => x.codec_type === 'audio');
  if (!v) return ['sem trilha de vídeo'];
  const m = [];
  if (!VIDEO_OK.has(v.codec_name)) m.push(`codec ${v.codec_name}`);
  if (Math.max(v.width || 0, v.height || 0) > LIMITES.lado) m.push(`${v.width}x${v.height} (máx. ${LIMITES.lado})`);
  const fps = fpsDe(v);
  if (fps && (fps < LIMITES.fpsMin || fps > LIMITES.fpsMax)) m.push(`${fps.toFixed(0)} fps`);
  if (v.pix_fmt && v.pix_fmt !== 'yuv420p' && v.pix_fmt !== 'yuvj420p') m.push(v.pix_fmt);
  const br = Number(probe?.format?.bit_rate || v.bit_rate || 0);
  if (br > LIMITES.bitrate) m.push(`${Math.round(br / 1e6)} Mbps`);
  if (a && a.codec_name !== 'aac') m.push(`áudio ${a.codec_name}`);
  if (a && Number(a.sample_rate) > LIMITES.audioHz) m.push(`áudio ${a.sample_rate} Hz`);
  if (!moovNoComeco(absoluto)) m.push('índice no fim do arquivo');
  return m;
}

/** O original serve como está? Na dúvida (probe falhou), não. */
async function originalServe(absoluto) {
  return (await motivosParaConverter(absoluto)).length === 0;
}

/** Nome curto e estável do arquivo desta conta para este post. */
function marcaDe(postId, accountId) {
  return crypto.createHash('sha256').update(`${postId}:${accountId}`).digest('hex').slice(0, 10);
}

/** Caminho relativo a uploads/ — é o que o publicador espera. */
function relativo(absoluto) {
  const rel = path.relative(RAIZ_UPLOADS, absoluto).split(path.sep).join('/');
  return rel.startsWith('..') ? absoluto : rel;
}

/**
 * @param {Object} post     — precisa de `id` e `media`; `marcaDagua` opcional
 * @param {Object} account  — precisa de `id` (e `username`, para a marca)
 * @returns {Promise<{caminho: string, proprio: boolean}>} `proprio` = arquivo
 *   gerado aqui, que o publicador apaga depois de a publicação terminar
 */
async function prepararParaConta(post, account, opcoes = {}) {
  const original = String(post?.media || '');
  if (!original) return { caminho: original, proprio: false };
  const absoluto = path.isAbsolute(original) ? original : path.join(RAIZ_UPLOADS, original);

  if (!fs.existsSync(absoluto)) {
    console.log(`⚠️ [MidiaPorConta] arquivo não encontrado: ${original}`);
    return { caminho: original, proprio: false };
  }

  if (!isVideo(absoluto)) {
    return (await marcarImagem(absoluto, post, account, opcoes)) || { caminho: original, proprio: false };
  }

  const configDaMarca = opcoes.marcaDagua || post.marcaDagua || null;
  const filtro = configDaMarca
    ? require('./marcaDagua').filtroDaMarca(configDaMarca, account.username)
    : null;

  const motivos = filtro ? [] : await motivosParaConverter(absoluto);
  if (!filtro && !motivos.length) {
    console.log(`🎬 [MidiaPorConta] @${account.username || account.id} → original (${path.basename(original)})`);
    return { caminho: original, proprio: false };
  }
  if (motivos.length) console.log(`🎬 [MidiaPorConta] ${path.basename(original)} fora do padrão do Reels (${motivos.join(', ')}) — convertendo`);

  try {
    const saida = await convertToReelFormat(absoluto, {
      quality: opcoes.quality || 'high',
      sufixo: `c${marcaDe(String(post.id), String(account.id))}`,
      ...(filtro ? { marcaDagua: filtro } : {}),
    });
    console.log(`🎬 [MidiaPorConta] @${account.username || account.id} → ${path.basename(saida)}`);
    return { caminho: relativo(saida), proprio: true };
  } catch (err) {
    console.log(
      `⚠️ [MidiaPorConta] conversão falhou para @${account.username || account.id}: ` +
      `${err.message} — publicando o original`
    );
    return { caminho: original, proprio: false };
  }
}

/**
 * A marca d'água numa imagem: uma passada de ffmpeg, arquivo próprio da conta.
 * `null` quando não há marca a desenhar ou quando a passada falha (aí vai o
 * original).
 * @returns {Promise<{caminho: string, proprio: boolean}|null>}
 */
async function marcarImagem(absoluto, post, account, opcoes = {}) {
  const config = opcoes.marcaDagua || post.marcaDagua || null;
  if (!config) return null;

  /* As posições superior e inferior da marca são calculadas sobre a altura da
     mídia — numa imagem quadrada, a altura do reel as jogaria para fora. */
  const { filtroDaMarca } = require('./marcaDagua');
  const { altura, largura } = await dimensoesDaImagem(absoluto);
  const filtro = filtroDaMarca(config, account.username, undefined, altura, largura);
  if (!filtro) return null;

  const ext = path.extname(absoluto) || '.jpg';
  const saida = path.join(RAIZ_UPLOADS, 'processed',
    `${path.basename(absoluto, ext)}-c${marcaDe(String(post.id), String(account.id))}${ext}`);

  try {
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    await new Promise((resolve, reject) => {
      require('fluent-ffmpeg')(absoluto)
        .outputOptions(['-vf', filtro, '-frames:v', '1', '-q:v', '1'])
        .on('end', resolve)
        .on('error', reject)
        .save(saida);
    });
    console.log(`🖼️ [MidiaPorConta] @${account.username || account.id} → ${path.basename(saida)} (marca d'água)`);
    return { caminho: relativo(saida), proprio: true };
  } catch (err) {
    console.log(`⚠️ [MidiaPorConta] marca na imagem falhou para @${account.username || account.id}: ${err.message} — publicando o original`);
    return null;
  }
}

/** Altura e largura da imagem, para a marca (e o logo) caírem dentro dela. */
async function dimensoesDaImagem(absoluto) {
  try {
    const meta = await probeVideo(absoluto);
    const v = meta?.streams?.find(s => s.codec_type === 'video');
    const ok = n => (Number.isFinite(n) && n > 0 ? n : undefined);
    return { altura: ok(v?.height), largura: ok(v?.width) };
  } catch {
    return {};
  }
}

/**
 * Apaga o arquivo gerado para uma conta. Só quando `proprio`: apagar o
 * original tiraria da biblioteca um vídeo que ainda vai ser usado.
 */
function descartar(caminho, proprio) {
  if (!proprio || !caminho) return;
  const absoluto = path.isAbsolute(caminho) ? caminho : path.join(RAIZ_UPLOADS, caminho);
  try { fs.unlinkSync(absoluto); } catch { /* já não existe */ }
}

module.exports = { motivosParaConverter, moovNoComeco, prepararParaConta, descartar, marcaDe };

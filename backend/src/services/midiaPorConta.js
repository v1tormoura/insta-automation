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

/** O original serve como está? Na dúvida (probe falhou), não. */
async function originalServe(absoluto) {
  if (!CONTEINER_OK.test(absoluto)) return false;
  try {
    const probe = await probeVideo(absoluto);
    const v = probe?.streams?.find(x => x.codec_type === 'video');
    const a = probe?.streams?.find(x => x.codec_type === 'audio');
    return !!v && VIDEO_OK.has(v.codec_name) && (!a || a.codec_name === 'aac');
  } catch {
    return false;
  }
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
 *   gerado aqui, que o publicador apaga depois de a Meta baixar
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

  if (!filtro && await originalServe(absoluto)) {
    console.log(`🎬 [MidiaPorConta] @${account.username || account.id} → original (${path.basename(original)})`);
    return { caminho: original, proprio: false };
  }

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
  const filtro = filtroDaMarca(config, account.username, undefined, await alturaDaImagem(absoluto));
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

/** A altura da imagem, para a marca cair dentro dela. */
async function alturaDaImagem(absoluto) {
  try {
    const meta = await probeVideo(absoluto);
    const h = meta?.streams?.find(s => s.codec_type === 'video')?.height;
    return Number.isFinite(h) && h > 0 ? h : null;
  } catch {
    return null;
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

module.exports = { prepararParaConta, descartar, marcaDe };

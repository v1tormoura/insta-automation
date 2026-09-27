'use strict';

/**
 * Publicação no Instagram pela API oficial — o arquivo sai daqui e vira mídia
 * no ar. Reescrito do zero em 27/09/2026.
 *
 * ── Vídeo (Reel e Story): o arquivo vai direto para a Meta
 *
 *   1. POST /{ig-user-id}/media  media_type=REELS|STORIES, upload_type=resumable
 *      → a Meta devolve o container e o endereço de upload (rupload.facebook.com)
 *   2. POST {endereço}  com o arquivo no corpo (Authorization: OAuth, offset,
 *      file_size) — o vídeo sai do servidor para a Meta, byte a byte
 *   3. GET  /{container}?fields=status_code  até FINISHED
 *   4. POST /{ig-user-id}/media_publish  creation_id={container}
 *
 * Antes a Meta BAIXAVA o vídeo de uma URL nossa (video_url). O upload direto é
 * o caminho que a Meta recomenda para Reels: não depende de a Meta alcançar o
 * nosso servidor, nem de o arquivo continuar lá até ela terminar de baixar.
 * Se ele falhar ANTES de publicar (e o problema não for da conta), a mesma
 * publicação é tentada uma vez pelo caminho da URL — o post não se perde.
 *
 * ── Imagem: por URL
 *
 * A API não aceita upload direto de imagem: `image_url` é o único caminho.
 *
 * ── Erros
 *
 * Tudo que vem da Meta sai como `GraphError` (code, subcode, type), o mesmo
 * que `contas.classificarErro` lê para decidir a saúde da conta.
 */

const fs = require('fs');
const { Readable } = require('stream');
const { VERSAO, GraphError, get, post } = require('./instagramAPI');

const RUPLOAD = `https://rupload.facebook.com/ig-api-upload/${VERSAO}`;
const LIMITE_UPLOAD_MS = 15 * 60_000;
const delay = ms => new Promise(r => setTimeout(r, ms));

function exigirConexao(conta) {
  if (!conta?.igUserId || !conta?.accessToken) {
    throw Object.assign(
      new Error(`@${conta?.username || '?'} não está conectada pela API oficial — reconecte em Contas`),
      { code: 'SEM_TOKEN' });
  }
}

/** Parâmetros vazios não vão: a Meta recusa `cover_url=` sem valor. */
function limpar(campos) {
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

async function criarContainer(conta, campos) {
  const d = await post(`/${conta.igUserId}/media`, limpar(campos), conta.accessToken);
  if (!d?.id) throw new Error('A Meta não devolveu o id do container');
  return { id: String(d.id), uri: d.uri || `${RUPLOAD}/${d.id}` };
}

/** Envia o arquivo inteiro para o endereço de upload do container. */
async function enviarArquivo(uri, caminho, token) {
  const tamanho = fs.statSync(caminho).size;
  const res = await fetch(uri, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(tamanho),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(tamanho),
    },
    body: Readable.toWeb(fs.createReadStream(caminho)),
    duplex: 'half',
    signal: AbortSignal.timeout(LIMITE_UPLOAD_MS),
  });
  const texto = await res.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = null; }
  if (dados?.error) throw new GraphError(dados.error, res.status);
  if (!res.ok) throw new GraphError({ message: `Upload do vídeo recusado (HTTP ${res.status}): ${texto.slice(0, 200)}` }, res.status);
  if (dados && dados.success === false) throw new GraphError({ message: `Upload do vídeo recusado: ${texto.slice(0, 200)}` }, res.status);
}

/** Espera a Meta processar a mídia. Vídeo leva de segundos a minutos. */
async function aguardarProcessamento(containerId, token, { limiteMs = 10 * 60_000, intervaloMs = 5000 } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    const d = await get(`/${containerId}`, { fields: 'status_code,status' }, token);
    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR') throw new Error(`A Meta não conseguiu processar a mídia: ${d.status || 'erro sem detalhe'}`);
    if (d.status_code === 'EXPIRED') throw new Error('O container expirou antes de ser publicado');
    await delay(intervaloMs);
  }
  throw new Error(`A Meta não terminou de processar a mídia em ${Math.round(limiteMs / 60_000)} min`);
}

async function publicarContainer(conta, containerId) {
  const d = await post(`/${conta.igUserId}/media_publish`, { creation_id: containerId }, conta.accessToken);
  if (!d?.id) throw new Error('A Meta não devolveu o id da publicação');
  return String(d.id);
}

/** Erro que diz respeito à CONTA (token, restrição, banimento): outro caminho não resolve. */
function ehErroDaConta(err) {
  return err?.code === 'SEM_TOKEN' || !!require('./contas').classificarErro(err);
}

/**
 * Vídeo — Reel ou Story. Upload direto; se falhar antes de publicar, uma
 * tentativa pela URL pública.
 *
 * @param {object} conta
 * @param {{ tipo: 'REELS'|'STORIES', caminho: string, url: string,
 *           legenda?: string, capaUrl?: string, noFeed?: boolean }} v
 * @returns {Promise<string>} id da mídia publicada
 */
async function publicarVideo(conta, v) {
  exigirConexao(conta);
  const base = v.tipo === 'STORIES'
    ? { media_type: 'STORIES' }
    : { media_type: 'REELS', caption: v.legenda, cover_url: v.capaUrl, share_to_feed: v.noFeed === false ? 'false' : 'true' };

  let containerId;
  try {
    const c = await criarContainer(conta, { ...base, upload_type: 'resumable' });
    await enviarArquivo(c.uri, v.caminho, conta.accessToken);
    containerId = c.id;
    console.log(`⬆️  [Publicação] @${conta.username} — vídeo enviado direto para a Meta (${c.id})`);
  } catch (err) {
    if (ehErroDaConta(err) || !v.url) throw err;
    console.log(`↪️  [Publicação] @${conta.username} — upload direto falhou (${err.message}); tentando pela URL`);
    containerId = (await criarContainer(conta, { ...base, video_url: v.url })).id;
  }

  await aguardarProcessamento(containerId, conta.accessToken, { intervaloMs: 5000 });
  return publicarContainer(conta, containerId);
}

/**
 * Imagem — post de feed ou Story. A API só aceita imagem por URL.
 * @param {{ tipo: 'IMAGE'|'STORIES', url: string, legenda?: string }} i
 */
async function publicarImagem(conta, i) {
  exigirConexao(conta);
  const campos = i.tipo === 'STORIES'
    ? { media_type: 'STORIES', image_url: i.url }
    : { image_url: i.url, caption: i.legenda };
  const { id } = await criarContainer(conta, campos);
  await aguardarProcessamento(id, conta.accessToken, { intervaloMs: 2000 });
  return publicarContainer(conta, id);
}

module.exports = { publicarVideo, publicarImagem, aguardarProcessamento, RUPLOAD };

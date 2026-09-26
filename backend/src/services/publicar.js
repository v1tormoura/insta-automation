'use strict';

/**
 * Publica UM post em UMA conta pela API oficial.
 *
 * A Meta baixa a mídia da nossa URL pública (PUBLIC_URL/uploads/...), então o
 * trabalho aqui é deixar o arquivo certo nesse endereço:
 *
 *   Reel .... vídeo único por conta (midiaPorConta: humanização, marca d'água,
 *             trilha, variação de edição) → media_type=REELS
 *   Imagem .. marca d'água da conta, depois JPEG na proporção que o feed aceita
 *   Story ... texto queimado (se houver), imagem 9:16 em JPEG ou vídeo único
 *
 * Os arquivos gerados são apagados DEPOIS da publicação: apagar antes deixaria
 * a Meta pedindo um arquivo que não existe mais.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const graph = require('./instagramAPI');
const midiaPorConta = require('./midiaPorConta');
const { jpegParaInstagram, isVideo } = require('./videoProcessor');
const { resolverLegenda } = require('./variarLegenda');

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');

function absoluto(caminho) {
  return path.isAbsolute(caminho) ? caminho : path.join(RAIZ_UPLOADS, caminho);
}

/** URL pública de um arquivo dentro de uploads/. */
function urlPublica(caminho) {
  const rel = path.relative(RAIZ_UPLOADS, absoluto(caminho)).split(path.sep).map(encodeURIComponent).join('/');
  if (rel.startsWith('..')) throw new Error(`Arquivo fora de uploads/ não pode ser publicado: ${caminho}`);
  return `${config.publicUrl}/uploads/${rel}`;
}

function apagar(arquivos) {
  for (const a of arquivos) { try { fs.unlinkSync(absoluto(a)); } catch { /* já saiu */ } }
}

/**
 * Converte um endereço de mídia (URL deste servidor, caminho relativo a
 * uploads/ ou URL externa) em arquivo local. URL externa é baixada para tmp/.
 * @returns {Promise<{caminho: string, temporario: boolean}>}
 */
async function midiaLocal(endereco) {
  const bruto = String(endereco || '').trim();
  if (!bruto) throw new Error('Publicação sem mídia');
  const doServidor = bruto.match(/\/uploads\/(.+?)(\?.*)?$/);
  if (doServidor) return { caminho: decodeURIComponent(doServidor[1]), temporario: false };
  if (!/^https?:\/\//i.test(bruto)) return { caminho: bruto, temporario: false };

  const res = await fetch(bruto, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Não foi possível baixar a mídia: HTTP ${res.status}`);
  const ext = (bruto.split('?')[0].match(/\.(jpe?g|png|webp|mp4|mov)$/i) || [, 'jpg'])[1];
  const nome = `tmp/remota_${Date.now()}.${ext}`;
  fs.mkdirSync(path.join(RAIZ_UPLOADS, 'tmp'), { recursive: true });
  fs.writeFileSync(absoluto(nome), Buffer.from(await res.arrayBuffer()));
  return { caminho: nome, temporario: true };
}

async function publicarReel(conta, post, legenda) {
  const gerados = [];
  try {
    const midia = await midiaPorConta.prepararParaConta(post, conta);
    if (midia.proprio) gerados.push(midia.caminho);
    const coverUrl = post.cover ? urlPublica(post.cover) : null;
    return await graph.publicarReel(conta, { videoUrl: urlPublica(midia.caminho), caption: legenda, coverUrl });
  } finally {
    apagar(gerados);
  }
}

async function publicarImagem(conta, post, legenda) {
  const gerados = [];
  try {
    const comMarca = await midiaPorConta.prepararParaConta(post, conta);
    if (comMarca.proprio) gerados.push(comMarca.caminho);
    const jpeg = await jpegParaInstagram(absoluto(comMarca.caminho), 'feed');
    gerados.push(jpeg);
    return await graph.publicarImagem(conta, { imageUrl: urlPublica(jpeg), caption: legenda });
  } finally {
    apagar(gerados);
  }
}

/**
 * Story de imagem ou vídeo, com o texto livre da tela de Stories queimado.
 * @param {{media: string, textoLivre?: object, id?: string}} story
 */
async function publicarStory(conta, story) {
  const gerados = [];
  try {
    const origem = await midiaLocal(story.media);
    if (origem.temporario) gerados.push(origem.caminho);

    let arquivo = origem.caminho;
    if (story.textoLivre) {
      const { queimarTexto } = require('./textoNoStory');
      const r = await queimarTexto(absoluto(arquivo), story.textoLivre);
      if (r.queimado) { arquivo = r.caminho; gerados.push(arquivo); }
    }

    if (isVideo(arquivo)) {
      const midia = await midiaPorConta.prepararParaConta({ id: story.id || arquivo, media: arquivo }, conta);
      if (midia.proprio) gerados.push(midia.caminho);
      return await graph.publicarStory(conta, { url: urlPublica(midia.caminho), video: true });
    }
    const jpeg = await jpegParaInstagram(absoluto(arquivo), 'story');
    gerados.push(jpeg);
    return await graph.publicarStory(conta, { url: urlPublica(jpeg), video: false });
  } finally {
    apagar(gerados);
  }
}

/* Contas já conferidas neste processo: uma leitura de /me por conta, não por post. */
const _conferidas = new Set();

/**
 * Garante que `conta.igUserId` é o id da conta profissional (o `user_id` do
 * /me). Contas conectadas antes da correção guardaram o id do app, e com ele
 * a Meta recusa /{id}/media com "Object with ID ... does not exist". Conserta
 * na hora e grava, sem pedir reconexão.
 */
async function conferirId(conta) {
  if (!conta?.id || _conferidas.has(conta.id) || !conta.accessToken) return;
  const p = await graph.perfil(conta.accessToken).catch(() => null);
  if (!p) return;
  _conferidas.add(conta.id);
  if (p.igUserId && p.igUserId !== conta.igUserId) {
    console.log(`🔧 [Publicar] @${conta.username} — id da conta corrigido (${conta.igUserId} → ${p.igUserId})`);
    conta.igUserId = p.igUserId;
    await require('../repos/accounts').update(conta.id, { igUserId: p.igUserId })
      .catch(e => console.log(`⚠️ [Publicar] não gravou o id novo: ${e.message}`));
  }
}

/**
 * Publica o post nesta conta. A legenda passa pela variação por conta
 * (spintax `{a|b}`), com semente estável no par post+conta.
 * @returns {Promise<{mediaId: string}>}
 */
async function publicar(conta, post) {
  await conferirId(conta);
  const tipo = post.postType || 'reel';
  if (tipo === 'story') {
    return { mediaId: await publicarStory(conta, { media: post.media, id: post.id, textoLivre: post.textoLivre }) };
  }
  const legenda = resolverLegenda(post.caption || '', `${post.id}:${conta.id}`);
  const mediaId = isVideo(post.media)
    ? await publicarReel(conta, post, legenda)
    : await publicarImagem(conta, post, legenda);
  return { mediaId };
}

module.exports = { publicar, publicarStory, urlPublica, midiaLocal, _conferirId: conferirId };

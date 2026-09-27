'use strict';

/**
 * Publica UM post em UMA conta. Reescrito do zero em 27/09/2026.
 *
 *   1. confere o id da conta (o `user_id` do /me)
 *   2. prepara o arquivo — o original; convertido só se o formato não servir
 *      ou se houver marca d'água (midiaPorConta); story com texto queimado
 *   3. entrega à Meta (publicacao.js) — vídeo por upload direto, imagem por URL
 *   4. apaga o que foi gerado para a publicação (nunca o original)
 *
 * A legenda passa pela variação por conta (spintax `{a|b}`), com semente
 * estável no par post+conta.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const graph = require('./instagramAPI');
const publicacao = require('./publicacao');
const midiaPorConta = require('./midiaPorConta');
const { jpegParaInstagram, isVideo } = require('./videoProcessor');
const { resolverLegenda } = require('./variarLegenda');

const RAIZ_UPLOADS = path.resolve(__dirname, '../../uploads');

function absoluto(caminho) {
  return path.isAbsolute(caminho) ? caminho : path.join(RAIZ_UPLOADS, caminho);
}

/** URL pública de um arquivo dentro de uploads/ (imagens, capa e o plano B do vídeo). */
function urlPublica(caminho) {
  const rel = path.relative(RAIZ_UPLOADS, absoluto(caminho)).split(path.sep).map(encodeURIComponent).join('/');
  if (rel.startsWith('..')) throw new Error(`Arquivo fora de uploads/ não pode ser publicado: ${caminho}`);
  return `${config.publicUrl}/uploads/${rel}`;
}

function apagar(arquivos) {
  for (const a of arquivos) { try { fs.unlinkSync(absoluto(a)); } catch { /* já saiu */ } }
}

/**
 * Endereço de mídia (URL deste servidor, caminho em uploads/ ou URL externa)
 * → arquivo local. URL externa é baixada para uploads/tmp/.
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

/* Contas já conferidas neste processo: uma leitura de /me por conta, não por post. */
const _conferidas = new Set();

/**
 * Garante que `conta.igUserId` é o id da conta profissional (o `user_id` do
 * /me). Contas conectadas antes guardaram o id do app, e com ele a Meta recusa
 * /{id}/media com "Object with ID ... does not exist". Conserta e grava.
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

/** Reel: o vídeo desta conta, com capa e legenda. */
async function reel(conta, post, legenda, gerados) {
  const midia = await midiaPorConta.prepararParaConta(post, conta);
  if (midia.proprio) gerados.push(midia.caminho);
  return publicacao.publicarVideo(conta, {
    tipo: 'REELS',
    caminho: absoluto(midia.caminho),
    url: urlPublica(midia.caminho),
    legenda,
    capaUrl: post.cover ? urlPublica(post.cover) : null,
  });
}

/** Post de imagem no feed: marca d'água (se houver) e JPEG na proporção do feed. */
async function imagem(conta, post, legenda, gerados) {
  const comMarca = await midiaPorConta.prepararParaConta(post, conta);
  if (comMarca.proprio) gerados.push(comMarca.caminho);
  const jpeg = await jpegParaInstagram(absoluto(comMarca.caminho), 'feed');
  gerados.push(jpeg);
  return publicacao.publicarImagem(conta, { tipo: 'IMAGE', url: urlPublica(jpeg), legenda });
}

/** Story de imagem ou vídeo, com o texto livre da tela de Stories queimado. */
async function story(conta, s, gerados) {
  const origem = await midiaLocal(s.media);
  if (origem.temporario) gerados.push(origem.caminho);

  let arquivo = origem.caminho;
  if (s.textoLivre) {
    const { queimarTexto } = require('./textoNoStory');
    const r = await queimarTexto(absoluto(arquivo), s.textoLivre);
    if (r.queimado) { arquivo = r.caminho; gerados.push(arquivo); }
  }

  if (isVideo(arquivo)) {
    const midia = await midiaPorConta.prepararParaConta({ id: s.id || arquivo, media: arquivo }, conta);
    if (midia.proprio) gerados.push(midia.caminho);
    return publicacao.publicarVideo(conta, { tipo: 'STORIES', caminho: absoluto(midia.caminho), url: urlPublica(midia.caminho) });
  }
  const jpeg = await jpegParaInstagram(absoluto(arquivo), 'story');
  gerados.push(jpeg);
  return publicacao.publicarImagem(conta, { tipo: 'STORIES', url: urlPublica(jpeg) });
}

/**
 * Publica o post nesta conta.
 * @returns {Promise<{mediaId: string}>}
 */
async function publicar(conta, post) {
  await conferirId(conta);
  /* O que foi gerado para esta publicação sai DEPOIS de a Meta terminar:
     no plano B (URL) ela ainda baixa daqui até o container ficar pronto. */
  const gerados = [];
  try {
    const tipo = post.postType || 'reel';
    if (tipo === 'story') {
      return { mediaId: await story(conta, { media: post.media, id: post.id, textoLivre: post.textoLivre }, gerados) };
    }
    const legenda = resolverLegenda(post.caption || '', `${post.id}:${conta.id}`);
    const mediaId = isVideo(post.media)
      ? await reel(conta, post, legenda, gerados)
      : await imagem(conta, post, legenda, gerados);
    return { mediaId };
  } finally {
    apagar(gerados);
  }
}

module.exports = { publicar, urlPublica, midiaLocal, _conferirId: conferirId };

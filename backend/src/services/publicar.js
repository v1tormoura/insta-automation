'use strict';

/**
 * Publica UM post em UMA conta — o fluxo do Publicador (publicacao.js).
 *
 *   1. confere o id da conta (o `user_id` do /me)
 *   2. a mídia vai como foi enviada: vídeo original (convertido só se o
 *      formato não for aceito pela API), foto em JPEG, story com o texto
 *      livre queimado quando houver
 *   3. a Meta baixa pela URL pública, processa e publica (publicacao.js)
 *   4. apaga o que foi gerado para a publicação (nunca o original)
 *
 * A legenda vai como foi escrita; só a sintaxe `{a|b}`, quando usada, é
 * resolvida (semente estável no par post+conta).
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

/** O vídeo como foi enviado; convertido só se o formato não for aceito pela API. */
async function videoParaAConta(post, conta, gerados) {
  const midia = await midiaPorConta.prepararParaConta({ id: post.id, media: post.media, marcaDagua: null }, conta);
  if (midia.proprio) gerados.push(midia.caminho);
  return midia.caminho;
}

/** Reel: o vídeo, com capa (imagem própria ou quadro) e legenda. */
async function reel(conta, post, legenda, gerados) {
  const video = await videoParaAConta(post, conta, gerados);
  return publicacao.publicarNoInstagram(conta, {
    tipo: 'REEL',
    midia: { kind: 'video', url: urlPublica(video) },
    legenda,
    capaUrl: post.cover ? urlPublica(post.cover) : null,
    thumbOffsetMs: Number.isFinite(post.thumbOffsetMs) ? post.thumbOffsetMs : undefined,
    noFeed: post.shareToFeed !== false,
  });
}

/** Foto no feed: JPEG na proporção do feed (a API só aceita JPEG). */
async function imagem(conta, post, legenda, gerados) {
  const jpeg = await jpegParaInstagram(absoluto(post.media), 'feed');
  gerados.push(jpeg);
  return publicacao.publicarNoInstagram(conta, { tipo: 'IMAGE', midia: { kind: 'image', url: urlPublica(jpeg) }, legenda });
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
    const video = await videoParaAConta({ id: s.id || arquivo, media: arquivo }, conta, gerados);
    return publicacao.publicarNoInstagram(conta, { tipo: 'STORY', midia: { kind: 'video', url: urlPublica(video) } });
  }
  const jpeg = await jpegParaInstagram(absoluto(arquivo), 'story');
  gerados.push(jpeg);
  return publicacao.publicarNoInstagram(conta, { tipo: 'STORY', midia: { kind: 'image', url: urlPublica(jpeg) } });
}

/**
 * Publica o post nesta conta.
 * @returns {Promise<{mediaId: string|null, permalink: string|null}>}
 */
async function publicar(conta, post) {
  await conferirId(conta);
  /* O que foi gerado para esta publicação sai DEPOIS de a Meta terminar:
     ela baixa daqui até o container ficar pronto. */
  const gerados = [];
  try {
    const tipo = post.postType || 'reel';
    if (tipo === 'story') {
      return await story(conta, { media: post.media, id: post.id, textoLivre: post.textoLivre }, gerados);
    }
    const legenda = resolverLegenda(post.caption || '', `${post.id}:${conta.id}`);
    return isVideo(post.media)
      ? await reel(conta, post, legenda, gerados)
      : await imagem(conta, post, legenda, gerados);
  } finally {
    apagar(gerados);
  }
}

module.exports = { publicar, urlPublica, midiaLocal, _conferirId: conferirId };

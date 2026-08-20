'use strict';

/**
 * Instagram Story posting service.
 *
 * - Graph API  → contas com accessToken + igUserId (OAuth)
 * - Private API → contas com username + password
 *
 * Story com link sticker: aparece como figurinha clicável no story.
 */

const Account = require('../models/Account');
const { createClient } = require('./instagramPrivateService');
const { postStoryWebSession, hasPuppeteerSession } = require('./storyWebSession');
const { postStoryPuppeteer } = require('./storyPuppeteer');

const IG_GRAPH = 'https://graph.instagram.com/v21.0';

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Graph API ─────────────────────────────────────────────────────────────────

async function postStoryGraphAPI(account, { imageUrl, linkUrl, linkText }) {
  const isVideo = /\.(mp4|mov|avi|webm)$/i.test(imageUrl);
  const params = new URLSearchParams({
    media_type:   'STORIES',
    access_token: account.accessToken,
  });
  if (isVideo) {
    params.set('video_url', imageUrl);
  } else {
    params.set('image_url', imageUrl);
  }

  if (linkUrl) {
    params.set('link_sticker_url', linkUrl);
  }

  // Passo 1: Criar container
  const containerRes = await fetch(`${IG_GRAPH}/${account.igUserId}/media`, {
    method: 'POST',
    body: params,
  });
  const container = await containerRes.json();

  if (container.error) {
    // Erro 9007 = permissão de link sticker não disponível → tenta sem link
    if (container.error.code === 9007 && linkUrl) {
      console.log(`⚠️  Link sticker não disponível via Graph API para @${account.username} — postando sem link`);
      return postStoryGraphAPI(account, { imageUrl, linkUrl: null, linkText: null });
    }
    throw new Error(container.error.message || 'Erro ao criar container de Story');
  }

  // Passo 2: Aguardar processamento (vídeo precisa de mais tempo)
  await delay(isVideo ? 8000 : 2500);

  // Para vídeo: polling de status até ficar pronto
  if (isVideo) {
    for (let i = 0; i < 12; i++) {
      const statusRes = await fetch(`${IG_GRAPH}/${container.id}?fields=status_code&access_token=${account.accessToken}`);
      const status = await statusRes.json();
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR') throw new Error('Erro no processamento do vídeo pelo Instagram');
      await delay(5000);
    }
  }

  const publishRes = await fetch(`${IG_GRAPH}/${account.igUserId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({
      creation_id:  container.id,
      access_token: account.accessToken,
    }),
  });
  const published = await publishRes.json();

  if (published.error) {
    throw new Error(published.error.message || 'Erro ao publicar Story');
  }

  console.log(`✅ [Story Graph] @${account.username} — id ${published.id}${linkUrl ? ' (link_sticker_url enviado)' : ''}`);
  console.log(`[Story Graph] container response:`, JSON.stringify(container).slice(0, 200));
  return { id: published.id, method: 'graph', withLink: !!linkUrl };
}

// ── Private API ───────────────────────────────────────────────────────────────

async function postStoryPrivateAPI(account, { imageUrl, imageBuffer, linkUrl }) {
  const ig = await createClient(account);

  // Obtém buffer da imagem
  let buffer = imageBuffer;
  if (!buffer && imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Não foi possível baixar a imagem: HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
  }
  if (!buffer) throw new Error('Imagem não fornecida');

  // Tenta postar com link sticker (suporte varia pela versão do pacote)
  if (linkUrl) {
    try {
      const result = await ig.publish.story({
        file: buffer,
        storyStickerIds: 'link',
        storyLinks: [{ webUri: linkUrl }],
      });
      console.log(`✅ [Story Private] @${account.username} — com link sticker`);
      return { method: 'private', withLink: true };
    } catch (e) {
      console.log(`⚠️  Link sticker privado falhou (${e.message}) — tentando sem link`);
    }
  }

  // Story simples (sem link sticker)
  await ig.publish.story({ file: buffer });
  console.log(`✅ [Story Private] @${account.username} — sem link sticker`);
  return { method: 'private', withLink: false };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Posta um Story na conta dada.
 *
 * @param {Object} account  - documento Account do Mongoose
 * @param {Object} options
 * @param {string} options.imageUrl   - URL pública da imagem (obrigatório)
 * @param {string} [options.linkUrl]  - URL do link sticker
 * @param {string} [options.linkText] - Texto da figurinha (padrão: "Clique Aqui")
 */
/**
 * Resolve a mídia para um caminho de arquivo — o instagrapi publica a partir do
 * disco, enquanto o painel envia URL pública.
 *
 * URLs do próprio servidor (.../uploads/<rel>) viram <rel>, que o HttpClient
 * prefixa com UPLOADS_DIR. URL externa é baixada para uploads/tmp.
 */
async function _resolveLocalMedia(media) {
  const bruto = String(media || '').trim();
  if (!bruto) throw new Error('Story sem mídia');

  const doUploads = bruto.match(/\/uploads\/(.+)$/);
  if (doUploads) return decodeURIComponent(doUploads[1]);

  if (!/^https?:\/\//i.test(bruto)) return bruto; // já é caminho local

  const path = require('path');
  const fs   = require('fs');
  const tmpDir = path.resolve(__dirname, '../../uploads/tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const res = await fetch(bruto, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Não foi possível baixar a mídia do story: HTTP ${res.status}`);
  const ext  = (bruto.split('?')[0].match(/\.(jpg|jpeg|png|mp4|mov)$/i) || [, 'jpg'])[1];
  const nome = `story_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(tmpDir, nome), Buffer.from(await res.arrayBuffer()));
  return `tmp/${nome}`;
}

async function postStory(account, options) {
  if (options.linkUrl) {
    // Fase 16: Desativamos a queima visual do link sticker para evitar sobreposição
    // com o nativo desenhado pelo Instagram.
  }

  // 0. Sessão instagrapi — método principal quando existe.
  // Vem antes da Graph API porque suporta link sticker em qualquer conta: a Graph
  // API responde 9007 (link_sticker sem permissão) e cai em story sem link.
  if (account.provider === 'instagrapi' || account.instagrapiSession) {
    const { getProvider } = require('../providers/ProviderFactory');
    const provider = getProvider(account);
    const media = await _resolveLocalMedia(options.imagePath || options.imageUrl);
    const res = await provider.publishStory(account, {
      media:        media,
      caption:      options.caption || '',
      linkUrl:      options.linkUrl || null,
      // Posição do sticker (0..1, x/y = centro). Ausentes → centralizado.
      linkX:        options.linkX,
      linkY:        options.linkY,
      linkWidth:    options.linkWidth,
      linkHeight:   options.linkHeight,
      linkRotation: options.linkRotation,
    });
    console.log(`✅ [Story instagrapi] @${account.username} — id ${res.media_id}${res.with_link ? ' (com link)' : ''}`);
    return { id: res.media_id, method: 'instagrapi', withLink: !!res.with_link };
  }

  // 1. Graph API (OAuth) — conta conectada via Meta API
  if (account.accessToken && account.igUserId) {
    // Para contas OAuth, Graph API é o método principal — não cai em Private API
    return await postStoryGraphAPI(account, options);
  }

  // 2. Sessão API privada salva
  if (account.igSession) {
    return postStoryPrivateAPI(account, options);
  }

  // 3. Private API com senha
  if (account.password) {
    try {
      return await postStoryPrivateAPI(account, options);
    } catch (err) {
      console.log(`⚠️  [Story] Private API falhou (${err.message}) — tentando sessão web...`);
    }
  }

  // 4. Sessão web (cookies.json)
  if (hasPuppeteerSession(account.username)) {
    return await postStoryWebSession(account, options);
  }

  throw new Error(
    `@${account.username}: conta não conectada via API — clique em "Conectar via API" na página de Contas`
  );
}

module.exports = { postStory };

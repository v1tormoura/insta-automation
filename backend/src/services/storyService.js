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
    params.set('link_sticker', JSON.stringify({
      link_url:          linkUrl,
      custom_link_label: linkText || 'Clique Aqui',
    }));
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

  console.log(`✅ [Story Graph] @${account.username} — id ${published.id}${linkUrl ? ' (com link sticker)' : ''}`);
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
async function postStory(account, options) {
  // 1. Graph API (OAuth) — tenta para qualquer token OAuth (IGQ, EAA, IGAAL)
  if (account.accessToken && account.igUserId) {
    try {
      return await postStoryGraphAPI(account, options);
    } catch (err) {
      console.log(`⚠️  [Story] Graph API falhou (${err.message}) — tentando Private API...`);
      // Cai para private API se graph falhar
    }
  }

  // 2. Sessão API privada salva (capturada após "Entrar" via browser)
  if (account.igSession) {
    return postStoryPrivateAPI(account, options);
  }

  // 3. Private API com senha — cria sessão mobile real, suporta link stickers
  if (account.password) {
    try {
      return await postStoryPrivateAPI(account, options);
    } catch (err) {
      console.log(`⚠️  [Story] Private API falhou (${err.message}) — tentando sessão web...`);
      // Cai para sessão web se private API falhar (senha errada, checkpoint, etc.)
    }
  }

  // 4. Sessão web (cookies.json) — HTTP puro, sem browser
  //    LIMITAÇÃO: link sticker não funciona (www.instagram.com ignora)
  if (hasPuppeteerSession(account.username)) {
    return await postStoryWebSession(account, options);
  }

  throw new Error(
    `@${account.username}: sem sessão — adicione a senha via 🔑 Senha ou clique em "Entrar" para capturar a sessão`
  );
}

module.exports = { postStory };

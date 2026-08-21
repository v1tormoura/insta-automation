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

/**
 * Modo da figurinha de link, por ambiente (STORY_LINK_MODE):
 *
 *   burned (padrão) — a pílula é queimada nos pixels e o serviço Python manda
 *                     só a área de toque nativa. Visível sem depender de o
 *                     Instagram desenhar nada.
 *   native          — nada é queimado; o Python manda `story_link_stickers`
 *                     para o Instagram desenhar a figurinha dele.
 *   both            — os dois, para comparar. Pode sair figurinha duplicada.
 */
function _modoFigurinha() {
  const modo = String(process.env.STORY_LINK_MODE || 'burned').trim().toLowerCase();
  return ['burned', 'native', 'both'].includes(modo) ? modo : 'burned';
}

/**
 * Queima a figurinha de link nos pixels da mídia e devolve a geometria usada.
 *
 * O Instagram não desenha figurinhas no servidor — o `tap_models` que a
 * instagrapi envia cria só a área clicável, por isso o link saía invisível.
 * A pílula é queimada aqui e a MESMA caixa vai como área de toque, então o que
 * se vê e o que se toca são o mesmo retângulo.
 *
 * @returns {Promise<{media:string, box:Object|null, rendered:boolean, engine:string|null}>}
 */
async function _aplicarFigurinhaDeLink(mediaRel, options) {
  if (!options.linkUrl) {
    return { media: mediaRel, box: null, rendered: false, engine: null };
  }

  const path = require('path');
  const {
    renderStoryWithLinkSticker, computeStickerBox, formatStickerLabel,
  } = require('./storyStickerRenderer');

  // Modo nativo: nada é queimado, mas a caixa continua sendo calculada aqui —
  // é ela que dimensiona a figurinha que o Instagram vai desenhar.
  if (_modoFigurinha() === 'native') {
    const label = formatStickerLabel(options.linkUrl, options.linkText);
    return {
      media: mediaRel,
      box: computeStickerBox({ label, ...options }),
      rendered: false,
      engine: null,
    };
  }

  const raizUploads = path.resolve(__dirname, '../../uploads');
  const absoluto = path.isAbsolute(mediaRel) ? mediaRel : path.join(raizUploads, mediaRel);

  const r = await renderStoryWithLinkSticker(absoluto, {
    linkUrl:    options.linkUrl,
    linkText:   options.linkText,
    linkX:      options.linkX,
    linkY:      options.linkY,
    linkWidth:  options.linkWidth,
    linkHeight: options.linkHeight,
  });

  if (!r.rendered) {
    console.warn(
      `⚠️ [Story] Figurinha visual não pôde ser queimada (${r.error || 'motivo desconhecido'}) — ` +
      'o story sai com o link nativo, que o Instagram não desenha.'
    );
    // Mesmo sem queimar, a caixa calculada é a melhor área de toque disponível.
    return { media: mediaRel, box: r.box, rendered: false, engine: r.engine };
  }

  // O HttpClient prefixa caminhos relativos com UPLOADS_DIR do container; um
  // caminho fora da raiz de uploads só pode seguir absoluto, ou viraria um
  // "../.." que o serviço Python não resolve.
  const relativo = path.relative(raizUploads, r.path).split(path.sep).join('/');
  const media = relativo.startsWith('..') ? r.path : relativo;
  return { media, box: r.box, rendered: true, engine: r.engine };
}

/**
 * Apaga a cópia da mídia com a figurinha queimada, depois que o upload terminou.
 * A mídia ORIGINAL nunca é tocada — só o arquivo derivado em uploads/processed.
 */
function _descartarQueimada(figurinha) {
  if (!figurinha.rendered) return;
  try {
    const path = require('path');
    const fs   = require('fs');
    const raizUploads = path.resolve(__dirname, '../../uploads');
    const alvo = path.isAbsolute(figurinha.media)
      ? figurinha.media
      : path.join(raizUploads, figurinha.media);
    if (path.resolve(alvo).startsWith(path.join(raizUploads, 'processed'))) {
      fs.unlinkSync(alvo);
    }
  } catch { /* arquivo já sumiu ou está em uso — não é motivo para falhar o story */ }
}

async function postStory(account, options) {
  // 0. Sessão instagrapi — método principal quando existe.
  // Vem antes da Graph API porque suporta link sticker em qualquer conta: a Graph
  // API responde 9007 (link_sticker sem permissão) e cai em story sem link.
  if (account.provider === 'instagrapi' || account.instagrapiSession) {
    const { getProvider } = require('../providers/ProviderFactory');
    const provider = getProvider(account);
    const midiaOriginal = await _resolveLocalMedia(options.imagePath || options.imageUrl);
    const figurinha = await _aplicarFigurinhaDeLink(midiaOriginal, options);

    let res;
    try {
      res = await provider.publishStory(account, {
        media:        figurinha.media,
        caption:      options.caption || '',
        linkUrl:      options.linkUrl || null,
        linkText:     options.linkText || null,
        // Área de toque: a caixa que acabou de ser desenhada, para o toque cair
        // exatamente sobre a pílula. Sem queima, cai no padrão do posicionador.
        linkX:        figurinha.box ? figurinha.box.x      : options.linkX,
        linkY:        figurinha.box ? figurinha.box.y      : options.linkY,
        linkWidth:    figurinha.box ? figurinha.box.width  : options.linkWidth,
        linkHeight:   figurinha.box ? figurinha.box.height : options.linkHeight,
        linkRotation: options.linkRotation,
        linkStickerMode: _modoFigurinha(),
      });
    } finally {
      // A cópia queimada serviu só para o upload. Sem isto, uploads/processed
      // cresce um arquivo por story publicado, para sempre.
      _descartarQueimada(figurinha);
    }

    const marca = options.linkUrl
      ? ` (link ${figurinha.rendered ? `visível via ${figurinha.engine}` : 'apenas nativo'}` +
        `${res.link_native ? ', nativo confirmado' : ''})`
      : '';
    console.log(`✅ [Story instagrapi] @${account.username} — id ${res.media_id}${marca}`);
    return {
      id:           res.media_id,
      method:       'instagrapi',
      withLink:     !!res.with_link,
      linkVisible:  figurinha.rendered,
      linkNative:   !!res.link_native,
      stickerEngine: figurinha.engine,
    };
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

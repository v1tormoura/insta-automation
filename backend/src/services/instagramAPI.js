/**
 * Instagram posting via Meta Graph API (no browser required).
 *
 * Flow:
 *  1. exchangeToken()         — short-lived -> long-lived access token (60 days)
 *  2. getIgUserId()           — find the Instagram User ID linked to the token
 *  3. prepareVideo()          — convert video ONCE before publishing to all accounts
 *  4. postReel()              — create container + wait + publish (per account)
 *
 * Requirements per account in MongoDB:
 *   account.igUserId    — numeric IG user ID ("17841400000000001")
 *   account.accessToken — long-lived user access token
 *
 * Env vars:
 *   META_APP_ID      — from developers.facebook.com
 *   META_APP_SECRET  — from developers.facebook.com
 *   PUBLIC_URL       — public base URL of this server (for cover images, optional)
 *                      e.g. "http://123.45.67.89:3000"
 */

const fs   = require('fs');
const path = require('path');
const { convertToReelFormat } = require('./videoProcessor');

const GRAPH_IG = 'https://graph.instagram.com/v21.0';  // Instagram Login tokens
const GRAPH_FB = 'https://graph.facebook.com/v21.0';   // Facebook Login tokens
const delay    = ms => new Promise(r => setTimeout(r, ms));

// Detect which Graph base to use based on token prefix.
// IG Business Login tokens start with "IGAAL" or "IGQ" -> graph.instagram.com
// FB Login tokens start with "EAA" -> graph.facebook.com
function graphBase(token) {
  if (token && (token.startsWith('IGQ') || token.startsWith('IGAAL') || token.startsWith('IG'))) return GRAPH_IG;
  return GRAPH_FB;
}

// --- Low-level helpers ---------------------------------------------------

async function gGet(endpoint, params = {}, token) {
  const GRAPH = graphBase(token);
  const url = new URL(GRAPH + endpoint);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const r = await fetch(url.toString());
  const d = await r.json();
  if (d.error) throw new Error(d.error.error_user_msg || d.error.error_user_title || `[Graph API] ${d.error.message} (code ${d.error.code})`);
  return d;
}

async function gPost(endpoint, params = {}, body = {}, token) {
  const GRAPH = graphBase(token);
  const url = new URL(GRAPH + endpoint);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const r = await fetch(url.toString(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.error_user_msg || d.error.error_user_title || `[Graph API] ${d.error.message} (code ${d.error.code})`);
  return d;
}

// --- Token management ---------------------------------------------------

/**
 * Exchange a short-lived user token for a long-lived one (valid ~60 days).
 * Returns { accessToken, expiresIn (seconds) }.
 */
async function exchangeToken(shortToken) {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) throw new Error('META_APP_ID e META_APP_SECRET nao definidos no .env');

  const isIgToken = shortToken?.match(/^(IGAAL|IGQ|IG)/i);

  let url;
  if (isIgToken) {
    url = new URL('https://graph.instagram.com/access_token');
    url.searchParams.set('grant_type',    'ig_exchange_token');
    url.searchParams.set('client_id',     appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('access_token',  shortToken);
  } else {
    url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    url.searchParams.set('grant_type',        'fb_exchange_token');
    url.searchParams.set('client_id',         appId);
    url.searchParams.set('client_secret',     appSecret);
    url.searchParams.set('fb_exchange_token', shortToken);
  }

  const r = await fetch(url.toString());
  const d = await r.json();
  if (d.error) throw new Error(`Troca de token falhou: ${d.error.message} (code ${d.error.code})`);

  return { accessToken: d.access_token, expiresIn: d.expires_in ?? 5184000 };
}

/**
 * Refresh a long-lived Instagram token (IGAAL / IGQ prefix).
 * Instagram allows refresh any time after 24h; token must NOT be expired.
 * Returns { accessToken, expiresIn }.
 */
async function refreshToken(currentToken) {
  if (!currentToken?.match(/^(IGAAL|IGQ|IG)/)) {
    throw new Error('Apenas tokens Instagram Login (IGAAL/IGQ) suportam refresh automatico');
  }
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type',   'ig_refresh_token');
  url.searchParams.set('access_token', currentToken);

  const r = await fetch(url.toString());
  const d = await r.json();
  if (d.error) throw new Error(`Refresh do token falhou: ${d.error.message} (code ${d.error.code})`);

  return { accessToken: d.access_token, expiresIn: d.expires_in ?? 5184000 };
}

/**
 * Find the Instagram Professional account connected to this token.
 * Returns { igUserId, pageName }.
 */
async function getIgUserId(token) {
  const isIgToken = token?.match(/^(IGAAL|IGQ|IG)/i);

  if (isIgToken) {
    const me = await gGet('/me', { fields: 'id,name,username,account_type' }, token);
    if (!me.id) throw new Error('Nao foi possivel obter o ID da conta Instagram. Verifique se o token e valido.');

    if (me.account_type === 'PERSONAL') {
      throw new Error(
        `A conta @${me.username} e pessoal (PERSONAL). ` +
        'Converta para Criador de Conteudo ou Comercial no app do Instagram ' +
        '(Configuracoes -> Conta -> Mudar para conta profissional) e tente novamente.'
      );
    }
    return { igUserId: me.id, pageName: me.name || me.username };
  }

  // Facebook Login tokens
  const pages = await gGet('/me/accounts', { fields: 'id,name,instagram_business_account' }, token);
  for (const page of (pages.data || [])) {
    if (page.instagram_business_account?.id) {
      return { igUserId: page.instagram_business_account.id, pageName: page.name };
    }
  }

  const me = await gGet('/me', { fields: 'id,name,instagram_pro_account' }, token);
  if (me.instagram_pro_account?.id) {
    return { igUserId: me.instagram_pro_account.id, pageName: me.name };
  }

  throw new Error(
    'Nenhuma conta Instagram Profissional encontrada. ' +
    'Certifique-se de que a conta e Business ou Creator e esta vinculada a uma Pagina do Facebook.'
  );
}

// --- Location -----------------------------------------------------------

const _locationCache = new Map();

async function searchLocationId(token, query) {
  if (_locationCache.has(query)) return _locationCache.get(query);

  try {
    const url = new URL('https://graph.facebook.com/v21.0/pages/search');
    url.searchParams.set('q',            query);
    url.searchParams.set('fields',       'id,name');
    url.searchParams.set('access_token', token);

    const r = await fetch(url.toString());
    const d = await r.json();
    if (d.error || !d.data?.length) return null;

    const id = d.data[0].id;
    console.log(`Location encontrado: "${d.data[0].name}" (${id})`);
    _locationCache.set(query, id);
    return id;
  } catch {
    return null;
  }
}

// --- Video container via video_url --------------------------------------

async function createVideoUrlContainer(igUserId, token, videoUrl, { caption, locationId, coverUrl }) {
  const GRAPH    = graphBase(token);
  const endpoint = `${GRAPH}/${igUserId}/media`;

  const url = new URL(endpoint);
  url.searchParams.set('access_token',  token);
  url.searchParams.set('media_type',    'REELS');
  url.searchParams.set('video_url',     videoUrl);
  url.searchParams.set('caption',       caption || '');
  url.searchParams.set('share_to_feed', 'true');
  if (locationId) url.searchParams.set('location_id', locationId);
  if (coverUrl)   url.searchParams.set('cover_url',   coverUrl);

  console.log(`Media API POST ${endpoint}`);
  console.log(`   video_url: ${videoUrl}`);

  const r    = await fetch(url.toString(), { method: 'POST' });
  const text = await r.text();
  console.log(`Media API response (${r.status}):`, text.slice(0, 500));
  const d = JSON.parse(text);
  if (d.error) throw new Error(d.error.error_user_msg || d.error.error_user_title || `Criacao de container falhou: ${d.error.message} (code ${d.error.code})`);

  return d.id;
}

// --- Container status & publish -----------------------------------------

async function waitForProcessing(containerId, token, timeoutMs = 300_000) {
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < timeoutMs) {
    const d = await gGet(`/${containerId}`, { fields: 'status_code,status' }, token);
    console.log(`[${i++}] Status: ${d.status_code}`);

    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR')    throw new Error(`Processamento falhou: ${d.status || 'erro desconhecido'}`);
    if (d.status_code === 'EXPIRED')  throw new Error('Container expirado');

    await delay(8000);
  }
  throw new Error('Timeout aguardando processamento do video (5 min)');
}

async function publishContainer(igUserId, token, containerId) {
  const GRAPH    = graphBase(token);
  const endpoint = `${GRAPH}/${igUserId}/media_publish`;

  const url = new URL(endpoint);
  url.searchParams.set('access_token', token);
  url.searchParams.set('creation_id',  containerId);

  console.log(`Publicando via /${igUserId}/media_publish`);
  const r    = await fetch(url.toString(), { method: 'POST' });
  const text = await r.text();
  console.log(`Publish response (${r.status}):`, text.slice(0, 300));
  const d = JSON.parse(text);
  if (d.error) throw new Error(d.error.error_user_msg || d.error.error_user_title || `[Graph API] ${d.error.message} (code ${d.error.code})`);
  return d.id;
}

// --- Main functions -----------------------------------------------------

/**
 * Converte o video UMA vez e retorna a URL publica.
 * Chame isso no worker ANTES de publicar em multiplas contas em paralelo,
 * para evitar reconversao simultanea do mesmo arquivo por cada conta.
 */
async function prepareVideo(post) {
  const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!publicUrl) {
    throw new Error('PUBLIC_URL nao definido no .env. Adicione PUBLIC_URL=http://SEU_IP:3000 para que o Instagram possa baixar o video.');
  }
  const rawPath   = path.resolve(__dirname, '../../uploads', post.media);
  const videoPath = await convertToReelFormat(rawPath, { processMode: post.processMode || 'sem_limpeza' });
  console.log('Video convertido:', path.basename(videoPath));
  return `${publicUrl}/uploads/processed/${path.basename(videoPath)}`;
}

/**
 * Publica um Reel via Meta Graph API.
 * @param {Object} account                — { igUserId, accessToken }
 * @param {Object} post                   — { media, caption, location, cover, postType }
 * @param {string} [preProcessedVideoUrl] — URL ja processada; se omitido, converte agora
 */
async function postReel(account, post, preProcessedVideoUrl = null) {
  const { igUserId, accessToken } = account;

  if (!igUserId || !accessToken) {
    throw new Error('Conta sem igUserId ou accessToken — conecte a conta via API primeiro.');
  }

  // 1. URL do video — usa pre-processada se disponivel, caso contrario converte agora
  const videoUrl = preProcessedVideoUrl || await prepareVideo(post);
  console.log('Video URL:', videoUrl);

  // 2. Location (opcional)
  const locationId = post.location
    ? await searchLocationId(accessToken, post.location)
    : null;

  // 3. Cover URL (opcional)
  const publicBase = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const coverUrl   = (post.cover && publicBase)
    ? `${publicBase}/uploads/${post.cover}`
    : null;

  // 4. Cria container
  console.log('Criando container de midia (video_url)...');
  const containerId = await createVideoUrlContainer(igUserId, accessToken, videoUrl, {
    caption:    post.caption || '',
    locationId,
    coverUrl,
  });
  console.log('Container criado:', containerId);

  // 5. Aguarda processamento pela Meta
  console.log('Aguardando processamento pela Meta...');
  await waitForProcessing(containerId, accessToken);
  console.log('Video processado');

  // 6. Publica
  console.log('Publicando Reel...');
  const publishedId = await publishContainer(igUserId, accessToken, containerId);
  console.log('REEL PUBLICADO! ID:', publishedId);

  return publishedId;
}

module.exports = {
  exchangeToken,
  refreshToken,
  getIgUserId,
  prepareVideo,
  postReel,
};

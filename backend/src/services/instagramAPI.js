'use strict';

/**
 * Cliente da API oficial do Instagram (Instagram API com Instagram Login).
 *
 * Só o que a Meta documenta para contas profissionais:
 *   OAuth .......... api.instagram.com/oauth/access_token (código → token curto)
 *   Token longo .... graph.instagram.com/access_token      (ig_exchange_token, 60 dias)
 *   Renovação ...... graph.instagram.com/refresh_access_token (ig_refresh_token)
 *   Perfil ......... GET  /me
 *   Publicação ..... POST /{ig-user-id}/media  →  GET /{container}?fields=status_code
 *                    →  POST /{ig-user-id}/media_publish
 *   Comentário ..... POST /{media-id}/comments
 *   Cota ........... GET  /{ig-user-id}/content_publishing_limit
 *
 * A Meta BAIXA a mídia de uma URL pública (a nossa PUBLIC_URL/uploads/...);
 * não existe upload direto de arquivo nesta API.
 *
 * O que ela NÃO faz (e por isso não existe aqui): login por senha, curtir,
 * seguir, editar perfil, figurinha de link/enquete em story, localização por
 * busca de lugar.
 */

const VERSAO = process.env.GRAPH_API_VERSION || 'v21.0';
const GRAPH = `https://graph.instagram.com/${VERSAO}`;
const TIMEOUT_MS = 30_000;

const delay = ms => new Promise(r => setTimeout(r, ms));

/** Erro da Graph com o código da Meta preservado (quem classifica precisa dele). */
class GraphError extends Error {
  constructor(erro, status) {
    super(erro?.error_user_msg || erro?.error_user_title || erro?.message || `Graph API respondeu ${status}`);
    this.name = 'GraphError';
    this.code = erro?.code;
    this.subcode = erro?.error_subcode;
    this.type = erro?.type;
    this.status = status;
  }
}

async function lerResposta(res) {
  const texto = await res.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = { error: { message: texto.slice(0, 300) || `HTTP ${res.status}` } }; }
  if (dados?.error) throw new GraphError(dados.error, res.status);
  if (!res.ok) throw new GraphError({ message: `HTTP ${res.status}` }, res.status);
  return dados;
}

async function get(caminho, params, token) {
  const url = new URL(caminho.startsWith('http') ? caminho : GRAPH + caminho);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  url.searchParams.set('access_token', token);
  return lerResposta(await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }));
}

async function post(caminho, params, token) {
  const corpo = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') corpo.set(k, String(v));
  if (token) corpo.set('access_token', token);
  const url = caminho.startsWith('http') ? caminho : GRAPH + caminho;
  return lerResposta(await fetch(url, { method: 'POST', body: corpo, signal: AbortSignal.timeout(TIMEOUT_MS) }));
}

// ── Tokens ───────────────────────────────────────────────────────────────────

/** Código do OAuth → token curto (1h) e o id da conta profissional. */
async function trocarCodigo(code, { appId, appSecret }, redirectUri) {
  const dados = await post('https://api.instagram.com/oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  // A resposta vem em `data[0]` em algumas versões e solta em outras.
  const r = Array.isArray(dados?.data) ? dados.data[0] : dados;
  if (!r?.access_token) throw new Error('A Meta não devolveu token na troca do código');
  return { token: r.access_token, userId: r.user_id ? String(r.user_id) : '' };
}

/** Token curto → longo (60 dias). */
async function tokenDeLongaDuracao(tokenCurto, appSecret) {
  const d = await get('https://graph.instagram.com/access_token', {
    grant_type: 'ig_exchange_token',
    client_secret: appSecret,
  }, tokenCurto);
  return { token: d.access_token, expiraEm: new Date(Date.now() + (d.expires_in || 5_184_000) * 1000) };
}

/** Renova um token longo ainda válido por mais 60 dias. */
async function renovarToken(tokenLongo) {
  const d = await get('https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token' }, tokenLongo);
  return { token: d.access_token, expiraEm: new Date(Date.now() + (d.expires_in || 5_184_000) * 1000) };
}

// ── Perfil ───────────────────────────────────────────────────────────────────

/* Os campos que a conta profissional expõe com Instagram Login. Um campo que a
   API não conhece derruba a chamada inteira — por isso só estes. `user_id` é o
   id da conta profissional (o que publica); a partir da v23 o `id` passa a
   ser o id do usuário no app, então `user_id` vem primeiro. */
const CAMPOS_PERFIL = 'id,user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count';

/** O perfil da conta dona do token, já no formato das colunas de `accounts`. */
async function perfil(token) {
  const me = await get('/me', { fields: CAMPOS_PERFIL }, token);
  return {
    igUserId: String(me.user_id || me.id || ''),
    username: me.username || '',
    name: me.name || me.username || '',
    accountType: String(me.account_type || '').toLowerCase(),
    avatarUrl: me.profile_picture_url || '',
    followers: me.followers_count ?? null,
    following: me.follows_count ?? null,
    postsCount: me.media_count ?? null,
  };
}

// ── Publicação ───────────────────────────────────────────────────────────────

async function criarContainer(conta, params) {
  const d = await post(`/${conta.igUserId}/media`, params, conta.accessToken);
  if (!d?.id) throw new Error('A Meta não devolveu o id do container');
  return d.id;
}

/** Espera a Meta baixar e processar a mídia. Vídeo leva de segundos a minutos. */
async function aguardarContainer(containerId, token, { limiteMs = 5 * 60_000, intervaloMs = 5000 } = {}) {
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

function exigirConexao(conta) {
  if (!conta?.igUserId || !conta?.accessToken) {
    throw Object.assign(new Error(`@${conta?.username || '?'} não está conectada pela API oficial — reconecte em Contas`), { code: 'SEM_TOKEN' });
  }
}

/** Reel a partir da URL pública do vídeo. Devolve o id da mídia publicada. */
async function publicarReel(conta, { videoUrl, caption = '', coverUrl = null, compartilharNoFeed = true }) {
  exigirConexao(conta);
  const container = await criarContainer(conta, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    cover_url: coverUrl,
    share_to_feed: compartilharNoFeed ? 'true' : 'false',
  });
  await aguardarContainer(container, conta.accessToken);
  return publicarContainer(conta, container);
}

/** Post de imagem (JPEG) no feed. */
async function publicarImagem(conta, { imageUrl, caption = '' }) {
  exigirConexao(conta);
  const container = await criarContainer(conta, { image_url: imageUrl, caption });
  await aguardarContainer(container, conta.accessToken, { intervaloMs: 2000 });
  return publicarContainer(conta, container);
}

/** Story de imagem ou vídeo. Sem figurinhas: a API oficial não as publica. */
async function publicarStory(conta, { url, video = false }) {
  exigirConexao(conta);
  const container = await criarContainer(conta, {
    media_type: 'STORIES',
    ...(video ? { video_url: url } : { image_url: url }),
  });
  await aguardarContainer(container, conta.accessToken, { intervaloMs: video ? 5000 : 2000 });
  return publicarContainer(conta, container);
}

/** Comenta numa mídia específica — a que a própria publicação devolveu. */
async function comentar(conta, mediaId, texto) {
  exigirConexao(conta);
  const d = await post(`/${mediaId}/comments`, { message: texto }, conta.accessToken);
  return d?.id ? String(d.id) : '';
}

/** Uso da cota de publicação nas últimas 24h. */
async function limiteDePublicacao(conta) {
  exigirConexao(conta);
  const d = await get(`/${conta.igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' }, conta.accessToken);
  return Array.isArray(d?.data) ? d.data[0] || {} : d || {};
}

module.exports = {
  GRAPH, VERSAO, GraphError, get, post,
  trocarCodigo, tokenDeLongaDuracao, renovarToken, perfil,
  publicarReel, publicarImagem, publicarStory, comentar, limiteDePublicacao,
  aguardarContainer,
};

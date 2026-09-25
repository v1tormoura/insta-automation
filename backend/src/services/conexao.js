'use strict';

/**
 * Conectar uma conta pela API oficial — um caminho só para os três jeitos de
 * chegar aqui: o retorno automático do OAuth (/callback), a URL de retorno
 * colada à mão e o token colado direto.
 *
 * Eram três cópias da mesma lógica, cada uma com um detalhe diferente (uma
 * gravava o app usado, outra não; uma baixava o avatar, outra não). Juntas,
 * divergem; aqui, não.
 */

const accounts = require('../repos/accounts');
const metaApps = require('../repos/metaApps');
const graph = require('./instagramAPI');
const { signState, verifyAndStripState } = require('./csrfState');
const config = require('../config');
const { broadcast } = require('../events/broadcaster');

const ESCOPOS = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_insights',
].join(',');

const SEPARADOR_APP = '__mapp_';

/**
 * A URL de autorização do Instagram.
 * O `state` leva a conta a reconectar (ou 'new') e o app usado, assinado com
 * HMAC para ninguém forjar um retorno.
 */
async function urlDeAutorizacao({ accountId = 'new', metaAppId = null } = {}) {
  const app = await metaApps.credenciais(metaAppId);
  if (!app) return null;

  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: config.oauthRedirectUri,
    scope: ESCOPOS,
    response_type: 'code',
    state: signState(`${accountId || 'new'}${SEPARADOR_APP}${app.id}`),
  });
  /* Faz o Instagram pedir login a cada autorização: sem isto, a segunda conta
     no mesmo navegador reaproveita a sessão e autoriza a MESMA conta de novo.
     Vem da URL que o próprio painel da Meta gera no login da empresa. */
  if (config.oauthForceReauth) params.set('force_reauth', 'true');
  if (app.loginConfigId) params.set('config_id', app.loginConfigId);

  return { url: `https://www.instagram.com/oauth/authorize?${params}`, metaAppId: app.id };
}

/** Desmonta e confere o `state` que voltou do Instagram. */
function lerState(state) {
  const r = verifyAndStripState(state);
  if (!r.valid) return null;
  const [alvo, metaAppId] = String(r.state || 'new').split(SEPARADOR_APP);
  return { alvo: alvo || 'new', metaAppId: metaAppId || null };
}

/**
 * Grava a conexão: atualiza a conta pedida, ou acha/cria pela conta do
 * Instagram (id) para nunca duplicar. Depois dispara a primeira sincronização.
 */
async function gravar({ token, expiraEm, igUserId, alvo, metaAppId }) {
  const p = await graph.perfil(token);
  const id = igUserId || p.igUserId;
  if (!id) throw new Error('A Meta não informou qual conta autorizou');

  const campos = {
    accessToken: token,
    tokenExpiresAt: expiraEm,
    igUserId: id,
    metaAppId: metaAppId || null,
    username: p.username || id,
    name: p.name || p.username || id,
    accountType: p.accountType,
    ...(p.followers !== null ? { followers: p.followers } : {}),
    ...(p.following !== null ? { following: p.following } : {}),
    ...(p.postsCount !== null ? { postsCount: p.postsCount } : {}),
    status: 'ativa',
    healthStatus: p.accountType === 'personal' ? 'conta_pessoal' : 'ativa',
    lastError: p.accountType === 'personal'
      ? 'Conta pessoal — mude para conta profissional no Instagram (Configurações → Tipo de conta) e reconecte'
      : '',
  };

  const existente = (alvo && alvo !== 'new' ? await accounts.findById(alvo) : null)
    || await accounts.findOne({ igUserId: id });
  const conta = existente ? await accounts.update(existente.id, campos) : await accounts.insert(campos);

  console.log(`✅ [Conexão] @${conta.username} conectada pela API oficial`);
  broadcast('accounts', { action: 'oauth_connected', username: conta.username, accountId: conta.id });
  // Avatar local, métricas e série de seguidores sem esperar o próximo ciclo.
  setImmediate(() => {
    require('./contas').sincronizar(conta).catch(() => {});
    require('./insightSyncService').syncAccountInsights(conta).catch(() => {});
  });
  return conta;
}

/** Código do OAuth → conta conectada. */
async function conectarPorCodigo(code, stateLido) {
  const app = await metaApps.credenciais(stateLido.metaAppId);
  if (!app) throw new Error('Nenhum App Meta cadastrado — cadastre na página API Meta');

  const curto = await graph.trocarCodigo(code, app, config.oauthRedirectUri);
  let token = curto.token;
  let expiraEm = new Date(Date.now() + 60 * 60 * 1000);
  try {
    ({ token, expiraEm } = await graph.tokenDeLongaDuracao(curto.token, app.appSecret));
  } catch (err) {
    console.warn(`⚠️ [Conexão] token de 60 dias não saiu, guardando o de 1h: ${err.message}`);
  }
  return gravar({ token, expiraEm, igUserId: curto.userId, alvo: stateLido.alvo, metaAppId: app.id });
}

/** Token colado direto (gerado no painel da Meta). */
async function conectarPorToken(tokenColado, alvo = 'new') {
  const app = await metaApps.credenciais(null);
  let token = String(tokenColado || '').trim();
  let expiraEm = new Date(Date.now() + 60 * 60 * 1000);
  // Curto vira longo; se já for longo, a troca recusa e a renovação serve.
  const longo = app
    ? await graph.tokenDeLongaDuracao(token, app.appSecret).catch(() => graph.renovarToken(token).catch(() => null))
    : await graph.renovarToken(token).catch(() => null);
  if (longo) ({ token, expiraEm } = longo);
  return gravar({ token, expiraEm, alvo, metaAppId: app?.id || null });
}

module.exports = { ESCOPOS, urlDeAutorizacao, lerState, conectarPorCodigo, conectarPorToken };

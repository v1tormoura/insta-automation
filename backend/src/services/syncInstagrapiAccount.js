'use strict';

const Account = require('../models/Account');

/**
 * Sincroniza uma conta conectada por instagrapi usando a própria sessão salva —
 * sem senha, sem cookies de navegador e sem Puppeteer.
 *
 * Existia uma lacuna aqui: os jobs de sync só reconheciam `accessToken` (Meta
 * API) e `igSession`/`rawWebSessionid` (API privada antiga e sessão web). Conta
 * instagrapi não casava com nenhum dos dois, caía no ramo "sem sessão" e era
 * marcada como `sessao_expirada` — com a sessão intacta no banco. O painel
 * passava a exibir "Sessão expirada" enquanto a página de Saúde, que lê o blob,
 * dizia "API Mobile Ativa". A sessão nunca havia caído.
 *
 * @param {Object} account — documento Mongoose da conta
 * @returns {Promise<Object>} campos atualizados
 */
async function syncInstagrapiAccount(account) {
  const { InstagrapiHttpClient } = require('./instagrapi/InstagrapiHttpClient');
  const { getSessionManager }    = require('./instagrapi/SessionManager');

  const http = new InstagrapiHttpClient(null, getSessionManager());

  await http.ensureSession(account);
  const info = await http.getUserInfo(account, account.username);

  const update = {
    lastSync:                new Date(),
    lastSuccessfulRequestAt: new Date(),
    lastError:               '',
    healthStatus:            'ativa',
    sessionStatus:           'VALID',
  };

  if (info.follower_count  !== undefined && info.follower_count  !== null) update.followers  = info.follower_count;
  if (info.following_count !== undefined && info.following_count !== null) update.following  = info.following_count;
  if (info.media_count     !== undefined && info.media_count     !== null) update.postsCount = info.media_count;
  if (info.full_name)                                                     update.name       = info.full_name;
  if (info.pk)                                                            update.igUserId   = String(info.pk);

  await Account.findByIdAndUpdate(account._id, update);
  return update;
}

module.exports = { syncInstagrapiAccount };

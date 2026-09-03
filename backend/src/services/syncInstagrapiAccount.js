'use strict';

const Account = require('../models/Account');
const { baixarAvatar, fotoMudou, origemDaFoto } = require('./avatarLocal');

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

  /* ── A foto de perfil ────────────────────────────────────────────────────

     A rota Python devolve `profile_pic_url` e o comentário dela diz, desde
     sempre, que serve "para popular o avatar da conta no MongoDB". Este
     arquivo simplesmente não lia o campo: conta conectada pela API mobile
     nunca teve foto no painel, e trocar a foto pelo aplicativo não mudava
     nada aqui.

     `fotoMudou` evita rebaixar a mesma imagem a cada 5 minutos: o CDN assina
     cada URL, então elas diferem mesmo quando a foto é a mesma. */
  if (fotoMudou(info.profile_pic_url, account.avatarOrigem, account.avatar)) {
    const local = await baixarAvatar(info.profile_pic_url, account.username);
    if (local) {
      update.avatar = local;
      update.avatarOrigem = origemDaFoto(info.profile_pic_url);
    }
  }

  await Account.findByIdAndUpdate(account._id, update);
  return update;
}

module.exports = { syncInstagrapiAccount };

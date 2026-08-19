'use strict';

const InstagramProvider = require('./InstagramProvider');

/**
 * Wraps the existing instagram-private-api + Meta Graph API flows
 * behind the InstagramProvider interface.
 *
 * Publication priority (mirrors worker.js publishWithRetry — not changed):
 *   1. Meta Graph API  — when account.accessToken + account.igUserId are set
 *   2. Private API     — all other cases (igSession, cookies, password)
 *
 * Session validation is credential-presence only (no network call).
 * Live liveness is handled by the existing healthCheck job — not duplicated here.
 *
 * The existing worker.js publication flow is NOT modified. This provider
 * wraps the same underlying services so it can be used by future callers
 * that go through ProviderFactory instead of calling services directly.
 */
class OfficialAPIProvider extends InstagramProvider {
  get providerName() { return 'official'; }

  /**
   * Returns whether the account has any usable credentials (no network call).
   */
  async validateSession(account) {
    if (account.igSession)                       return { valid: true,  reason: 'igSession presente' };
    if (account.rawWebSessionid)                 return { valid: true,  reason: 'rawWebSessionid presente' };
    if (account.accessToken && account.igUserId) return { valid: true,  reason: 'accessToken Graph API presente' };
    return { valid: false, reason: 'Sem credenciais — conecte via Meta API ou importe cookies (🍪)' };
  }

  /**
   * @returns {Promise<{mediaId: string}>} id da mídia publicada quando a via
   *          usada o expõe. A Graph API devolve o id no publish; a Private API
   *          não o expõe de forma confiável e devolve string vazia.
   */
  async publishReel(account, postData) {
    if (account.accessToken && account.igUserId) {
      const { postReel } = require('../services/instagramAPI');
      const id = await postReel(account, postData, null);
      return { mediaId: id ? String(id) : '' };
    }
    const { postReel } = require('../services/instagramPrivateService');
    await postReel(account, postData);
    return { mediaId: '' };
  }

  async publishPost(account, postData) {
    // Private API uses the same reel endpoint for image posts
    return this.publishReel(account, postData);
  }

  async publishStory(account, storyData) {
    const { postStory } = require('../services/storyService');
    await postStory(account, storyData);
  }

  /**
   * Comenta numa mídia específica pela Graph API.
   *
   * Recebe o media_id da publicação correspondente. A busca por "mídia mais
   * recente da conta" que o fluxo de CTA usa não entra aqui: numa campanha, a
   * mais recente frequentemente não é a que se quer comentar.
   */
  async comment(account, { mediaId, text }) {
    if (!mediaId) {
      throw Object.assign(
        new Error('Comentário sem media_id da publicação'),
        { code: 'COMMENT_MEDIA_NOT_FOUND' }
      );
    }
    if (!account.accessToken) {
      throw Object.assign(
        new Error('Comentário exige conta conectada pela API oficial'),
        { code: 'COMMENT_NOT_SUPPORTED' }
      );
    }

    const { commentOnMedia } = require('../services/instagramAPI');
    const id = await commentOnMedia(account, String(mediaId), String(text || ''));
    return { commentId: id ? String(id) : '', mediaId: String(mediaId) };
  }

  async invalidateSession(accountId) {
    const Account = require('../models/Account');
    await Account.findByIdAndUpdate(accountId, {
      $set: {
        igSession:    '',
        healthStatus: 'sessao_expirada',
        lastError:    'Sessão invalidada pelo provider',
      },
    });
  }

  async recoverSession(account) {
    try {
      const { createClient } = require('../services/instagramPrivateService');
      await createClient(account);
      return { recovered: true, reason: '' };
    } catch (err) {
      return { recovered: false, reason: err.message };
    }
  }
}

module.exports = OfficialAPIProvider;

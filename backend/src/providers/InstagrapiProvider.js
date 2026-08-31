'use strict';

const InstagramProvider = require('./InstagramProvider');

const NOT_IMPLEMENTED_CODE = 'INSTAGRAPI_NOT_IMPLEMENTED';
const NOT_IMPLEMENTED_MSG  = 'Python instagrapi service not yet implemented (Phase 4+)';

/**
 * Instagram provider backed by the Docker-internal Python instagrapi service.
 *
 * Session metadata (validate/invalidate/metrics) is always handled by SessionManager.
 * Publication (publishReel/publishPost) delegates to InstagrapiHttpClient which:
 *   1. Loads the instagrapi session from MongoDB into the Python service pool.
 *   2. Calls the appropriate /publish/* endpoint.
 *   3. Saves the updated session blob returned by Python back to MongoDB.
 *
 * Constructor accepts an optional httpClient. When omitted (legacy / test usage),
 * publication methods throw INSTAGRAPI_NOT_IMPLEMENTED — identical to Phase 3 stub
 * behaviour, so existing Phase 3 tests remain valid without modification.
 */
class InstagrapiProvider extends InstagramProvider {
  /**
   * @param {import('../services/instagrapi/SessionManager').SessionManager} sessionManager
   * @param {import('../services/instagrapi/InstagrapiHttpClient').InstagrapiHttpClient|null} [httpClient]
   */
  constructor(sessionManager, httpClient = null) {
    super();
    this.sessionManager = sessionManager;
    this._http = httpClient;
  }

  get providerName() { return 'instagrapi'; }

  /** Delegates to SessionManager — checks stored metadata, no network call. */
  async validateSession(account) {
    return this.sessionManager.validate(String(account._id));
  }

  async publishReel(account, postData) {
    if (!this._http) throw this._notReady('publishReel');
    return this._http.publishReel(account, postData);
  }

  async publishPost(account, postData) {
    if (!this._http) throw this._notReady('publishPost');
    return this._http.publishPost(account, postData);
  }

  /**
   * Publica story com link sticker opcional.
   *
   * O comentário anterior aqui afirmava que instagrapi não expõe upload de story.
   * Isso estava errado: a biblioteca tem photo_upload_to_story /
   * video_upload_to_story, com `links: List[StoryLink]` para o link sticker.
   */
  async publishStory(account, storyData) {
    if (!this._http) throw this._notReady('publishStory');
    return this._http.publishStory(account, storyData);
  }

  /**
   * Audiência dos stories ativos da conta.
   *
   * Existe só no provider instagrapi: a Graph API tem caminho próprio para isso
   * (edge /stories + /insights), tratado em storyInsightSync.
   */
  async mediaInsights(account, quantidade = 12) {
    if (!this._http) throw this._notReady('mediaInsights');
    return this._http.mediaInsights(account, quantidade);
  }

  async storyInsights(account) {
    if (!this._http) throw this._notReady('storyInsights');
    return this._http.storyInsights(account);
  }

  /**
   * Comenta via serviço Python (Client.media_comment).
   *
   * O media_id vem da publicação correspondente — a mídia mais recente da conta
   * nunca é consultada.
   */
  async comment(account, { mediaId, text }) {
    if (!this._http) throw this._notReady('comment');
    if (!mediaId) {
      throw Object.assign(
        new Error('Comentário sem media_id da publicação'),
        { code: 'COMMENT_MEDIA_NOT_FOUND' }
      );
    }
    const r = await this._http.comment(account, { mediaId, text });
    return { commentId: r?.comment_id || '', mediaId: String(mediaId) };
  }

  /** Edita nome, bio e link da bio (external_url) via account_edit. */
  async editProfile(account, fields) {
    if (!this._http) throw this._notReady('editProfile');
    return this._http.editProfile(account, fields);
  }

  /** Troca a foto de perfil via account_change_picture. */
  async changeProfilePicture(account, imagePath) {
    if (!this._http) throw this._notReady('changeProfilePicture');
    return this._http.changeProfilePicture(account, imagePath);
  }

  async invalidateSession(accountId) {
    await this.sessionManager.invalidate(String(accountId));
    if (this._http) await this._http.evictSession(String(accountId));
  }

  async recoverSession(account) {
    if (!this._http) {
      // No HTTP client configured — same stub behaviour as Phase 3
      await this.sessionManager._setStatus(String(account._id), 'RECOVERING');
      return { recovered: false, reason: NOT_IMPLEMENTED_MSG };
    }
    // With HTTP client: automatic recovery is not possible (no stored password).
    // Flag as AUTH_REQUIRED so the UI can prompt the admin to reconnect.
    await this.sessionManager._setStatus(String(account._id), 'AUTH_REQUIRED');
    return {
      recovered: false,
      reason:    'Re-login instagrapi necessário — reconecte a conta pelo painel de administração',
    };
  }

  _notReady(method) {
    return Object.assign(
      new Error(`InstagrapiProvider.${method}(): ${NOT_IMPLEMENTED_MSG}`),
      { code: NOT_IMPLEMENTED_CODE }
    );
  }
}

module.exports = InstagrapiProvider;

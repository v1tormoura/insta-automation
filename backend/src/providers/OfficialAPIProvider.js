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

  async publishReel(account, postData) {
    if (account.accessToken && account.igUserId) {
      const { postReel } = require('../services/instagramAPI');
      await postReel(account, postData, null);
    } else {
      const { postReel } = require('../services/instagramPrivateService');
      await postReel(account, postData);
    }
  }

  async publishPost(account, postData) {
    // Private API uses the same reel endpoint for image posts
    return this.publishReel(account, postData);
  }

  async publishStory(account, storyData) {
    const { postStory } = require('../services/storyService');
    await postStory(account, storyData);
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

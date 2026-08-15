'use strict';

const InstagramProvider = require('./InstagramProvider');

const NOT_IMPLEMENTED_CODE = 'INSTAGRAPI_NOT_IMPLEMENTED';
const NOT_IMPLEMENTED_MSG  = 'Python instagrapi service not yet implemented (Phase 4+)';

/**
 * Stub provider for the Python instagrapi service.
 *
 * All publication methods intentionally throw INSTAGRAPI_NOT_IMPLEMENTED.
 * Session management (load/save/lock/metrics) IS wired so Phase 4+ can start
 * using the session infrastructure without touching account models again.
 *
 * Phase 4+:
 *   - publishReel / publishPost / publishStory call the Docker-internal Python HTTP service
 *   - recoverSession triggers instagrapi login flow via that service
 */
class InstagrapiProvider extends InstagramProvider {
  /**
   * @param {import('../services/instagrapi/SessionManager').SessionManager} sessionManager
   */
  constructor(sessionManager) {
    super();
    this.sessionManager = sessionManager;
  }

  get providerName() { return 'instagrapi'; }

  /** Delegates to SessionManager — checks stored metadata, no network call. */
  async validateSession(account) {
    return this.sessionManager.validate(String(account._id));
  }

  async publishReel(account, postData) {
    throw this._notReady('publishReel');
  }

  async publishPost(account, postData) {
    throw this._notReady('publishPost');
  }

  async publishStory(account, storyData) {
    throw this._notReady('publishStory');
  }

  async invalidateSession(accountId) {
    await this.sessionManager.invalidate(String(accountId));
  }

  async recoverSession(account) {
    // Phase 4+: will trigger instagrapi re-login via Python service
    await this.sessionManager._setStatus(String(account._id), 'RECOVERING');
    return { recovered: false, reason: NOT_IMPLEMENTED_MSG };
  }

  _notReady(method) {
    return Object.assign(
      new Error(`InstagrapiProvider.${method}(): ${NOT_IMPLEMENTED_MSG}`),
      { code: NOT_IMPLEMENTED_CODE }
    );
  }
}

module.exports = InstagrapiProvider;

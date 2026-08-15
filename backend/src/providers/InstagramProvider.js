'use strict';

/**
 * Abstract base class for Instagram API providers.
 *
 * Concrete implementations:
 *   OfficialAPIProvider — instagram-private-api + Meta Graph API (existing flow, unchanged)
 *   InstagrapiProvider  — Python instagrapi HTTP service (Phase 4+, stub for now)
 *
 * Callers ask ProviderFactory.getProvider(account) for the right implementation;
 * they never import providers directly. This keeps provider conditionals in one place.
 *
 * Every unimplemented method throws with the class + method name so errors are
 * immediately identifiable during development.
 */
class InstagramProvider {
  /** @type {string} Must match the values used in Account.provider enum */
  get providerName() {
    throw new Error(`${this.constructor.name} must define providerName`);
  }

  /**
   * Checks whether credentials exist for this account (no network call).
   * Live session validation is the responsibility of the health check job.
   * @param {Object} account — Mongoose Account document (lean or hydrated)
   * @returns {Promise<{valid: boolean, reason: string}>}
   */
  async validateSession(account) {
    throw new Error(`${this.constructor.name}.validateSession() not implemented`);
  }

  /**
   * Publishes a Reel (video) to Instagram.
   * @param {Object} account
   * @param {Object} postData — { media, caption, cover, location, mediaType, postType, ... }
   * @returns {Promise<void>}
   */
  async publishReel(account, postData) {
    throw new Error(`${this.constructor.name}.publishReel() not implemented`);
  }

  /**
   * Publishes a static image post to Instagram.
   * @param {Object} account
   * @param {Object} postData
   * @returns {Promise<void>}
   */
  async publishPost(account, postData) {
    throw new Error(`${this.constructor.name}.publishPost() not implemented`);
  }

  /**
   * Publishes a story to Instagram.
   * @param {Object} account
   * @param {Object} storyData
   * @returns {Promise<void>}
   */
  async publishStory(account, storyData) {
    throw new Error(`${this.constructor.name}.publishStory() not implemented`);
  }

  /**
   * Marks the session as invalid in persistent storage.
   * @param {string} accountId
   * @returns {Promise<void>}
   */
  async invalidateSession(accountId) {
    throw new Error(`${this.constructor.name}.invalidateSession() not implemented`);
  }

  /**
   * Attempts to recover an expired or invalid session without user interaction.
   * @param {Object} account
   * @returns {Promise<{recovered: boolean, reason: string}>}
   */
  async recoverSession(account) {
    throw new Error(`${this.constructor.name}.recoverSession() not implemented`);
  }
}

module.exports = InstagramProvider;

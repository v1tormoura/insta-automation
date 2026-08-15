'use strict';

const OfficialAPIProvider = require('./OfficialAPIProvider');
const InstagrapiProvider  = require('./InstagrapiProvider');

// Process-lifetime singletons — created on first call, reused thereafter.
// InstagrapiProvider holds a SessionManager reference; OfficialAPIProvider is stateless.
let _official   = null;
let _instagrapi = null;

/**
 * Returns the InstagramProvider for the given account.
 *
 * account.provider === 'instagrapi' → InstagrapiProvider
 * anything else (default: 'official') → OfficialAPIProvider
 *
 * Callers never import provider classes directly — this is the single
 * dispatch point that removes provider conditionals from the rest of the code.
 *
 * @param {Object} account — Mongoose Account document (lean or hydrated)
 * @returns {import('./InstagramProvider')}
 */
function getProvider(account) {
  if (account?.provider === 'instagrapi') {
    if (!_instagrapi) {
      const { getSessionManager } = require('../services/instagrapi/SessionManager');
      _instagrapi = new InstagrapiProvider(getSessionManager());
    }
    return _instagrapi;
  }

  if (!_official) _official = new OfficialAPIProvider();
  return _official;
}

/** Resets singletons. Only for use in tests — never call in production code. */
function _resetForTest() {
  _official   = null;
  _instagrapi = null;
}

module.exports = { getProvider, _resetForTest };

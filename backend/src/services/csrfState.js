'use strict';

/**
 * CSRF protection for OAuth state parameter.
 *
 * Signs the state with HMAC-SHA256 so any tampering is detected in the callback.
 * Format: {original_state}~{8-byte-nonce}~{16-char-hmac}
 *
 * Backward compatible: unsigned states (legacy or missing key) are allowed through
 * with a console warning instead of a hard reject, to avoid breaking existing flows.
 *
 * Set OAUTH_STATE_SECRET (or ENCRYPTION_KEY as fallback) to enable signing.
 */

const crypto = require('crypto');

const SEPARATOR = '~';

function getSigningKey() {
  const raw = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  return Buffer.from(raw.slice(0, 64).padEnd(64, '0'), 'hex');
}

function signState(originalState) {
  const key = getSigningKey();
  if (!key) {
    console.warn('[CSRF] OAUTH_STATE_SECRET não configurado — state não assinado (modo degradado)');
    return originalState;
  }
  const nonce   = crypto.randomBytes(8).toString('hex');
  const payload = `${originalState}${SEPARATOR}${nonce}`;
  const sig     = crypto.createHmac('sha256', key).update(payload).digest('hex').slice(0, 16);
  return `${payload}${SEPARATOR}${sig}`;
}

function verifyAndStripState(signedState) {
  if (!signedState) return { valid: false, state: '' };

  const key = getSigningKey();
  if (!key) {
    console.warn('[CSRF] OAUTH_STATE_SECRET não configurado — validação desabilitada');
    return { valid: true, state: signedState, unsigned: true };
  }

  const parts = signedState.split(SEPARATOR);

  // Legacy state without CSRF suffix: 1 or 2 parts (no nonce, no sig)
  if (parts.length < 3) {
    console.warn(`[CSRF] State sem assinatura (legado): ${signedState.slice(0, 40)}...`);
    return { valid: true, state: signedState, legacy: true };
  }

  const receivedSig = parts[parts.length - 1];
  const payloadParts = parts.slice(0, -1);
  const payload      = payloadParts.join(SEPARATOR);

  const expectedSig = crypto.createHmac('sha256', key).update(payload).digest('hex').slice(0, 16);

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch { valid = false; }

  if (!valid) {
    console.error(`[CSRF] Assinatura inválida — possível adulteração de state`);
    return { valid: false, state: '' };
  }

  // Strip nonce from payload to recover original state
  const originalParts = payloadParts.slice(0, -1); // remove nonce (last part before sig)
  return { valid: true, state: originalParts.join(SEPARATOR) };
}

module.exports = { signState, verifyAndStripState };

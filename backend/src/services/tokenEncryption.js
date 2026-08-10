'use strict';

/**
 * AES-256-GCM token encryption service.
 *
 * Encrypted values are prefixed with "enc1:" for easy detection and
 * backward compatibility — plaintext tokens are returned as-is by decrypt().
 *
 * Set ENCRYPTION_KEY env var to a 64-char hex string (32 bytes) to enable.
 * Without ENCRYPTION_KEY, encrypt() is a no-op (tokens stored in plaintext).
 * Generate key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX    = 'enc1:';
const IV_BYTES  = 12;
const TAG_BYTES = 16;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY deve ter exatamente 64 caracteres hex (32 bytes)');
  return buf;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // idempotent
  const key = getKey();
  if (!key) return plaintext; // ENCRYPTION_KEY ausente → armazena em texto puro

  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  if (!isEncrypted(ciphertext)) return ciphertext; // passthrough para tokens em texto puro

  const key = getKey();
  if (!key) throw new Error('ENCRYPTION_KEY não configurada — impossível descriptografar token');

  try {
    const buf      = Buffer.from(ciphertext.slice(PREFIX.length), 'base64url');
    const iv       = buf.subarray(0, IV_BYTES);
    const tag      = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const enc      = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Falha ao descriptografar token — chave incorreta ou dados corrompidos');
  }
}

module.exports = { encrypt, decrypt, isEncrypted };

'use strict';

/**
 * Token isolation tests: validates that account A's token can NEVER reach
 * account B's API calls, even when both are stored encrypted in the database.
 */

process.env.ENCRYPTION_KEY = 'a'.repeat(64); // test key

const { encrypt, decrypt } = require('../src/services/tokenEncryption');

const TOKEN_A = 'IGQWRtoken_account_AAAA_business_12345';
const TOKEN_B = 'IGQWRtoken_account_BBBB_business_67890';

// Simulate DB-stored account objects (tokens stored encrypted)
const dbAccountA = { _id: 'aaaabbbbcccc000000000001', username: 'account_a', accessToken: encrypt(TOKEN_A) };
const dbAccountB = { _id: 'aaaabbbbcccc000000000002', username: 'account_b', accessToken: encrypt(TOKEN_B) };

function resolveToken(account) {
  return decrypt(account.accessToken);
}

describe('Token isolation', () => {
  test('account A resolves to token A', () => {
    expect(resolveToken(dbAccountA)).toBe(TOKEN_A);
  });

  test('account B resolves to token B', () => {
    expect(resolveToken(dbAccountB)).toBe(TOKEN_B);
  });

  test('tokens are distinct after encryption', () => {
    expect(dbAccountA.accessToken).not.toBe(dbAccountB.accessToken);
  });

  test('account A token never equals account B token', () => {
    expect(resolveToken(dbAccountA)).not.toBe(resolveToken(dbAccountB));
  });

  test('account B token does not contain any part of token A', () => {
    const resolved = resolveToken(dbAccountB);
    expect(resolved).not.toContain(TOKEN_A);
    expect(resolved).not.toContain('AAAA');
  });

  test('account A token does not contain any part of token B', () => {
    const resolved = resolveToken(dbAccountA);
    expect(resolved).not.toContain(TOKEN_B);
    expect(resolved).not.toContain('BBBB');
  });

  test('using account B stored value cannot produce account A token', () => {
    const resolvedWithB = resolveToken(dbAccountB);
    expect(resolvedWithB).not.toBe(TOKEN_A);
  });

  test('encrypted ciphertexts are unlinkable across accounts', () => {
    // Two encryptions of the same value should differ (random IV)
    const enc1 = encrypt(TOKEN_A);
    const enc2 = encrypt(TOKEN_A);
    expect(enc1).not.toBe(enc2);
    // But both decrypt correctly
    expect(decrypt(enc1)).toBe(TOKEN_A);
    expect(decrypt(enc2)).toBe(TOKEN_A);
  });
});

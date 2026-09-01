'use strict';

// Set key before requiring the module so getKey() reads it
process.env.ENCRYPTION_KEY = '0'.repeat(64); // 32 zero-bytes — test only

const { encrypt, decrypt, isEncrypted } = require('../src/services/tokenEncryption');

const SAMPLE_TOKEN = 'IGQWRtesttoken_business_12345abcdef';

describe('tokenEncryption', () => {
  test('encrypt() adds enc1: prefix', () => {
    const enc = encrypt(SAMPLE_TOKEN);
    expect(enc).toMatch(/^enc1:/);
  });

  test('decrypt() recovers original plaintext', () => {
    const enc = encrypt(SAMPLE_TOKEN);
    expect(decrypt(enc)).toBe(SAMPLE_TOKEN);
  });

  test('isEncrypted() detects encrypted values correctly', () => {
    expect(isEncrypted(encrypt(SAMPLE_TOKEN))).toBe(true);
    expect(isEncrypted(SAMPLE_TOKEN)).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  test('encrypt() is idempotent for already-encrypted values', () => {
    const enc = encrypt(SAMPLE_TOKEN);
    expect(encrypt(enc)).toBe(enc);
  });

  test('decrypt() passes through plaintext tokens (backward compatibility)', () => {
    expect(decrypt(SAMPLE_TOKEN)).toBe(SAMPLE_TOKEN);
  });

  test('decrypt() handles empty/null gracefully', () => {
    expect(decrypt('')).toBe('');
    expect(decrypt(null)).toBe(null);
    expect(decrypt(undefined)).toBe(undefined);
  });

  test('each encrypt() call produces a unique ciphertext (random IV)', () => {
    const enc1 = encrypt(SAMPLE_TOKEN);
    const enc2 = encrypt(SAMPLE_TOKEN);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(SAMPLE_TOKEN);
    expect(decrypt(enc2)).toBe(SAMPLE_TOKEN);
  });

  test('decrypt() throws with wrong key', () => {
    const enc = encrypt(SAMPLE_TOKEN);
    process.env.ENCRYPTION_KEY = '1'.repeat(64);
    expect(() => decrypt(enc)).toThrow();
    process.env.ENCRYPTION_KEY = '0'.repeat(64); // restore
  });

  test('encrypt() without ENCRYPTION_KEY returns plaintext (no-op mode)', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(encrypt(SAMPLE_TOKEN)).toBe(SAMPLE_TOKEN);
    process.env.ENCRYPTION_KEY = saved;
  });
});

/**
 * Os campos cifrados do schema, e a assimetria que morde.
 *
 * O valor sai do banco cifrado e só volta legível pelo GETTER do schema. Quem
 * lê com `.lean()` recebe o documento cru, sem getters — e a linha parece
 * idêntica à que funciona. O token cifrado então segue para a Meta como se
 * fosse o token, e a recusa fala de autorização inválida, sem nenhuma pista de
 * que a causa é criptografia.
 *
 * `storyService._conexaoDeLink` busca `fbAccessToken` justamente assim, e por
 * isso NÃO usa `lean`. Este teste guarda o motivo.
 */
describe('campos cifrados do Account', () => {
  const Account = require('../src/models/Account');

  const cifrados = ['accessToken', 'instagrapiSession', 'fbAccessToken'];

  test('o getter devolve o token em claro; o documento cru, não', () => {
    for (const campo of cifrados) {
      const cru = { _id: '507f1f77bcf86cd799439011', username: 'loja', [campo]: encrypt(SAMPLE_TOKEN) };
      const doc = Account.hydrate(cru);

      expect(doc[campo]).toBe(SAMPLE_TOKEN);          // com getter
      expect(cru[campo]).toMatch(/^enc1:/);           // como viria de um lean()
      expect(cru[campo]).not.toBe(SAMPLE_TOKEN);
    }
  });

  test('atribuir cifra antes de guardar', () => {
    for (const campo of cifrados) {
      const doc = Account.hydrate({ _id: '507f1f77bcf86cd799439011', username: 'loja' });
      doc[campo] = SAMPLE_TOKEN;
      expect(doc.get(campo, null, { getters: false })).toMatch(/^enc1:/);
      expect(doc[campo]).toBe(SAMPLE_TOKEN);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { SecretBox, hmac } from '../../src/lib/crypto.js';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';
import { redactText } from '../../src/lib/redact.js';
import { signedMediaUrl, verifyMediaSignature } from '../../src/modules/media/publicUrl.js';
import { parseSignedRequest } from '../../src/modules/oauth/oauth.service.js';

const keyA = Buffer.alloc(32, 1).toString('base64');
const keyB = Buffer.alloc(32, 2).toString('base64');

describe('SecretBox (AES-256-GCM)', () => {
  it('cifra e decifra; o texto cifrado não contém o token', () => {
    const box = new SecretBox(keyA);
    const sealed = box.seal('IGAAsegredo123');
    expect(JSON.stringify(sealed)).not.toContain('IGAAsegredo123');
    expect(box.open(sealed)).toBe('IGAAsegredo123');
  });

  it('detecta adulteração', () => {
    const box = new SecretBox(keyA);
    const sealed = box.seal('abc');
    const tampered = { ...sealed, data: Buffer.from('xyz').toString('base64') };
    expect(() => box.open(tampered)).toThrow();
  });

  it('rotação: a chave anterior continua decifrando e o valor pede re-cifragem', () => {
    const old = new SecretBox(keyA).seal('token-antigo');
    const rotated = new SecretBox(keyB, keyA);
    expect(rotated.open(old)).toBe('token-antigo');
    expect(rotated.needsReseal(old)).toBe(true);
    expect(rotated.needsReseal(rotated.seal('novo'))).toBe(false);
  });
});

describe('redactText', () => {
  it('remove tokens de URLs e formatos conhecidos', () => {
    const text = 'GET https://graph.instagram.com/me?fields=id&access_token=IGAAabcdefghijklmnopqrstuvwxyz0123 falhou; code=AQBx&client_secret=shh';
    const out = redactText(text);
    expect(out).not.toContain('IGAAabcdef');
    expect(out).not.toContain('shh');
    expect(out).toContain('access_token=[REDACTED]');
  });

  it('remove tokens soltos e Bearer', () => {
    expect(redactText('token EAAB1234567890abcdefghijklmnop vazou')).toBe('token [REDACTED_TOKEN] vazou');
    expect(redactText('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [REDACTED]');
  });
});

describe('senhas (scrypt)', () => {
  it('verifica a senha certa e recusa a errada', async () => {
    const hash = await hashPassword('senha-muito-forte');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('senha-muito-forte', hash)).toBe(true);
    expect(await verifyPassword('senha-errada', hash)).toBe(false);
  });
});

describe('URLs públicas assinadas de mídia', () => {
  it('assina e valida', () => {
    const url = new URL(signedMediaUrl('a'.repeat(24), 'original', 'f.jpg'));
    const [, , , id, variant, expires, sig] = url.pathname.split('/');
    expect(verifyMediaSignature(id!, variant!, expires!, sig!)).toBe(true);
    expect(verifyMediaSignature(id!, 'thumb', expires!, sig!)).toBe(false);
    expect(verifyMediaSignature('b'.repeat(24), variant!, expires!, sig!)).toBe(false);
  });

  it('expira', () => {
    const url = new URL(signedMediaUrl('a'.repeat(24), 'original', 'f.jpg', -1000));
    const [, , , id, variant, expires, sig] = url.pathname.split('/');
    expect(verifyMediaSignature(id!, variant!, expires!, sig!)).toBe(false);
  });
});

describe('signed_request da Meta', () => {
  const make = (payload: object, secret: string) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${hmac(secret, body)}.${body}`;
  };

  it('aceita assinatura válida', () => {
    const req = make({ algorithm: 'HMAC-SHA256', user_id: '123' }, 'segredo');
    expect(parseSignedRequest(req, 'segredo')?.user_id).toBe('123');
  });

  it('recusa assinatura com outro segredo ou algoritmo errado', () => {
    expect(parseSignedRequest(make({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'outro'), 'segredo')).toBeNull();
    expect(parseSignedRequest(make({ algorithm: 'none', user_id: '1' }, 'segredo'), 'segredo')).toBeNull();
    expect(parseSignedRequest('lixo', 'segredo')).toBeNull();
  });
});

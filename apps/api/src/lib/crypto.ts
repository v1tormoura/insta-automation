import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmac(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ── Cofre de segredos (AES-256-GCM) ──────────────────────────────────────
   Cada valor cifrado guarda o id da chave que o cifrou. Isso permite rotação:
   a chave nova cifra, a anterior continua decifrando até todos os tokens
   serem renovados (o que acontece sozinho no refresh periódico). */

export interface SealedSecret {
  keyId: string;
  iv: string;
  tag: string;
  data: string;
}

export class SecretBox {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentId: string;

  constructor(currentKeyB64: string, previousKeyB64?: string) {
    const current = Buffer.from(currentKeyB64, 'base64');
    this.currentId = SecretBox.keyId(current);
    this.keys.set(this.currentId, current);
    if (previousKeyB64) {
      const prev = Buffer.from(previousKeyB64, 'base64');
      this.keys.set(SecretBox.keyId(prev), prev);
    }
  }

  private static keyId(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 12);
  }

  seal(plaintext: string): SealedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentId)!, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { keyId: this.currentId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  open(sealed: SealedSecret): string {
    const key = this.keys.get(sealed.keyId);
    if (!key) throw new Error(`Chave de criptografia ${sealed.keyId} não está disponível`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  }

  needsReseal(sealed: SealedSecret): boolean {
    return sealed.keyId !== this.currentId;
  }
}

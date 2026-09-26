import { env } from '../../config/env.js';
import { hmac, safeEqual } from '../../lib/crypto.js';
import { HOUR } from '../../lib/time.js';

/**
 * URLs públicas e assinadas das mídias.
 *
 * A Content Publishing API não recebe upload: ela baixa a mídia de uma URL
 * pública. Estas URLs são impossíveis de adivinhar (HMAC) e expiram, então
 * a biblioteca do cliente não fica exposta na internet.
 */
export type MediaVariant = 'original' | 'thumb';

const payload = (mediaId: string, variant: MediaVariant, expires: number) => `${mediaId}.${variant}.${expires}`;

export function signedMediaUrl(mediaId: string, variant: MediaVariant, filename: string, ttlMs = env.MEDIA_URL_TTL_HOURS * HOUR): string {
  const expires = Math.floor((Date.now() + ttlMs) / 1000);
  const sig = hmac(env.MEDIA_SIGNING_SECRET, payload(mediaId, variant, expires));
  const base = env.API_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/public/media/${mediaId}/${variant}/${expires}/${sig}/${encodeURIComponent(filename)}`;
}

export function verifyMediaSignature(mediaId: string, variant: string, expires: string, sig: string): boolean {
  if (variant !== 'original' && variant !== 'thumb') return false;
  const exp = Number(expires);
  if (!Number.isInteger(exp) || exp * 1000 < Date.now()) return false;
  return safeEqual(sig, hmac(env.MEDIA_SIGNING_SECRET, payload(mediaId, variant, exp)));
}

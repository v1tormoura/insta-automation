import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// Parâmetros OWASP para scrypt: N=2^17, r=8, p=1 (~128 MiB). maxmem acompanha.
const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return timingSafeEqual(expected, actual);
}

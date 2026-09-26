import { env } from '../../config/env.js';
import { SecretBox, type SealedSecret } from '../../lib/crypto.js';

let box: SecretBox | undefined;

function vault(): SecretBox {
  box ??= new SecretBox(env.TOKEN_ENCRYPTION_KEY, env.TOKEN_ENCRYPTION_KEY_PREVIOUS);
  return box;
}

export const sealToken = (token: string): SealedSecret => vault().seal(token);
export const openToken = (sealed: SealedSecret): string => vault().open(sealed);
export const tokenNeedsReseal = (sealed: SealedSecret): boolean => vault().needsReseal(sealed);

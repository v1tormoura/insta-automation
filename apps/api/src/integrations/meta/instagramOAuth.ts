import { MetaApiError } from './errors.js';
import type { GraphClient } from './graphClient.js';

/**
 * OAuth do "Instagram API with Instagram Login" (Business Login for Instagram).
 *
 *   1. https://www.instagram.com/oauth/authorize          → code
 *   2. POST https://api.instagram.com/oauth/access_token  → token curto (1h)
 *   3. GET  graph.instagram.com/access_token              → token longo (60 dias)
 *        grant_type=ig_exchange_token
 *   4. GET  graph.instagram.com/refresh_access_token      → renova por mais 60 dias
 *        grant_type=ig_refresh_token (token com ≥ 24h e ainda válido)
 */

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
] as const;

/** Sem estas a conta não serve para o produto; insights é opcional (a tela avisa). */
export const REQUIRED_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'] as const;

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  forceReauth: boolean;
}

export interface ShortLivedToken {
  accessToken: string;
  userId: string | null;
  permissions: string[];
}

export interface LongLivedToken {
  accessToken: string;
  expiresInSeconds: number;
}

export interface InstagramProfile {
  id: string;
  userId: string;
  username: string;
  name: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export const PROFILE_FIELDS = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count';

export function buildAuthorizeUrl(cfg: InstagramOAuthConfig, state: string): string {
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', cfg.appId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
  url.searchParams.set('state', state);
  if (cfg.forceReauth) url.searchParams.set('force_reauth', 'true');
  return url.toString();
}

/** O Instagram costuma anexar `#_` ao code no redirect. */
export function cleanAuthCode(code: string): string {
  return code.replace(/#_$/, '').trim();
}

export async function exchangeCode(graph: GraphClient, cfg: InstagramOAuthConfig, code: string): Promise<ShortLivedToken> {
  const text = await graph.rawPost('https://api.instagram.com/oauth/access_token', {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
    code: cleanAuthCode(code),
  });
  return parseShortLivedResponse(text);
}

/**
 * A resposta vem como `{access_token, user_id, permissions}` ou embrulhada em
 * `{data: [...]}`. O `user_id` é numérico e pode passar de 2^53 — por isso é
 * extraído do texto bruto, não do JSON.parse (que arredondaria o número).
 */
export function parseShortLivedResponse(text: string): ShortLivedToken {
  const json = JSON.parse(text) as
    | { access_token?: string; permissions?: string | string[]; data?: { access_token?: string; permissions?: string | string[] }[] }
    | undefined;
  const entry = json?.data?.[0] ?? json;
  if (!entry?.access_token) throw new MetaApiError(502, { message: 'Troca do code não retornou access_token' }, '/oauth/access_token');
  const userIdMatch = text.match(/"user_id"\s*:\s*"?(\d+)"?/);
  const perms = entry.permissions;
  return {
    accessToken: entry.access_token,
    userId: userIdMatch?.[1] ?? null,
    permissions: (Array.isArray(perms) ? perms : String(perms ?? '').split(',')).map((p) => p.trim()).filter(Boolean),
  };
}

export async function exchangeForLongLived(graph: GraphClient, cfg: InstagramOAuthConfig, shortToken: string): Promise<LongLivedToken> {
  const res = await graph.get<{ access_token: string; expires_in: number }>(
    'access_token',
    { grant_type: 'ig_exchange_token', client_secret: cfg.appSecret },
    shortToken,
    { versioned: false },
  );
  return { accessToken: res.access_token, expiresInSeconds: res.expires_in };
}

export async function refreshLongLived(graph: GraphClient, token: string): Promise<LongLivedToken> {
  const res = await graph.get<{ access_token: string; expires_in: number }>(
    'refresh_access_token',
    { grant_type: 'ig_refresh_token' },
    token,
    { versioned: false },
  );
  return { accessToken: res.access_token, expiresInSeconds: res.expires_in };
}

export async function fetchProfile(graph: GraphClient, token: string): Promise<InstagramProfile> {
  const me = await graph.get<{
    id: string;
    user_id?: string;
    username: string;
    name?: string;
    account_type?: string;
    profile_picture_url?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  }>('me', { fields: `id,${PROFILE_FIELDS}` }, token);
  return {
    id: String(me.id),
    // `user_id` é o ID da conta profissional usado nos endpoints de publicação.
    userId: String(me.user_id ?? me.id),
    username: me.username,
    name: me.name ?? null,
    accountType: me.account_type ?? null,
    profilePictureUrl: me.profile_picture_url ?? null,
    followersCount: me.followers_count ?? null,
    followsCount: me.follows_count ?? null,
    mediaCount: me.media_count ?? null,
  };
}

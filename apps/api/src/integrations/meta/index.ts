import { env, instagramRedirectUri, isMetaConfigured } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { GraphClient } from './graphClient.js';
import type { InstagramOAuthConfig } from './instagramOAuth.js';

let client: GraphClient | undefined;

/** Cliente único da Graph API do Instagram, versão fixada por META_GRAPH_VERSION. */
export function metaGraph(): GraphClient {
  client ??= new GraphClient({
    version: env.META_GRAPH_VERSION,
    onUsage: (endpoint, usage) => {
      if (usage.maxPercent >= 75) logger.warn({ endpoint, usage }, 'meta: uso de rate limit alto');
    },
  });
  return client;
}

/** Para testes: injeta um cliente com fetch falso. */
export function setMetaGraph(custom: GraphClient | undefined): void {
  client = custom;
}

export function instagramOAuthConfig(): InstagramOAuthConfig {
  if (!isMetaConfigured()) {
    throw new AppError(
      'META_NOT_CONFIGURED',
      'A integração com o Instagram ainda não foi configurada neste servidor (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).',
      503,
    );
  }
  return {
    appId: env.INSTAGRAM_APP_ID!,
    appSecret: env.INSTAGRAM_APP_SECRET!,
    redirectUri: instagramRedirectUri(),
    forceReauth: env.INSTAGRAM_OAUTH_FORCE_REAUTH,
  };
}

export * from './errors.js';

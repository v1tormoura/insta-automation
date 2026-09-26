import type { Job } from 'bullmq';
import type { Types } from 'mongoose';
import { logger } from '../lib/logger.js';
import { isoDate } from '../lib/time.js';
import { isMetaError } from '../integrations/meta/errors.js';
import type { GraphClient } from '../integrations/meta/graphClient.js';
import { getMediaInsights, mediaMetricGroup } from '../integrations/meta/insights.js';
import { fetchProfile, refreshLongLived } from '../integrations/meta/instagramOAuth.js';
import { getPublishingLimit, listRecentMedia } from '../integrations/meta/publishing.js';
import { InstagramAccount, type InstagramAccountDoc } from '../modules/accounts/account.model.js';
import { loadAccountWithToken, setAccountStatus, toAccountDTO } from '../modules/accounts/account.service.js';
import { sealToken } from '../modules/accounts/tokenVault.js';
import { AccountSnapshot, MediaInsight } from '../modules/insights/insight.models.js';
import { emit } from '../modules/realtime/events.js';
import type { SyncJobData, SyncJobName } from '../queue/queues.js';

/**
 * Sincronização por conta. Cada job mexe em UMA conta: uma conta com token
 * vencido ou bloqueada falha sozinha, sem afetar a sincronização das outras.
 */

async function withAccount(
  accountId: string,
  fn: (ctx: { userId: Types.ObjectId; account: InstagramAccountDoc; token: string }) => Promise<void>,
): Promise<void> {
  const owner = await InstagramAccount.findById(accountId).setOptions({ crossTenant: true }).select('userId').lean();
  if (!owner) return;
  const loaded = await loadAccountWithToken(owner.userId, owner._id);
  if (!loaded || !loaded.token || ['DISCONNECTED', 'EXPIRED'].includes(loaded.account.status)) return;
  try {
    await fn({ userId: owner.userId, account: loaded.account, token: loaded.token });
  } catch (err) {
    if (isMetaError(err) && err.category === 'auth') {
      await setAccountStatus(owner.userId, owner._id, 'EXPIRED', err.userMessage);
      return;
    }
    if (loaded.account.status === 'SYNCING') {
      await InstagramAccount.updateOne({ userId: owner.userId, _id: owner._id, status: 'SYNCING' }, { $set: { status: 'CONNECTED' } });
    }
    throw err;
  }
}

async function syncProfile(graph: GraphClient, accountId: string): Promise<void> {
  await withAccount(accountId, async ({ userId, account, token }) => {
    const p = await fetchProfile(graph, token);
    const updated = await InstagramAccount.findOneAndUpdate(
      { userId, _id: account._id },
      {
        $set: {
          username: p.username,
          name: p.name,
          profilePictureUrl: p.profilePictureUrl,
          accountType: p.accountType,
          followersCount: p.followersCount,
          followsCount: p.followsCount,
          mediaCount: p.mediaCount,
          lastSyncedAt: new Date(),
          ...(account.status === 'SYNCING' || account.status === 'ERROR' ? { status: 'CONNECTED', statusReason: null } : {}),
        },
      },
      { returnDocument: 'after', lean: true },
    );
    await AccountSnapshot.updateOne(
      { userId, accountId: account._id, date: isoDate(new Date()) },
      { $set: { followersCount: p.followersCount, followsCount: p.followsCount, mediaCount: p.mediaCount } },
      { upsert: true },
    );
    if (updated) await emit(userId, { type: 'account.updated', account: toAccountDTO(updated) });
  });
}

async function syncQuota(graph: GraphClient, accountId: string): Promise<void> {
  await withAccount(accountId, async ({ userId, account, token }) => {
    const limit = await getPublishingLimit(graph, token, account.igUserId);
    const updated = await InstagramAccount.findOneAndUpdate(
      { userId, _id: account._id },
      { $set: { 'publishing.quotaUsage': limit.quotaUsage, 'publishing.quotaTotal': limit.quotaTotal, 'publishing.checkedAt': new Date() } },
      { returnDocument: 'after', lean: true },
    );
    if (updated) await emit(userId, { type: 'account.updated', account: toAccountDTO(updated) });
  });
}

async function syncMediaInsights(graph: GraphClient, accountId: string): Promise<void> {
  await withAccount(accountId, async ({ userId, account, token }) => {
    const recent = await listRecentMedia(graph, token, account.igUserId, 25);
    const canReadInsights = account.permissions.length === 0 || account.permissions.includes('instagram_business_manage_insights');
    for (const m of recent) {
      let metrics: Record<string, number | null> = {};
      let unavailable: { key: string; reason: string }[] = [];
      if (canReadInsights) {
        try {
          const r = await getMediaInsights(graph, token, m.id, mediaMetricGroup(m.productType, m.mediaType));
          metrics = r.values;
          unavailable = r.unavailable;
        } catch (err) {
          if (isMetaError(err) && (err.category === 'auth' || err.category === 'rate_limit')) throw err;
          unavailable = [{ key: '*', reason: isMetaError(err) ? err.userMessage : 'Falha ao consultar insights.' }];
        }
      } else {
        unavailable = [{ key: '*', reason: 'Permissão de insights não concedida. Reconecte a conta para liberar as métricas.' }];
      }
      await MediaInsight.updateOne(
        { userId, accountId: account._id, igMediaId: m.id },
        {
          $set: {
            mediaType: m.mediaType,
            productType: m.productType,
            caption: m.caption ?? '',
            permalink: m.permalink,
            thumbnailUrl: m.thumbnailUrl ?? (m.mediaType === 'IMAGE' || m.mediaType === 'CAROUSEL_ALBUM' ? m.mediaUrl : null),
            timestamp: m.timestamp ? new Date(m.timestamp) : null,
            metrics,
            unavailable,
            syncedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
  });
}

async function refreshToken(graph: GraphClient, accountId: string): Promise<void> {
  await withAccount(accountId, async ({ userId, account, token }) => {
    const refreshed = await refreshLongLived(graph, token);
    await InstagramAccount.updateOne(
      { userId, _id: account._id },
      {
        $set: {
          token: sealToken(refreshed.accessToken),
          tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
          tokenRefreshedAt: new Date(),
        },
      },
    );
    logger.info({ accountId }, 'sync: token renovado');
  });
}

export function syncProcessor(graph: GraphClient) {
  return async (job: Job<SyncJobData, unknown, SyncJobName>): Promise<void> => {
    const { accountId } = job.data;
    switch (job.name) {
      case 'account.profile':
        return syncProfile(graph, accountId);
      case 'account.quota':
        return syncQuota(graph, accountId);
      case 'account.media-insights':
        return syncMediaInsights(graph, accountId);
      case 'account.token-refresh':
        return refreshToken(graph, accountId);
    }
  };
}

import { PLANS, type AccountDTO, type AccountSettingsInput, type PlanId } from '@nexora/shared';
import { Types } from 'mongoose';
import { notFound, planLimit } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { REQUIRED_SCOPES, INSTAGRAM_SCOPES, type InstagramProfile } from '../../integrations/meta/instagramOAuth.js';
import { enqueueSync, removeQueuedPublish } from '../../queue/queues.js';
import { notify } from '../notifications/notification.service.js';
import { PublishJob } from '../posts/job.model.js';
import { recomputePost } from '../publishing/aggregate.js';
import { emit } from '../realtime/events.js';
import { InstagramAccount, type InstagramAccountDoc } from './account.model.js';
import { openToken, sealToken } from './tokenVault.js';

export function toAccountDTO(a: InstagramAccountDoc): AccountDTO {
  return {
    id: a._id.toString(),
    igUserId: a.igUserId,
    username: a.username,
    name: a.name ?? null,
    profilePictureUrl: a.profilePictureUrl ?? null,
    accountType: a.accountType ?? null,
    followersCount: a.followersCount ?? null,
    followsCount: a.followsCount ?? null,
    mediaCount: a.mediaCount ?? null,
    status: a.status,
    statusReason: a.statusReason ?? null,
    permissions: a.permissions,
    missingPermissions: INSTAGRAM_SCOPES.filter((s) => !a.permissions.includes(s)),
    lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
    tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
    connectedAt: a.connectedAt.toISOString(),
    settings: { paused: a.settings.paused, minIntervalSeconds: a.settings.minIntervalSeconds },
    publishing: {
      quotaUsage: a.publishing?.quotaUsage ?? null,
      quotaTotal: a.publishing?.quotaTotal ?? null,
      checkedAt: a.publishing?.checkedAt?.toISOString() ?? null,
    },
  };
}

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export async function listAccounts(userId: Types.ObjectId): Promise<AccountDTO[]> {
  const docs = await InstagramAccount.find({ userId }).sort({ status: 1, username: 1 }).lean();
  return docs.map(toAccountDTO);
}

export async function getAccountOrThrow(userId: Types.ObjectId, accountId: string): Promise<InstagramAccountDoc> {
  if (!Types.ObjectId.isValid(accountId)) throw notFound('Conta');
  const doc = await InstagramAccount.findOne({ userId, _id: oid(accountId) }).lean();
  if (!doc) throw notFound('Conta');
  return doc;
}

export interface OAuthConnection {
  profile: InstagramProfile;
  accessToken: string;
  expiresInSeconds: number;
  permissions: string[];
}

export function missingRequiredScopes(permissions: string[]): string[] {
  // Se a Meta não informar as permissões na troca, não bloqueamos aqui: a
  // primeira chamada que precisar delas falha com erro de permissão claro.
  if (permissions.length === 0) return [];
  return REQUIRED_SCOPES.filter((s) => !permissions.includes(s));
}

/** Cria ou reconecta a conta a partir do OAuth. Reautorizar a mesma conta atualiza o token. */
export async function upsertFromOAuth(userId: Types.ObjectId, plan: PlanId, conn: OAuthConnection): Promise<InstagramAccountDoc> {
  const existing = await InstagramAccount.findOne({ userId, igUserId: conn.profile.userId }).lean();
  if (!existing || existing.status === 'DISCONNECTED') {
    const active = await InstagramAccount.countDocuments({ userId, status: { $ne: 'DISCONNECTED' } });
    const limit = PLANS[plan].maxAccounts;
    if (active >= limit) throw planLimit(`Seu plano permite ${limit} contas conectadas. Desconecte uma conta ou faça upgrade.`);
  }
  const now = new Date();
  const p = conn.profile;
  const doc = await InstagramAccount.findOneAndUpdate(
    { userId, igUserId: p.userId },
    {
      $set: {
        appScopedId: p.id,
        username: p.username,
        name: p.name,
        profilePictureUrl: p.profilePictureUrl,
        accountType: p.accountType,
        followersCount: p.followersCount,
        followsCount: p.followsCount,
        mediaCount: p.mediaCount,
        status: 'CONNECTED',
        statusReason: null,
        permissions: conn.permissions,
        token: sealToken(conn.accessToken),
        tokenExpiresAt: new Date(now.getTime() + conn.expiresInSeconds * 1000),
        tokenRefreshedAt: now,
        lastSyncedAt: now,
        connectedAt: existing?.status === 'DISCONNECTED' || !existing ? now : existing.connectedAt,
        disconnectedAt: null,
      },
      $setOnInsert: { userId, igUserId: p.userId },
    },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  return doc!;
}

export async function disconnectAccount(userId: Types.ObjectId, accountId: string): Promise<{ canceledJobs: number }> {
  const account = await getAccountOrThrow(userId, accountId);
  // Publicações pendentes desta conta não têm mais como sair: cancela com motivo.
  const pending = await PublishJob.find({ userId, accountId: account._id, status: { $in: ['SCHEDULED', 'QUEUED'] } })
    .select('_id postId')
    .lean();
  if (pending.length) {
    await PublishJob.updateMany(
      { userId, _id: { $in: pending.map((j) => j._id) }, status: { $in: ['SCHEDULED', 'QUEUED'] } },
      {
        $set: { status: 'CANCELED', finishedAt: new Date(), waitReason: null },
        $push: { history: { $each: [{ at: new Date(), status: 'CANCELED', message: 'Conta desconectada' }], $slice: -30 } },
      },
    );
    await Promise.all(pending.map((j) => removeQueuedPublish(j._id)));
    for (const postId of new Set(pending.map((j) => j.postId.toString()))) await recomputePost(userId, postId);
  }
  const updated = await InstagramAccount.findOneAndUpdate(
    { userId, _id: account._id },
    { $set: { status: 'DISCONNECTED', statusReason: 'Desconectada pelo usuário', disconnectedAt: new Date() }, $unset: { token: 1 } },
    { returnDocument: 'after', lean: true },
  );
  if (updated) await emit(userId, { type: 'account.updated', account: toAccountDTO(updated) });
  return { canceledJobs: pending.length };
}

export async function updateSettings(userId: Types.ObjectId, accountId: string, input: AccountSettingsInput): Promise<AccountDTO> {
  const account = await getAccountOrThrow(userId, accountId);
  const set: Record<string, unknown> = {};
  if (input.paused !== undefined) set['settings.paused'] = input.paused;
  if (input.minIntervalSeconds !== undefined) set['settings.minIntervalSeconds'] = input.minIntervalSeconds;
  const updated = await InstagramAccount.findOneAndUpdate({ userId, _id: account._id }, { $set: set }, { returnDocument: 'after', lean: true });
  const dto = toAccountDTO(updated!);
  await emit(userId, { type: 'account.updated', account: dto });
  return dto;
}

export async function requestSync(userId: Types.ObjectId, accountId: string): Promise<AccountDTO> {
  const account = await getAccountOrThrow(userId, accountId);
  if (account.status === 'DISCONNECTED' || account.status === 'EXPIRED') return toAccountDTO(account);
  const updated = await InstagramAccount.findOneAndUpdate(
    { userId, _id: account._id },
    { $set: { status: 'SYNCING' } },
    { returnDocument: 'after', lean: true },
  );
  await Promise.all([
    enqueueSync('account.profile', account._id),
    enqueueSync('account.quota', account._id),
    enqueueSync('account.media-insights', account._id, 5_000),
  ]);
  const dto = toAccountDTO(updated!);
  await emit(userId, { type: 'account.updated', account: dto });
  return dto;
}

/* ── Uso interno (workers) ─────────────────────────────────────────────── */

/** Carrega a conta com o token decifrado. Nunca exponha o retorno fora do backend. */
export async function loadAccountWithToken(userId: Types.ObjectId, accountId: Types.ObjectId) {
  const account = await InstagramAccount.findOne({ userId, _id: accountId }).select('+token').lean();
  if (!account) return null;
  return { account, token: account.token?.data ? openToken(account.token) : null };
}

export async function setAccountStatus(
  userId: Types.ObjectId,
  accountId: Types.ObjectId,
  status: InstagramAccountDoc['status'],
  reason: string | null,
): Promise<InstagramAccountDoc | null> {
  const prev = await InstagramAccount.findOneAndUpdate(
    { userId, _id: accountId, status: { $ne: 'DISCONNECTED' } },
    { $set: { status, statusReason: reason } },
    { returnDocument: 'before', lean: true },
  );
  if (!prev) return null;
  const updated = await InstagramAccount.findOne({ userId, _id: accountId }).lean();
  if (!updated) return null;
  await emit(userId, { type: 'account.updated', account: toAccountDTO(updated) });
  if (prev.status !== status && (status === 'EXPIRED' || status === 'ERROR')) {
    logger.warn({ accountId: accountId.toString(), status, reason }, 'conta mudou para estado de atenção');
    await notify(userId, {
      kind: status === 'EXPIRED' ? 'account.expired' : 'account.error',
      level: status === 'EXPIRED' ? 'warning' : 'error',
      title: status === 'EXPIRED' ? `@${updated.username} precisa ser reconectada` : `Problema na conta @${updated.username}`,
      body: reason ?? '',
      link: '/accounts',
      dedupeKey: `account:${accountId.toString()}:${status}:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  return updated;
}

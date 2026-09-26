import { ACTIVE_JOB_STATUSES } from '@nexora/shared';
import { logger } from '../lib/logger.js';
import { DAY, HOUR, MINUTE } from '../lib/time.js';
import { InstagramAccount } from '../modules/accounts/account.model.js';
import { setAccountStatus } from '../modules/accounts/account.service.js';
import { Campaign } from '../modules/campaigns/campaign.model.js';
import { PublishJob } from '../modules/posts/job.model.js';
import { PRIORITY, enqueuePublish, enqueueSync, getMaintenanceQueue, getPublishQueue, type MaintenanceJobName } from '../queue/queues.js';

/**
 * Rede de segurança: o Mongo é a fonte da verdade. Se o Redis perdeu dados,
 * se um enqueue falhou ou se um worker morreu no meio, esta varredura
 * recoloca na fila qualquer job vencido que não esteja andando.
 */
export async function recoverStuckJobs(): Promise<number> {
  const now = Date.now();
  const candidates = await PublishJob.find({
    $or: [
      { status: { $in: ['SCHEDULED', 'QUEUED'] }, runAt: { $lte: new Date(now - MINUTE) } },
      { status: { $in: ACTIVE_JOB_STATUSES.filter((s) => s !== 'QUEUED') }, updatedAt: { $lte: new Date(now - 20 * MINUTE) } },
    ],
  })
    .setOptions({ crossTenant: true })
    .select('_id campaignId status')
    .limit(1000)
    .lean();
  if (!candidates.length) return 0;

  const campaignIds = [...new Set(candidates.map((c) => c.campaignId?.toString()).filter((id): id is string => Boolean(id)))];
  const paused = new Set(
    (await Campaign.find({ _id: { $in: campaignIds }, pausedAt: { $ne: null } }).setOptions({ crossTenant: true }).select('_id').lean()).map((c) =>
      c._id.toString(),
    ),
  );

  const queue = getPublishQueue();
  let recovered = 0;
  for (const c of candidates) {
    if (c.status === 'SCHEDULED' && c.campaignId && paused.has(c.campaignId.toString())) continue;
    const existing = await queue.getJob(c._id.toString());
    const state = existing ? await existing.getState() : 'missing';
    if (['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'].includes(state)) continue;
    await enqueuePublish(c._id, new Date(), PRIORITY.now);
    recovered++;
  }
  if (recovered) logger.warn({ recovered }, 'recovery: jobs recolocados na fila');
  return recovered;
}

/**
 * Tokens de longa duração valem 60 dias e só podem ser renovados depois de
 * 24h de vida. Renovamos quando faltam menos de 15 dias; vencidos viram EXPIRED.
 */
export async function sweepTokens(): Promise<void> {
  const now = Date.now();
  const expired = await InstagramAccount.find({ status: { $in: ['CONNECTED', 'SYNCING', 'ERROR'] }, tokenExpiresAt: { $lte: new Date(now) } })
    .setOptions({ crossTenant: true })
    .select('_id userId')
    .lean();
  for (const a of expired) await setAccountStatus(a.userId, a._id, 'EXPIRED', 'O token de acesso expirou. Reconecte a conta.');

  const due = await InstagramAccount.find({
    status: { $in: ['CONNECTED', 'SYNCING', 'ERROR'] },
    tokenExpiresAt: { $gt: new Date(now), $lte: new Date(now + 15 * DAY) },
    tokenRefreshedAt: { $lte: new Date(now - DAY) },
  })
    .setOptions({ crossTenant: true })
    .select('_id')
    .lean();
  for (const [i, a] of due.entries()) await enqueueSync('account.token-refresh', a._id, i * 2_000);
}

/** Sincronização periódica de perfil, cota e insights, espalhada ao longo de 30 min. */
export async function sweepSync(): Promise<void> {
  const accounts = await InstagramAccount.find({ status: { $in: ['CONNECTED', 'ERROR'] } })
    .setOptions({ crossTenant: true })
    .select('_id')
    .lean();
  const spread = 30 * MINUTE;
  for (const [i, a] of accounts.entries()) {
    const delay = accounts.length > 1 ? Math.floor((spread * i) / accounts.length) : 0;
    await enqueueSync('account.profile', a._id, delay);
    await enqueueSync('account.quota', a._id, delay + 5_000);
    await enqueueSync('account.media-insights', a._id, delay + 15_000);
  }
}

export async function registerSchedules(): Promise<void> {
  const q = getMaintenanceQueue();
  const every: Record<MaintenanceJobName, number> = {
    'sweep.recovery': 2 * MINUTE,
    'sweep.token-refresh': 6 * HOUR,
    'sweep.sync': 6 * HOUR,
  };
  for (const [name, ms] of Object.entries(every) as [MaintenanceJobName, number][]) {
    await q.upsertJobScheduler(name, { every: ms }, { name, data: {} });
  }
}

export async function runMaintenance(name: MaintenanceJobName): Promise<void> {
  if (name === 'sweep.recovery') await recoverStuckJobs();
  else if (name === 'sweep.token-refresh') await sweepTokens();
  else if (name === 'sweep.sync') await sweepSync();
}

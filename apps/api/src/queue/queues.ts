import { Queue, type JobsOptions } from 'bullmq';
import type { Types } from 'mongoose';
import { bullConnection } from '../infra/redis.js';

/**
 * Filas BullMQ.
 *
 *  publish     — um job por PublishJob (post × conta). jobId = id do PublishJob,
 *                o que torna o enfileiramento idempotente.
 *  sync        — sincronização por conta (perfil, cota, insights, token).
 *  maintenance — varreduras periódicas (recuperação, renovação de tokens).
 *
 * Isolamento entre contas não depende de uma fila por conta: o worker usa um
 * lock por conta no Redis e devolve para "delayed" o job que não conseguiu a
 * vaga, liberando o slot para jobs de outras contas.
 */
export const QUEUE_NAMES = { publish: 'publish', sync: 'sync', maintenance: 'maintenance' } as const;

export interface PublishJobData {
  publishJobId: string;
}

export type SyncJobName = 'account.profile' | 'account.quota' | 'account.media-insights' | 'account.token-refresh';
export interface SyncJobData {
  accountId: string;
}

export type MaintenanceJobName = 'sweep.recovery' | 'sweep.token-refresh' | 'sweep.sync';

let publishQueue: Queue<PublishJobData> | undefined;
let syncQueue: Queue<SyncJobData, unknown, SyncJobName> | undefined;
let maintenanceQueue: Queue<Record<string, never>, unknown, MaintenanceJobName> | undefined;

export function getPublishQueue() {
  publishQueue ??= new Queue<PublishJobData>(QUEUE_NAMES.publish, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return publishQueue;
}

export function getSyncQueue() {
  syncQueue ??= new Queue<SyncJobData, unknown, SyncJobName>(QUEUE_NAMES.sync, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return syncQueue;
}

export function getMaintenanceQueue() {
  maintenanceQueue ??= new Queue<Record<string, never>, unknown, MaintenanceJobName>(QUEUE_NAMES.maintenance, {
    connection: bullConnection(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
  });
  return maintenanceQueue;
}

export const PRIORITY = { now: 1, scheduled: 2, campaign: 3 } as const;

/**
 * Coloca (ou recoloca) um PublishJob na fila. Se já existir um job BullMQ com
 * o mesmo id que não esteja ativo (falho, concluído, atrasado), ele é
 * substituído — é o que permite "tentar de novo" e "publicar agora".
 */
export async function enqueuePublish(
  publishJobId: Types.ObjectId | string,
  runAt: Date,
  priority: number = PRIORITY.scheduled,
): Promise<'enqueued' | 'active'> {
  const queue = getPublishQueue();
  const id = String(publishJobId);
  const existing = await queue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active') return 'active';
    await existing.remove().catch(() => undefined);
  }
  const opts: JobsOptions = { jobId: id, delay: Math.max(0, runAt.getTime() - Date.now()), priority };
  await queue.add('publish', { publishJobId: id }, opts);
  return 'enqueued';
}

export async function removeQueuedPublish(publishJobId: Types.ObjectId | string): Promise<void> {
  const job = await getPublishQueue().getJob(String(publishJobId));
  if (!job) return;
  const state = await job.getState();
  if (state !== 'active') await job.remove().catch(() => undefined);
}

export async function enqueueSync(name: SyncJobName, accountId: Types.ObjectId | string, delayMs = 0): Promise<void> {
  const id = String(accountId);
  // jobId por (tipo, conta): pedir sync duas vezes não empilha dois jobs.
  await getSyncQueue().add(name, { accountId: id }, { jobId: `${name.replace('.', '-')}-${id}`, delay: delayMs });
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([publishQueue?.close(), syncQueue?.close(), maintenanceQueue?.close()]);
  publishQueue = undefined;
  syncQueue = undefined;
  maintenanceQueue = undefined;
}

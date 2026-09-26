import { DEFAULT_PUBLISHING_QUOTA, isTerminalJobStatus } from '@nexora/shared';
import { DelayedError, type Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import { InstagramAccount } from '../modules/accounts/account.model.js';
import { setAccountStatus } from '../modules/accounts/account.service.js';
import { PublishJob } from '../modules/posts/job.model.js';
import { emitJobUpdate } from '../modules/publishing/jobEvents.js';
import {
  MAX_ATTEMPTS,
  PublishExecution,
  decideFailure,
  needsRequeue,
  type ExecutorDeps,
} from '../modules/publishing/publishExecutor.js';
import type { PublishJobData } from '../queue/queues.js';

function human(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

async function delay(bullJob: Job<PublishJobData>, token: string | undefined, ms: number): Promise<never> {
  await bullJob.moveToDelayed(Date.now() + ms, token);
  throw new DelayedError();
}

/**
 * Processador do BullMQ para a fila `publish`. Toda espera volta para
 * "delayed" (DelayedError) — o slot do worker nunca fica parado esperando.
 */
export async function runPublishJob(bullJob: Job<PublishJobData>, token: string | undefined, deps: ExecutorDeps): Promise<void> {
  const doc = await PublishJob.findById(bullJob.data.publishJobId).setOptions({ crossTenant: true }).lean();
  if (!doc || isTerminalJobStatus(doc.status)) return;

  const exec = new PublishExecution(doc, deps);
  let result;
  try {
    result = await exec.advance();
  } catch (err) {
    await exec.releaseLocks();
    return handleError(exec, err, bullJob, token);
  }

  if (result.kind === 'wait') {
    if (!result.keepLock) await exec.releaseLocks();
    await exec.setWaitReason(result.reason);
    return delay(bullJob, token, result.ms);
  }
  await exec.releaseLocks();
}

async function handleError(exec: PublishExecution, err: unknown, bullJob: Job<PublishJobData>, token: string | undefined): Promise<void> {
  const job = exec.job;
  const attempts = job.attempts + 1;
  const decision = decideFailure(err, attempts, job.rateLimitWaits ?? 0);
  const where = { jobId: job._id.toString(), accountId: job.accountId.toString(), status: job.status, attempts };

  if (decision.action === 'wait') {
    logger.info({ ...where, delayMs: decision.delayMs }, 'publish: aguardando limite da Meta');
    const updated = await PublishJob.findOneAndUpdate(
      { userId: job.userId, _id: job._id },
      { $inc: { rateLimitWaits: 1 }, $set: { waitReason: decision.reason } },
      { returnDocument: 'after', lean: true },
    );
    if (updated) await emitJobUpdate(updated);
    if (decision.markQuotaExhausted) {
      // Os outros jobs desta conta passam a esperar no portão de cota, sem criar container.
      await InstagramAccount.updateOne(
        { userId: job.userId, _id: job.accountId },
        [
          {
            $set: {
              'publishing.quotaUsage': { $ifNull: ['$publishing.quotaTotal', DEFAULT_PUBLISHING_QUOTA] },
              'publishing.checkedAt': '$$NOW',
            },
          },
        ],
      );
    }
    return delay(bullJob, token, decision.delayMs);
  }

  if (decision.action === 'fail') {
    logger.warn({ ...where, err, code: decision.error.code }, 'publish: falhou');
    await PublishJob.updateOne({ userId: job.userId, _id: job._id }, { $set: { attempts } });
    if (decision.accountStatus) {
      await setAccountStatus(job.userId, job.accountId, decision.accountStatus.status, decision.accountStatus.reason);
    }
    await exec.fail(decision.error);
    return;
  }

  logger.warn({ ...where, err, delayMs: decision.delayMs }, 'publish: erro retentável');
  const set = {
    attempts,
    error: decision.error,
    waitReason: `${decision.error.message} Nova tentativa automática em ${human(decision.delayMs)} (${attempts}/${MAX_ATTEMPTS}).`,
  };
  if (needsRequeue(job)) {
    await exec.transition([job.status], 'QUEUED', set, decision.error.message);
  } else {
    const updated = await PublishJob.findOneAndUpdate({ userId: job.userId, _id: job._id }, { $set: set }, { returnDocument: 'after', lean: true });
    if (updated) await emitJobUpdate(updated);
  }
  return delay(bullJob, token, decision.delayMs);
}

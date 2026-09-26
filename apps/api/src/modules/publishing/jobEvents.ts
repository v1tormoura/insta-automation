import type { JobStatus } from '@nexora/shared';
import type { Types } from 'mongoose';
import { hydrateJobs } from '../posts/mappers.js';
import { PublishJob, type PublishJobDoc } from '../posts/job.model.js';
import { emit } from '../realtime/events.js';

export async function emitJobUpdate(job: PublishJobDoc): Promise<void> {
  const [dto] = await hydrateJobs(job.userId, [job]);
  if (dto) await emit(job.userId, { type: 'job.updated', job: dto });
}

export async function emitJobById(userId: Types.ObjectId, jobId: Types.ObjectId): Promise<void> {
  const job = await PublishJob.findOne({ userId, _id: jobId }).lean();
  if (job) await emitJobUpdate(job);
}

export function historyPush(status: JobStatus, message?: string) {
  return { history: { $each: [{ at: new Date(), status, ...(message ? { message } : {}) }], $slice: -30 } };
}

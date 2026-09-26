import type { CampaignStatus, JobStatus, PostStatus } from '@nexora/shared';
import { Types } from 'mongoose';
import { Campaign } from '../campaigns/campaign.model.js';
import { notify } from '../notifications/notification.service.js';
import { PublishJob } from '../posts/job.model.js';
import { Post, type JobCounts } from '../posts/post.model.js';
import { emit } from '../realtime/events.js';

/**
 * Status agregado de post e fila, derivado dos jobs. Nunca é mantido "à mão":
 * sempre recalculado a partir da contagem real, então não diverge.
 */

async function countJobs(match: Record<string, unknown>): Promise<{ counts: JobCounts; active: number }> {
  const rows = await PublishJob.aggregate<{ _id: JobStatus; n: number }>([
    { $match: match },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n])) as Partial<Record<JobStatus, number>>;
  const published = by.PUBLISHED ?? 0;
  const failed = by.FAILED ?? 0;
  const canceled = by.CANCELED ?? 0;
  const active = (by.QUEUED ?? 0) + (by.CREATING ?? 0) + (by.PROCESSING ?? 0) + (by.PUBLISHING ?? 0);
  const pending = (by.SCHEDULED ?? 0) + active;
  return { counts: { total: published + failed + canceled + pending, published, failed, pending, canceled }, active };
}

export function derivePostStatus(counts: JobCounts, active: number, hasDraft: boolean): PostStatus {
  if (counts.total === 0) return hasDraft ? 'DRAFT' : 'CANCELED';
  if (counts.pending > 0) return active > 0 || counts.published + counts.failed > 0 ? 'PUBLISHING' : 'SCHEDULED';
  if (counts.published === counts.total - counts.canceled && counts.published > 0) return 'PUBLISHED';
  if (counts.published > 0) return 'PARTIAL';
  if (counts.failed > 0) return 'FAILED';
  return 'CANCELED';
}

export function deriveCampaignStatus(counts: JobCounts, paused: boolean): CampaignStatus {
  if (counts.pending > 0) return paused ? 'PAUSED' : 'ACTIVE';
  if (counts.total === 0 || counts.canceled === counts.total) return 'CANCELED';
  if (counts.failed === 0 && counts.published > 0) return 'COMPLETED';
  if (counts.published > 0) return 'PARTIAL';
  return 'FAILED';
}

const TERMINAL_POST: PostStatus[] = ['PUBLISHED', 'PARTIAL', 'FAILED'];

export async function recomputePost(userId: Types.ObjectId, postId: Types.ObjectId | string): Promise<void> {
  const _id = new Types.ObjectId(String(postId));
  const post = await Post.findOne({ userId, _id }).lean();
  if (!post) return;
  const { counts, active } = await countJobs({ userId, postId: _id });
  const status = derivePostStatus(counts, active, post.status === 'DRAFT');
  const becameTerminal = TERMINAL_POST.includes(status) && !TERMINAL_POST.includes(post.status);
  await Post.updateOne(
    { userId, _id },
    { $set: { counts, status, ...(becameTerminal ? { completedAt: new Date() } : {}) } },
  );
  await emit(userId, { type: 'post.updated', postId: _id.toString(), status, counts });

  // Post avulso com várias contas: um aviso consolidado no fim, em vez de um por conta.
  if (becameTerminal && !post.campaignId && counts.total > 1) {
    await notify(userId, {
      kind: 'post.completed',
      level: status === 'PUBLISHED' ? 'success' : status === 'PARTIAL' ? 'warning' : 'error',
      title: status === 'PUBLISHED' ? 'Publicação concluída' : status === 'PARTIAL' ? 'Publicação concluída com falhas' : 'Publicação falhou',
      body: `Publicado em ${counts.published} de ${counts.total - counts.canceled} contas.`,
      link: `/posts/${_id.toString()}`,
      dedupeKey: `post:${_id.toString()}:done`,
    });
  }
  if (post.campaignId) await recomputeCampaign(userId, post.campaignId);
}

export async function recomputeCampaign(userId: Types.ObjectId, campaignId: Types.ObjectId | string): Promise<void> {
  const _id = new Types.ObjectId(String(campaignId));
  const campaign = await Campaign.findOne({ userId, _id }).lean();
  if (!campaign) return;
  const { counts } = await countJobs({ userId, campaignId: _id });
  const status = deriveCampaignStatus(counts, Boolean(campaign.pausedAt));
  const terminal = !['ACTIVE', 'PAUSED'].includes(status);
  const becameTerminal = terminal && ['ACTIVE', 'PAUSED'].includes(campaign.status);
  await Campaign.updateOne(
    { userId, _id },
    { $set: { counts, status, ...(becameTerminal ? { completedAt: new Date() } : {}) } },
  );
  await emit(userId, { type: 'campaign.updated', campaignId: _id.toString(), status, counts });
  if (becameTerminal && status !== 'CANCELED') {
    await notify(userId, {
      kind: 'campaign.completed',
      level: status === 'COMPLETED' ? 'success' : status === 'PARTIAL' ? 'warning' : 'error',
      title: `Fila "${campaign.name}" finalizada`,
      body: `${counts.published} publicadas, ${counts.failed} com falha, ${counts.canceled} canceladas.`,
      link: `/campaigns/${_id.toString()}`,
      dedupeKey: `campaign:${_id.toString()}:done`,
    });
  }
}

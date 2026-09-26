import { JOB_PROGRESS, type JobDTO, type PostDTO } from '@nexora/shared';
import type { Types } from 'mongoose';
import { InstagramAccount, type InstagramAccountDoc } from '../accounts/account.model.js';
import { Media, type MediaDoc } from '../media/media.model.js';
import { toMediaDTO } from '../media/media.service.js';
import type { PublishJobDoc } from './job.model.js';
import { Post, type PostDoc } from './post.model.js';

type PostSummary = Pick<PostDoc, '_id' | 'type' | 'caption' | 'mediaIds'>;

export function toJobDTO(
  job: PublishJobDoc,
  ctx: { account?: InstagramAccountDoc | null; post?: PostSummary | null; thumbnailUrl?: string | null },
): JobDTO {
  return {
    id: job._id.toString(),
    postId: job.postId.toString(),
    campaignId: job.campaignId?.toString() ?? null,
    accountId: job.accountId.toString(),
    account: ctx.account
      ? { id: ctx.account._id.toString(), username: ctx.account.username, profilePictureUrl: ctx.account.profilePictureUrl ?? null }
      : null,
    postType: job.postType,
    captionPreview: (ctx.post?.caption ?? '').slice(0, 140),
    thumbnailUrl: ctx.thumbnailUrl ?? null,
    status: job.status,
    progress: JOB_PROGRESS[job.status],
    runAt: job.runAt.toISOString(),
    attempts: job.attempts,
    waitReason: job.waitReason ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    igMediaId: job.igMediaId ?? null,
    permalink: job.permalink ?? null,
    error: job.error
      ? {
          code: job.error.code,
          message: job.error.message,
          retryable: job.error.retryable,
          metaCode: job.error.metaCode ?? null,
          metaSubcode: job.error.metaSubcode ?? null,
        }
      : null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

/** Converte vários jobs de uma vez, carregando contas, posts e miniaturas em lote. */
export async function hydrateJobs(userId: Types.ObjectId, jobs: PublishJobDoc[]): Promise<JobDTO[]> {
  if (!jobs.length) return [];
  const accountIds = [...new Set(jobs.map((j) => j.accountId.toString()))];
  const postIds = [...new Set(jobs.map((j) => j.postId.toString()))];
  const [accounts, posts] = await Promise.all([
    InstagramAccount.find({ userId, _id: { $in: accountIds } }).lean(),
    Post.find({ userId, _id: { $in: postIds } }).select('_id type caption mediaIds').lean(),
  ]);
  const firstMediaIds = posts.map((p) => p.mediaIds[0]).filter((m): m is Types.ObjectId => Boolean(m));
  const media = await Media.find({ userId, _id: { $in: firstMediaIds } }).lean();
  const accountById = new Map(accounts.map((a) => [a._id.toString(), a]));
  const postById = new Map(posts.map((p) => [p._id.toString(), p]));
  const thumbByMedia = new Map(media.map((m) => [m._id.toString(), toMediaDTO(m).thumbnailUrl]));
  return jobs.map((job) => {
    const post = postById.get(job.postId.toString()) ?? null;
    return toJobDTO(job, {
      account: accountById.get(job.accountId.toString()) ?? null,
      post,
      thumbnailUrl: post?.mediaIds[0] ? thumbByMedia.get(post.mediaIds[0].toString()) ?? null : null,
    });
  });
}

export async function toPostDTOs(userId: Types.ObjectId, posts: PostDoc[]): Promise<PostDTO[]> {
  const ids = new Set<string>();
  for (const p of posts) {
    p.mediaIds.forEach((m) => ids.add(m.toString()));
    if (p.cover?.mediaId) ids.add(p.cover.mediaId.toString());
  }
  // Mídias removidas da biblioteca continuam aparecendo no histórico (sem arquivo).
  const media = await Media.find({ userId, _id: { $in: [...ids] } }).lean();
  const byId = new Map<string, MediaDoc>(media.map((m) => [m._id.toString(), m]));
  return posts.map((p) => ({
    id: p._id.toString(),
    type: p.type,
    caption: p.caption,
    media: p.mediaIds.map((m) => byId.get(m.toString())).filter((m): m is MediaDoc => Boolean(m)).map(toMediaDTO),
    cover: p.cover && (p.cover.mediaId || p.cover.thumbOffsetMs != null)
      ? {
          media: p.cover.mediaId && byId.get(p.cover.mediaId.toString()) ? toMediaDTO(byId.get(p.cover.mediaId.toString())!) : null,
          thumbOffsetMs: p.cover.thumbOffsetMs ?? null,
        }
      : null,
    shareToFeed: p.shareToFeed,
    status: p.status,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    campaignId: p.campaignId?.toString() ?? null,
    accountIds: p.accountIds.map(String),
    counts: p.counts,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

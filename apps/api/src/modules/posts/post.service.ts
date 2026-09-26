import {
  PENDING_JOB_STATUSES,
  PLANS,
  planSchedule,
  type CreatePostInput,
  type ListJobsQuery,
  type ListPostsQuery,
  type Paginated,
  type JobDTO,
  type PostContentInput,
  type PostDTO,
  type PlanId,
  type ScheduleInputDto,
} from '@nexora/shared';
import { Types } from 'mongoose';
import { AppError, badRequest, conflict, notFound, planLimit } from '../../lib/errors.js';
import { MINUTE } from '../../lib/time.js';
import { PRIORITY, enqueuePublish, removeQueuedPublish } from '../../queue/queues.js';
import { InstagramAccount, type InstagramAccountDoc } from '../accounts/account.model.js';
import { Media, type MediaDoc } from '../media/media.model.js';
import { assertMediaFitsPost } from '../media/media.service.js';
import { recomputePost } from '../publishing/aggregate.js';
import { emitJobById, historyPush } from '../publishing/jobEvents.js';
import { PublishJob, type PublishJobDoc } from './job.model.js';
import { hydrateJobs, toPostDTOs } from './mappers.js';
import { Post, type PostDoc } from './post.model.js';

const oid = (id: string) => new Types.ObjectId(id);

export interface PreparedContent {
  type: PostDoc['type'];
  caption: string;
  mediaIds: Types.ObjectId[];
  cover: PostDoc['cover'];
  shareToFeed: boolean;
}

/** Valida o conteúdo contra as mídias reais do usuário e as regras da Meta. */
export async function prepareContent(userId: Types.ObjectId, content: PostContentInput): Promise<PreparedContent> {
  const ids = content.mediaIds.map(oid);
  const coverId = content.cover?.mediaId ? oid(content.cover.mediaId) : null;
  const docs = await Media.find({ userId, deletedAt: null, _id: { $in: coverId ? [...ids, coverId] : ids } }).lean();
  const byId = new Map<string, MediaDoc>(docs.map((d) => [d._id.toString(), d]));
  const media = ids.map((id) => byId.get(id.toString()));
  if (media.some((m) => !m)) throw notFound('Mídia');
  const cover = coverId ? byId.get(coverId.toString()) ?? null : null;
  if (coverId && !cover) throw notFound('Mídia da capa');
  assertMediaFitsPost(content.type, media as MediaDoc[], cover);
  return {
    type: content.type,
    // Stories não exibem legenda; não guardamos um texto que não será publicado.
    caption: content.type === 'STORY' ? '' : content.caption.trim(),
    mediaIds: ids,
    cover: content.type === 'REEL' && content.cover ? { mediaId: coverId, thumbOffsetMs: content.cover.thumbOffsetMs ?? null } : null,
    shareToFeed: content.type === 'REEL' ? content.shareToFeed : true,
  };
}

/** Só contas conectadas deste usuário podem receber publicações. */
export async function resolveTargetAccounts(userId: Types.ObjectId, accountIds: string[]): Promise<InstagramAccountDoc[]> {
  const docs = await InstagramAccount.find({ userId, _id: { $in: accountIds.map(oid) } }).lean();
  if (docs.length !== accountIds.length) throw notFound('Conta');
  const unavailable = docs.filter((a) => a.status === 'DISCONNECTED' || a.status === 'EXPIRED');
  if (unavailable.length) {
    throw new AppError(
      'ACCOUNT_UNAVAILABLE',
      `Reconecte antes de agendar: ${unavailable.map((a) => `@${a.username}`).join(', ')}.`,
      409,
    );
  }
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  return accountIds.map((id) => byId.get(id)!);
}

export async function assertPendingCapacity(userId: Types.ObjectId, plan: PlanId, adding: number): Promise<void> {
  const limit = PLANS[plan].maxPendingJobs;
  const pending = await PublishJob.countDocuments({ userId, status: { $in: PENDING_JOB_STATUSES } });
  if (pending + adding > limit) {
    throw planLimit(`Seu plano permite ${limit} publicações pendentes (hoje: ${pending}). Aguarde a fila andar ou faça upgrade.`);
  }
}

export function resolveStart(schedule: ScheduleInputDto): Date | null {
  if (schedule.mode === 'draft') return null;
  if (schedule.mode === 'now') return new Date();
  if (schedule.at.getTime() < Date.now() - MINUTE) throw badRequest('O horário escolhido já passou.');
  return schedule.at;
}

export interface JobSeed {
  postId: Types.ObjectId;
  accountId: Types.ObjectId;
  runAt: Date;
}

/** Cria os PublishJobs e agenda no BullMQ. Falha de Redis aqui é coberta pela varredura de recuperação. */
export async function createJobs(
  userId: Types.ObjectId,
  seeds: JobSeed[],
  postType: (postId: string) => PostDoc['type'],
  opts: { campaignId?: Types.ObjectId; priority: number },
): Promise<PublishJobDoc[]> {
  const now = new Date();
  const docs = await PublishJob.insertMany(
    seeds.map((s) => ({
      userId,
      postId: s.postId,
      campaignId: opts.campaignId ?? null,
      accountId: s.accountId,
      postType: postType(s.postId.toString()),
      status: 'SCHEDULED',
      runAt: s.runAt,
      history: [{ at: now, status: 'SCHEDULED' }],
    })),
  );
  await Promise.allSettled(docs.map((d) => enqueuePublish(d._id, d.runAt, opts.priority)));
  return docs.map((d) => d.toObject() as PublishJobDoc);
}

export async function createPost(userId: Types.ObjectId, plan: PlanId, input: CreatePostInput): Promise<PostDTO> {
  const content = await prepareContent(userId, input.content);
  const accounts = await resolveTargetAccounts(userId, input.accountIds);
  const startAt = resolveStart(input.schedule);
  if (startAt) await assertPendingCapacity(userId, plan, accounts.length);

  const post = await Post.create({
    userId,
    ...content,
    status: startAt ? 'SCHEDULED' : 'DRAFT',
    scheduledAt: startAt,
    accountIds: accounts.map((a) => a._id),
    accountStaggerMinutes: input.accountStaggerMinutes,
  });

  if (startAt) {
    try {
      await schedulePostJobs(userId, post.toObject() as PostDoc, startAt, input.schedule.mode === 'now' ? PRIORITY.now : PRIORITY.scheduled);
    } catch (err) {
      await Promise.all([PublishJob.deleteMany({ userId, postId: post._id }), Post.deleteOne({ userId, _id: post._id })]);
      throw err;
    }
  }
  return getPost(userId, post._id.toString());
}

async function schedulePostJobs(userId: Types.ObjectId, post: PostDoc, startAt: Date, priority: number): Promise<void> {
  const slots = planSchedule({
    startAt,
    itemCount: 1,
    accountIds: post.accountIds.map(String),
    intervalMinutes: 0,
    accountStaggerMinutes: post.accountStaggerMinutes,
  });
  await createJobs(
    userId,
    slots.map((s) => ({ postId: post._id, accountId: oid(s.accountId), runAt: s.runAt })),
    () => post.type,
    { priority },
  );
  await recomputePost(userId, post._id);
}

/** Envia um rascunho para a fila. */
export async function submitDraft(
  userId: Types.ObjectId,
  plan: PlanId,
  postId: string,
  input: Pick<CreatePostInput, 'accountIds' | 'schedule' | 'accountStaggerMinutes'>,
): Promise<PostDTO> {
  const post = await getPostDoc(userId, postId);
  if (post.status !== 'DRAFT') throw conflict('Só rascunhos podem ser enviados para a fila.');
  const startAt = resolveStart(input.schedule);
  if (!startAt) throw badRequest('Escolha publicar agora ou agendar.');
  const accounts = await resolveTargetAccounts(userId, input.accountIds);
  await prepareContent(userId, {
    type: post.type,
    caption: post.caption,
    mediaIds: post.mediaIds.map(String),
    cover: post.cover?.mediaId || post.cover?.thumbOffsetMs != null
      ? { mediaId: post.cover?.mediaId?.toString(), thumbOffsetMs: post.cover?.thumbOffsetMs ?? undefined }
      : undefined,
    shareToFeed: post.shareToFeed,
  });
  await assertPendingCapacity(userId, plan, accounts.length);
  const updated = await Post.findOneAndUpdate(
    { userId, _id: post._id, status: 'DRAFT' },
    { $set: { status: 'SCHEDULED', scheduledAt: startAt, accountIds: accounts.map((a) => a._id), accountStaggerMinutes: input.accountStaggerMinutes } },
    { returnDocument: 'after', lean: true },
  );
  if (!updated) throw conflict('O rascunho foi alterado por outra ação. Recarregue a página.');
  await schedulePostJobs(userId, updated, startAt, input.schedule.mode === 'now' ? PRIORITY.now : PRIORITY.scheduled);
  return getPost(userId, postId);
}

async function getPostDoc(userId: Types.ObjectId, postId: string): Promise<PostDoc> {
  if (!Types.ObjectId.isValid(postId)) throw notFound('Publicação');
  const post = await Post.findOne({ userId, _id: oid(postId) }).lean();
  if (!post) throw notFound('Publicação');
  return post;
}

export async function getPost(userId: Types.ObjectId, postId: string): Promise<PostDTO> {
  const post = await getPostDoc(userId, postId);
  const [dto] = await toPostDTOs(userId, [post]);
  const jobs = await PublishJob.find({ userId, postId: post._id }).sort({ runAt: 1 }).lean();
  return { ...dto!, jobs: await hydrateJobs(userId, jobs) };
}

export async function listPosts(userId: Types.ObjectId, q: ListPostsQuery): Promise<Paginated<PostDTO>> {
  const filter: Record<string, unknown> = { userId };
  if (q.status) filter.status = q.status;
  if (q.type) filter.type = q.type;
  if (q.accountId) filter.accountIds = oid(q.accountId);
  if (q.campaignId) filter.campaignId = oid(q.campaignId);
  const [items, total] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Post.countDocuments(filter),
  ]);
  return { items: await toPostDTOs(userId, items), page: q.page, pageSize: q.pageSize, total };
}

export async function deletePost(userId: Types.ObjectId, postId: string): Promise<void> {
  const post = await getPostDoc(userId, postId);
  if (!['DRAFT', 'CANCELED', 'FAILED'].includes(post.status)) {
    throw conflict('Só rascunhos, publicações canceladas ou com falha podem ser removidos.');
  }
  await PublishJob.deleteMany({ userId, postId: post._id });
  await Post.deleteOne({ userId, _id: post._id });
}

export async function cancelPost(userId: Types.ObjectId, postId: string): Promise<PostDTO> {
  const post = await getPostDoc(userId, postId);
  const jobs = await PublishJob.find({ userId, postId: post._id, status: { $in: ['SCHEDULED', 'QUEUED', 'CREATING', 'PROCESSING'] } })
    .select('_id')
    .lean();
  for (const j of jobs) await cancelJobDoc(userId, j._id, 'Cancelado pelo usuário');
  if (post.status === 'DRAFT') await Post.updateOne({ userId, _id: post._id }, { $set: { status: 'CANCELED' } });
  await recomputePost(userId, post._id);
  return getPost(userId, postId);
}

/* ── Jobs ─────────────────────────────────────────────────────────────── */

const CANCELABLE = ['SCHEDULED', 'QUEUED', 'CREATING', 'PROCESSING'] as const;

async function cancelJobDoc(userId: Types.ObjectId, jobId: Types.ObjectId, reason: string): Promise<boolean> {
  const res = await PublishJob.updateOne(
    { userId, _id: jobId, status: { $in: CANCELABLE } },
    { $set: { status: 'CANCELED', finishedAt: new Date(), waitReason: null }, $push: historyPush('CANCELED', reason) },
  );
  if (!res.modifiedCount) return false;
  await removeQueuedPublish(jobId);
  await emitJobById(userId, jobId);
  return true;
}

async function getJobDoc(userId: Types.ObjectId, jobId: string): Promise<PublishJobDoc> {
  if (!Types.ObjectId.isValid(jobId)) throw notFound('Job');
  const job = await PublishJob.findOne({ userId, _id: oid(jobId) }).lean();
  if (!job) throw notFound('Job');
  return job;
}

async function jobDTO(userId: Types.ObjectId, jobId: Types.ObjectId): Promise<JobDTO> {
  const job = await PublishJob.findOne({ userId, _id: jobId }).lean();
  return (await hydrateJobs(userId, [job!]))[0]!;
}

export async function listJobs(userId: Types.ObjectId, q: ListJobsQuery): Promise<Paginated<JobDTO>> {
  const filter: Record<string, unknown> = { userId };
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.accountId) filter.accountId = oid(q.accountId);
  if (q.postId) filter.postId = oid(q.postId);
  if (q.campaignId) filter.campaignId = oid(q.campaignId);
  const sort: Record<string, 1 | -1> = q.sort === 'runAt' ? { runAt: 1 } : q.sort === '-runAt' ? { runAt: -1 } : { updatedAt: -1 };
  const [items, total] = await Promise.all([
    PublishJob.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    PublishJob.countDocuments(filter),
  ]);
  return { items: await hydrateJobs(userId, items), page: q.page, pageSize: q.pageSize, total };
}

export async function cancelJob(userId: Types.ObjectId, jobId: string): Promise<JobDTO> {
  const job = await getJobDoc(userId, jobId);
  if (job.status === 'PUBLISHING') throw conflict('A publicação já está sendo enviada ao Instagram e não pode ser cancelada.');
  if (!(await cancelJobDoc(userId, job._id, 'Cancelado pelo usuário'))) throw conflict('Este job não está mais pendente.');
  await recomputePost(userId, job.postId);
  return jobDTO(userId, job._id);
}

export async function retryJob(userId: Types.ObjectId, plan: PlanId, jobId: string): Promise<JobDTO> {
  const job = await getJobDoc(userId, jobId);
  if (job.status !== 'FAILED') throw conflict('Só jobs com falha podem ser tentados de novo.');
  const account = await InstagramAccount.findOne({ userId, _id: job.accountId }).lean();
  if (!account || account.status === 'DISCONNECTED' || account.status === 'EXPIRED') {
    throw new AppError('ACCOUNT_UNAVAILABLE', 'Reconecte a conta antes de tentar de novo.', 409);
  }
  await assertPendingCapacity(userId, plan, 1);
  const now = new Date();
  const res = await PublishJob.updateOne(
    { userId, _id: job._id, status: 'FAILED' },
    {
      $set: {
        status: 'QUEUED',
        runAt: now,
        attempts: 0,
        error: null,
        waitReason: null,
        containerId: null,
        containerCreatedAt: null,
        childContainerIds: [],
        finishedAt: null,
      },
      $push: historyPush('QUEUED', 'Nova tentativa solicitada'),
    },
  );
  if (!res.modifiedCount) throw conflict('Este job mudou de estado. Recarregue a página.');
  await enqueuePublish(job._id, now, PRIORITY.now);
  await recomputePost(userId, job.postId);
  await emitJobById(userId, job._id);
  return jobDTO(userId, job._id);
}

export async function runJobNow(userId: Types.ObjectId, jobId: string): Promise<JobDTO> {
  const job = await getJobDoc(userId, jobId);
  if (job.status !== 'SCHEDULED') throw conflict('Só publicações agendadas podem ser antecipadas.');
  const now = new Date();
  await PublishJob.updateOne({ userId, _id: job._id, status: 'SCHEDULED' }, { $set: { runAt: now } });
  await enqueuePublish(job._id, now, PRIORITY.now);
  await emitJobById(userId, job._id);
  return jobDTO(userId, job._id);
}

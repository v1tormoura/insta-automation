import { planSchedule, scheduleEndsAt, type CampaignDTO, type CreateCampaignInput, type Paginated, type PlanId, paginationSchema } from '@nexora/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { conflict, notFound } from '../../lib/errors.js';
import { PRIORITY, enqueuePublish, removeQueuedPublish } from '../../queue/queues.js';
import { PublishJob } from '../posts/job.model.js';
import { Post, type PostDoc } from '../posts/post.model.js';
import {
  assertPendingCapacity,
  createJobs,
  prepareContent,
  resolveStart,
  resolveTargetAccounts,
  type PreparedContent,
} from '../posts/post.service.js';
import { recomputeCampaign, recomputePost } from '../publishing/aggregate.js';
import { historyPush } from '../publishing/jobEvents.js';
import { Campaign, type CampaignDoc } from './campaign.model.js';

export function toCampaignDTO(c: CampaignDoc): CampaignDTO {
  return {
    id: c._id.toString(),
    name: c.name,
    status: c.status,
    accountIds: c.accountIds.map(String),
    startAt: c.startAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    intervalMinutes: c.intervalMinutes,
    accountStaggerMinutes: c.accountStaggerMinutes,
    counts: c.counts,
    postIds: c.postIds.map(String),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Cria uma fila: N conteúdos × M contas. Cada conteúdo vira um Post; cada
 * (conteúdo, conta) vira um PublishJob com horário calculado pelo planner.
 */
export async function createCampaign(userId: Types.ObjectId, plan: PlanId, input: CreateCampaignInput): Promise<CampaignDTO> {
  const accounts = await resolveTargetAccounts(userId, input.accountIds);
  const contents: PreparedContent[] = [];
  for (const item of input.items) contents.push(await prepareContent(userId, item));
  const startAt = resolveStart(input.startAt === 'now' ? { mode: 'now' } : { mode: 'scheduled', at: input.startAt })!;
  await assertPendingCapacity(userId, plan, contents.length * accounts.length);

  const scheduleInput = {
    startAt,
    itemCount: contents.length,
    accountIds: accounts.map((a) => a._id.toString()),
    intervalMinutes: input.intervalMinutes,
    accountStaggerMinutes: input.accountStaggerMinutes,
  };
  const slots = planSchedule(scheduleInput);

  const campaign = await Campaign.create({
    userId,
    name: input.name,
    accountIds: accounts.map((a) => a._id),
    startAt,
    endsAt: scheduleEndsAt(scheduleInput),
    intervalMinutes: input.intervalMinutes,
    accountStaggerMinutes: input.accountStaggerMinutes,
  });

  try {
    const posts = await Post.insertMany(
      contents.map((c, i) => ({
        userId,
        campaignId: campaign._id,
        ...c,
        status: 'SCHEDULED',
        scheduledAt: new Date(startAt.getTime() + i * input.intervalMinutes * 60_000),
        accountIds: accounts.map((a) => a._id),
        accountStaggerMinutes: input.accountStaggerMinutes,
      })),
    );
    const typeByPost = new Map(posts.map((p) => [p._id.toString(), p.type]));
    await createJobs(
      userId,
      slots.map((s) => ({ postId: posts[s.itemIndex]!._id, accountId: new Types.ObjectId(s.accountId), runAt: s.runAt })),
      (postId) => typeByPost.get(postId)!,
      { campaignId: campaign._id, priority: PRIORITY.campaign },
    );
    await Campaign.updateOne({ userId, _id: campaign._id }, { $set: { postIds: posts.map((p) => p._id) } });
    for (const p of posts) await recomputePost(userId, p._id);
  } catch (err) {
    await Promise.all([
      PublishJob.deleteMany({ userId, campaignId: campaign._id }),
      Post.deleteMany({ userId, campaignId: campaign._id }),
      Campaign.deleteOne({ userId, _id: campaign._id }),
    ]);
    throw err;
  }
  return getCampaign(userId, campaign._id.toString());
}

async function getCampaignDoc(userId: Types.ObjectId, id: string): Promise<CampaignDoc> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Fila');
  const doc = await Campaign.findOne({ userId, _id: new Types.ObjectId(id) }).lean();
  if (!doc) throw notFound('Fila');
  return doc;
}

export async function getCampaign(userId: Types.ObjectId, id: string): Promise<CampaignDTO> {
  return toCampaignDTO(await getCampaignDoc(userId, id));
}

export async function listCampaigns(userId: Types.ObjectId, q: z.infer<typeof paginationSchema>): Promise<Paginated<CampaignDTO>> {
  const [items, total] = await Promise.all([
    Campaign.find({ userId }).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Campaign.countDocuments({ userId }),
  ]);
  return { items: items.map(toCampaignDTO), page: q.page, pageSize: q.pageSize, total };
}

async function postIdsOf(userId: Types.ObjectId, campaign: CampaignDoc): Promise<Types.ObjectId[]> {
  const posts = await Post.find({ userId, campaignId: campaign._id }).select('_id').lean<Pick<PostDoc, '_id'>[]>();
  return posts.map((p) => p._id);
}

/**
 * Pausar tira da fila só o que ainda está AGENDADO — o que já começou a
 * publicar termina. Retomar reagenda: horários que já passaram saem agora,
 * mantendo o espaçamento relativo entre eles.
 */
export async function pauseCampaign(userId: Types.ObjectId, id: string): Promise<CampaignDTO> {
  const campaign = await getCampaignDoc(userId, id);
  if (campaign.status !== 'ACTIVE') throw conflict('Só filas ativas podem ser pausadas.');
  await Campaign.updateOne({ userId, _id: campaign._id }, { $set: { pausedAt: new Date() } });
  const jobs = await PublishJob.find({ userId, campaignId: campaign._id, status: 'SCHEDULED' }).select('_id').lean();
  await Promise.all(jobs.map((j) => removeQueuedPublish(j._id)));
  await recomputeCampaign(userId, campaign._id);
  return getCampaign(userId, id);
}

export async function resumeCampaign(userId: Types.ObjectId, id: string): Promise<CampaignDTO> {
  const campaign = await getCampaignDoc(userId, id);
  if (campaign.status !== 'PAUSED') throw conflict('Esta fila não está pausada.');
  const jobs = await PublishJob.find({ userId, campaignId: campaign._id, status: 'SCHEDULED' }).sort({ runAt: 1 }).lean();
  const pausedFor = campaign.pausedAt ? Date.now() - campaign.pausedAt.getTime() : 0;
  for (const job of jobs) {
    // Empurra pelo tempo que ficou pausada: preserva o intervalo combinado.
    const runAt = new Date(Math.max(Date.now(), job.runAt.getTime() + pausedFor));
    await PublishJob.updateOne({ userId, _id: job._id }, { $set: { runAt }, $push: historyPush('SCHEDULED', 'Fila retomada') });
    await enqueuePublish(job._id, runAt, PRIORITY.campaign);
  }
  await Campaign.updateOne({ userId, _id: campaign._id }, { $set: { pausedAt: null } });
  await recomputeCampaign(userId, campaign._id);
  return getCampaign(userId, id);
}

export async function cancelCampaign(userId: Types.ObjectId, id: string): Promise<CampaignDTO> {
  const campaign = await getCampaignDoc(userId, id);
  const jobs = await PublishJob.find({ userId, campaignId: campaign._id, status: { $in: ['SCHEDULED', 'QUEUED'] } }).select('_id').lean();
  if (jobs.length) {
    await PublishJob.updateMany(
      { userId, _id: { $in: jobs.map((j) => j._id) }, status: { $in: ['SCHEDULED', 'QUEUED'] } },
      { $set: { status: 'CANCELED', finishedAt: new Date(), waitReason: null }, $push: historyPush('CANCELED', 'Fila cancelada') },
    );
    await Promise.all(jobs.map((j) => removeQueuedPublish(j._id)));
  }
  await Campaign.updateOne({ userId, _id: campaign._id }, { $set: { pausedAt: null } });
  for (const postId of await postIdsOf(userId, campaign)) await recomputePost(userId, postId);
  await recomputeCampaign(userId, campaign._id);
  return getCampaign(userId, id);
}

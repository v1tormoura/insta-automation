import { DelayedError, type Job } from 'bullmq';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { redis } from '../../src/infra/redis.js';
import { InstagramAccount } from '../../src/modules/accounts/account.model.js';
import { Notification } from '../../src/modules/notifications/notification.model.js';
import { PublishJob } from '../../src/modules/posts/job.model.js';
import { Post } from '../../src/modules/posts/post.model.js';
import { cancelJob, createPost } from '../../src/modules/posts/post.service.js';
import { createCampaign } from '../../src/modules/campaigns/campaign.service.js';
import { acquireAccountLock } from '../../src/queue/locks.js';
import type { PublishJobData } from '../../src/queue/queues.js';
import { runPublishJob } from '../../src/workers/publishRunner.js';
import { resetDatabases, startDatabases, stopDatabases } from '../helpers/db.js';
import { FakeMeta, metaError } from '../helpers/fakeMeta.js';
import { makeAccount, makeImageMedia, makeUser, makeVideoMedia } from '../helpers/factories.js';

beforeAll(startDatabases);
afterAll(stopDatabases);
beforeEach(resetDatabases);

/** Meta falsa com um "estado" de containers controlável por teste. */
function fakePublishingMeta() {
  const meta = new FakeMeta();
  let seq = 0;
  const statuses = new Map<string, string[]>();
  meta.on('POST', /\/v25\.0\/[^/]+\/media$/, () => {
    const id = `cont-${++seq}`;
    return { body: { id } };
  });
  meta.on('GET', /\/v25\.0\/cont-\d+$/, (call) => {
    const id = call.path.split('/').pop()!;
    const queue = statuses.get(id);
    const status = queue && queue.length > 1 ? queue.shift()! : queue?.[0] ?? 'FINISHED';
    return { body: { status_code: status, id } };
  });
  meta.on('POST', /\/v25\.0\/[^/]+\/media_publish$/, (call) => ({ body: { id: `media-${call.params.creation_id}` } }));
  meta.on('GET', /\/v25\.0\/media-cont-\d+$/, (call) => ({ body: { id: call.path.split('/').pop(), permalink: 'https://instagram.com/p/abc' } }));
  return { meta, statuses };
}

/** Executa o job como o BullMQ faria, até concluir (ou até `maxSteps`). */
async function drive(jobId: Types.ObjectId, meta: FakeMeta, maxSteps = 20) {
  const delays: number[] = [];
  const bullJob = {
    data: { publishJobId: jobId.toString() },
    moveToDelayed: async (ts: number) => {
      delays.push(ts - Date.now());
    },
  } as unknown as Job<PublishJobData>;
  for (let i = 0; i < maxSteps; i++) {
    try {
      await runPublishJob(bullJob, 'token', { redis: redis(), graph: meta.client() });
      return { delays, finished: true };
    } catch (err) {
      if (!(err instanceof DelayedError)) throw err;
    }
  }
  return { delays, finished: false };
}

const jobsOf = (userId: Types.ObjectId, postId: string) => PublishJob.find({ userId, postId: new Types.ObjectId(postId) }).sort({ runAt: 1 }).lean();

describe('publicação', () => {
  it('foto em duas contas: cria container com URL pública assinada, publica e consolida o post', async () => {
    const user = await makeUser();
    const [a, b] = [await makeAccount(user._id), await makeAccount(user._id)];
    const media = await makeImageMedia(user._id);
    const { meta } = fakePublishingMeta();

    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: 'Olá #mundo', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [a._id.toString(), b._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    expect(post.status).toBe('SCHEDULED');

    for (const job of await jobsOf(user._id, post.id)) expect((await drive(job._id, meta)).finished).toBe(true);

    const create = meta.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/media'));
    expect(create).toHaveLength(2);
    expect(create[0]!.params.caption).toBe('Olá #mundo');
    expect(create[0]!.params.image_url).toMatch(/^https:\/\/api\.test\.local\/public\/media\/[a-f\d]{24}\/original\/\d+\/[\w-]+\//);
    expect(create.map((c) => c.path)).toEqual([expect.stringContaining(a.igUserId), expect.stringContaining(b.igUserId)]);

    const jobs = await jobsOf(user._id, post.id);
    expect(jobs.map((j) => j.status)).toEqual(['PUBLISHED', 'PUBLISHED']);
    expect(jobs[0]!.permalink).toBe('https://instagram.com/p/abc');
    const saved = await Post.findOne({ userId: user._id, _id: new Types.ObjectId(post.id) }).lean();
    expect(saved).toMatchObject({ status: 'PUBLISHED', counts: { total: 2, published: 2 } });
    expect(await Notification.countDocuments({ userId: user._id, kind: 'post.completed' })).toBe(1);
  });

  it('reel: espera o processamento sem prender o worker e envia capa e share_to_feed', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const video = await makeVideoMedia(user._id, 30);
    const cover = await makeImageMedia(user._id, { width: 1080, height: 1920 });
    const { meta, statuses } = fakePublishingMeta();
    statuses.set('cont-1', ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']);

    const post = await createPost(user._id, user.plan, {
      content: { type: 'REEL', caption: 'reel', mediaIds: [video._id.toString()], cover: { mediaId: cover._id.toString() }, shareToFeed: false },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    const run = await drive(job!._id, meta);
    expect(run.finished).toBe(true);
    expect(run.delays.length).toBe(2); // duas esperas de processamento

    const create = meta.calls.find((c) => c.method === 'POST' && c.path.endsWith('/media'))!;
    expect(create.params).toMatchObject({ media_type: 'REELS', share_to_feed: 'false' });
    expect(create.params.cover_url).toContain(`/public/media/${cover._id}/original/`);
    expect(create.params.video_url).toContain(`/public/media/${video._id}/original/`);
    expect((await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean())!.status).toBe('PUBLISHED');
  });

  it('carrossel: cria os itens, espera todos processarem e só então cria o container pai', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const items = [await makeImageMedia(user._id), await makeImageMedia(user._id), await makeVideoMedia(user._id, 10)];
    const { meta, statuses } = fakePublishingMeta();
    statuses.set('cont-3', ['IN_PROGRESS', 'FINISHED']);

    const post = await createPost(user._id, user.plan, {
      content: { type: 'CAROUSEL', caption: 'carrossel', mediaIds: items.map((m) => m._id.toString()), shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    expect((await drive(job!._id, meta)).finished).toBe(true);

    const creates = meta.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/media'));
    expect(creates.slice(0, 3).every((c) => c.params.is_carousel_item === 'true')).toBe(true);
    expect(creates[2]!.params.media_type).toBe('VIDEO');
    expect(creates[3]!.params).toMatchObject({ media_type: 'CAROUSEL', children: 'cont-1,cont-2,cont-3', caption: 'carrossel' });
    expect(meta.count('POST', /media_publish$/)).toBe(1);
  });

  it('uma conta ocupada não bloqueia outra', async () => {
    const user = await makeUser();
    const [a, b] = [await makeAccount(user._id), await makeAccount(user._id)];
    const media = await makeImageMedia(user._id);
    const { meta } = fakePublishingMeta();
    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: '', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [a._id.toString(), b._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    // Outra publicação "em andamento" na conta A.
    await acquireAccountLock(redis(), a._id.toString(), 'outro-job', 60_000);

    const [jobA, jobB] = await jobsOf(user._id, post.id);
    const runA = await drive(jobA!._id, meta, 1);
    const runB = await drive(jobB!._id, meta);

    expect(runA.finished).toBe(false);
    const afterA = await PublishJob.findById(jobA!._id).setOptions({ crossTenant: true }).lean();
    expect(afterA).toMatchObject({ status: 'QUEUED', waitReason: expect.stringContaining('outra publicação desta conta') });
    expect(afterA!.attempts).toBe(0);
    expect(runB.finished).toBe(true);
    expect((await PublishJob.findById(jobB!._id).setOptions({ crossTenant: true }).lean())!.status).toBe('PUBLISHED');
  });

  it('respeita o limite de publicações simultâneas do plano', async () => {
    const user = await makeUser({ plan: 'free' }); // 2 simultâneas
    const accounts = [await makeAccount(user._id), await makeAccount(user._id), await makeAccount(user._id)];
    const video = await makeVideoMedia(user._id, 30);
    const { meta, statuses } = fakePublishingMeta();
    for (const id of ['cont-1', 'cont-2']) statuses.set(id, ['IN_PROGRESS']);
    const post = await createPost(user._id, user.plan, {
      content: { type: 'REEL', caption: '', mediaIds: [video._id.toString()], shareToFeed: true },
      accountIds: accounts.map((a) => a._id.toString()),
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const jobs = await jobsOf(user._id, post.id);
    await drive(jobs[0]!._id, meta, 1); // fica processando, segura a vaga
    await drive(jobs[1]!._id, meta, 1);
    await drive(jobs[2]!._id, meta, 1);
    const third = await PublishJob.findById(jobs[2]!._id).setOptions({ crossTenant: true }).lean();
    expect(third).toMatchObject({ status: 'QUEUED', waitReason: expect.stringContaining('até 2 contas ao mesmo tempo') });
    expect(meta.count('POST', /\/media$/)).toBe(2);
  });

  it('respeita o intervalo mínimo entre publicações da mesma conta', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id, { lastPublishedAt: new Date(), settings: { paused: false, minIntervalSeconds: 600 } });
    const media = await makeImageMedia(user._id);
    const { meta } = fakePublishingMeta();
    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: '', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    const run = await drive(job!._id, meta, 1);
    expect(run.delays[0]).toBeGreaterThan(590_000);
    expect(meta.count('POST', /\/media$/)).toBe(0);
  });

  it('token revogado: job falha sem retry, conta vira EXPIRED e o usuário é notificado', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const media = await makeImageMedia(user._id);
    const { meta } = fakePublishingMeta();
    meta.reply('POST', /\/media$/, metaError(190, 460, 'Error validating access token'), 400);
    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: '', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    expect((await drive(job!._id, meta)).finished).toBe(true);
    const failed = await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean();
    expect(failed).toMatchObject({ status: 'FAILED', error: { code: 'META_AUTH', retryable: false, metaCode: 190 } });
    expect((await InstagramAccount.findOne({ userId: user._id, _id: account._id }).lean())!.status).toBe('EXPIRED');
    expect(await Notification.countDocuments({ userId: user._id, kind: 'account.expired' })).toBe(1);
    expect(await Notification.countDocuments({ userId: user._id, kind: 'job.failed' })).toBe(1);
  });

  it('erro transitório: nova tentativa com backoff, depois publica', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const media = await makeImageMedia(user._id);
    const { meta } = fakePublishingMeta();
    let failures = 1;
    meta.on('POST', /\/media$/, () => (failures-- > 0 ? { status: 500, body: metaError(2, undefined, 'Service unavailable') } : undefined));
    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: '', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    const first = await drive(job!._id, meta, 1);
    expect(first.delays[0]).toBeGreaterThanOrEqual(60_000);
    const retrying = await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean();
    expect(retrying).toMatchObject({ status: 'QUEUED', attempts: 1, error: { retryable: true } });
    expect((await drive(job!._id, meta)).finished).toBe(true);
    expect((await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean())!.status).toBe('PUBLISHED');
  });

  it('rate limit da Meta: espera sem consumir tentativa', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const media = await makeImageMedia(user._id);
    const { meta } = fakePublishingMeta();
    meta.reply('POST', /\/media$/, metaError(4, undefined, 'Application request limit reached'), 400);
    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: '', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    await drive(job!._id, meta, 1);
    const waiting = await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean();
    expect(waiting).toMatchObject({ attempts: 0, rateLimitWaits: 1, waitReason: expect.stringContaining('Limite de chamadas') });
  });

  it('resposta do media_publish perdida: confere o container e não publica duas vezes', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const media = await makeImageMedia(user._id);
    const { meta, statuses } = fakePublishingMeta();
    meta.on('POST', /media_publish$/, () => {
      statuses.set('cont-1', ['PUBLISHED']);
      throw new Error('socket hang up');
    });
    meta.reply('GET', /\/v25\.0\/[^/]+\/media$/, { data: [{ id: 'media-real', caption: 'legenda', timestamp: new Date().toISOString() }] });
    meta.reply('GET', /\/v25\.0\/media-real$/, { id: 'media-real', permalink: 'https://instagram.com/p/real' });
    const post = await createPost(user._id, user.plan, {
      content: { type: 'IMAGE', caption: 'legenda', mediaIds: [media._id.toString()], shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    expect((await drive(job!._id, meta)).finished).toBe(true);
    const done = await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean();
    expect(done).toMatchObject({ status: 'PUBLISHED', igMediaId: 'media-real', permalink: 'https://instagram.com/p/real' });
    expect(meta.count('POST', /media_publish$/)).toBe(1);
  });

  it('cancelar durante o processamento interrompe antes do media_publish', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const video = await makeVideoMedia(user._id, 30);
    const { meta, statuses } = fakePublishingMeta();
    statuses.set('cont-1', ['IN_PROGRESS', 'FINISHED']);
    const post = await createPost(user._id, user.plan, {
      content: { type: 'REEL', caption: '', mediaIds: [video._id.toString()], shareToFeed: true },
      accountIds: [account._id.toString()],
      schedule: { mode: 'now' },
      accountStaggerMinutes: 0,
    });
    const [job] = await jobsOf(user._id, post.id);
    await drive(job!._id, meta, 1);
    await cancelJob(user._id, job!._id.toString());
    await drive(job!._id, meta);
    expect(meta.count('POST', /media_publish$/)).toBe(0);
    expect((await PublishJob.findById(job!._id).setOptions({ crossTenant: true }).lean())!.status).toBe('CANCELED');
    expect((await Post.findOne({ userId: user._id, _id: new Types.ObjectId(post.id) }).lean())!.status).toBe('CANCELED');
  });

  it('valida mídia contra o tipo antes de enfileirar', async () => {
    const user = await makeUser();
    const account = await makeAccount(user._id);
    const wide = await makeImageMedia(user._id, { width: 3000, height: 1000 });
    const video = await makeVideoMedia(user._id, 120);
    const base = { accountIds: [account._id.toString()], schedule: { mode: 'now' as const }, accountStaggerMinutes: 0 };
    await expect(
      createPost(user._id, user.plan, { ...base, content: { type: 'IMAGE', caption: '', mediaIds: [wide._id.toString()], shareToFeed: true } }),
    ).rejects.toThrow(/proporção/);
    await expect(
      createPost(user._id, user.plan, { ...base, content: { type: 'STORY', caption: '', mediaIds: [video._id.toString()], shareToFeed: true } }),
    ).rejects.toThrow(/entre 3s e 60s/);
    await expect(
      createPost(user._id, user.plan, { ...base, content: { type: 'REEL', caption: '', mediaIds: [wide._id.toString()], shareToFeed: true } }),
    ).rejects.toThrow(/não aceita imagem/);
    expect(await PublishJob.countDocuments({ userId: user._id })).toBe(0);
  });
});

describe('filas (campanhas)', () => {
  it('distribui N conteúdos × M contas com intervalo e espaçamento', async () => {
    const user = await makeUser();
    const [a, b] = [await makeAccount(user._id), await makeAccount(user._id)];
    const media = [await makeImageMedia(user._id), await makeImageMedia(user._id), await makeImageMedia(user._id)];
    const startAt = new Date(Date.now() + 3600_000);
    const campaign = await createCampaign(user._id, user.plan, {
      name: 'Semana',
      accountIds: [a._id.toString(), b._id.toString()],
      items: media.map((m) => ({ type: 'IMAGE' as const, caption: 'x', mediaIds: [m._id.toString()], shareToFeed: true })),
      startAt,
      intervalMinutes: 60,
      accountStaggerMinutes: 5,
    });
    expect(campaign.counts).toMatchObject({ total: 6, pending: 6 });
    expect(new Date(campaign.endsAt).getTime() - startAt.getTime()).toBe((120 + 5) * 60_000);
    const jobs = await PublishJob.find({ userId: user._id, accountId: b._id }).sort({ runAt: 1 }).lean();
    expect(jobs.map((j) => (j.runAt.getTime() - startAt.getTime()) / 60_000)).toEqual([5, 65, 125]);
  });
});

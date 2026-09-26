import { Worker } from 'bullmq';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bullConnection, redis } from '../../src/infra/redis.js';
import { PublishJob } from '../../src/modules/posts/job.model.js';
import type { RealtimeHub } from '../../src/modules/realtime/events.js';
import { QUEUE_NAMES, getPublishQueue, type PublishJobData } from '../../src/queue/queues.js';
import { recoverStuckJobs } from '../../src/workers/maintenance.js';
import { runPublishJob } from '../../src/workers/publishRunner.js';
import { resetDatabases, startDatabases, stopDatabases } from '../helpers/db.js';
import { FakeMeta } from '../helpers/fakeMeta.js';
import { makeAccount, makeImageMedia } from '../helpers/factories.js';
import { makeApp, signedInAgent } from '../helpers/http.js';

let app: Awaited<ReturnType<typeof makeApp>>['app'];
let hub: RealtimeHub;
let worker: Worker<PublishJobData> | undefined;

const meta = new FakeMeta()
  .reply('POST', /\/media$/, { id: 'cont-1' })
  .reply('GET', /\/cont-1$/, { status_code: 'FINISHED' })
  .reply('POST', /media_publish$/, { id: 'm-1' })
  .reply('GET', /\/m-1$/, { id: 'm-1', permalink: 'https://instagram.com/p/m1' });

beforeAll(async () => {
  await startDatabases();
  ({ app, hub } = await makeApp());
});
afterAll(async () => {
  await worker?.close();
  await hub.stop();
  await stopDatabases();
});
beforeEach(async () => {
  await worker?.close();
  worker = undefined;
  await getPublishQueue().obliterate({ force: true });
  await resetDatabases();
});

function startWorker() {
  worker = new Worker<PublishJobData>(QUEUE_NAMES.publish, (job, token) => runPublishJob(job, token, { redis: redis(), graph: meta.client() }), {
    connection: bullConnection(),
    concurrency: 5,
  });
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('fila real (BullMQ + Redis)', () => {
  it('post criado pela API é publicado pelo worker e aparece no histórico', async () => {
    const { agent, user } = await signedInAgent(app);
    const userId = new Types.ObjectId(user.id);
    const account = await makeAccount(userId);
    const media = await makeImageMedia(userId);
    startWorker();

    const res = await agent
      .post('/api/posts')
      .set('x-nexora-client', 'web')
      .send({ content: { type: 'IMAGE', caption: 'e2e', mediaIds: [media._id.toString()] }, accountIds: [account._id.toString()], schedule: { mode: 'now' } });
    expect(res.status).toBe(201);

    const job = await waitFor(
      () => PublishJob.findOne({ userId, postId: new Types.ObjectId(res.body.post.id) }).lean(),
      (j) => j?.status === 'PUBLISHED',
    );
    expect(job).toMatchObject({ status: 'PUBLISHED', igMediaId: 'm-1', permalink: 'https://instagram.com/p/m1' });

    const history = await agent.get('/api/posts?status=PUBLISHED');
    expect(history.body.items).toHaveLength(1);
    const dashboard = await agent.get('/api/dashboard');
    expect(dashboard.body.dashboard.jobs.publishedToday).toBe(1);
  });

  it('varredura de recuperação recoloca na fila um job vencido que sumiu do Redis', async () => {
    const { agent, user } = await signedInAgent(app);
    const userId = new Types.ObjectId(user.id);
    const account = await makeAccount(userId);
    const media = await makeImageMedia(userId);
    const res = await agent
      .post('/api/posts')
      .set('x-nexora-client', 'web')
      .send({ content: { type: 'IMAGE', caption: 'x', mediaIds: [media._id.toString()] }, accountIds: [account._id.toString()], schedule: { mode: 'now' } });
    const postId = new Types.ObjectId(res.body.post.id);

    // Simula perda do Redis: o job some da fila e o horário já passou.
    await getPublishQueue().obliterate({ force: true });
    await PublishJob.updateMany({ userId, postId }, { $set: { runAt: new Date(Date.now() - 5 * 60_000) } });

    expect(await recoverStuckJobs()).toBe(1);
    startWorker();
    const job = await waitFor(() => PublishJob.findOne({ userId, postId }).lean(), (j) => j?.status === 'PUBLISHED');
    expect(job!.status).toBe('PUBLISHED');
  });
});

process.env.NEXORA_PROCESS ??= 'worker';

import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo, syncIndexes } from './infra/mongo.js';
import { bullConnection, closeRedis, redis } from './infra/redis.js';
import { logger } from './lib/logger.js';
import { metaGraph } from './integrations/meta/index.js';
import { QUEUE_NAMES, closeQueues, type MaintenanceJobName, type PublishJobData, type SyncJobData, type SyncJobName } from './queue/queues.js';
import { registerSchedules, runMaintenance } from './workers/maintenance.js';
import { runPublishJob } from './workers/publishRunner.js';
import { syncProcessor } from './workers/sync.js';

/**
 * Processo de workers. Pode rodar em várias réplicas: o isolamento por conta
 * e o limite por cliente vivem no Redis, não na memória deste processo.
 */
async function main() {
  await connectMongo();
  await syncIndexes();
  const graph = metaGraph();
  const deps = { redis: redis(), graph };

  const publish = new Worker<PublishJobData>(QUEUE_NAMES.publish, (job, token) => runPublishJob(job, token, deps), {
    connection: bullConnection(),
    concurrency: env.PUBLISH_WORKER_CONCURRENCY,
    lockDuration: 120_000,
  });
  const sync = new Worker<SyncJobData, unknown, SyncJobName>(QUEUE_NAMES.sync, syncProcessor(graph), {
    connection: bullConnection(),
    concurrency: env.SYNC_WORKER_CONCURRENCY,
    // Protege o rate limit da Meta na sincronização em massa.
    limiter: { max: 20, duration: 1_000 },
  });
  const maintenance = new Worker<Record<string, never>, unknown, MaintenanceJobName>(
    QUEUE_NAMES.maintenance,
    (job) => runMaintenance(job.name),
    { connection: bullConnection(), concurrency: 1 },
  );

  for (const w of [publish, sync, maintenance]) {
    w.on('failed', (job, err) => logger.warn({ queue: w.name, jobId: job?.id, name: job?.name, err }, 'worker: job falhou'));
    w.on('error', (err) => logger.error({ queue: w.name, err }, 'worker: erro'));
  }

  await registerSchedules();
  await runMaintenance('sweep.recovery');
  logger.info({ publishConcurrency: env.PUBLISH_WORKER_CONCURRENCY }, 'workers prontos');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'workers encerrando (terminando jobs em andamento)');
    await Promise.allSettled([publish.close(), sync.close(), maintenance.close()]);
    await closeQueues();
    await closeRedis();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar os workers');
  process.exit(1);
});

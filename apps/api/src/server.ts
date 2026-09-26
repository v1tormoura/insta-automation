process.env.NEXORA_PROCESS ??= 'api';

import { mkdir } from 'node:fs/promises';
import { env } from './config/env.js';
import { createApp } from './http/app.js';
import { connectMongo, disconnectMongo, syncIndexes } from './infra/mongo.js';
import { closeRedis } from './infra/redis.js';
import { logger } from './lib/logger.js';
import { RealtimeHub } from './modules/realtime/events.js';
import { closeQueues } from './queue/queues.js';

async function main() {
  await connectMongo();
  await syncIndexes();
  await mkdir(env.STORAGE_DIR, { recursive: true });

  const hub = new RealtimeHub();
  await hub.start();

  const server = createApp({ hub }).listen(env.PORT, () => {
    logger.info({ port: env.PORT, graph: env.META_GRAPH_VERSION }, 'api pronta');
  });
  // SSE mantém conexões longas; o timeout padrão de 5 min as derrubaria.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'api encerrando');
    server.close();
    server.closeAllConnections();
    await hub.stop();
    await closeQueues();
    await closeRedis();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar a api');
  process.exit(1);
});

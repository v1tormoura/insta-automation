import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Conexões Redis. BullMQ exige `maxRetriesPerRequest: null` nas conexões de
 * worker (comandos bloqueantes); as demais usam o padrão.
 */
const clients = new Set<Redis>();

export function createRedis(opts: RedisOptions = {}, url = env.REDIS_URL): Redis {
  const client = new Redis(url, { lazyConnect: false, ...opts });
  client.on('error', (err) => logger.warn({ err }, 'redis: erro de conexão'));
  clients.add(client);
  client.once('end', () => clients.delete(client));
  return client;
}

let shared: Redis | undefined;
export function redis(): Redis {
  shared ??= createRedis();
  return shared;
}

let bull: Redis | undefined;
export function bullConnection(): Redis {
  bull ??= createRedis({ maxRetriesPerRequest: null });
  return bull;
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([...clients].map((c) => c.quit()));
  shared = undefined;
  bull = undefined;
}

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { closeRedis, redis } from '../../src/infra/redis.js';
import { closeQueues } from '../../src/queue/queues.js';

let mongod: MongoMemoryServer | undefined;

/**
 * Mongo real (mongodb-memory-server) + Redis real. Em ambientes sem acesso ao
 * download de binários, aponte MONGOMS_SYSTEM_BINARY para um `mongod` local.
 */
export async function startDatabases(): Promise<void> {
  mongod = await MongoMemoryServer.create(
    process.env.MONGOMS_SYSTEM_BINARY ? { binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } } : {},
  );
  await mongoose.connect(mongod.getUri('nexora-test'));
  for (const model of Object.values(mongoose.models)) await model.syncIndexes();
  await redis().flushdb();
}

export async function resetDatabases(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  await redis().flushdb();
}

export async function stopDatabases(): Promise<void> {
  await closeQueues();
  await closeRedis();
  await mongoose.disconnect();
  await mongod?.stop();
}

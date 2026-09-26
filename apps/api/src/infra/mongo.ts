import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

mongoose.set('strictQuery', true);
// Índices são criados pela aplicação no boot (syncIndexes), não a cada model.
mongoose.set('autoIndex', false);

export async function connectMongo(uri = env.MONGO_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 });
  logger.info({ db: conn.connection.name }, 'mongo conectado');
  return conn;
}

export async function syncIndexes(): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

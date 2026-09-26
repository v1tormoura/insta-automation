import { Router } from 'express';
import mongoose from 'mongoose';
import { isMetaConfigured } from '../../config/env.js';
import { redis } from '../../infra/redis.js';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/ready', async (_req, res) => {
    const checks = {
      mongo: mongoose.connection.readyState === 1,
      redis: await redis()
        .ping()
        .then((r) => r === 'PONG')
        .catch(() => false),
      metaConfigured: isMetaConfigured(),
    };
    res.status(checks.mongo && checks.redis ? 200 : 503).json(checks);
  });

  return router;
}

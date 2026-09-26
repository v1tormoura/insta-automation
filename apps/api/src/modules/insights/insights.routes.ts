import { insightRangeQuerySchema, objectIdSchema } from '@nexora/shared';
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../http/middleware/auth.js';
import { parse } from '../../http/validate.js';
import { getAccountInsights, listMediaInsights, refreshAccountInsights } from './insights.service.js';

const mediaQuery = z.object({
  accountId: objectIdSchema.optional(),
  sort: z.enum(['recent', 'views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions']).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export function insightsRoutes(): Router {
  const router = Router();

  router.get('/accounts/:id', async (req, res) => {
    const { range } = parse(insightRangeQuerySchema, req.query);
    res.json({ insights: await getAccountInsights(auth(req).userId, req.params.id, range) });
  });

  router.post('/accounts/:id/refresh', async (req, res) => {
    await refreshAccountInsights(auth(req).userId, req.params.id);
    res.status(202).json({ ok: true });
  });

  router.get('/media', async (req, res) => {
    res.json({ items: await listMediaInsights(auth(req).userId, parse(mediaQuery, req.query)) });
  });

  return router;
}

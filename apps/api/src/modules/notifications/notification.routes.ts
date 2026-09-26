import { markNotificationsSchema, paginationSchema } from '@nexora/shared';
import { Router } from 'express';
import { auth } from '../../http/middleware/auth.js';
import { parse } from '../../http/validate.js';
import { listNotifications, markRead } from './notification.service.js';

export function notificationRoutes(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const { page, pageSize } = parse(paginationSchema, req.query);
    res.json(await listNotifications(auth(req).userId, page, pageSize));
  });

  router.post('/read', async (req, res) => {
    const updated = await markRead(auth(req).userId, parse(markNotificationsSchema, req.body));
    res.json({ updated });
  });

  return router;
}

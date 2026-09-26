import { Router } from 'express';
import { auth } from '../../http/middleware/auth.js';
import { getDashboard } from './dashboard.service.js';

export function dashboardRoutes(): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const { userId, user } = auth(req);
    res.json({ dashboard: await getDashboard(userId, user.timezone) });
  });
  return router;
}

import { accountSettingsSchema } from '@nexora/shared';
import { Router } from 'express';
import { auth } from '../../http/middleware/auth.js';
import { parse } from '../../http/validate.js';
import * as service from './account.service.js';

export function accountRoutes(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ items: await service.listAccounts(auth(req).userId) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ account: service.toAccountDTO(await service.getAccountOrThrow(auth(req).userId, req.params.id)) });
  });

  router.post('/:id/sync', async (req, res) => {
    res.status(202).json({ account: await service.requestSync(auth(req).userId, req.params.id) });
  });

  router.patch('/:id/settings', async (req, res) => {
    const account = await service.updateSettings(auth(req).userId, req.params.id, parse(accountSettingsSchema, req.body));
    res.json({ account });
  });

  router.delete('/:id', async (req, res) => {
    res.json(await service.disconnectAccount(auth(req).userId, req.params.id));
  });

  return router;
}

import { createCampaignSchema, paginationSchema } from '@nexora/shared';
import { Router } from 'express';
import { auth } from '../../http/middleware/auth.js';
import { parse } from '../../http/validate.js';
import * as service from './campaign.service.js';

export function campaignRoutes(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await service.listCampaigns(auth(req).userId, parse(paginationSchema, req.query)));
  });

  router.post('/', async (req, res) => {
    const { userId, user } = auth(req);
    res.status(201).json({ campaign: await service.createCampaign(userId, user.plan, parse(createCampaignSchema, req.body)) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ campaign: await service.getCampaign(auth(req).userId, req.params.id) });
  });

  router.post('/:id/pause', async (req, res) => {
    res.json({ campaign: await service.pauseCampaign(auth(req).userId, req.params.id) });
  });

  router.post('/:id/resume', async (req, res) => {
    res.json({ campaign: await service.resumeCampaign(auth(req).userId, req.params.id) });
  });

  router.post('/:id/cancel', async (req, res) => {
    res.json({ campaign: await service.cancelCampaign(auth(req).userId, req.params.id) });
  });

  return router;
}

import { createPostSchema, listJobsQuerySchema, listPostsQuerySchema } from '@nexora/shared';
import { Router } from 'express';
import { auth } from '../../http/middleware/auth.js';
import { parse } from '../../http/validate.js';
import * as service from './post.service.js';

const submitSchema = createPostSchema.pick({ accountIds: true, schedule: true, accountStaggerMinutes: true });

export function postRoutes(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await service.listPosts(auth(req).userId, parse(listPostsQuerySchema, req.query)));
  });

  router.post('/', async (req, res) => {
    const { userId, user } = auth(req);
    res.status(201).json({ post: await service.createPost(userId, user.plan, parse(createPostSchema, req.body)) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ post: await service.getPost(auth(req).userId, req.params.id) });
  });

  router.post('/:id/submit', async (req, res) => {
    const { userId, user } = auth(req);
    res.json({ post: await service.submitDraft(userId, user.plan, req.params.id, parse(submitSchema, req.body)) });
  });

  router.post('/:id/cancel', async (req, res) => {
    res.json({ post: await service.cancelPost(auth(req).userId, req.params.id) });
  });

  router.delete('/:id', async (req, res) => {
    await service.deletePost(auth(req).userId, req.params.id);
    res.status(204).end();
  });

  return router;
}

export function jobRoutes(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await service.listJobs(auth(req).userId, parse(listJobsQuerySchema, req.query)));
  });

  router.post('/:id/cancel', async (req, res) => {
    res.json({ job: await service.cancelJob(auth(req).userId, req.params.id) });
  });

  router.post('/:id/retry', async (req, res) => {
    const { userId, user } = auth(req);
    res.json({ job: await service.retryJob(userId, user.plan, req.params.id) });
  });

  router.post('/:id/run-now', async (req, res) => {
    res.json({ job: await service.runJobNow(auth(req).userId, req.params.id) });
  });

  return router;
}

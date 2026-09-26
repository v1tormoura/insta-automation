import { Router, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { auth, requireAuth, resolveSession } from '../../http/middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { handleDataDeletion, handleDeauthorize, handleInstagramCallback, startInstagramOAuth } from './oauth.service.js';

function appRedirect(res: Response, params: Record<string, string>): void {
  const url = new URL('/accounts', env.APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.redirect(303, url.toString());
}

export function oauthRoutes(): Router {
  const router = Router();

  // Inicia o fluxo: o frontend recebe a URL e navega até ela.
  router.post('/instagram/start', requireAuth, async (req, res) => {
    res.json(await startInstagramOAuth(auth(req).userId));
  });

  // A Meta redireciona o navegador para cá.
  router.get('/instagram/callback', async (req: Request, res: Response) => {
    await resolveSession(req);
    const q = req.query as Record<string, string | undefined>;
    const result = await handleInstagramCallback({
      state: typeof q.state === 'string' ? q.state : undefined,
      code: typeof q.code === 'string' ? q.code : undefined,
      error: typeof q.error === 'string' ? q.error : undefined,
      sessionUserId: req.auth?.userId,
    });
    res.set('Cache-Control', 'no-store');
    if (result.ok) appRedirect(res, { connected: result.username });
    else appRedirect(res, { oauth_error: result.error });
  });

  // Chamados pelos servidores da Meta (sem cookie). Autenticados pelo signed_request.
  router.post('/instagram/deauthorize', async (req, res) => {
    const signed = String(req.body?.signed_request ?? '');
    if (!(await handleDeauthorize(signed))) throw new AppError('VALIDATION_ERROR', 'signed_request inválido', 400);
    res.json({ ok: true });
  });

  router.post('/instagram/data-deletion', async (req, res) => {
    const signed = String(req.body?.signed_request ?? '');
    const result = await handleDataDeletion(signed);
    if (!result) throw new AppError('VALIDATION_ERROR', 'signed_request inválido', 400);
    res.json(result);
  });

  return router;
}

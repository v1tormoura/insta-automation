import { loginSchema, signupSchema, updateProfileSchema } from '@nexora/shared';
import { Router, type CookieOptions, type Request, type Response } from 'express';
import { isProduction } from '../../config/env.js';
import { SESSION_COOKIE, auth, requireAuth } from '../../http/middleware/auth.js';
import { authLimiter } from '../../http/middleware/rateLimit.js';
import { parse } from '../../http/validate.js';
import * as service from './auth.service.js';

const cookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
  ...(expires ? { expires } : {}),
});

function meta(req: Request) {
  return { userAgent: req.get('user-agent'), ip: req.ip };
}

function setSession(res: Response, session: service.IssuedSession) {
  res.cookie(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt));
}

export function authRoutes(): Router {
  const router = Router();
  const limiter = authLimiter();

  router.post('/signup', limiter, async (req, res) => {
    const { user, session } = await service.signup(parse(signupSchema, req.body), meta(req));
    setSession(res, session);
    res.status(201).json({ user: service.toUserDTO(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const { user, session } = await service.login(parse(loginSchema, req.body), meta(req));
    setSession(res, session);
    res.json({ user: service.toUserDTO(user) });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    await service.logout(auth(req).sessionId);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  });

  router.post('/logout-all', requireAuth, async (req, res) => {
    await service.logoutEverywhere(auth(req).userId);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: service.toUserDTO(auth(req).user) });
  });

  router.patch('/me', requireAuth, async (req, res) => {
    const user = await service.updateProfile(auth(req).userId, parse(updateProfileSchema, req.body));
    res.json({ user: service.toUserDTO(user) });
  });

  return router;
}

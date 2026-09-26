import cookieParser from 'cookie-parser';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { accountRoutes } from '../modules/accounts/account.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { campaignRoutes } from '../modules/campaigns/campaign.routes.js';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes.js';
import { healthRoutes } from '../modules/health/health.routes.js';
import { insightsRoutes } from '../modules/insights/insights.routes.js';
import { mediaRoutes, publicMediaRoutes } from '../modules/media/media.routes.js';
import { notificationRoutes } from '../modules/notifications/notification.routes.js';
import { oauthRoutes } from '../modules/oauth/oauth.routes.js';
import { jobRoutes, postRoutes } from '../modules/posts/post.routes.js';
import type { RealtimeHub } from '../modules/realtime/events.js';
import { sseRoutes } from '../modules/realtime/sse.routes.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { sameOrigin } from './middleware/sameOrigin.js';

export interface AppDeps {
  hub: RealtimeHub;
}

export function createApp({ hub }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url?.startsWith('/public/media') === true },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      // Nunca logar query string: o callback do OAuth traz `code` e `state`.
      serializers: { req: (req: { method: string; url: string; id: unknown }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }) },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  // Callbacks de plataforma da Meta chegam como form-urlencoded.
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // Pública e assinada: é daqui que a Meta baixa as mídias.
  app.use('/public/media', publicMediaRoutes());

  const api = Router();
  api.use('/health', healthRoutes());
  api.use('/oauth', oauthRoutes());
  api.use(sameOrigin);
  api.use('/auth', authRoutes());

  const authed = Router();
  authed.use(requireAuth, apiLimiter());
  authed.use('/accounts', accountRoutes());
  authed.use('/media', mediaRoutes());
  authed.use('/posts', postRoutes());
  authed.use('/jobs', jobRoutes());
  authed.use('/campaigns', campaignRoutes());
  authed.use('/insights', insightsRoutes());
  authed.use('/notifications', notificationRoutes());
  authed.use('/dashboard', dashboardRoutes());
  api.use('/events', sseRoutes(hub));
  api.use(authed);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

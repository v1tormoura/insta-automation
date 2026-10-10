import fs from 'node:fs';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import type { AppConfig } from './config';
import { HistoryService, type AppContext } from './context';
import { Database } from './db/database';
import { Repositories } from './db/repositories';
import { PlanError } from './media/pipeline/plan';
import { MediaTools } from './media/tools';
import { JobQueue } from './queue/jobQueue';
import { JobRunner } from './queue/jobRunner';
import { assetRoutes } from './routes/assetRoutes';
import type { Deps } from './routes/deps';
import { jobRoutes } from './routes/jobRoutes';
import { profileRoutes } from './routes/profileRoutes';
import { sessionRoutes } from './routes/sessionRoutes';
import { PathEscapeError } from './security/paths';
import { HttpError, SessionManager } from './security/session';
import { BatchError, BatchService } from './services/batchService';
import { CleanupService } from './services/cleanupService';
import { EventHub } from './services/events';
import { ExportError, ExportService } from './services/exportService';
import { ImportService } from './services/importService';
import { PreviewBusyError, PreviewService } from './services/previewService';
import { Storage } from './services/storage';

z.config(z.locales.ptBR());

export interface MediaForgeApp {
  app: FastifyInstance;
  ctx: AppContext;
  deps: Deps;
  /** Detecta FFmpeg, recupera a fila e inicia os serviços de fundo. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(config: AppConfig, opts: { tools?: MediaTools; logger?: boolean } = {}): Promise<MediaForgeApp> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
          },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });

  const db = new Database(config.dbFile);
  const repos = new Repositories(db);
  const events = new EventHub();
  const tools = opts.tools ?? new MediaTools(config.ffmpegPath, config.ffprobePath);
  const ctx = {
    config,
    db,
    repos,
    log: app.log,
    tools,
    storage: new Storage(config.sessionsDir),
    events,
    history: new HistoryService(repos, events),
  } as AppContext;
  ctx.queue = new JobQueue(ctx, new JobRunner(ctx));

  const deps: Deps = {
    ctx,
    sessions: new SessionManager(ctx),
    imports: new ImportService(ctx),
    batches: new BatchService(ctx),
    exports: new ExportService(ctx),
    previews: new PreviewService(ctx),
    cleanup: new CleanupService(ctx),
  };

  await app.register(cookie);
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: config.limits.maxUploadBytes,
      files: config.limits.maxFilesPerUpload,
      fields: 20,
      parts: config.limits.maxFilesPerUpload + 20,
      fieldSize: 64 * 1024,
    },
  });

  const serveWeb = config.serveWeb && fs.existsSync(`${config.webDist}/index.html`);
  await app.register(fastifyStatic, {
    root: serveWeb ? config.webDist : config.dataDir,
    serve: serveWeb,
    wildcard: false,
    index: serveWeb ? ['index.html'] : false,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) reply.header('Content-Security-Policy', CSP);
    return payload;
  });

  // Proteção contra requisições de outros sites (CSRF): a origem precisa ser este servidor.
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (!origin) return;
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'bad-origin', 'Origem da requisição inválida.');
    }
    if (host !== req.headers.host) throw new HttpError(403, 'bad-origin', 'Requisição de outra origem recusada.');
  });

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      reply.code(status).send({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
    if (err instanceof HttpError) return send(err.status, err.code, err.message, err.details);
    if (err instanceof ZodError) {
      return send(400, 'invalid-request', 'Dados inválidos.', err.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`));
    }
    if (err instanceof PlanError) return send(422, 'invalid-settings', err.messages.join(' '), err.messages);
    if (err instanceof BatchError) return send(422, 'invalid-batch', 'Há configurações inválidas; nenhuma tarefa foi criada.', err.errors);
    if (err instanceof ExportError) return send(409, 'export-failed', err.message, err.details);
    if (err instanceof PreviewBusyError) return send(429, 'preview-busy', err.message);
    if (err instanceof PathEscapeError) return send(400, 'invalid-path', err.message);
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_FILES_LIMIT') return send(413, 'too-many-files', `Máximo de ${config.limits.maxFilesPerUpload} arquivos por envio.`);
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return send(413, 'file-too-large', `Arquivo excede ${config.limits.maxUploadMb} MB.`);
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return send(e.statusCode, e.code ?? 'bad-request', e.message ?? 'Requisição inválida.');
    req.log.error({ err: e.message, url: req.url }, 'erro interno');
    return send(500, 'internal', 'Erro interno. Consulte os logs do servidor.');
  });

  for (const register of [sessionRoutes, assetRoutes, jobRoutes, profileRoutes]) await register(app, deps);

  app.setNotFoundHandler((req, reply) => {
    if (serveWeb && req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: { code: 'not-found', message: 'Rota não encontrada.' } });
  });

  let started = false;
  return {
    app,
    ctx,
    deps,
    async start() {
      await tools.detect();
      if (!tools.ready) app.log.error({ ffmpeg: tools.ffmpeg.error, ffprobe: tools.ffprobe.error }, 'FFmpeg/FFprobe indisponíveis');
      else app.log.info({ ffmpeg: tools.ffmpeg.version, capabilities: tools.capabilities }, 'FFmpeg detectado');
      await deps.cleanup.run();
      ctx.queue.start();
      deps.cleanup.start();
      started = true;
    },
    async stop() {
      deps.cleanup.stop();
      if (started) await ctx.queue.stop();
      await app.close();
      db.close();
    },
  };
}

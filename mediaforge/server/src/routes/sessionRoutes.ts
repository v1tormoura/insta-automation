import os from 'node:os';
import { EDITORIAL_PRESETS, EXPORT_PROFILES, METADATA_PRESETS, type SessionDTO, type SystemInfoDTO } from '@mediaforge/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, safeEqual } from '../security/session';
import { historyToDTO } from '../services/dto';
import { session, type Deps } from './deps';

export const APP_VERSION = '1.0.0';

export async function sessionRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  const sessionDTO = async (id: string): Promise<SessionDTO> => {
    const row = ctx.repos.sessionById(id)!;
    const jobs = ctx.repos.jobs(id);
    return {
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.last_seen_at + ctx.config.sessionTtlMs,
      storageBytes: await ctx.storage.sessionSize(id),
      counts: { assets: ctx.repos.countAssets(id), jobs: jobs.length, completed: jobs.filter((j) => j.status === 'completed').length },
      requiresAccessKey: !!ctx.config.accessKey,
    };
  };

  app.get('/api/health', async () => ({ ok: true, ffmpeg: ctx.tools.ffmpeg.available, ffprobe: ctx.tools.ffprobe.available }));

  app.get('/api/session', async (req, reply) => {
    const s = await session(deps, req, reply);
    return sessionDTO(s.id);
  });

  /** Inicia uma sessão (com chave de acesso, quando configurada). */
  app.post('/api/session', async (req, reply) => {
    const body = z.object({ accessKey: z.string().max(500).optional() }).parse(req.body ?? {});
    if (ctx.config.accessKey && !safeEqual(body.accessKey ?? '', ctx.config.accessKey)) {
      throw new HttpError(401, 'auth-failed', 'Chave de acesso incorreta.');
    }
    const existing = deps.sessions.current(req);
    if (existing) return sessionDTO(existing.id);
    const s = await deps.sessions.create(reply);
    return sessionDTO(s.id);
  });

  /** Encerra a sessão: cancela tarefas, apaga arquivos e registros, e abre uma nova. */
  app.delete('/api/session', async (req, reply) => {
    const s = deps.sessions.current(req);
    if (s) {
      await deps.cleanup.removeSession(s.id);
      ctx.events.publish(s.id, { type: 'session-reset' });
      ctx.log.info({ sessionId: s.id }, 'sessão encerrada pelo usuário');
    }
    if (ctx.config.accessKey) {
      reply.clearCookie('mf_session', { path: '/' });
      return { ok: true };
    }
    const n = await deps.sessions.create(reply);
    return sessionDTO(n.id);
  });

  app.get('/api/system', async (req, reply) => {
    await session(deps, req, reply);
    const l = ctx.config.limits;
    const info: SystemInfoDTO = {
      app: { name: 'MediaForge', version: APP_VERSION },
      ffmpeg: ctx.tools.ffmpeg,
      ffprobe: ctx.tools.ffprobe,
      capabilities: ctx.tools.capabilities,
      limits: {
        maxUploadMb: l.maxUploadMb,
        maxFilesPerUpload: l.maxFilesPerUpload,
        maxDurationSec: l.maxDurationSec,
        maxResolution: l.maxResolution,
        maxJobsPerSession: l.maxJobsPerSession,
        jobTimeoutSec: Math.round(ctx.config.queue.jobTimeoutMs / 1000),
        sessionTtlHours: ctx.config.sessionTtlMs / 3600_000,
        previewMaxSeconds: l.previewMaxSeconds,
      },
      queue: ctx.queue.stats(),
      platform: `${os.platform()} ${os.arch()} · Node ${process.versions.node}`,
    };
    return info;
  });

  app.put('/api/system/concurrency', async (req, reply) => {
    const s = await session(deps, req, reply);
    const { value } = z.object({ value: z.number().int().min(1).max(64) }).parse(req.body);
    const applied = ctx.queue.setConcurrency(value);
    ctx.history.add(s.id, 'system', 'info', `Processamento simultâneo ajustado para ${applied}`);
    return ctx.queue.stats();
  });

  app.get('/api/presets', async () => ({
    exportProfiles: EXPORT_PROFILES,
    editorialPresets: EDITORIAL_PRESETS,
    metadataPresets: METADATA_PRESETS,
  }));

  app.get('/api/history', async (req, reply) => {
    const s = await session(deps, req, reply);
    return ctx.repos.history(s.id).map(historyToDTO);
  });

  /** Eventos em tempo real (Server-Sent Events). */
  app.get('/api/events', async (req, reply) => {
    const s = await session(deps, req, reply);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'queue', queue: ctx.queue.stats() });
    const unsubscribe = ctx.events.subscribe(s.id, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}

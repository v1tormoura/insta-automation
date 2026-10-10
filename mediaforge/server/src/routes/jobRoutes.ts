import fsp from 'node:fs/promises';
import type { JobReport, JobStatus } from '@mediaforge/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AssetRow } from '../db/repositories';
import { contentDisposition } from '../security/filenames';
import { HttpError } from '../security/session';
import { batchToDTO, jobToDTO, parseJson } from '../services/dto';
import { maskReport } from '../services/exportService';
import { sendSessionFile } from './assetRoutes';
import { idParam, notFound, session, type Deps } from './deps';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export async function jobRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  const requireJob = (sid: string, id: string) => {
    const j = ctx.repos.job(sid, id);
    if (!j) notFound('Tarefa');
    return j;
  };

  /** Validação e plano (sem efeitos): mostra o que será feito antes de processar. */
  app.post('/api/plan', async (req, reply) => {
    const s = await session(deps, req, reply);
    return deps.batches.plan(s.id, req.body);
  });

  app.post('/api/batches', async (req, reply) => {
    const s = await session(deps, req, reply);
    const out = deps.batches.create(s.id, req.body);
    reply.code(201);
    return out;
  });

  app.get('/api/batches', async (req, reply) => {
    const s = await session(deps, req, reply);
    return ctx.repos.batches(s.id).map((b) => batchToDTO(b, ctx.repos));
  });

  app.post('/api/batches/:id/cancel', async (req, reply) => {
    const s = await session(deps, req, reply);
    const batch = ctx.repos.batch(s.id, idParam(req));
    if (!batch) notFound('Lote');
    let n = 0;
    for (const j of ctx.repos.jobsByBatch(batch.id)) if ((j.status === 'queued' || j.status === 'running') && ctx.queue.cancel(j)) n++;
    ctx.history.add(s.id, 'batch', 'info', `Lote "${batch.label}": ${n} tarefa(s) cancelada(s)`);
    return { canceled: n };
  });

  app.post('/api/batches/:id/retry', async (req, reply) => {
    const s = await session(deps, req, reply);
    const batch = ctx.repos.batch(s.id, idParam(req));
    if (!batch) notFound('Lote');
    let n = 0;
    for (const j of ctx.repos.jobsByBatch(batch.id)) if (j.status === 'failed' && retryJob(j.id, j.session_id)) n++;
    ctx.history.add(s.id, 'batch', 'info', `Lote "${batch.label}": ${n} tarefa(s) com erro reenfileirada(s)`);
    ctx.queue.tick();
    return { retried: n };
  });

  app.get('/api/jobs', async (req, reply) => {
    const s = await session(deps, req, reply);
    const cache = new Map<string, AssetRow | undefined>();
    return ctx.repos.jobs(s.id).map((j) => jobToDTO(j, ctx.repos, cache));
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    return { ...jobToDTO(j, ctx.repos), report: parseJson<JobReport>(j.report_json), logTail: j.log_tail };
  });

  app.post('/api/jobs/:id/cancel', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    if (!ctx.queue.cancel(j)) throw new HttpError(409, 'not-cancelable', 'A tarefa já terminou.');
    return { ok: true };
  });

  const retryJob = (id: string, sid: string) => {
    const ok = ctx.repos.updateJobIfStatus(id, ['failed', 'canceled'] as JobStatus[], {
      status: 'queued',
      phase: 'aguardando',
      progress: 0,
      attempts: 0,
      error: null,
      error_code: null,
      started_at: null,
      finished_at: null,
      duration_ms: null,
      report_json: null,
      validation_status: null,
      seq: ctx.repos.nextSeq(),
    });
    if (ok) ctx.queue.afterChange(id, sid);
    return ok;
  };

  app.post('/api/jobs/:id/retry', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    if (!retryJob(j.id, s.id)) throw new HttpError(409, 'not-retryable', 'Só é possível repetir tarefas com erro ou canceladas.');
    ctx.history.add(s.id, 'job', 'info', `Repetição solicitada: ${j.label}`);
    ctx.queue.tick();
    return { ok: true };
  });

  app.post('/api/jobs/cancel-pending', async (req, reply) => {
    const s = await session(deps, req, reply);
    let n = 0;
    for (const j of ctx.repos.jobs(s.id)) if (j.status === 'queued' && ctx.queue.cancel(j)) n++;
    ctx.history.add(s.id, 'job', 'info', `${n} tarefa(s) pendente(s) cancelada(s)`);
    return { canceled: n };
  });

  const removeJobFiles = async (sid: string, j: { output_file: string | null; output_thumb: string | null }) => {
    if (j.output_file) await fsp.rm(ctx.storage.file(sid, 'outputs', j.output_file), { force: true });
    if (j.output_thumb) await fsp.rm(ctx.storage.file(sid, 'thumbs', j.output_thumb), { force: true });
  };

  app.delete('/api/jobs/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    if (j.status === 'queued' || j.status === 'running') throw new HttpError(409, 'job-active', 'Cancele a tarefa antes de removê-la.');
    await removeJobFiles(s.id, j);
    ctx.repos.deleteJob(s.id, j.id);
    ctx.repos.deleteEmptyBatches(s.id);
    ctx.events.publish(s.id, { type: 'job-removed', jobId: j.id });
    return { ok: true };
  });

  /** Remove da lista as tarefas terminadas (e seus arquivos, se pedido). */
  app.post('/api/jobs/clear-finished', async (req, reply) => {
    const s = await session(deps, req, reply);
    const { includeCompleted } = z.object({ includeCompleted: z.boolean().default(false) }).parse(req.body ?? {});
    let n = 0;
    for (const j of ctx.repos.jobs(s.id)) {
      if (j.status === 'failed' || j.status === 'canceled' || (includeCompleted && j.status === 'completed')) {
        await removeJobFiles(s.id, j);
        ctx.repos.deleteJob(s.id, j.id);
        ctx.events.publish(s.id, { type: 'job-removed', jobId: j.id });
        n++;
      }
    }
    ctx.repos.deleteEmptyBatches(s.id);
    return { removed: n };
  });

  /** Reprodução/visualização inline (suporta Range). */
  app.get('/api/jobs/:id/output', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    const { path } = await deps.exports.verifyOutput(j, false);
    return sendSessionFile(reply, path, { disposition: 'inline', downloadName: j.output_name!, contentType: mimeOf(j.output_name!) });
  });

  /** Download individual: confere existência, tamanho e SHA-256 antes de enviar. */
  app.get('/api/jobs/:id/download', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    const { path } = await deps.exports.verifyOutput(j, true);
    reply.header('X-Content-SHA256', j.output_sha256 ?? '');
    return sendSessionFile(reply, path, { disposition: 'attachment', downloadName: j.output_name!, contentType: mimeOf(j.output_name!) });
  });

  app.get('/api/jobs/:id/report', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    const report = parseJson<JobReport>(j.report_json);
    if (!report) notFound('Relatório');
    const q = z.object({ raw: z.enum(['0', '1']).optional() }).parse(req.query ?? {});
    const body = q.raw === '1' ? report : maskReport(report);
    reply.header('Content-Disposition', contentDisposition('attachment', `${j.output_name ?? j.label}.relatorio.json`));
    reply.type('application/json; charset=utf-8');
    return JSON.stringify(body, null, 2);
  });

  app.get('/api/jobs/:id/thumbnail', async (req, reply) => {
    const s = await session(deps, req, reply);
    const j = requireJob(s.id, idParam(req));
    if (!j.output_thumb) notFound('Miniatura');
    return sendSessionFile(reply, ctx.storage.file(s.id, 'thumbs', j.output_thumb), { contentType: 'image/jpeg' });
  });

  app.post('/api/exports', async (req, reply) => {
    const s = await session(deps, req, reply);
    const { jobIds } = z.object({ jobIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).max(5000).nullable().default(null) }).parse(req.body ?? {});
    return deps.exports.prepare(s.id, jobIds);
  });

  app.get('/api/exports/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const { stream, filename } = await deps.exports.stream(s.id, idParam(req));
    reply.header('Content-Disposition', contentDisposition('attachment', filename));
    reply.header('Cache-Control', 'private, no-store');
    reply.type('application/zip');
    return reply.send(stream);
  });

  app.post('/api/preview', async (req, reply) => {
    const s = await session(deps, req, reply);
    return deps.previews.render(s.id, req.body);
  });

  app.get('/api/previews/:name', async (req, reply) => {
    const s = await session(deps, req, reply);
    const name = (req.params as { name: string }).name;
    if (!/^[A-Za-z0-9_-]{8,64}\.(mp4|jpg)$/.test(name)) throw new HttpError(400, 'invalid-id', 'Nome inválido.');
    return sendSessionFile(reply, ctx.storage.file(s.id, 'previews', name), { contentType: mimeOf(name) });
  });
}

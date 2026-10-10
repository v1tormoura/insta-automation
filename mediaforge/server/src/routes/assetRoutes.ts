import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { contentDisposition } from '../security/filenames';
import { HttpError } from '../security/session';
import { assetToDetailDTO, assetToDTO } from '../services/dto';
import { ImportError } from '../services/importService';
import { idParam, notFound, session, type Deps } from './deps';

/** Envia um arquivo da sessão com suporte a Range (reprodução no navegador). */
export async function sendSessionFile(
  reply: FastifyReply,
  file: string,
  opts: { disposition?: 'inline' | 'attachment'; downloadName?: string; contentType?: string } = {},
) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st || !st.isFile()) notFound('Arquivo');
  reply.header('Cache-Control', 'private, no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  if (opts.downloadName) reply.header('Content-Disposition', contentDisposition(opts.disposition ?? 'attachment', opts.downloadName));
  if (opts.contentType) reply.type(opts.contentType);
  return reply.sendFile(path.basename(file), path.dirname(file), { cacheControl: false, etag: true, lastModified: true });
}

export async function assetRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.get('/api/assets', async (req, reply) => {
    const s = await session(deps, req, reply);
    return ctx.repos.assets(s.id).map((a) => assetToDTO(a, ctx.repos));
  });

  /** Importação múltipla (multipart). Cada arquivo é validado separadamente. */
  app.post('/api/assets', async (req, reply) => {
    const s = await session(deps, req, reply);
    if (!req.isMultipart()) throw new HttpError(400, 'multipart-required', 'Envie os arquivos como multipart/form-data.');
    if (!ctx.tools.ready) throw new HttpError(503, 'ffmpeg-missing', 'FFmpeg/FFprobe indisponíveis: não é possível validar arquivos.');
    const results: Array<{ name: string; ok: boolean; asset?: ReturnType<typeof assetToDTO>; error?: string }> = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      try {
        const { asset } = await deps.imports.importStream(s.id, part.file, part.filename ?? 'arquivo');
        results.push({ name: asset.original_name, ok: asset.status === 'ready', asset: assetToDTO(asset, ctx.repos), error: asset.error ?? undefined });
      } catch (err) {
        if (err instanceof ImportError) {
          results.push({ name: part.filename ?? 'arquivo', ok: false, error: err.message });
          part.file.resume();
          if (err.code === 'limit') break;
        } else throw err;
      }
    }
    if (results.length === 0) throw new HttpError(400, 'no-files', 'Nenhum arquivo recebido.');
    return { results };
  });

  app.get('/api/assets/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const row = ctx.repos.asset(s.id, idParam(req));
    if (!row) notFound('Arquivo');
    return assetToDetailDTO(row, ctx.repos);
  });

  app.delete('/api/assets/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const id = idParam(req);
    const row = ctx.repos.asset(s.id, id);
    if (!row) notFound('Arquivo');
    const active = ctx.repos.activeJobsForAsset(s.id, id);
    if (active.length) throw new HttpError(409, 'asset-in-use', `O arquivo está em uso por ${active.length} tarefa(s) ativa(s). Cancele-as antes.`);
    ctx.repos.deleteAsset(s.id, id);
    if (row.stored_name) await fsp.rm(ctx.storage.file(s.id, 'uploads', row.stored_name), { force: true });
    if (row.thumb_name) await fsp.rm(ctx.storage.file(s.id, 'thumbs', row.thumb_name), { force: true });
    ctx.events.publish(s.id, { type: 'asset-removed', assetId: id });
    ctx.history.add(s.id, 'asset', 'info', `Removido da sessão: ${row.original_name}`);
    return { ok: true };
  });

  app.get('/api/assets/:id/thumbnail', async (req, reply) => {
    const s = await session(deps, req, reply);
    const row = ctx.repos.asset(s.id, idParam(req));
    if (!row?.thumb_name) notFound('Miniatura');
    return sendSessionFile(reply, ctx.storage.file(s.id, 'thumbs', row.thumb_name), { contentType: 'image/jpeg' });
  });

  app.get('/api/assets/:id/file', async (req, reply) => {
    const s = await session(deps, req, reply);
    const row = ctx.repos.asset(s.id, idParam(req));
    if (!row?.stored_name || row.status !== 'ready') notFound('Arquivo');
    return sendSessionFile(reply, ctx.storage.file(s.id, 'uploads', row.stored_name), { disposition: 'inline', downloadName: row.original_name });
  });
}

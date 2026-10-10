import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import type { SessionRow } from '../db/repositories';
import { HttpError, type SessionManager } from '../security/session';
import type { BatchService } from '../services/batchService';
import type { CleanupService } from '../services/cleanupService';
import type { ExportService } from '../services/exportService';
import type { ImportService } from '../services/importService';
import type { PreviewService } from '../services/previewService';

export interface Deps {
  ctx: AppContext;
  sessions: SessionManager;
  imports: ImportService;
  batches: BatchService;
  exports: ExportService;
  previews: PreviewService;
  cleanup: CleanupService;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Valida um identificador vindo da URL antes de qualquer consulta. */
export function idParam(req: FastifyRequest, name = 'id'): string {
  const v = (req.params as Record<string, string>)[name];
  if (!v || !ID_RE.test(v)) throw new HttpError(400, 'invalid-id', 'Identificador inválido.');
  return v;
}

export async function session(deps: Deps, req: FastifyRequest, reply: FastifyReply): Promise<SessionRow> {
  return deps.sessions.require(req, reply);
}

export function notFound(what = 'Recurso'): never {
  throw new HttpError(404, 'not-found', `${what} não encontrado.`);
}

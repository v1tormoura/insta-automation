import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import type { SessionRow } from '../db/repositories';
import { newId } from './filenames';

export const SESSION_COOKIE = 'mf_session';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Sessões: o navegador recebe um token aleatório em cookie httpOnly
 * (SameSite=Strict); o banco guarda só o hash. Todos os arquivos e tarefas
 * pertencem a uma sessão e toda consulta filtra por ela.
 */
export class SessionManager {
  constructor(private ctx: AppContext) {}

  async create(reply: FastifyReply): Promise<SessionRow> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const row: SessionRow = { id: newId(9), token_hash: hashToken(token), created_at: now, last_seen_at: now };
    this.ctx.repos.insertSession(row);
    await this.ctx.storage.ensureSession(row.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.ctx.config.cookieSecure,
      path: '/',
      maxAge: Math.round(this.ctx.config.sessionTtlMs / 1000) * 4,
    });
    this.ctx.history.add(row.id, 'session', 'info', 'Sessão iniciada');
    return row;
  }

  current(req: FastifyRequest): SessionRow | undefined {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || token.length > 200) return undefined;
    return this.ctx.repos.sessionByTokenHash(hashToken(token));
  }

  /**
   * Resolve a sessão da requisição. Sem chave de acesso configurada, cria uma
   * sessão nova automaticamente; com chave, exige login (POST /api/session).
   */
  async require(req: FastifyRequest, reply: FastifyReply): Promise<SessionRow> {
    const existing = this.current(req);
    if (existing) {
      const now = Date.now();
      if (now - existing.last_seen_at > 30_000) {
        this.ctx.repos.touchSession(existing.id, now);
        existing.last_seen_at = now;
      }
      await this.ctx.storage.ensureSession(existing.id);
      return existing;
    }
    if (this.ctx.config.accessKey) throw new HttpError(401, 'auth-required', 'Informe a chave de acesso para iniciar uma sessão.');
    return this.create(reply);
  }
}

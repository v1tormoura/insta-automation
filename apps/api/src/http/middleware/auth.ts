import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../../config/env.js';
import { unauthenticated } from '../../lib/errors.js';
import { sha256 } from '../../lib/crypto.js';
import { MINUTE } from '../../lib/time.js';
import { Session } from '../../modules/auth/session.model.js';
import { User } from '../../modules/auth/user.model.js';
import '../types.js';

export const SESSION_COOKIE = isProduction ? '__Host-nx_session' : 'nx_session';

export async function resolveSession(req: Request): Promise<void> {
  const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!raw || raw.length > 200) return;
  const session = await Session.findOne({ tokenHash: sha256(raw), expiresAt: { $gt: new Date() } }).lean();
  if (!session) return;
  const user = await User.findById(session.userId).lean();
  if (!user || user.status !== 'active') return;
  req.auth = { userId: user._id, user, sessionId: session._id };
  if (Date.now() - session.lastSeenAt.getTime() > 5 * MINUTE) {
    void Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).exec();
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  await resolveSession(req);
  if (!req.auth) throw unauthenticated();
  next();
}

/** Atalho tipado para handlers que já passaram por requireAuth. */
export function auth(req: Request) {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

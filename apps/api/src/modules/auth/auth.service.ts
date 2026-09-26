import { PLANS, type LoginInput, type SignupInput, type UpdateProfileInput, type UserDTO } from '@nexora/shared';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { AppError, conflict, unauthenticated } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { DAY } from '../../lib/time.js';
import { Session } from './session.model.js';
import { User, type UserDoc } from './user.model.js';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

// Hash fixo usado quando o e-mail não existe: o tempo de resposta não revela se a conta existe.
let dummyHash: Promise<string> | undefined;

export function toUserDTO(user: UserDoc): UserDTO {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    plan: user.plan,
    limits: PLANS[user.plan],
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueSession(userId: Types.ObjectId, meta: SessionMeta): Promise<IssuedSession> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * DAY);
  await Session.create({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
  });
  return { token, expiresAt };
}

export async function signup(input: SignupInput, meta: SessionMeta) {
  if (!env.SIGNUP_ENABLED) throw new AppError('FORBIDDEN', 'Novos cadastros estão desativados.', 403);
  if (await User.exists({ email: input.email })) throw conflict('Já existe uma conta com este e-mail.');
  const user = await User.create({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    lastLoginAt: new Date(),
  });
  return { user, session: await issueSession(user._id, meta) };
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!user) {
    dummyHash ??= hashPassword(randomToken(16));
    await verifyPassword(input.password, await dummyHash);
    throw unauthenticated('E-mail ou senha incorretos.');
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) throw unauthenticated('E-mail ou senha incorretos.');
  if (user.status !== 'active') throw new AppError('FORBIDDEN', 'Esta conta está suspensa.', 403);
  user.lastLoginAt = new Date();
  await user.save();
  return { user, session: await issueSession(user._id, meta) };
}

export async function logout(sessionId: Types.ObjectId): Promise<void> {
  await Session.deleteOne({ _id: sessionId });
}

export async function logoutEverywhere(userId: Types.ObjectId): Promise<void> {
  await Session.deleteMany({ userId });
}

export async function updateProfile(userId: Types.ObjectId, input: UpdateProfileInput): Promise<UserDoc> {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Fuso horário inválido.', 400);
    }
  }
  const user = await User.findByIdAndUpdate(userId, { $set: input }, { returnDocument: 'after' }).lean();
  if (!user) throw unauthenticated();
  return user;
}

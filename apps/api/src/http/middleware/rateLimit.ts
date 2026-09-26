import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from '../../infra/redis.js';
import { AppError } from '../../lib/errors.js';

function store(prefix: string) {
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis().call(command, ...args) as Promise<RedisReply>,
  });
}

const tooMany = () => new AppError('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.', 429);

/** Login/cadastro: por IP + e-mail, para frear força bruta sem travar um escritório inteiro. */
export const authLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: store('auth'),
    keyGenerator: (req: Request) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase()}`,
    handler: () => {
      throw tooMany();
    },
  });

/** Teto geral por usuário autenticado (ou IP). */
export const apiLimiter = () =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: store('api'),
    keyGenerator: (req: Request) => req.auth?.userId.toString() ?? ipKeyGenerator(req.ip ?? ''),
    handler: () => {
      throw tooMany();
    },
  });

import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { forbidden } from '../../lib/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção CSRF em camadas para a API com cookie de sessão:
 *  1. o cookie é SameSite=Lax (POST cross-site não leva o cookie);
 *  2. se o navegador informar Origin, ele precisa ser o do app;
 *  3. toda escrita exige o header `X-Nexora-Client`, que um formulário HTML
 *     não consegue enviar e que, via fetch cross-origin, força um preflight
 *     que este servidor não autoriza.
 */
export function sameOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  const allowed = [new URL(env.APP_URL).origin, new URL(env.API_PUBLIC_URL).origin];
  if (origin && !allowed.includes(origin)) throw forbidden('Origem da requisição não permitida.');
  if (req.get('x-nexora-client') !== 'web') throw forbidden('Requisição sem identificação do cliente.');
  next();
}

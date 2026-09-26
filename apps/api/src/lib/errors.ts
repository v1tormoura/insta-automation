import type { ErrorCode } from '@nexora/shared';

/**
 * Erro de aplicação com código estável e mensagem pronta para o usuário final.
 * Qualquer outro erro vira INTERNAL_ERROR com mensagem genérica.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError('VALIDATION_ERROR', message, 400, details);
export const unauthenticated = (message = 'Faça login para continuar.') => new AppError('UNAUTHENTICATED', message, 401);
export const forbidden = (message = 'Você não tem acesso a este recurso.') => new AppError('FORBIDDEN', message, 403);
export const notFound = (what = 'Recurso') => new AppError('NOT_FOUND', `${what} não encontrado.`, 404);
export const conflict = (message: string) => new AppError('CONFLICT', message, 409);
export const planLimit = (message: string) => new AppError('PLAN_LIMIT_REACHED', message, 402);
export const featureUnavailable = (message: string) => new AppError('FEATURE_UNAVAILABLE', message, 422);

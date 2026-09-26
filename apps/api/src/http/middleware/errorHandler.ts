import type { ApiErrorBody } from '@nexora/shared';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } };
  res.status(404).json(body);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
    res.status(err.status).json(body);
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION_ERROR', message: tooLarge ? 'Arquivo maior que o permitido.' : 'Upload inválido.' },
    };
    res.status(tooLarge ? 413 : 400).json(body);
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiErrorBody);
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, 'erro não tratado');
  const body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Algo deu errado do nosso lado. Tente novamente.' } };
  res.status(500).json(body);
}

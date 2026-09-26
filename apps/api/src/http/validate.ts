import type { z } from 'zod';
import { badRequest } from '../lib/errors.js';

/** Valida e devolve o dado já tipado; erro vira 400 com os campos problemáticos. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(fields[0]?.message ?? 'Dados inválidos.', { fields });
  }
  return result.data;
}

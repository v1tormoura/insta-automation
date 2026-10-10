import path from 'node:path';

export class PathEscapeError extends Error {
  constructor() {
    super('Caminho fora do diretório permitido');
    this.name = 'PathEscapeError';
  }
}

/** Verdadeiro se `target` estiver dentro de `base` (ou for o próprio `base`). */
export function isInside(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Junta partes a um diretório base e garante que o resultado não escapa dele.
 * Cada parte deve ser um nome simples (sem separadores) — nomes vindos do
 * usuário nunca chegam aqui, apenas identificadores gerados pelo servidor.
 */
export function resolveInside(base: string, ...parts: string[]): string {
  for (const p of parts) {
    if (!p || p.includes('\0') || p === '.' || p === '..' || /[\\/]/.test(p)) throw new PathEscapeError();
  }
  const target = path.resolve(base, ...parts);
  if (!isInside(base, target) || target === path.resolve(base)) throw new PathEscapeError();
  return target;
}

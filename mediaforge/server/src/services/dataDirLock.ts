import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const requireCjs = createRequire(import.meta.url);

export interface DataDirLock {
  readonly file: string;
  release(): void;
}

export class DataDirLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDirLockedError';
  }
}

/**
 * Bloqueio exclusivo do diretório de dados: impede que uma segunda instância
 * (mesmo que vá falhar logo depois por porta ocupada) apague temporários e
 * reivindique tarefas da instância ativa.
 *
 * Usa o bloqueio de arquivo do próprio SQLite (fcntl no Linux/macOS,
 * LockFileEx no Windows) em modo EXCLUSIVE, num arquivo separado do banco
 * principal. O sistema operacional libera o bloqueio sozinho se o processo
 * morrer, então não existe "bloqueio velho" depois de uma queda.
 */
export function acquireDataDirLock(dataDir: string): DataDirLock {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'instance.lock');
  const { DatabaseSync } = requireCjs('node:sqlite') as typeof import('node:sqlite');
  const db: DatabaseSyncType = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
    db.exec('CREATE TABLE IF NOT EXISTS instance (pid INTEGER, started_at INTEGER)');
    db.exec('DELETE FROM instance');
    db.prepare('INSERT INTO instance (pid, started_at) VALUES (?, ?)').run(process.pid, Date.now());
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
    const msg = (err as Error).message ?? '';
    if (/locked|busy/i.test(msg)) {
      throw new DataDirLockedError(
        `Outra instância do MediaForge já está usando o diretório de dados ${dataDir}. Encerre-a ou configure outro DATA_DIR.`,
      );
    }
    throw err;
  }
  let released = false;
  return {
    file,
    release() {
      if (released) return;
      released = true;
      try {
        db.close();
      } catch {
        /* já fechado */
      }
    },
  };
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isInside, resolveInside } from '../security/paths';

export type SessionArea = 'uploads' | 'thumbs' | 'outputs' | 'previews' | 'tmp';
const AREAS: SessionArea[] = ['uploads', 'thumbs', 'outputs', 'previews', 'tmp'];

/**
 * Organização em disco, isolada por sessão:
 *   <DATA_DIR>/sessions/<sessão>/{uploads,thumbs,outputs,previews,tmp}
 * Toda resolução de caminho passa por `resolveInside`, que recusa escapes.
 */
export class Storage {
  constructor(readonly sessionsDir: string) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  sessionDir(sessionId: string): string {
    return resolveInside(this.sessionsDir, sessionId);
  }

  async ensureSession(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    await Promise.all(AREAS.map((a) => fsp.mkdir(path.join(dir, a), { recursive: true })));
  }

  area(sessionId: string, area: SessionArea): string {
    return path.join(this.sessionDir(sessionId), area);
  }

  file(sessionId: string, area: SessionArea, name: string): string {
    return resolveInside(this.area(sessionId, area), name);
  }

  /** Diretório temporário exclusivo de uma tarefa. */
  async jobTmp(sessionId: string, jobId: string): Promise<string> {
    const dir = resolveInside(this.area(sessionId, 'tmp'), `job-${jobId}`);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  async removeJobTmp(sessionId: string, jobId: string): Promise<void> {
    const dir = resolveInside(this.area(sessionId, 'tmp'), `job-${jobId}`);
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }

  isInsideSession(sessionId: string, target: string): boolean {
    return isInside(this.sessionDir(sessionId), target);
  }

  async removeSession(sessionId: string): Promise<void> {
    await fsp.rm(this.sessionDir(sessionId), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }

  async listSessionDirs(): Promise<string[]> {
    const entries = await fsp.readdir(this.sessionsDir, { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  /** Espaço ocupado pela sessão em bytes. */
  async sessionSize(sessionId: string): Promise<number> {
    let total = 0;
    const walk = async (dir: string) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
      }
    };
    await walk(this.sessionDir(sessionId));
    return total;
  }

  /**
   * Move um arquivo para `destDir` sem sobrescrever nada: se o nome já existe,
   * acrescenta sufixo numérico. Retorna o nome final.
   */
  async moveNoOverwrite(src: string, destDir: string, desiredName: string): Promise<string> {
    const dot = desiredName.lastIndexOf('.');
    const stem = dot > 0 ? desiredName.slice(0, dot) : desiredName;
    const ext = dot > 0 ? desiredName.slice(dot) : '';
    for (let i = 1; i < 10_000; i++) {
      const name = i === 1 ? desiredName : `${stem}-${i}${ext}`;
      const dest = resolveInside(destDir, name);
      try {
        // link() falha com EEXIST se o destino existir: nunca sobrescreve.
        await fsp.link(src, dest);
        await fsp.unlink(src);
        return name;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') continue;
        if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP') {
          try {
            await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
            await fsp.unlink(src);
            return name;
          } catch (e2) {
            if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') continue;
            throw e2;
          }
        }
        throw err;
      }
    }
    throw new Error('Não foi possível gerar um nome de arquivo único');
  }
}

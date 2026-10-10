import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';

/**
 * Limpeza automática configurável:
 * - sessões inativas além de SESSION_TTL_HOURS (arquivos + registros);
 * - diretórios de sessão sem registro no banco (órfãos);
 * - temporários de tarefas que não estão rodando, uploads interrompidos e prévias velhas;
 * - registros de exportação com mais de 1 dia.
 * Nunca remove uma sessão com tarefa em execução.
 */
export class CleanupService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private ctx: AppContext) {}

  start() {
    this.timer = setInterval(() => {
      this.run().catch((err) => this.ctx.log.error({ err: (err as Error).message }, 'falha na limpeza automática'));
    }, this.ctx.config.cleanupIntervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(now = Date.now()): Promise<{ sessionsRemoved: number; tmpRemoved: number; orphansRemoved: number }> {
    const { repos, storage, config, queue, log } = this.ctx;
    const active = queue.activeSessions();
    let sessionsRemoved = 0;
    for (const s of repos.expiredSessions(now - config.sessionTtlMs)) {
      if (active.has(s.id)) continue;
      await this.removeSession(s.id);
      sessionsRemoved++;
    }

    const known = new Set(repos.allSessions().map((s) => s.id));
    let orphansRemoved = 0;
    for (const dir of await storage.listSessionDirs()) {
      if (!known.has(dir) && !active.has(dir)) {
        await fsp.rm(path.join(storage.sessionsDir, dir), { recursive: true, force: true }).catch(() => undefined);
        orphansRemoved++;
      }
    }

    let tmpRemoved = 0;
    for (const sid of known) {
      const tmp = storage.area(sid, 'tmp');
      const entries = await fsp.readdir(tmp, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(tmp, e.name);
        const st = await fsp.stat(full).catch(() => null);
        if (!st) continue;
        const age = now - st.mtimeMs;
        const jobMatch = e.name.match(/^job-(.+)$/);
        const stale =
          (jobMatch && !queue.isRunning(jobMatch[1]!)) ||
          (e.name.startsWith('upload-') && age > 60 * 60 * 1000) ||
          (e.name.startsWith('preview-') && age > 10 * 60 * 1000);
        if (stale) {
          await fsp.rm(full, { recursive: true, force: true }).catch(() => undefined);
          tmpRemoved++;
        }
      }
    }
    repos.deleteOldExports(now - 24 * 3600 * 1000);
    if (sessionsRemoved || orphansRemoved || tmpRemoved) log.info({ sessionsRemoved, orphansRemoved, tmpRemoved }, 'limpeza automática');
    return { sessionsRemoved, tmpRemoved, orphansRemoved };
  }

  /** Cancela as tarefas da sessão, remove arquivos e registros. */
  async removeSession(sessionId: string) {
    const { repos, storage, queue } = this.ctx;
    await queue.stopSession(sessionId);
    repos.deleteSession(sessionId);
    await storage.removeSession(sessionId).catch(() => undefined);
  }
}

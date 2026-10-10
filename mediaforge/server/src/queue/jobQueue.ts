import os from 'node:os';
import type { AppContext } from '../context';
import type { JobRow } from '../db/repositories';
import { batchToDTO, jobToDTO } from '../services/dto';
import { JobFailure, type JobRunner } from './jobRunner';

type StopReason = 'cancel' | 'shutdown';

class AbortReason extends Error {
  constructor(readonly kind: StopReason) {
    super(kind === 'cancel' ? 'Cancelada pelo usuário' : 'Servidor encerrando');
  }
}

/**
 * Fila persistente sobre SQLite. O estado de cada tarefa vive no banco; a
 * fila só decide quando reivindicar a próxima (UPDATE condicional atômico)
 * e controla a concorrência. Em caso de queda, as tarefas "running" são
 * reenfileiradas na inicialização (ou marcadas como falha se esgotaram as
 * tentativas). Encerramento ordenado devolve as tarefas em execução à fila.
 */
export class JobQueue {
  private running = new Map<string, { controller: AbortController; promise: Promise<void>; sessionId: string }>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private ticking = false;
  private memoryWarned = false;
  concurrency: number;

  constructor(
    private ctx: AppContext,
    private runner: JobRunner,
  ) {
    const saved = Number(ctx.repos.setting('concurrency'));
    this.concurrency = this.clamp(Number.isFinite(saved) && saved > 0 ? saved : ctx.config.queue.defaultConcurrency);
  }

  private clamp(n: number) {
    return Math.max(1, Math.min(this.ctx.config.queue.maxConcurrency, Math.round(n)));
  }

  start() {
    this.recover();
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), 1500);
    this.timer.unref();
    this.tick();
  }

  /** Reenfileira tarefas interrompidas por uma queda do processo. */
  recover() {
    const { repos } = this.ctx;
    for (const job of repos.runningJobs()) {
      if (this.running.has(job.id)) continue;
      const exhausted = job.attempts >= job.max_attempts;
      repos.updateJob(job.id, {
        status: exhausted ? 'failed' : 'queued',
        phase: null,
        progress: 0,
        error: exhausted
          ? 'Interrompida por reinicialização do servidor e sem tentativas restantes.'
          : 'Interrompida por reinicialização do servidor; reenfileirada automaticamente.',
        error_code: exhausted ? 'interrupted' : null,
        finished_at: exhausted ? Date.now() : null,
      });
      this.ctx.storage.removeJobTmp(job.session_id, job.id).catch(() => undefined);
      this.ctx.history.add(
        job.session_id,
        'recovery',
        exhausted ? 'error' : 'warning',
        `${exhausted ? 'Falhou' : 'Reenfileirada'} após reinicialização: ${job.label}`,
      );
      this.ctx.log.warn({ jobId: job.id, exhausted }, 'tarefa interrompida recuperada');
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.running.values()) r.controller.abort(new AbortReason('shutdown'));
    await Promise.allSettled([...this.running.values()].map((r) => r.promise));
  }

  setConcurrency(n: number) {
    this.concurrency = this.clamp(n);
    this.ctx.repos.setSetting('concurrency', String(this.concurrency));
    this.publishQueue();
    this.tick();
    return this.concurrency;
  }

  stats() {
    return {
      concurrency: this.concurrency,
      maxConcurrency: this.ctx.config.queue.maxConcurrency,
      running: this.running.size,
      queued: this.ctx.repos.countJobsByStatus('queued'),
    };
  }

  isRunning(jobId: string) {
    return this.running.has(jobId);
  }

  /** Cancela uma tarefa da fila ou em execução. Retorna falso se já terminou. */
  cancel(job: JobRow): boolean {
    const { repos } = this.ctx;
    if (job.status === 'queued') {
      const ok = repos.updateJobIfStatus(job.id, ['queued'], {
        status: 'canceled',
        phase: null,
        finished_at: Date.now(),
        error: 'Cancelada antes de iniciar.',
        error_code: 'canceled',
      });
      if (ok) this.afterChange(job.id, job.session_id);
      return ok;
    }
    if (job.status === 'running') {
      const r = this.running.get(job.id);
      if (r) {
        r.controller.abort(new AbortReason('cancel'));
        return true;
      }
    }
    return false;
  }

  tick() {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      while (this.running.size < this.concurrency) {
        const minFree = this.ctx.config.queue.minFreeMemoryBytes;
        if (minFree > 0 && os.freemem() < minFree) {
          if (!this.memoryWarned) this.ctx.log.warn({ free: os.freemem() }, 'memória livre abaixo do limite; aguardando para iniciar novas tarefas');
          this.memoryWarned = true;
          break;
        }
        this.memoryWarned = false;
        const job = this.ctx.repos.claimNextJob(Date.now());
        if (!job) break;
        this.launch(job);
      }
    } finally {
      this.ticking = false;
    }
  }

  private launch(job: JobRow) {
    const controller = new AbortController();
    this.afterChange(job.id, job.session_id);
    const promise = this.runner
      .run(job, controller.signal)
      .catch((err) => this.handleFailure(job, err, controller.signal))
      .finally(() => {
        this.running.delete(job.id);
        this.afterChange(job.id, job.session_id);
        this.publishQueue();
        setImmediate(() => this.tick());
      });
    this.running.set(job.id, { controller, promise, sessionId: job.session_id });
    this.publishQueue();
  }

  private handleFailure(job: JobRow, err: unknown, signal: AbortSignal) {
    const { repos, history, log } = this.ctx;
    const now = Date.now();
    const current = repos.jobById(job.id);
    if (!current) return;
    const reason = signal.aborted ? (signal.reason as AbortReason | undefined) : undefined;
    if (reason instanceof AbortReason && reason.kind === 'shutdown') {
      repos.updateJob(job.id, {
        status: 'queued',
        phase: null,
        progress: 0,
        attempts: Math.max(0, current.attempts - 1),
        error: 'Interrompida pelo encerramento do servidor; será retomada.',
        started_at: null,
      });
      return;
    }
    if (reason instanceof AbortReason && reason.kind === 'cancel') {
      repos.updateJobIfStatus(job.id, ['running'], {
        status: 'canceled',
        phase: null,
        finished_at: now,
        duration_ms: now - (current.started_at ?? now),
        error: 'Cancelada durante o processamento.',
        error_code: 'canceled',
      });
      history.add(job.session_id, 'job', 'info', `Cancelada: ${job.label}`);
      return;
    }
    const failure =
      err instanceof JobFailure ? err : new JobFailure(`Erro inesperado: ${(err as Error)?.message ?? String(err)}`, 'internal', true);
    const retry = failure.retryable && current.attempts < current.max_attempts;
    repos.updateJobIfStatus(job.id, ['running'], {
      status: retry ? 'queued' : 'failed',
      phase: null,
      progress: retry ? 0 : current.progress,
      finished_at: retry ? null : now,
      duration_ms: retry ? null : now - (current.started_at ?? now),
      error: retry ? `Tentativa ${current.attempts} falhou: ${failure.message}` : failure.message,
      error_code: failure.code,
      report_json: failure.report ? JSON.stringify(failure.report) : current.report_json,
      validation_status: failure.report?.validation.status ?? null,
    });
    const assetName = repos.assetById(job.asset_id)?.original_name ?? job.label;
    history.add(
      job.session_id,
      'job',
      retry ? 'warning' : 'error',
      retry ? `Nova tentativa agendada: ${assetName} (${failure.message.slice(0, 160)})` : `Falhou: ${assetName} — ${failure.message.slice(0, 200)}`,
    );
    log.warn({ jobId: job.id, code: failure.code, retry }, 'tarefa falhou');
  }

  /** Publica o estado atual da tarefa e do lote dela. */
  afterChange(jobId: string, sessionId: string) {
    const { repos, events } = this.ctx;
    const row = repos.jobById(jobId);
    if (!row) return;
    events.publish(sessionId, { type: 'job', job: jobToDTO(row, repos) });
    const batch = repos.batch(sessionId, row.batch_id);
    if (batch) events.publish(sessionId, { type: 'batch', batch: batchToDTO(batch, repos) });
  }

  publishQueue() {
    this.ctx.events.broadcast({ type: 'queue', queue: this.stats() });
  }

  /** Aguarda até não haver tarefas em execução nem na fila (usado em testes). */
  async drain(timeoutMs = 120_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.running.size === 0 && this.ctx.repos.countJobsByStatus('queued') === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Fila não esvaziou no tempo limite');
  }

  /** Cancela todas as tarefas da sessão e aguarda as que estão rodando pararem. */
  async stopSession(sessionId: string, timeoutMs = 15_000) {
    for (const j of this.ctx.repos.jobs(sessionId)) if (j.status === 'queued' || j.status === 'running') this.cancel(j);
    const pending = [...this.running.values()].filter((r) => r.sessionId === sessionId).map((r) => r.promise);
    if (pending.length === 0) return;
    await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** Sessões com tarefas em execução (para não limpar arquivos em uso). */
  activeSessions(): Set<string> {
    return new Set([...this.running.values()].map((r) => r.sessionId));
  }
}

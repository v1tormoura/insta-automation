import { JOB_STATUS_LABELS, PHASE_LABELS, type BatchDTO, type JobDTO } from '@mediaforge/shared';
import clsx from 'clsx';
import { Ban, ChevronDown, ChevronRight, ListX, Minus, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, EmptyState, ProgressBar, Stat, type Tone } from '../../components/ui/feedback';
import { useToast } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { formatMs, formatPercent, formatTime } from '../../lib/format';
import { keys, queryClient, removeJob, useBatches, useJobs, useSystem } from '../../lib/queries';

export const STATUS_TONE: Record<JobDTO['status'], Tone> = { queued: 'neutral', running: 'accent', completed: 'ok', failed: 'bad', canceled: 'warn' };

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function JobRow({ job, now }: { job: JobDTO; now: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const elapsed = job.status === 'running' && job.startedAt ? now - job.startedAt : job.durationMs;
  const finished = job.status === 'completed' || job.status === 'failed' || job.status === 'canceled';
  return (
    <li className="rounded-lg border border-line bg-surface-2/70 px-2.5 py-2" data-testid="job-row" data-status={job.status}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-ink" title={job.assetName}>
            {job.assetName}
          </p>
          <p className="truncate text-[11px] text-ink-3">{job.label}</p>
        </div>
        <Badge tone={STATUS_TONE[job.status]}>{job.status === 'running' && job.phase ? PHASE_LABELS[job.phase] : JOB_STATUS_LABELS[job.status]}</Badge>
        <div className="flex items-center">
          {(job.status === 'queued' || job.status === 'running') && (
            <IconButton icon={XCircle} size="xs" label="Cancelar" loading={busy} onClick={() => act(() => api.cancelJob(job.id))} data-testid="job-cancel" />
          )}
          {(job.status === 'failed' || job.status === 'canceled') && (
            <IconButton icon={RotateCcw} size="xs" label="Repetir" loading={busy} onClick={() => act(() => api.retryJob(job.id))} data-testid="job-retry" />
          )}
          {finished && (
            <IconButton icon={Trash2} size="xs" label="Remover da lista (e o arquivo gerado)" loading={busy} onClick={() => act(() => api.deleteJob(job.id), () => removeJob(job.id))} />
          )}
        </div>
      </div>
      {(job.status === 'running' || job.status === 'queued') && (
        <div className="mt-1.5 flex items-center gap-2">
          <ProgressBar value={job.progress} active={job.status === 'running'} tone={job.status === 'queued' ? 'neutral' : 'accent'} label={`Progresso de ${job.assetName}`} />
          <span className="tabular w-10 text-right text-[11px] text-ink-2">{formatPercent(job.progress)}</span>
        </div>
      )}
      <div className="tabular mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-ink-3">
        {job.startedAt && <span>início {formatTime(job.startedAt)}</span>}
        {job.finishedAt && <span>fim {formatTime(job.finishedAt)}</span>}
        {elapsed ? <span>duração {formatMs(elapsed)}</span> : null}
        {job.attempts > 1 || job.status === 'failed' ? (
          <span>
            tentativa {job.attempts}/{job.maxAttempts}
          </span>
        ) : null}
        {job.validationStatus === 'warning' && <span className="text-warn">validação com avisos</span>}
      </div>
      {job.error && job.status !== 'completed' && <p className={clsx('mt-1 text-[11px] leading-snug break-words', job.status === 'queued' ? 'text-warn' : 'text-bad')}>{job.error}</p>}
    </li>
  );
}

function BatchCard({ batch, jobs, now, defaultOpen }: { batch: BatchDTO; jobs: JobDTO[]; now: number; defaultOpen: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const active = batch.counts.queued + batch.counts.running > 0;
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  return (
    <li className="rounded-xl border border-line bg-surface/60" data-testid="batch-card">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-ink-3 hover:text-ink" aria-label={open ? 'Recolher' : 'Expandir'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-ink-2">{batch.label}</p>
          <p className="tabular text-[10.5px] text-ink-3">
            {formatTime(batch.createdAt)} · {batch.counts.completed}/{batch.counts.total} concluídas
            {batch.counts.failed ? ` · ${batch.counts.failed} com erro` : ''}
            {batch.counts.canceled ? ` · ${batch.counts.canceled} canceladas` : ''}
          </p>
        </div>
        {active && (
          <Button size="xs" variant="ghost" icon={Ban} onClick={() => api.cancelBatch(batch.id).catch((e) => toast.error(e))}>
            Cancelar
          </Button>
        )}
        {batch.counts.failed > 0 && (
          <Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => api.retryBatch(batch.id).catch((e) => toast.error(e))}>
            Repetir erros
          </Button>
        )}
      </div>
      <div className="px-2.5 pb-2">
        <ProgressBar value={batch.progress} tone={batch.counts.failed ? 'warn' : active ? 'accent' : 'ok'} label={`Progresso do lote ${batch.label}`} />
      </div>
      {open && (
        <ul className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function QueuePanel() {
  const { data: jobs = [] } = useJobs();
  const { data: batches = [] } = useBatches();
  const { data: system } = useSystem();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const now = useNow(running > 0);

  const byBatch = useMemo(() => {
    const m = new Map<string, JobDTO[]>();
    for (const j of jobs) m.set(j.batchId, [...(m.get(j.batchId) ?? []), j]);
    return m;
  }, [jobs]);
  const sortedBatches = useMemo(() => [...batches].filter((b) => byBatch.has(b.id)).sort((a, b) => b.createdAt - a.createdAt), [batches, byBatch]);

  // Progresso geral: lotes com trabalho pendente (ou o último lote, se nada estiver ativo).
  const activeBatches = sortedBatches.filter((b) => b.counts.queued + b.counts.running > 0);
  const scope = activeBatches.length ? activeBatches : sortedBatches.slice(0, 1);
  const scopeJobs = scope.flatMap((b) => byBatch.get(b.id) ?? []);
  const overall = scopeJobs.length ? scopeJobs.reduce((s, j) => s + (j.status === 'queued' ? 0 : j.status === 'running' ? j.progress : 1), 0) / scopeJobs.length : 0;

  const concurrency = system?.queue.concurrency ?? 1;
  const maxC = system?.queue.maxConcurrency ?? 1;
  const setConcurrency = async (v: number) => {
    try {
      const q = await api.setConcurrency(v);
      queryClient.setQueryData(keys.system, (s: typeof system) => (s ? { ...s, queue: q } : s));
    } catch (err) {
      toast.error(err);
    }
  };

  const visibleBatches = showAll ? sortedBatches : sortedBatches.slice(0, 6);

  return (
    <div className="flex flex-col gap-3" data-testid="queue-panel">
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Rodando" value={running} tone={running ? 'accent' : 'neutral'} />
        <Stat label="Na fila" value={queued} />
        <Stat label="Prontas" value={completed} tone={completed ? 'ok' : 'neutral'} />
        <Stat label="Erros" value={failed} tone={failed ? 'bad' : 'neutral'} />
      </div>

      <div className="rounded-lg border border-line bg-surface-2/70 p-2.5" data-testid="overall-progress">
        <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
          <span className="text-ink-2">{activeBatches.length ? `Progresso geral (${scopeJobs.length} tarefas)` : 'Último lote'}</span>
          <span className="tabular font-semibold text-ink">{formatPercent(overall)}</span>
        </div>
        <ProgressBar value={overall} active={running > 0} tone={activeBatches.length ? 'accent' : 'ok'} label="Progresso geral" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink-2">Simultâneas</span>
        <div className="flex items-center rounded-md border border-line-strong bg-surface-2">
          <IconButton icon={Minus} size="xs" label="Diminuir" disabled={concurrency <= 1} onClick={() => setConcurrency(concurrency - 1)} />
          <span className="tabular w-6 text-center text-[12.5px] font-semibold" data-testid="concurrency">
            {concurrency}
          </span>
          <IconButton icon={Plus} size="xs" label="Aumentar" disabled={concurrency >= maxC} onClick={() => setConcurrency(concurrency + 1)} />
        </div>
        <span className="text-[11px] text-ink-3">máx. {maxC}</span>
        <span className="ml-auto flex gap-1">
          <Button size="xs" variant="ghost" icon={Ban} disabled={!queued} onClick={() => api.cancelPending().then((r) => toast.push('info', `${r.canceled} pendente(s) cancelada(s)`)).catch((e) => toast.error(e))}>
            Cancelar pendentes
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={ListX}
            disabled={!jobs.some((j) => j.status === 'failed' || j.status === 'canceled')}
            onClick={() =>
              api
                .clearFinished(false)
                .then((r) => toast.push('info', `${r.removed} tarefa(s) com erro/cancelada(s) removida(s) da lista`))
                .catch((e) => toast.error(e))
            }
          >
            Limpar erros
          </Button>
        </span>
      </div>

      {sortedBatches.length === 0 ? (
        <EmptyState icon={ListX} title="Fila vazia">
          As tarefas aparecem aqui com progresso em tempo real assim que você processar.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleBatches.map((b, i) => (
            <BatchCard key={b.id} batch={b} jobs={byBatch.get(b.id) ?? []} now={now} defaultOpen={i === 0} />
          ))}
          {sortedBatches.length > 6 && (
            <Button size="xs" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Mostrar menos' : `Mostrar todos os ${sortedBatches.length} lotes`}
            </Button>
          )}
        </ul>
      )}
    </div>
  );
}

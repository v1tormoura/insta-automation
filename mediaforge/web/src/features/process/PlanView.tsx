import { STRATEGY_LABELS, type OperationRecord, type PlanJobPreview } from '@mediaforge/shared';
import { AlertTriangle, CircleSlash, Wand2 } from 'lucide-react';
import { Badge } from '../../components/ui/feedback';
import { formatDuration, formatResolution } from '../../lib/format';

export function OperationList({ operations, compact }: { operations: OperationRecord[]; compact?: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {operations.map((o, i) => (
        <li key={`${o.id}-${i}`} className="flex gap-2 text-[11.5px] leading-snug">
          <Wand2 size={11} className="mt-0.5 shrink-0 text-accent-soft" />
          <span className="min-w-0">
            <span className="font-medium text-ink-2">{o.label}</span>
            {!compact && <span className="text-ink-3"> — {o.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NoteList({ warnings, skipped }: { warnings: string[]; skipped: Array<{ label: string; reason: string }> }) {
  if (!warnings.length && !skipped.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {warnings.map((w, i) => (
        <li key={`w${i}`} className="flex gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {w}
        </li>
      ))}
      {skipped.map((s, i) => (
        <li key={`s${i}`} className="flex gap-1.5 text-[11.5px] text-ink-3">
          <CircleSlash size={11} className="mt-0.5 shrink-0" />
          <span>
            <b className="font-medium">{s.label}</b> não aplicado: {s.reason}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PlanJobCard({ job }: { job: PlanJobPreview }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/70 p-3" data-testid="plan-job">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{job.assetName}</span>
        <Badge tone="accent">{job.label}</Badge>
        <Badge tone={job.strategy === 'stream-copy' || job.strategy === 'image-lossless' ? 'ok' : 'info'}>{STRATEGY_LABELS[job.strategy]}</Badge>
        <span className="tabular ml-auto text-[11.5px] text-ink-3">
          → {job.outputFormat.toUpperCase()} · {formatResolution(job.expected.width, job.expected.height)}
          {job.expected.durationSec ? ` · ${formatDuration(job.expected.durationSec)}` : ''}
          {job.outputFormat.match(/mp4|mov|webm|mkv/) ? (job.expected.hasAudio ? ' · com áudio' : ' · sem áudio') : ''}
        </span>
      </div>
      <div className="mt-2">
        <OperationList operations={job.operations} />
        <NoteList warnings={job.warnings} skipped={job.skipped} />
      </div>
    </div>
  );
}

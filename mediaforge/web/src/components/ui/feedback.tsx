import clsx from 'clsx';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'violet';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2 border-line-strong',
  accent: 'bg-accent/12 text-accent-soft border-accent/30',
  ok: 'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  bad: 'bg-bad/10 text-bad border-bad/30',
  info: 'bg-info/10 text-info border-info/30',
  violet: 'bg-violet/12 text-violet border-violet/30',
};

export function Badge({ tone = 'neutral', icon: Icon, children, className, title }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx('inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium leading-none whitespace-nowrap', TONES[tone], className)}
    >
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

const BAR: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  violet: 'bg-violet',
};

export function ProgressBar({ value, tone = 'accent', active, className, label }: { value: number; tone?: Tone; active?: boolean; className?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div className={clsx('h-full rounded-full transition-[width] duration-300 ease-out', BAR[tone], active && 'striped-progress')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx('animate-spin text-accent-soft', className)} />;
}

export function EmptyState({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface-2 text-ink-3">
        <Icon size={18} />
      </span>
      <p className="text-[13px] font-medium text-ink-2">{title}</p>
      {children && <div className="max-w-sm text-[12px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
      <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-3">{label}</span>
      <span className={clsx('tabular text-[15px] font-semibold', tone === 'neutral' ? 'text-ink' : TONES[tone].split(' ')[1])}>{value}</span>
    </div>
  );
}

export function KeyValue({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

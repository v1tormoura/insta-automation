import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function Panel({
  title,
  icon: Icon,
  actions,
  subtitle,
  children,
  className,
  bodyClassName,
  id,
  testId,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  testId?: string;
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={clsx(
        'flex min-w-0 flex-col rounded-[var(--radius-panel)] border border-line bg-surface/90 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset,0_12px_32px_-20px_rgb(0_0_0/0.8)] backdrop-blur',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex min-h-11 items-center gap-2 border-b border-line px-3.5 py-2">
          {Icon && (
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/12 text-accent-soft">
              <Icon size={14} strokeWidth={2.2} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle && <p className="truncate text-[11.5px] text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', bodyClassName ?? 'p-3.5')}>{children}</div>
    </section>
  );
}

export function SectionTitle({ children, hint, right }: { children: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-2">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{children}</h3>
        {hint && <p className="mt-0.5 text-[11.5px] text-ink-3">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

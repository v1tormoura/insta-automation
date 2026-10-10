import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Diálogo modal (centro) ou gaveta lateral (side). Fecha com Esc ou clique
 * fora; o foco vai para o diálogo ao abrir e volta ao elemento anterior.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  side,
  width = 'max-w-2xl',
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: boolean;
  width?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in bg-[rgb(2_5_14/0.72)] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-testid={testId}
        className={clsx(
          'flex max-h-full w-full flex-col border border-line-strong bg-surface shadow-2xl outline-none',
          side ? 'ml-auto h-full max-w-[min(720px,100vw)] animate-slide-in border-y-0 border-r-0' : clsx('m-auto max-h-[92vh] rounded-[var(--radius-panel)]', width),
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[12px] text-ink-3">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

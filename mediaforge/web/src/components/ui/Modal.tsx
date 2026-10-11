import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Diálogos abertos, do mais antigo ao mais recente: só o do topo responde a Esc/Tab. */
const stack: HTMLElement[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), video[controls], audio[controls]';

/**
 * Diálogo modal (centro) ou gaveta lateral (side). Fecha com Esc ou clique
 * fora; o foco vai para o diálogo ao abrir, fica preso nele (Tab/Shift+Tab) e
 * volta ao elemento anterior ao fechar. Re-renderizações do componente pai
 * (eventos em tempo real, digitação) não mexem no foco.
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
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    stack.push(el);
    el.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== el) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      const inside = !!current && el.contains(current);
      if (e.shiftKey && (!inside || current === first || current === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || current === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(el);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in bg-[rgb(2_5_14/0.72)] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onCloseRef.current()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className={clsx(
          'flex max-h-full w-full flex-col border border-line-strong bg-surface shadow-2xl outline-none',
          side ? 'ml-auto h-full max-w-[min(720px,100vw)] animate-slide-in border-y-0 border-r-0' : clsx('m-auto max-h-[92vh] rounded-[var(--radius-panel)]', width),
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[14px] font-semibold text-ink">
              {title}
            </h2>
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

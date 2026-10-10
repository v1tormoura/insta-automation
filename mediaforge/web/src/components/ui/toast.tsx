import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';

type Kind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  lines?: string[];
}

interface ToastApi {
  push(kind: Kind, title: string, lines?: string[]): void;
  error(err: unknown, fallback?: string): void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONE = { success: 'text-ok', error: 'text-bad', info: 'text-accent-soft', warning: 'text-warn' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Kind, title: string, lines?: string[]) => {
      const id = ++seq;
      setItems((l) => [...l.slice(-4), { id, kind, title, lines }]);
      setTimeout(() => remove(id), kind === 'error' ? 9000 : 4500);
    },
    [remove],
  );
  const value = useMemo<ToastApi>(
    () => ({
      push,
      error: (err, fallback = 'Operação falhou') => {
        if (err instanceof ApiError) push('error', err.message || fallback, err.detailLines.slice(0, 6));
        else push('error', fallback, [err instanceof Error ? err.message : String(err)]);
      },
    }),
    [push],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(380px,calc(100vw-24px))] flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div key={t.id} role="status" className="pointer-events-auto flex animate-slide-in gap-2.5 rounded-xl border border-line-strong bg-surface-2/95 p-3 shadow-2xl backdrop-blur">
              <Icon size={16} className={clsx('mt-0.5 shrink-0', TONE[t.kind])} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">{t.title}</p>
                {t.lines?.map((l, i) => (
                  <p key={i} className="mt-0.5 text-[11.5px] break-words text-ink-3">
                    {l}
                  </p>
                ))}
              </div>
              <button type="button" aria-label="Dispensar" onClick={() => remove(t.id)} className="text-ink-3 hover:text-ink">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('ToastProvider ausente');
  return v;
}

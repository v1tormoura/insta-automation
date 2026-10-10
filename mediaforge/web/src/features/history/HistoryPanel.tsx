import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, History, Info, XCircle } from 'lucide-react';
import { EmptyState } from '../../components/ui/feedback';
import { formatTime } from '../../lib/format';
import { useHistory } from '../../lib/queries';

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };
const TONE = { info: 'text-ink-3', success: 'text-ok', warning: 'text-warn', error: 'text-bad' };

export function HistoryPanel() {
  const { data: entries = [] } = useHistory();
  if (!entries.length) return <EmptyState icon={History} title="Sem eventos nesta sessão" />;
  return (
    <ol className="flex max-h-[420px] flex-col gap-0.5 overflow-y-auto pr-1" data-testid="history">
      {entries.map((e) => {
        const Icon = ICON[e.level];
        return (
          <li key={e.id} className="flex gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
            <Icon size={12} className={clsx('mt-0.5 shrink-0', TONE[e.level])} />
            <span className="min-w-0 flex-1 text-[11.5px] leading-snug break-words text-ink-2">{e.message}</span>
            <time className="tabular shrink-0 text-[10.5px] text-ink-3">{formatTime(e.createdAt)}</time>
          </li>
        );
      })}
    </ol>
  );
}

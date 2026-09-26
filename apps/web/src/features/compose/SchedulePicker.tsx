import { MAX_INTERVAL_MINUTES, planSchedule } from '@nexora/shared';
import { CalendarClock, FileText, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAccounts } from '@/features/accounts/api';
import { formatDateTime, formatMinutes, toLocalInputValue } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ScheduleMode = 'now' | 'scheduled' | 'draft';

export interface ScheduleValue {
  mode: ScheduleMode;
  at: string; // datetime-local
  staggerMinutes: number;
}

export const defaultSchedule = (): ScheduleValue => ({
  mode: 'now',
  at: toLocalInputValue(new Date(Date.now() + 60 * 60_000)),
  staggerMinutes: 0,
});

const MODES = [
  { id: 'now', label: 'Publicar agora', icon: Zap },
  { id: 'scheduled', label: 'Agendar', icon: CalendarClock },
  { id: 'draft', label: 'Salvar rascunho', icon: FileText },
] as const;

export function MinutesInput({ id, label, value, onChange, hint }: { id: string; label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          max={MAX_INTERVAL_MINUTES}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(MAX_INTERVAL_MINUTES, Math.round(Number(e.target.value) || 0))))}
          className="w-28"
        />
        <span className="text-sm text-muted-foreground">minutos · {formatMinutes(value)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SchedulePicker({ value, onChange, accountIds, allowDraft = true }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void; accountIds: string[]; allowDraft?: boolean }) {
  const { data: accounts } = useAccounts();
  const names = new Map(accounts?.map((a) => [a.id, a.username]));
  const startAt = value.mode === 'scheduled' ? new Date(value.at) : new Date();

  // A mesma função do backend calcula a prévia: o que se vê é o que será agendado.
  const preview = useMemo(
    () =>
      value.mode === 'draft' || !accountIds.length || Number.isNaN(startAt.getTime())
        ? []
        : planSchedule({ startAt, itemCount: 1, accountIds, intervalMinutes: 0, accountStaggerMinutes: value.staggerMinutes }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.mode, value.at, value.staggerMinutes, accountIds.join(',')],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Quando publicar">
        {MODES.filter((m) => allowDraft || m.id !== 'draft').map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value.mode === id}
            onClick={() => onChange({ ...value, mode: id })}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm transition-colors',
              value.mode === id ? 'border-primary/60 bg-primary/8 font-medium' : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <Icon className={cn('size-4', value.mode === id && 'text-primary')} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {value.mode === 'scheduled' && (
        <div className="space-y-2">
          <Label htmlFor="schedule-at">Data e hora</Label>
          <Input
            id="schedule-at"
            type="datetime-local"
            value={value.at}
            min={toLocalInputValue(new Date())}
            onChange={(e) => onChange({ ...value, at: e.target.value })}
            className="w-full sm:w-64"
          />
          <p className="text-xs text-muted-foreground">No fuso horário do seu navegador ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
        </div>
      )}

      {value.mode !== 'draft' && accountIds.length > 1 && (
        <MinutesInput
          id="stagger"
          label="Intervalo entre contas"
          value={value.staggerMinutes}
          onChange={(staggerMinutes) => onChange({ ...value, staggerMinutes })}
          hint="Espaça a mesma publicação entre as contas selecionadas, na ordem em que foram marcadas."
        />
      )}

      {preview.length > 1 && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Prévia da ordem de publicação</p>
          <ol className="space-y-1 text-sm">
            {preview.map((slot, i) => (
              <li key={slot.accountId} className="flex justify-between gap-3">
                <span className="truncate">
                  {i + 1}. @{names.get(slot.accountId) ?? '…'}
                </span>
                <span className="tabular shrink-0 text-muted-foreground">{value.mode === 'now' && i === 0 ? 'imediatamente' : formatDateTime(slot.runAt.toISOString())}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

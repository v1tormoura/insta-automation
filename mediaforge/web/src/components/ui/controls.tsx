import clsx from 'clsx';
import { RotateCcw } from 'lucide-react';
import { useId, type ReactNode } from 'react';

const ctl =
  'h-7.5 w-full min-w-0 rounded-[var(--radius-ctl)] border border-line-strong bg-surface-2 px-2 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-accent/40 focus:border-accent disabled:opacity-50';

export function Field({ label, hint, children, className, htmlFor, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; right?: ReactNode }) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[11.5px] font-medium text-ink-2">
          {label}
        </label>
        {right}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  id,
  testId,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  disabled?: boolean;
  id?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      data-testid={testId}
      aria-label={ariaLabel}
      className={clsx(ctl, 'cursor-pointer pr-6')}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} className="bg-surface-2">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  placeholder,
  id,
  suffix,
  testId,
  allowEmpty,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  suffix?: string;
  testId?: string;
  allowEmpty?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        data-testid={testId}
        aria-label={ariaLabel}
        type="number"
        inputMode="decimal"
        className={clsx(ctl, 'tabular', suffix && 'pr-8')}
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(allowEmpty ? null : min ?? 0);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        onBlur={(e) => {
          if (e.target.value === '') return;
          let n = Number(e.target.value);
          if (min !== undefined) n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          if (n !== value) onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-ink-3">{suffix}</span>}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  defaultValue,
  disabled,
  hint,
  testId,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  defaultValue?: number;
  disabled?: boolean;
  hint?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  const changed = defaultValue !== undefined && value !== defaultValue;
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      right={
        <span className="flex items-center gap-1">
          <span className={clsx('tabular text-[11.5px]', changed ? 'text-accent-soft' : 'text-ink-3')}>{format ? format(value) : value}</span>
          {changed && (
            <button type="button" className="text-ink-3 hover:text-ink" title="Restaurar padrão" aria-label="Restaurar padrão" onClick={() => onChange(defaultValue!)}>
              <RotateCcw size={11} />
            </button>
          )}
        </span>
      }
    >
      <input
        id={id}
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-4 w-full cursor-pointer disabled:cursor-not-allowed"
      />
    </Field>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; testId?: string }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-[18px] w-[32px] shrink-0 rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3',
        )}
      >
        <span className={clsx('absolute top-[2px] left-[2px] h-[12px] w-[12px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[14px]' : 'translate-x-0')} />
      </button>
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled, indeterminate, ariaLabel, testId }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; indeterminate?: boolean; ariaLabel?: string; testId?: string }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        type="checkbox"
        data-testid={testId}
        aria-label={ariaLabel}
        className="h-3.5 w-3.5 cursor-pointer rounded accent-[var(--color-accent)]"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, maxLength, id, testId, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; id?: string; testId?: string; ariaLabel?: string }) {
  return <input id={id} data-testid={testId} aria-label={ariaLabel} className={ctl} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, placeholder, maxLength, rows = 2, testId, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; rows?: number; testId?: string; ariaLabel?: string }) {
  return (
    <textarea
      data-testid={testId}
      aria-label={ariaLabel}
      className={clsx(ctl, 'h-auto resize-y py-1.5 leading-snug')}
      rows={rows}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ColorInput({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-7.5 w-9 cursor-pointer rounded-[var(--radius-ctl)] border border-line-strong bg-surface-2 p-0.5"
      />
      <span className="tabular font-mono text-[11.5px] text-ink-3">{value.toUpperCase()}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  className,
  testId,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>;
  size?: 'sm' | 'md';
  className?: string;
  testId?: string;
}) {
  return (
    <div role="radiogroup" data-testid={testId} className={clsx('inline-flex rounded-[var(--radius-ctl)] border border-line-strong bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex-1 rounded-[6px] px-2.5 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            size === 'md' ? 'h-8 text-[13px]' : 'h-6.5 text-[12px]',
            value === o.value ? 'bg-accent text-white shadow-[0_2px_10px_-3px_rgb(47_123_255/0.8)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

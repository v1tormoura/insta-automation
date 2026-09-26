import type * as React from 'react';

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  swatch: string;
}

/** Tooltip dos gráficos: texto em tokens de texto, a cor só no marcador. */
export function ChartTooltipBox({ title, rows }: { title: React.ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-foreground">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: r.swatch }} aria-hidden />
              {r.label}
            </span>
            <span className="tabular font-medium text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

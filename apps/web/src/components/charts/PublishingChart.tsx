import { CheckCircle2, XCircle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber, formatShortDay } from '@/lib/format';
import { ChartTooltipBox } from './ChartTooltip';

interface Datum {
  date: string;
  published: number;
  failed: number;
}

const SERIES = [
  { key: 'published', label: 'Publicadas', color: 'var(--chart-1)', icon: CheckCircle2 },
  { key: 'failed', label: 'Falhas', color: 'var(--chart-critical)', icon: XCircle },
] as const;

type ShapeProps = { x: number; y: number; width: number; height: number; fill: string; payload: Datum; dataKey: keyof Datum };

/**
 * Coluna empilhada: só o segmento do topo recebe o canto arredondado de 4px;
 * a base fica reta. Entre segmentos, 2px de "chão" (stroke na cor da superfície).
 */
function Segment({ x, y, width, height, fill, payload, dataKey }: ShapeProps) {
  if (!height || height <= 0) return null;
  const isTop = dataKey === 'failed' ? payload.failed > 0 : payload.failed === 0;
  const r = isTop ? Math.min(4, height) : 0;
  const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
  return <path d={d} fill={fill} stroke="var(--chart-surface)" strokeWidth={2} />;
}

export function PublishingChart({ data }: { data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.published + d.failed, 0);
  return (
    <div className="flex h-full min-h-72 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-label="Legenda">
        {SERIES.map(({ key, label, color, icon: Icon }) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />
            <Icon className="size-3.5" aria-hidden />
            {label}
          </span>
        ))}
      </div>
      <div className="min-h-60 flex-1" role="img" aria-label={`Publicações por dia nos últimos 14 dias, total ${total}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDay}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={18}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: 'var(--accent)', opacity: 0.6 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <ChartTooltipBox
                    title={formatShortDay(String(label))}
                    rows={SERIES.map((s) => ({ key: s.key, label: s.label, swatch: s.color, value: formatNumber(Number((payload[0]!.payload as Datum)[s.key])) }))}
                  />
                ) : null
              }
            />
            {SERIES.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="jobs"
                fill={s.color}
                maxBarSize={24}
                isAnimationActive={false}
                shape={(props: unknown) => <Segment {...(props as ShapeProps)} dataKey={s.key} />}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

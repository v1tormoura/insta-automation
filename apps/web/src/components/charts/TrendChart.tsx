import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatNumber, formatShortDay } from '@/lib/format';
import { ChartTooltipBox } from './ChartTooltip';

/**
 * Série única ao longo do tempo: linha de 2px, área em lavagem de 10%, eixo
 * único, crosshair com tooltip. Sem caixa de legenda — o título do card nomeia a série.
 */
export function TrendChart({
  data,
  dataKey,
  label,
  height = 220,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  label: string;
  height?: number;
}) {
  const gradientId = `trend-${dataKey}`;
  return (
    <div style={{ height }} role="img" aria-label={`${label} por dia`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDay}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v: number) => formatCompact(v)}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={['auto', 'auto']}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeOpacity: 0.4 }}
            content={({ active, payload, label: l }) =>
              active && payload?.length ? (
                <ChartTooltipBox
                  title={formatShortDay(String(l))}
                  rows={[{ key: dataKey, label, swatch: 'var(--chart-1)', value: formatNumber(payload[0]!.value as number) }]}
                />
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradientId})`}
            connectNulls
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--chart-surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

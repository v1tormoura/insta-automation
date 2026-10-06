import {
  Area, AreaChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

/** Gráfico "publicado × previsto" do Dashboard — num arquivo só dele para o
 *  recharts não pesar no carregamento do painel. */
export default function GraficoDePrevisao({ dados, tooltipStyle }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={dados} margin={{ top:10, right:4, left:-28, bottom:0 }}>
        <defs>
          <linearGradient id="fg-chart" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--mf-primary-500)" stopOpacity={.3} />
            <stop offset="100%" stopColor="var(--mf-primary-500)" stopOpacity={0}  />
          </linearGradient>
          <linearGradient id="fg-chart-amber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--mf-warning-500)" stopOpacity={.35} />
            <stop offset="100%" stopColor="var(--mf-warning-500)" stopOpacity={0}   />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tick={{ fontSize: 'var(--mf-t-nano)', fill:'var(--mf-text-3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tick={{ fontSize: 'var(--mf-t-nano)', fill:'var(--mf-text-3)' }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color:'var(--mf-text)' }} formatter={(v, name) => [v, name === 'published' ? 'Publicado' : 'Previsto']} />
        <Area type="monotone" dataKey="published"  stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth={2} fill="url(#fg-chart)"       dot={false} activeDot={{ r:4, fill:'var(--mf-mod, var(--mf-accent-500))' }} connectNulls={false} />
        <Area type="monotone" dataKey="forecasted" stroke="var(--mf-warning-500)"      strokeWidth={2} fill="url(#fg-chart-amber)" dot={false} activeDot={{ r:4, fill:'var(--mf-warning-500)'      }} connectNulls={false} strokeDasharray="5 3" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

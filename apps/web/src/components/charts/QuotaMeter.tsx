import { cn } from '@/lib/utils';

/**
 * Uso da cota de publicações da Meta (janela de 24h). O preenchimento carrega
 * a severidade; o trilho é um tom mais claro do mesmo matiz.
 */
export function QuotaMeter({ usage, total, className }: { usage: number | null; total: number | null; className?: string }) {
  if (usage === null) return <p className={cn('text-xs text-muted-foreground', className)}>Cota ainda não consultada</p>;
  const cap = total ?? 100;
  const pct = Math.min(100, Math.round((usage / cap) * 100));
  const tone = pct >= 90 ? 'destructive' : pct >= 70 ? 'warning' : 'primary';
  const fill = { destructive: 'bg-destructive', warning: 'bg-warning', primary: 'bg-primary' }[tone];
  const track = { destructive: 'bg-destructive/15', warning: 'bg-warning/15', primary: 'bg-primary/15' }[tone];
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Cota 24h</span>
        <span className="tabular">
          {usage}/{cap}
        </span>
      </div>
      <div className={cn('h-1.5 overflow-hidden rounded-full', track)} role="meter" aria-valuenow={usage} aria-valuemin={0} aria-valuemax={cap} aria-label="Uso da cota de publicações">
        <div className={cn('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

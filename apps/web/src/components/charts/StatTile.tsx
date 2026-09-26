import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  icon: Icon,
  footnote,
  loading,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  footnote?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn('relative overflow-hidden p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      {loading ? <Skeleton className="mt-3 h-7 w-20" /> : <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>}
      {footnote && <div className="mt-1 text-xs text-muted-foreground">{footnote}</div>}
    </Card>
  );
}

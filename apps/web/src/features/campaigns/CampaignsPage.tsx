import type { CampaignDTO } from '@nexora/shared';
import { CalendarRange, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { CampaignStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { useCampaigns } from './api';

export function campaignProgress(c: Pick<CampaignDTO, 'counts'>) {
  const done = c.counts.published + c.counts.failed + c.counts.canceled;
  return c.counts.total ? Math.round((done / c.counts.total) * 100) : 0;
}

function CampaignCard({ c }: { c: CampaignDTO }) {
  const pct = campaignProgress(c);
  return (
    <Link to={`/campaigns/${c.id}`}>
      <Card className="space-y-4 p-5 transition-colors hover:bg-accent/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{c.name}</p>
            <p className="text-xs text-muted-foreground">
              {c.postIds.length} conteúdo(s) × {c.accountIds.length} conta(s) · a cada {formatMinutes(c.intervalMinutes)}
            </p>
          </div>
          <CampaignStatusBadge status={c.status} />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="tabular">
              {c.counts.published}/{c.counts.total} publicadas{c.counts.failed ? ` · ${c.counts.failed} falhas` : ''}
            </span>
            <span className="tabular">{pct}%</span>
          </div>
          <Progress value={pct} />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(c.startAt)} → {formatDateTime(c.endsAt)}
        </p>
      </Card>
    </Link>
  );
}

export function CampaignsPage() {
  const { data, isLoading, error, refetch } = useCampaigns();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Filas de publicação"
        description="Vários conteúdos, várias contas, com intervalo entre publicações. Pause, retome ou cancele quando quiser."
        actions={
          <Button asChild>
            <Link to="/campaigns/new">
              <Plus /> Nova fila
            </Link>
          </Button>
        }
      />
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : data?.items.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((c) => (
            <CampaignCard key={c.id} c={c} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarRange}
          title="Nenhuma fila criada"
          description="Monte uma sequência de posts para uma ou várias contas e deixe o Nexora publicar no ritmo que você definir."
          action={
            <Button asChild>
              <Link to="/campaigns/new">
                <Plus /> Criar fila
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

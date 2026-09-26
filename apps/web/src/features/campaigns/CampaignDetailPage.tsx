import { ArrowLeft, Ban, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Pagination } from '@/components/Pagination';
import { ErrorState } from '@/components/States';
import { CampaignStatusBadge } from '@/components/StatusBadge';
import { StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobs } from '@/features/compose/api';
import { JobRow } from '@/features/queue/JobRow';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { CalendarClock, CheckCircle2, Hourglass, XCircle } from 'lucide-react';
import { useCampaign, useCampaignAction } from './api';
import { campaignProgress } from './CampaignsPage';

export function CampaignDetailPage() {
  const { id } = useParams();
  const { data: c, isLoading, error, refetch } = useCampaign(id);
  const action = useCampaignAction();
  const [page, setPage] = useState(1);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const jobs = useJobs({ campaignId: id, page, pageSize: 30, sort: 'runAt' });

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !c) return <ErrorState error={error ?? new Error('Fila não encontrada.')} onRetry={() => void refetch()} />;

  const run = (a: 'pause' | 'resume' | 'cancel', ok: string) =>
    action.mutate({ id: c.id, action: a }, { onSuccess: () => (toast.success(ok), setConfirmCancel(false)), onError: (e) => toast.error(errorMessage(e)) });
  const pct = campaignProgress(c);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/campaigns">
          <ArrowLeft /> Filas
        </Link>
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.name}</h1>
            <CampaignStatusBadge status={c.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {c.postIds.length} conteúdo(s) × {c.accountIds.length} conta(s) · a cada {formatMinutes(c.intervalMinutes)} · contas espaçadas em {formatMinutes(c.accountStaggerMinutes)}
          </p>
        </div>
        <div className="flex gap-2">
          {c.status === 'ACTIVE' && (
            <Button variant="outline" loading={action.isPending} onClick={() => run('pause', 'Fila pausada.')}>
              <Pause /> Pausar
            </Button>
          )}
          {c.status === 'PAUSED' && (
            <Button loading={action.isPending} onClick={() => run('resume', 'Fila retomada.')}>
              <Play /> Retomar
            </Button>
          )}
          {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
            <Button variant="outline" onClick={() => setConfirmCancel(true)}>
              <Ban /> Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Publicadas" icon={CheckCircle2} value={c.counts.published} footnote={`de ${c.counts.total}`} />
        <StatTile label="Pendentes" icon={Hourglass} value={c.counts.pending} footnote={c.status === 'PAUSED' ? 'Fila pausada' : `Termina ${formatDateTime(c.endsAt)}`} />
        <StatTile label="Falhas" icon={XCircle} value={c.counts.failed} footnote={c.counts.failed ? 'Veja abaixo e tente de novo' : 'Nenhuma'} />
        <StatTile label="Início" icon={CalendarClock} value={<span className="text-lg">{formatDateTime(c.startAt)}</span>} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progresso · {pct}%</CardTitle>
          <Progress value={pct} className="mt-2" />
        </CardHeader>
        <CardContent className="py-2">
          {jobs.isLoading ? (
            <Skeleton className="my-4 h-40 w-full" />
          ) : (
            <div className="divide-y">{jobs.data?.items.map((j) => <JobRow key={j.id} job={j} />)}</div>
          )}
          {jobs.data && <Pagination page={jobs.data.page} pageSize={jobs.data.pageSize} total={jobs.data.total} onPage={setPage} />}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        destructive
        title="Cancelar a fila?"
        description="Tudo que ainda não começou a publicar será cancelado. O que já foi publicado continua no Instagram."
        confirmLabel="Cancelar fila"
        loading={action.isPending}
        onConfirm={() => run('cancel', 'Fila cancelada.')}
      />
    </div>
  );
}

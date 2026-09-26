import { AlertTriangle, CalendarClock, CheckCircle2, Camera as Instagram, PenSquare, Send, Users } from 'lucide-react';
import { Link } from 'react-router';
import { AccountAvatar } from '@/components/AccountAvatar';
import { PublishingChart } from '@/components/charts/PublishingChart';
import { QuotaMeter } from '@/components/charts/QuotaMeter';
import { StatTile } from '@/components/charts/StatTile';
import { AccountStatusBadge } from '@/components/StatusBadge';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccounts, useConnectInstagram } from '@/features/accounts/api';
import { useMe } from '@/features/auth/session';
import { JobRow } from '@/features/queue/JobRow';
import { errorMessage } from '@/lib/api';
import { formatCompact, formatNumber, formatPercent } from '@/lib/format';
import { toast } from 'sonner';
import { useDashboard } from './api';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function Onboarding() {
  const connect = useConnectInstagram();
  return (
    <Card className="brand-glow overflow-hidden">
      <CardContent className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1.4fr_1fr] md:items-center">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Comece conectando sua primeira conta</h2>
          <p className="text-sm text-muted-foreground">
            A conexão é feita pela Meta: você autoriza no Instagram e voltamos para cá. Precisamos de uma conta profissional (Empresa ou Criador de conteúdo).
            Nunca pedimos sua senha.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button loading={connect.isPending} onClick={() => connect.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
              <Instagram /> Conectar Instagram
            </Button>
            <Button asChild variant="outline">
              <Link to="/compose">Explorar o editor</Link>
            </Button>
          </div>
        </div>
        <ol className="space-y-3 text-sm">
          {['Conecte uma ou mais contas', 'Envie fotos e vídeos para a biblioteca', 'Publique agora, agende ou monte uma fila'].map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className="grid size-7 place-items-center rounded-full border bg-card text-xs font-semibold">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data: user } = useMe();
  const { data, isLoading, error, refetch } = useDashboard();
  const { data: accounts } = useAccounts();

  const attention = (data?.accounts.byStatus.EXPIRED ?? 0) + (data?.accounts.byStatus.ERROR ?? 0);
  const noAccounts = !isLoading && data && data.accounts.total === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        description="O que está saindo, o que já saiu e como estão as suas contas."
        actions={
          <Button asChild>
            <Link to="/compose">
              <PenSquare /> Nova publicação
            </Link>
          </Button>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {noAccounts && <Onboarding />}

      {attention > 0 && (
        <Link
          to="/accounts"
          className="flex items-center gap-3 rounded-xl border border-warning/35 bg-warning/8 px-4 py-3 text-sm transition-colors hover:bg-warning/12"
        >
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          <span className="flex-1">
            {attention === 1 ? '1 conta precisa' : `${attention} contas precisam`} de atenção. Publicações nelas ficam paradas até a reconexão.
          </span>
          <span className="font-medium">Ver contas →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Contas conectadas"
          icon={Instagram}
          loading={isLoading}
          value={formatNumber(data?.accounts.total)}
          footnote={attention ? <span className="text-warning">{attention} com problema</span> : 'Todas saudáveis'}
        />
        <StatTile label="Seguidores somados" icon={Users} loading={isLoading} value={formatCompact(data?.accounts.followers)} footnote="Todas as contas" />
        <StatTile
          label="Agendadas"
          icon={CalendarClock}
          loading={isLoading}
          value={formatNumber(data?.jobs.scheduled)}
          footnote={data?.jobs.active ? `${data.jobs.active} em andamento agora` : 'Nada em andamento'}
        />
        <StatTile label="Publicadas hoje" icon={Send} loading={isLoading} value={formatNumber(data?.jobs.publishedToday)} footnote={`${formatNumber(data?.jobs.published7d)} nos últimos 7 dias`} />
        <StatTile
          label="Sucesso (7 dias)"
          icon={CheckCircle2}
          loading={isLoading}
          value={formatPercent(data?.jobs.successRate7d)}
          footnote={data?.jobs.failed7d ? <span className="text-destructive">{data.jobs.failed7d} {data.jobs.failed7d === 1 ? 'falha' : 'falhas'}</span> : 'Nenhuma falha'}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>Publicações por dia</CardTitle>
            <CardDescription>Últimos 14 dias, todas as contas.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">{isLoading || !data ? <Skeleton className="h-64 w-full" /> : <PublishingChart data={data.daily} />}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="space-y-1">
              <CardTitle>Próximas publicações</CardTitle>
              <CardDescription>Na fila e agendadas.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/queue">Ver fila</Link>
            </Button>
          </CardHeader>
          <CardContent className="py-2">
            {isLoading ? (
              <div className="space-y-3 py-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : data?.upcoming.length ? (
              <div className="divide-y">{data.upcoming.slice(0, 5).map((j) => <JobRow key={j.id} job={j} compact />)}</div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Nada agendado. Que tal programar a semana?</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div className="space-y-1">
              <CardTitle>Atividade recente</CardTitle>
              <CardDescription>Últimas publicações concluídas ou com falha.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/history">Histórico</Link>
            </Button>
          </CardHeader>
          <CardContent className="py-2">
            {data?.recent.length ? (
              <div className="divide-y">{data.recent.map((j) => <JobRow key={j.id} job={j} />)}</div>
            ) : (
              <EmptyState icon={Send} title="Nenhuma publicação ainda" description="Quando algo for publicado, aparece aqui em tempo real." className="my-3 border-0" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="space-y-1">
              <CardTitle>Contas</CardTitle>
              <CardDescription>Status e cota de publicação.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/accounts">Gerenciar</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {accounts?.filter((a) => a.status !== 'DISCONNECTED').slice(0, 6).map((a) => (
              <div key={a.id} className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <AccountAvatar username={a.username} src={a.profilePictureUrl} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">@{a.username}</p>
                    <p className="text-xs text-muted-foreground">{formatCompact(a.followersCount)} seguidores</p>
                  </div>
                  <AccountStatusBadge status={a.status} />
                </div>
                <QuotaMeter usage={a.publishing.quotaUsage} total={a.publishing.quotaTotal} />
              </div>
            ))}
            {!accounts?.some((a) => a.status !== 'DISCONNECTED') && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma conta conectada.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

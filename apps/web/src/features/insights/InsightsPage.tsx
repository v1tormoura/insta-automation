import { INSIGHT_RANGES, type AccountDTO, type InsightRange, type MediaInsightDTO } from '@nexora/shared';
import { BarChart3, ExternalLink, Info, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AccountAvatar } from '@/components/AccountAvatar';
import { StatTile } from '@/components/charts/StatTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccounts } from '@/features/accounts/api';
import { errorMessage } from '@/lib/api';
import { formatCompact, formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { Eye, Heart, MessageCircle, Share2, Sparkles, Users } from 'lucide-react';
import { useAccountInsights, useMediaInsights, useRefreshInsights } from './api';

const RANGE_LABEL: Record<InsightRange, string> = { '7d': '7 dias', '14d': '14 dias', '30d': '30 dias' };
const TILE_ICON: Record<string, typeof Eye> = {
  reach: Users,
  views: Eye,
  accounts_engaged: Sparkles,
  total_interactions: Heart,
  likes: Heart,
  comments: MessageCircle,
  shares: Share2,
};
const SORTS = [
  { id: 'recent', label: 'Mais recentes' },
  { id: 'views', label: 'Visualizações' },
  { id: 'reach', label: 'Alcance' },
  { id: 'total_interactions', label: 'Interações' },
  { id: 'likes', label: 'Curtidas' },
  { id: 'comments', label: 'Comentários' },
  { id: 'saved', label: 'Salvamentos' },
  { id: 'shares', label: 'Compartilhamentos' },
];
const MEDIA_COLUMNS = [
  ['views', 'Visualiz.'],
  ['reach', 'Alcance'],
  ['likes', 'Curtidas'],
  ['comments', 'Coment.'],
  ['saved', 'Salvos'],
  ['shares', 'Compart.'],
] as const;

function AccountPicker({ accounts, value, onChange }: { accounts: AccountDTO[]; value?: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-60" aria-label="Conta">
        <SelectValue placeholder="Escolha uma conta" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            @{a.username}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MediaTable({ items }: { items: MediaInsightDTO[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Publicação</th>
            {MEDIA_COLUMNS.map(([, label]) => (
              <th key={label} className="px-2 py-2 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((m) => (
            <tr key={m.igMediaId} className="align-middle">
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                    {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-1 max-w-xs">{m.caption || <span className="text-muted-foreground">Sem legenda</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.productType === 'REELS' ? 'Reel' : m.productType === 'STORY' ? 'Story' : m.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Foto'} ·{' '}
                      {formatDateTime(m.timestamp)}
                      {m.permalink && (
                        <a href={m.permalink} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-primary hover:underline">
                          abrir <ExternalLink className="ml-0.5 size-3" />
                        </a>
                      )}
                    </p>
                  </div>
                </div>
              </td>
              {MEDIA_COLUMNS.map(([key]) => (
                <td key={key} className="tabular px-2 py-2.5 text-right">
                  {m.metrics[key] === undefined || m.metrics[key] === null ? <span className="text-muted-foreground">—</span> : formatCompact(m.metrics[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsPage() {
  const { data: accounts, isLoading: loadingAccounts } = useAccounts();
  const usable = accounts?.filter((a) => a.status !== 'DISCONNECTED') ?? [];
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account') ?? undefined;
  const [range, setRange] = useState<InsightRange>('30d');
  const [sort, setSort] = useState('recent');
  const insights = useAccountInsights(accountId, range);
  const media = useMediaInsights({ accountId, sort, limit: 30 });
  const refresh = useRefreshInsights();
  const account = usable.find((a) => a.id === accountId);

  useEffect(() => {
    if (!accountId && usable[0]) setParams({ account: usable[0].id }, { replace: true });
  }, [accountId, usable, setParams]);

  if (!loadingAccounts && usable.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Métricas" />
        <EmptyState
          icon={BarChart3}
          title="Conecte uma conta para ver métricas"
          action={
            <Button asChild>
              <Link to="/accounts">Conectar Instagram</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const data = insights.data;
  const globalUnavailable = data?.unavailable.find((u) => u.key === '*');
  const partial = data?.unavailable.filter((u) => u.key !== '*') ?? [];
  const tiles = data?.totals.filter((t) => ['reach', 'views', 'accounts_engaged', 'total_interactions'].includes(t.key)) ?? [];
  const secondary = data?.totals.filter((t) => !['reach', 'views', 'accounts_engaged', 'total_interactions'].includes(t.key)) ?? [];
  const hasReach = data?.series.some((p) => p.reach !== null);
  const hasFollowers = (data?.series.filter((p) => p.followers !== null).length ?? 0) > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métricas"
        description="Dados oficiais da Meta (Instagram Insights). A Meta consolida as métricas com algumas horas de atraso."
        actions={
          <Button
            variant="outline"
            disabled={!accountId}
            loading={refresh.isPending}
            onClick={() => accountId && refresh.mutate(accountId, { onSuccess: () => toast.success('Atualização solicitada. Os dados chegam em instantes.'), onError: (e) => toast.error(errorMessage(e)) })}
          >
            <RefreshCw /> Atualizar
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {account && <AccountAvatar username={account.username} src={account.profilePictureUrl} className="size-9" />}
          <AccountPicker accounts={usable} value={accountId} onChange={(id) => setParams({ account: id })} />
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as InsightRange)}>
          <TabsList>
            {INSIGHT_RANGES.map((r) => (
              <TabsTrigger key={r} value={r}>
                {RANGE_LABEL[r]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {insights.error && <ErrorState error={insights.error} onRetry={() => void insights.refetch()} />}
      {globalUnavailable && (
        <Alert variant="warning">
          <Info />
          <AlertTitle>Métricas indisponíveis para esta conta</AlertTitle>
          <AlertDescription>{globalUnavailable.reason}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Seguidores" icon={Users} loading={!account} value={formatCompact(account?.followersCount)} footnote={`${formatNumber(account?.mediaCount)} posts no perfil`} />
        {(tiles.length ? tiles : Array.from({ length: 4 }, (_, i) => ({ key: String(i), label: '…', value: null }))).map((t) => (
          <StatTile key={t.key} label={t.label} icon={TILE_ICON[t.key] ?? BarChart3} loading={insights.isLoading} value={formatCompact(t.value)} footnote={RANGE_LABEL[range]} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alcance diário</CardTitle>
            <CardDescription>Contas únicas alcançadas por dia.</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : hasReach ? (
              <TrendChart data={data!.series} dataKey="reach" label="Alcance" />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">A Meta não retornou a série diária de alcance para este período.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Seguidores</CardTitle>
            <CardDescription>Total de seguidores registrado a cada sincronização diária.</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : hasFollowers ? (
              <TrendChart data={data!.series} dataKey="followers" label="Seguidores" />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">O histórico começa a ser registrado a partir da conexão. Volte em alguns dias.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {secondary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Engajamento no período</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {secondary.map((t) => (
                <div key={t.key}>
                  <dt className="text-xs text-muted-foreground">{t.label}</dt>
                  <dd className="text-lg font-semibold">{formatCompact(t.value)}</dd>
                </div>
              ))}
            </dl>
            {partial.length > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Indisponíveis pela API oficial para esta conta: {partial.map((u) => data?.totals.find((t) => t.key === u.key)?.label ?? (u.key === 'reach_series' ? 'série diária de alcance' : u.key)).join(', ')}. {partial[0]?.reason}
              </p>
            )}
            {data && <p className="mt-2 text-[11px] text-muted-foreground">Consultado {formatRelative(data.fetchedAt)}.</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Desempenho das publicações</CardTitle>
            <CardDescription>Últimas 25 mídias da conta, sincronizadas a cada 6 horas.</CardDescription>
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-44" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {media.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : media.data?.length ? (
            <MediaTable items={media.data} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mídia sincronizada ainda. Clique em “Atualizar” para buscar agora.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

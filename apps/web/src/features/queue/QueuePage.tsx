import { CalendarClock, ListOrdered, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccountFilter } from '@/features/accounts/AccountFilter';
import { useJobs } from '@/features/compose/api';
import { JobRow } from './JobRow';

const TABS = {
  active: { label: 'Em andamento', icon: Loader2, status: 'QUEUED,CREATING,PROCESSING,PUBLISHING', sort: 'runAt' as const, empty: 'Nada sendo publicado agora.' },
  scheduled: { label: 'Agendadas', icon: CalendarClock, status: 'SCHEDULED', sort: 'runAt' as const, empty: 'Nenhuma publicação agendada.' },
  failed: { label: 'Falhas', icon: XCircle, status: 'FAILED', sort: '-updatedAt' as const, empty: 'Nenhuma falha. 🎉' },
};
type TabId = keyof typeof TABS;

export function QueuePage() {
  const [tab, setTab] = useState<TabId>('active');
  const [accountId, setAccountId] = useState<string>();
  const [page, setPage] = useState(1);
  const cfg = TABS[tab];
  const { data, isLoading, error, refetch } = useJobs(
    { status: cfg.status, accountId, page, pageSize: 25, sort: cfg.sort },
    // Rede de segurança caso o SSE caia: a aba "em andamento" se atualiza sozinha.
    { refetchInterval: tab === 'active' ? 15_000 : undefined },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Em andamento"
        description="Acompanhe cada publicação por conta, ao vivo. Uma conta com problema não segura as outras."
        actions={
          <Button asChild variant="outline">
            <Link to="/history">Ver histórico</Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as TabId);
            setPage(1);
          }}
        >
          <TabsList>
            {Object.entries(TABS).map(([id, t]) => (
              <TabsTrigger key={id} value={id}>
                <t.icon aria-hidden /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <AccountFilter
          value={accountId}
          onChange={(id) => {
            setAccountId(id);
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <Card>
          <CardContent className="py-1">
            {isLoading ? (
              <div className="space-y-3 py-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : data?.items.length ? (
              <div className="divide-y">{data.items.map((j) => <JobRow key={j.id} job={j} />)}</div>
            ) : (
              <EmptyState icon={ListOrdered} title={cfg.empty} className="my-4 border-0" />
            )}
          </CardContent>
        </Card>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

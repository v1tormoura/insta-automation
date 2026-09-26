import { Bell, CheckCheck } from 'lucide-react';
import { NotificationItem } from '@/components/layout/NotificationBell';
import { EmptyState, ErrorState, PageHeader } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarkNotificationsRead, useNotifications } from './api';

export function NotificationsPage() {
  const { data, isLoading, error, refetch } = useNotifications();
  const mark = useMarkNotificationsRead();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificações"
        description="Sucessos, falhas e avisos das suas contas e publicações."
        actions={
          data?.unread ? (
            <Button variant="outline" onClick={() => mark.mutate({ all: true })}>
              <CheckCheck /> Marcar todas como lidas
            </Button>
          ) : null
        }
      />
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : data?.items.length ? (
        <Card className="divide-y overflow-hidden">
          {data.items.map((n) => (
            <NotificationItem key={n.id} n={n} />
          ))}
        </Card>
      ) : (
        <EmptyState icon={Bell} title="Tudo em dia" description="As notificações aparecem aqui e em tempo real no sino." />
      )}
    </div>
  );
}

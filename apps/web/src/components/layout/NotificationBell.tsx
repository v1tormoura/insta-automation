import type { NotificationDTO } from '@nexora/shared';
import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const LEVEL_ICON = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info } as const;
const LEVEL_COLOR = { success: 'text-success', error: 'text-destructive', warning: 'text-warning', info: 'text-info' } as const;

export function NotificationItem({ n, compact }: { n: NotificationDTO; compact?: boolean }) {
  const Icon = LEVEL_ICON[n.level];
  const body = (
    <div className={cn('flex gap-3 px-4 py-3 transition-colors hover:bg-accent/60', !n.readAt && 'bg-brand/[0.04]')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', LEVEL_COLOR[n.level])} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm leading-snug font-medium">{n.title}</p>
        {n.body && <p className={cn('text-xs text-muted-foreground', compact && 'line-clamp-2')}>{n.body}</p>}
        <p className="text-[11px] text-muted-foreground/80">{formatRelative(n.createdAt)}</p>
      </div>
      {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Não lida" />}
    </div>
  );
  if (!n.link) return body;
  return n.link.startsWith('http') ? (
    <a href={n.link} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <Link to={n.link}>{body}</Link>
  );
}

export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = data?.unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ''}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-primary-foreground dark:text-[#031018]">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          {unread > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={() => markRead.mutate({ all: true })}>
              Marcar todas como lidas
            </button>
          )}
        </div>
        <div className="scrollbar-thin max-h-96 divide-y overflow-y-auto">
          {data?.items.length ? (
            data.items.slice(0, 12).map((n) => <NotificationItem key={n.id} n={n} compact />)
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma notificação por enquanto.</p>
          )}
        </div>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/notifications">Ver todas</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

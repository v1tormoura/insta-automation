import type { NotificationDTO, Paginated } from '@nexora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

type NotificationPage = Paginated<NotificationDTO> & { unread: number };

export function useNotifications() {
  return useQuery({ queryKey: qk.notifications, queryFn: () => api<NotificationPage>('/notifications', { query: { pageSize: 50 } }) });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: { all: true } | { ids: string[] }) => api('/notifications/read', { method: 'POST', body: target }),
    onMutate: (target) => {
      const now = new Date().toISOString();
      qc.setQueryData<NotificationPage>(qk.notifications, (old) => {
        if (!old) return old;
        const hit = (n: NotificationDTO) => !n.readAt && ('all' in target || target.ids.includes(n.id));
        const marked = old.items.filter(hit).length;
        return { ...old, unread: 'all' in target ? 0 : Math.max(0, old.unread - marked), items: old.items.map((n) => (hit(n) ? { ...n, readAt: now } : n)) };
      });
    },
  });
}

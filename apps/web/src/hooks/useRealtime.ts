import type { AccountDTO, JobDTO, NotificationDTO, Paginated, PostDTO, RealtimeEvent } from '@nexora/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { qk } from '@/lib/queryKeys';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

const EVENT_TYPES: RealtimeEvent['type'][] = ['job.updated', 'post.updated', 'campaign.updated', 'account.updated', 'notification.created'];

/**
 * Assina o SSE do backend e aplica cada evento no cache do TanStack Query.
 * Atualizações pontuais (job, conta) entram direto no cache; agregados
 * (dashboard, listas) são invalidados em lote para não refazer requisições a
 * cada evento de uma fila grande.
 */
export function useRealtime(enabled: boolean): RealtimeStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      for (const key of pending.current) void qc.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
      pending.current.clear();
    };
    const invalidateSoon = (...keys: readonly unknown[][]) => {
      for (const k of keys) pending.current.add(JSON.stringify(k));
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 800);
    };

    let wasOffline = false;
    const es = new EventSource('/api/events');
    es.onopen = () => {
      setStatus('live');
      // Voltou depois de cair: pode ter perdido eventos, então recarrega tudo.
      if (wasOffline) void qc.invalidateQueries();
      wasOffline = false;
    };
    es.onerror = () => {
      setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
      wasOffline = true;
    };

    const handler = (e: MessageEvent<string>) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(e.data) as RealtimeEvent;
      } catch {
        return;
      }
      applyEvent(qc, event, invalidateSoon);
    };
    for (const type of EVENT_TYPES) es.addEventListener(type, handler as EventListener);

    return () => {
      clearTimeout(timer.current);
      es.close();
    };
  }, [enabled, qc]);

  return status;
}

function replaceJob(list: Paginated<JobDTO> | undefined, job: JobDTO) {
  if (!list) return list;
  return { ...list, items: list.items.map((j) => (j.id === job.id ? job : j)) };
}

export function applyEvent(qc: QueryClient, event: RealtimeEvent, invalidateSoon: (...keys: readonly unknown[][]) => void) {
  switch (event.type) {
    case 'job.updated': {
      const { job } = event;
      qc.setQueriesData<Paginated<JobDTO>>({ queryKey: qk.jobsAll }, (old) => replaceJob(old, job));
      qc.setQueryData<PostDTO>(qk.post(job.postId), (old) =>
        old?.jobs ? { ...old, jobs: old.jobs.map((j) => (j.id === job.id ? job : j)) } : old,
      );
      invalidateSoon([...qk.jobsAll], [...qk.dashboard], ...(job.campaignId ? [[...qk.campaign(job.campaignId)]] : []));
      break;
    }
    case 'post.updated':
      qc.setQueryData<PostDTO>(qk.post(event.postId), (old) => (old ? { ...old, status: event.status, counts: event.counts } : old));
      invalidateSoon([...qk.postsAll], [...qk.dashboard]);
      break;
    case 'campaign.updated':
      invalidateSoon([...qk.campaigns], [...qk.campaign(event.campaignId)]);
      break;
    case 'account.updated':
      qc.setQueryData<{ items: AccountDTO[] }>(qk.accounts, (old) => {
        if (!old) return old;
        const exists = old.items.some((a) => a.id === event.account.id);
        return { items: exists ? old.items.map((a) => (a.id === event.account.id ? event.account : a)) : [...old.items, event.account] };
      });
      invalidateSoon([...qk.dashboard]);
      break;
    case 'notification.created': {
      const n: NotificationDTO = event.notification;
      qc.setQueryData<Paginated<NotificationDTO> & { unread: number }>(qk.notifications, (old) =>
        old ? { ...old, items: [n, ...old.items], total: old.total + 1, unread: old.unread + 1 } : old,
      );
      const show = n.level === 'success' ? toast.success : n.level === 'error' ? toast.error : n.level === 'warning' ? toast.warning : toast.info;
      show(n.title, { description: n.body || undefined });
      break;
    }
  }
}

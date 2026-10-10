import type { ServerEvent, SystemInfoDTO } from '@mediaforge/shared';
import { useEffect, useState } from 'react';
import { applyAsset, applyBatch, applyHistory, applyJob, keys, queryClient, removeAsset, removeJob } from './queries';

export type ConnectionState = 'connecting' | 'open' | 'closed';

/**
 * Conecta ao fluxo SSE do servidor e aplica cada evento ao cache do React
 * Query: progresso, estados de tarefas, importações e histórico chegam sem
 * polling. Reconecta automaticamente (EventSource) e ressincroniza ao voltar.
 */
export function useServerEvents(sessionId: string | undefined): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource('/api/events', { withCredentials: true });
    let wasClosed = false;
    es.onopen = () => {
      setState('open');
      if (wasClosed) {
        // Ressincroniza o que pode ter mudado durante a desconexão.
        void queryClient.invalidateQueries();
      }
    };
    es.onerror = () => {
      wasClosed = true;
      setState(es.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    };
    es.onmessage = (msg) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      switch (ev.type) {
        case 'job':
          applyJob(ev.job);
          break;
        case 'job-removed':
          removeJob(ev.jobId);
          break;
        case 'asset':
          applyAsset(ev.asset);
          break;
        case 'asset-removed':
          removeAsset(ev.assetId);
          break;
        case 'batch':
          applyBatch(ev.batch);
          break;
        case 'history':
          applyHistory(ev.entry);
          break;
        case 'queue':
          queryClient.setQueryData<SystemInfoDTO>(keys.system, (s) => (s ? { ...s, queue: ev.queue } : s));
          break;
        case 'session-reset':
          void queryClient.invalidateQueries();
          break;
      }
    };
    return () => es.close();
  }, [sessionId]);
  return state;
}

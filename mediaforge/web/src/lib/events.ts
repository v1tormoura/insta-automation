import type { ServerEvent, SystemInfoDTO } from '@mediaforge/shared';
import { useEffect, useState } from 'react';
import { applyAsset, applyBatch, applyHistory, applyJob, keys, queryClient, removeAsset, removeBatch, removeJob } from './queries';

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
    // Contadores do cabeçalho (arquivos, tarefas, espaço): recarrega no máximo a cada 1,5 s.
    let sessionTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshSession = () => {
      if (sessionTimer) return;
      sessionTimer = setTimeout(() => {
        sessionTimer = null;
        void queryClient.invalidateQueries({ queryKey: keys.session });
      }, 1500);
    };
    const statusOf = (id: string) => queryClient.getQueryData<Array<{ id: string; status: string }>>(keys.jobs)?.find((j) => j.id === id)?.status;
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
          if (statusOf(ev.job.id) !== ev.job.status) refreshSession();
          applyJob(ev.job);
          break;
        case 'job-removed':
          removeJob(ev.jobId);
          refreshSession();
          break;
        case 'asset':
          applyAsset(ev.asset);
          refreshSession();
          break;
        case 'asset-removed':
          removeAsset(ev.assetId);
          refreshSession();
          break;
        case 'batch':
          applyBatch(ev.batch);
          break;
        case 'batch-removed':
          removeBatch(ev.batchId);
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
    return () => {
      if (sessionTimer) clearTimeout(sessionTimer);
      es.close();
    };
  }, [sessionId]);
  return state;
}

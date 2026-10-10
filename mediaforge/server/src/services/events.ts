import type { ServerEvent } from '@mediaforge/shared';

type Listener = (event: ServerEvent) => void;

/** Distribui eventos em tempo real para as conexões SSE de cada sessão. */
export class EventHub {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, fn: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.listeners.delete(sessionId);
    };
  }

  publish(sessionId: string, event: ServerEvent) {
    for (const fn of this.listeners.get(sessionId) ?? []) {
      try {
        fn(event);
      } catch {
        /* conexão encerrada: o próprio unsubscribe remove o ouvinte */
      }
    }
  }

  broadcast(event: ServerEvent) {
    for (const sid of this.listeners.keys()) this.publish(sid, event);
  }

  connections(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

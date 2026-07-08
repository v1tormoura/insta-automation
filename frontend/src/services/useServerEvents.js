import { useEffect, useRef } from 'react';

const SSE_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/events`;

/**
 * Escuta eventos SSE do backend com reconexão automática.
 *
 * @param {string[]} events   - nomes dos eventos (ex: ['posts', 'accounts'])
 * @param {function} callback - chamada quando qualquer evento ocorrer
 * @param {object}   options  - { retryMs: número de ms entre reconexões (padrão 5000) }
 */
export function useServerEvents(events, callback, { retryMs = 2000 } = {}) {
  const cbRef    = useRef(callback);
  const esRef    = useRef(null);
  const retryRef = useRef(null);
  const aliveRef = useRef(true);

  // Mantém a referência do callback sempre atualizada sem re-subscribing
  cbRef.current = callback;

  useEffect(() => {
    aliveRef.current = true;

    function connect() {
      if (!aliveRef.current) return;

      try {
        const es = new EventSource(SSE_BASE);
        esRef.current = es;

        // Registra handlers para cada evento
        events.forEach(event => {
          es.addEventListener(event, () => {
            try { cbRef.current(); } catch {}
          });
        });

        // Heartbeat — servidor envia ": keepalive" a cada 30s
        // EventSource reconecta automaticamente em caso de erro de rede,
        // mas adiciona lógica própria para garantir reconexão mais rápida.
        es.onerror = () => {
          es.close();
          esRef.current = null;

          if (aliveRef.current) {
            // Tenta reconectar após retryMs
            retryRef.current = setTimeout(connect, retryMs);
          }
        };

        es.onopen = () => {
          // Limpa timer de retry quando a conexão é estabelecida
          if (retryRef.current) {
            clearTimeout(retryRef.current);
            retryRef.current = null;
          }
        };

      } catch {
        // SSE não disponível (backend offline) — tenta novamente
        if (aliveRef.current) {
          retryRef.current = setTimeout(connect, retryMs);
        }
      }
    }

    connect();

    return () => {
      aliveRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (esRef.current)   { esRef.current.close(); esRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

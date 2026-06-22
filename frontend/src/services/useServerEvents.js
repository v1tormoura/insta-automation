import { useEffect } from 'react';

const SSE_URL = 'http://localhost:3000/events';

/**
 * Escuta eventos SSE do backend e chama `callback` quando o evento ocorre.
 *
 * @param {string[]} events - lista de nomes de eventos para escutar (ex: ['posts', 'accounts'])
 * @param {function} callback - função chamada quando qualquer evento da lista ocorrer
 *
 * Exemplo:
 *   useServerEvents(['posts', 'accounts'], () => loadData());
 */
export function useServerEvents(events, callback) {
  useEffect(() => {
    const es = new EventSource(SSE_URL);

    events.forEach((event) => {
      es.addEventListener(event, callback);
    });

    es.onerror = () => {
      // Reconexão automática é feita pelo navegador no EventSource
    };

    return () => {
      es.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

'use strict';

/**
 * SSE broadcaster — gerencia clientes conectados e envia eventos em tempo real.
 * Inclui limpeza automática de clientes zumbi (conexões mortas).
 */

const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

/**
 * Emite um evento SSE para todos os clientes conectados.
 * Remove automaticamente clientes com conexão morta.
 *
 * @param {string} event - nome do evento (ex: 'posts', 'accounts', 'refresh')
 * @param {object} data  - payload JSON
 */
function broadcast(event, data = {}) {
  if (clients.size === 0) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];

  clients.forEach(res => {
    try {
      // Verifica se a conexão ainda está aberta antes de escrever
      if (res.writableEnded || res.destroyed || !res.writable) {
        dead.push(res);
        return;
      }
      const ok = res.write(message);
      // Back-pressure: se o buffer estiver cheio, remove cliente
      if (!ok) {
        res.once('drain', () => {});
      }
    } catch {
      dead.push(res);
    }
  });

  // Limpa conexões mortas
  for (const res of dead) clients.delete(res);
}

/**
 * Emite heartbeat keepalive para manter conexões SSE vivas.
 * Clientes que não conseguem receber o heartbeat são removidos.
 */
function sendHeartbeat() {
  if (clients.size === 0) return;

  const dead = [];
  clients.forEach(res => {
    try {
      if (res.writableEnded || res.destroyed || !res.writable) {
        dead.push(res);
        return;
      }
      res.write(': keepalive\n\n');
    } catch {
      dead.push(res);
    }
  });

  for (const res of dead) clients.delete(res);
}

// Heartbeat a cada 25 segundos (antes do timeout de 30s do proxy/nginx)
const heartbeatInterval = setInterval(sendHeartbeat, 25_000);
heartbeatInterval.unref(); // Não impede o processo de fechar

/**
 * Retorna o número de clientes SSE conectados.
 */
function clientCount() {
  return clients.size;
}

module.exports = { addClient, removeClient, broadcast, clientCount };

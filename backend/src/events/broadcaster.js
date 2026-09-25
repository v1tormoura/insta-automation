'use strict';

/**
 * Eventos em tempo real para o painel (SSE).
 *
 * API, fila e jobs rodam no mesmo processo, então um `Set` de conexões basta:
 * o que o worker emite chega direto aos navegadores ligados em /events.
 *
 * O heartbeat de 25s mantém a conexão viva atrás de proxies que derrubam
 * conexão ociosa (o Cloudflare corta em ~100s sem tráfego).
 */

const clients = new Set();

function addClient(res) { clients.add(res); }
function removeClient(res) { clients.delete(res); }
function clientCount() { return clients.size; }

function escrever(mensagem) {
  for (const res of clients) {
    if (res.writableEnded || res.destroyed || !res.writable) { clients.delete(res); continue; }
    try { res.write(mensagem); } catch { clients.delete(res); }
  }
}

/** Emite `event` com `data` para todos os navegadores conectados. */
function broadcast(event, data = {}) {
  if (!clients.size) return;
  escrever(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
}

setInterval(() => { if (clients.size) escrever(': keepalive\n\n'); }, 25_000).unref();

module.exports = { addClient, removeClient, broadcast, clientCount };

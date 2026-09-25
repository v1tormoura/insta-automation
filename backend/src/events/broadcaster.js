'use strict';

/**
 * Eventos em tempo real para o painel (SSE).
 *
 * API, fila e jobs rodam no mesmo processo, então um mapa de conexões basta:
 * o que o worker emite chega direto aos navegadores ligados em /events.
 *
 * Cada conexão pertence a um usuário, e cada evento vai só para o dono do
 * dado — um envio de outra pessoa nem chega a este navegador.
 *
 * O heartbeat de 25s mantém a conexão viva atrás de proxies que derrubam
 * conexão ociosa.
 */

const clients = new Map(); // res → usuarioId

function addClient(res, usuarioId) { clients.set(res, String(usuarioId || '')); }
function removeClient(res) { clients.delete(res); }
function clientCount() { return clients.size; }

function escrever(mensagem, usuarioId = null) {
  for (const [res, dono] of clients) {
    if (usuarioId !== null && dono !== String(usuarioId)) continue;
    if (res.writableEnded || res.destroyed || !res.writable) { clients.delete(res); continue; }
    try { res.write(mensagem); } catch { clients.delete(res); }
  }
}

/** Emite `event` com `data` para os navegadores do usuário `usuarioId`. Sem dono, não emite. */
function broadcast(event, data = {}, usuarioId) {
  if (!clients.size) return;
  if (!usuarioId) {
    if (!process.env.JEST_WORKER_ID) console.warn(`[SSE] evento "${event}" sem dono — descartado`);
    return;
  }
  escrever(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`, usuarioId);
}

setInterval(() => { if (clients.size) escrever(': keepalive\n\n'); }, 25_000).unref();

module.exports = { addClient, removeClient, broadcast, clientCount };

const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

/**
 * Emite um evento SSE para todos os clientes conectados.
 * @param {string} event - nome do evento (ex: 'posts', 'accounts', 'refresh')
 * @param {object} data  - payload JSON
 */
function broadcast(event, data = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => {
    try {
      res.write(message);
    } catch (_) {
      clients.delete(res);
    }
  });
}

module.exports = { addClient, removeClient, broadcast };

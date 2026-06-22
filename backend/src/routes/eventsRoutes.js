const router = require('express').Router();
const { addClient, removeClient } = require('../events/broadcaster');

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Confirma conexão ao cliente
  res.write('event: connected\ndata: {}\n\n');

  addClient(res);

  // Heartbeat a cada 30s para manter a conexão viva
  const heartbeat = setInterval(() => {
    try {
      res.write('event: ping\ndata: {}\n\n');
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res);
  });
});

module.exports = router;

'use strict';

const router = require('express').Router();
const { addClient, removeClient } = require('../events/broadcaster');

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Sem isto, proxies com buffer seguram os eventos até juntar um bloco.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  addClient(res);
  req.on('close', () => removeClient(res));
});

module.exports = router;

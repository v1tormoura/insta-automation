'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/** Exige o JWT do painel — no header Authorization ou em ?token= (EventSource não manda header). */
function auth(req, res, next) {
  const header = req.headers.authorization;
  const token = (header && header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = auth;

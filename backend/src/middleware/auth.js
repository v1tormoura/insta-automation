'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'instaflow_secret_mude_isso';

function authMiddleware(req, res, next) {
  // Aceita token no header Authorization ou como query param (para SSE/EventSource)
  const header = req.headers['authorization'];
  const token =
    (header && header.startsWith('Bearer ') ? header.slice(7) : null) ||
    req.query.token ||
    null;

  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = authMiddleware;

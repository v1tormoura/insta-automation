'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const JWT_SECRET = process.env.JWT_SECRET    || 'instaflow_secret_mude_isso';
const USERNAME   = process.env.AUTH_USERNAME || 'admin';
const PASSWORD   = process.env.AUTH_PASSWORD || 'admin123';

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== USERNAME || password !== PASSWORD) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username });
});

router.get('/me', (req, res) => {
  const header = req.headers['authorization'];
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ username: decoded.username });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;

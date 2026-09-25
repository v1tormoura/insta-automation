'use strict';

/**
 * Entrada no painel.
 *
 * Duas senhas, de propósito: o hash gravado em "Minha Conta" e AUTH_PASSWORD.
 * A do ambiente continua valendo como recuperação — inclusive quando o banco
 * não responde, que é justamente quando alguém precisa entrar para ver o que
 * aconteceu. Cada entrada por ela sai no log.
 */

const router = require('express').Router();
const jwt = require('jsonwebtoken');
const config = require('../config');
const usuario = require('../repos/usuario');
const senhas = require('../services/senhaDoPainel');

async function _conferir(senha) {
  try {
    const u = await usuario.carregar();
    if (u.senhaHash && senhas.conferir(senha, u.senhaHash)) return { ok: true, via: 'hash' };
    return { ok: senha === config.authPassword, via: 'ambiente' };
  } catch (err) {
    console.log(`⚠️  [Auth] Não deu para ler o usuário: ${err.message}`);
    return { ok: senha === config.authPassword, via: 'ambiente-sem-banco' };
  }
}

async function senhaConfere(senha) {
  const r = await _conferir(senha);
  if (r.ok && r.via !== 'hash') console.log(`🔑 [Auth] Entrada com a senha do ambiente (${r.via}).`);
  return r;
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (username !== config.authUsername || typeof password !== 'string' || !(await senhaConfere(password)).ok) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  }
  const token = jwt.sign({ username }, config.jwtSecret, { expiresIn: '30d' });
  res.json({ token, username });
});

router.get('/me', (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    res.json({ username: jwt.verify(token, config.jwtSecret).username });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
module.exports.senhaConfere = senhaConfere;

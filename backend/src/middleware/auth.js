'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { sql } = require('../db');

/**
 * O usuário ATIVO por trás do JWT da requisição — no header Authorization ou
 * em ?token= (EventSource não manda header).
 *
 * Relido a cada requisição (uma consulta por chave primária): bloquear alguém
 * no painel corta o acesso na hora, sem esperar o token de 30 dias vencer.
 *
 * @returns {Promise<{usuario?: object, erro?: string, code?: string}>}
 */
async function lerUsuario(req) {
  const header = req.headers.authorization;
  const token = (header && header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null;
  if (!token) return { erro: 'Não autenticado' };

  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); }
  catch { return { erro: 'Token inválido ou expirado' }; }
  // Token da versão de usuário único (sem `sub`): entra de novo.
  if (!payload?.sub) return { erro: 'Sessão antiga — entre de novo' };

  const [u] = await sql`select id, papel, status, nome, email, avatar from usuarios where id = ${payload.sub}`;
  if (!u || u.status !== 'ativo') return { erro: 'Acesso não autorizado', code: 'ACESSO_REVOGADO' };
  return { usuario: u };
}

/** Exige login. `req.user` = { id, papel, status, nome, email, avatar }. */
async function auth(req, res, next) {
  try {
    const r = await lerUsuario(req);
    if (!r.usuario) return res.status(401).json({ error: r.erro, ...(r.code ? { code: r.code } : {}) });
    req.user = r.usuario;
    next();
  } catch (err) {
    next(err);
  }
}

/** Depois de `auth`: só o admin passa. */
function soAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') return res.status(403).json({ error: 'Só o administrador pode fazer isto', code: 'SO_ADMIN' });
  next();
}

module.exports = auth;
module.exports.soAdmin = soAdmin;
module.exports.lerUsuario = lerUsuario;

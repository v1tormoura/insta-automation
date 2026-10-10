'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const usuarios = require('../repos/usuario');

/**
 * O usuário ATIVO por trás do JWT da requisição — no header Authorization ou
 * em ?token= (EventSource não manda header).
 *
 * Conferido a cada requisição (com uma cópia de poucos segundos em memória,
 * esquecida a cada alteração do usuário): bloquear alguém no painel corta o
 * acesso na hora, sem esperar o token de 30 dias vencer.
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
  if (payload.tipo) return { erro: 'Token inválido ou expirado' }; // desafio do 2FA não é sessão

  const u = await usuarios.paraSessao(payload.sub);
  if (!u || u.status !== 'ativo') return { erro: 'Acesso não autorizado', code: 'ACESSO_REVOGADO' };
  // Senha redefinida pelo link: o que foi emitido antes deixa de valer.
  const { sessoesDesde, ...usuario } = u;
  if (sessoesDesde && payload.iat * 1000 < new Date(sessoesDesde).getTime() - 1000) {
    return { erro: 'Sua senha foi redefinida — entre de novo', code: 'SESSAO_ENCERRADA' };
  }
  return { usuario };
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

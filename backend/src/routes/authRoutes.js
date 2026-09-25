'use strict';

/**
 * Entrada no painel e cadastro.
 *
 *   POST /auth/login     — admin (AUTH_USERNAME) ou e-mail de usuário aprovado
 *   POST /auth/cadastro  — cria o pedido de acesso, que espera o admin aprovar
 *   GET  /auth/me        — quem está logado
 *
 * O admin tem duas senhas, de propósito: a trocada em "Minha Conta" e
 * AUTH_PASSWORD. A do ambiente continua valendo como recuperação — inclusive
 * quando o banco não responde. Usuários comuns só têm a própria.
 *
 * Contra tentativa em série: depois de 8 erros seguidos para o mesmo login
 * (ou IP), 15 minutos de espera. A resposta de erro é a mesma para e-mail
 * inexistente e senha errada — não dá para descobrir quem tem cadastro.
 */

const router = require('express').Router();
const jwt = require('jsonwebtoken');
const config = require('../config');
const usuarios = require('../repos/usuario');
const senhas = require('../services/senhaDoPainel');
const auth = require('../middleware/auth');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── Freio de tentativas ─────────────────────────────────────────────────────
const MAX_ERROS = 8;
const ESPERA_MS = 15 * 60_000;
const erros = new Map(); // chave → { n, ate }

function bloqueado(chaves) {
  const agora = Date.now();
  return chaves.some(k => { const e = erros.get(k); return e && e.ate > agora; });
}
function errou(chaves) {
  for (const k of chaves) {
    const e = erros.get(k) || { n: 0, ate: 0 };
    e.n += 1;
    if (e.n >= MAX_ERROS) { e.ate = Date.now() + ESPERA_MS; e.n = 0; }
    erros.set(k, e);
  }
  if (erros.size > 10_000) erros.clear();
}
function acertou(chaves) { for (const k of chaves) erros.delete(k); }

function emitir(u) {
  return jwt.sign({ sub: u.id, papel: u.papel }, config.jwtSecret, { expiresIn: '30d' });
}

function publico(u) {
  return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, avatar: u.avatar || '' };
}

const MENSAGEM_STATUS = {
  pendente: { code: 'CADASTRO_PENDENTE', error: 'Seu cadastro está aguardando aprovação do administrador.' },
  recusado: { code: 'CADASTRO_RECUSADO', error: 'Seu cadastro não foi aprovado.' },
  bloqueado: { code: 'CONTA_BLOQUEADA', error: 'Seu acesso foi bloqueado pelo administrador.' },
};

async function _entrarComoAdmin(senha) {
  try {
    const u = await usuarios.admin();
    if (u.senhaHash && senhas.conferir(senha, u.senhaHash)) return u;
    if (config.authPassword && senha === config.authPassword) {
      console.log('🔑 [Auth] Admin entrou com a senha do ambiente.');
      return u;
    }
  } catch (err) {
    console.log(`⚠️  [Auth] Não deu para ler o admin: ${err.message}`);
  }
  return null;
}

router.post('/login', async (req, res) => {
  const login = String(req.body?.username ?? req.body?.email ?? '').trim();
  const senha = req.body?.password;
  const chaves = [`l:${login.toLowerCase()}`, `ip:${req.ip}`];
  if (bloqueado(chaves)) {
    return res.status(429).json({ code: 'MUITAS_TENTATIVAS', error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
  }
  if (!login || typeof senha !== 'string' || !senha) {
    return res.status(400).json({ code: 'FALTA_CAMPO', error: 'Informe e-mail e senha.' });
  }

  let u = null;
  if (login.toLowerCase() === config.authUsername.toLowerCase()) {
    u = await _entrarComoAdmin(senha);
  } else {
    const candidato = await usuarios.porEmail(login);
    if (candidato?.senhaHash && senhas.conferir(senha, candidato.senhaHash)) u = candidato;
  }

  if (!u) {
    errou(chaves);
    return res.status(401).json({ code: 'CREDENCIAIS', error: 'E-mail ou senha incorretos' });
  }
  acertou(chaves);
  if (u.status !== 'ativo') return res.status(403).json(MENSAGEM_STATUS[u.status] || MENSAGEM_STATUS.bloqueado);

  await usuarios.atualizar(u.id, { ultimoLogin: new Date() }).catch(() => {});
  res.json({ token: emitir(u), usuario: publico(u) });
});

router.post('/cadastro', async (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 160);
  const senha = req.body?.senha;

  if (bloqueado([`c:${req.ip}`])) {
    return res.status(429).json({ code: 'MUITAS_TENTATIVAS', error: 'Muitos cadastros deste endereço. Tente mais tarde.' });
  }
  if (nome.length < 2) return res.status(400).json({ code: 'NOME_INVALIDO', error: 'Informe seu nome.' });
  if (!EMAIL.test(email)) return res.status(400).json({ code: 'EMAIL_INVALIDO', error: 'E-mail inválido.' });
  if (email === config.authUsername.toLowerCase()) return res.status(400).json({ code: 'EMAIL_INVALIDO', error: 'E-mail inválido.' });

  let senhaHash;
  try { senhaHash = senhas.gerar(senha); }
  catch (err) { return res.status(400).json({ code: err.code || 'SENHA_INVALIDA', error: err.message }); }

  if (await usuarios.porEmail(email)) {
    return res.status(409).json({ code: 'EMAIL_EM_USO', error: 'Já existe um cadastro com este e-mail.' });
  }

  let u;
  try {
    u = await usuarios.criar({ nome, email, senhaHash });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ code: 'EMAIL_EM_USO', error: 'Já existe um cadastro com este e-mail.' });
    throw err;
  }
  errou([`c:${req.ip}`]); // conta cadastros por IP: 8 em 15 min, depois espera
  console.log(`🆕 [Auth] Cadastro pendente: ${email}`);
  require('../services/avisosDoAdmin').novoCadastro(u).catch(e => console.log('[Auth] aviso ao admin falhou:', e.message));

  res.status(201).json({
    ok: true,
    message: 'Cadastro enviado! Você poderá entrar assim que o administrador aprovar.',
  });
});

router.get('/me', auth, (req, res) => {
  res.json(publico(req.user));
});

module.exports = router;
module.exports._freio = { erros };

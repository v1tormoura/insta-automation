'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

/**
 * Entrada no painel.
 *
 * ── Duas senhas, de propósito
 *
 * A senha sempre veio de `AUTH_PASSWORD`. Trocá-la exigia editar o `.env` e
 * reiniciar o backend, então "Minha Conta" passou a gravar um hash no banco.
 *
 * A ordem é: hash quando existe, ambiente quando não existe — e ambiente
 * TAMBÉM quando o banco não responde. Essa última é a parte que importa: se o
 * hash fosse a única forma de entrar, um Mongo fora do ar trancaria a pessoa
 * fora do painel, que é justamente onde ela iria ver que o Mongo caiu.
 *
 * Cada entrada pelo caminho alternativo sai no log. Uma porta de recuperação
 * que ninguém consegue auditar depois é uma porta que não se sabe se foi usada.
 *
 * ── O que NÃO mudou
 *
 * O formato do token, o tempo de validade e a resposta. A tela de login não
 * sabe que qualquer coisa aqui mudou, e não precisa saber.
 */

const JWT_SECRET = process.env.JWT_SECRET    || 'instaflow_secret_mude_isso';
const USERNAME   = process.env.AUTH_USERNAME || 'admin';
const PASSWORD   = process.env.AUTH_PASSWORD || 'admin123';

/** Mongoose enfileira consulta sem conexão e só desiste em 10 s. */
function bancoConectado() {
  try { return require('mongoose').connection?.readyState === 1; }
  catch { return false; }
}

/**
 * A senha confere?
 *
 * @returns {Promise<{ok: boolean, via: 'hash'|'ambiente'|'ambiente-sem-banco'}>}
 */
async function senhaConfere(senha) {
  const r = await _conferir(senha);
  /* Só quando ENTROU: registrar tentativa errada encheria o log de cada
     digitação torta, e o que se quer auditar é a entrada, não o erro. */
  if (r.ok && r.via !== 'hash') {
    console.log(`🔑 [Auth] Entrada com a senha do ambiente (${r.via}).`);
  }
  return r;
}

async function _conferir(senha) {
  if (!bancoConectado()) {
    /* Sem banco não há hash para conferir. Cair para o ambiente é a diferença
       entre "não consigo entrar para ver o problema" e "entro e vejo". */
    return { ok: senha === PASSWORD, via: 'ambiente-sem-banco' };
  }

  try {
    const Usuario = require('../models/Usuario');
    const doc = await Usuario.findOne({ chave: 'principal' }).select('+senhaHash').lean();
    const hash = doc?.senhaHash;

    if (hash) {
      const senhas = require('../services/senhaDoPainel');
      if (senhas.conferir(senha, hash)) return { ok: true, via: 'hash' };
      /* Hash existe e não bateu: ainda aceita a do ambiente, como recuperação.
         É dito na tela de Minha Conta, com essas palavras — uma troca de senha
         que deixa a antiga funcionando em silêncio seria pior que não trocar. */
      return { ok: senha === PASSWORD, via: 'ambiente' };
    }

    return { ok: senha === PASSWORD, via: 'ambiente' };
  } catch (err) {
    /* Erro ao ler o usuário não pode virar 500 no login: para quem está
       tentando entrar, 500 é indistinguível de "o servidor caiu". */
    console.log(`⚠️  [Auth] Não deu para ler o usuário: ${err.message}`);
    return { ok: senha === PASSWORD, via: 'ambiente-sem-banco' };
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (username !== USERNAME) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  }

  const r = await senhaConfere(password);
  if (!r.ok) {
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
module.exports.senhaConfere = senhaConfere;

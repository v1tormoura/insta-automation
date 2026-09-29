'use strict';

/**
 * Chamadas que a Meta faz para o servidor (sem login):
 *
 *   POST /meta/deauthorize     a pessoa removeu o app no Instagram
 *   POST /meta/data-deletion   a pessoa pediu a exclusão dos dados
 *
 * As duas chegam com `signed_request` (form-urlencoded): `assinatura.payload`,
 * em base64url, assinado com HMAC-SHA256 pelo segredo do app. Sem assinatura
 * válida para algum app cadastrado, nada é feito.
 *
 * Os endereços ficam em API Meta, para colar no painel do app.
 */

const crypto = require('crypto');
const express = require('express');
const { sql } = require('../db');
const config = require('../config');
const { decrypt } = require('../services/tokenEncryption');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const b64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Os segredos de todos os apps cadastrados (do Instagram e do Facebook). */
async function segredos() {
  const apps = await sql`select app_secret, instagram_app_secret from meta_apps`;
  const lista = [];
  for (const a of apps) {
    for (const cifrado of [a.instagramAppSecret, a.appSecret]) {
      if (!cifrado) continue;
      try { const s = decrypt(cifrado); if (s) lista.push(s); } catch { /* segredo ilegível: ignora */ }
    }
  }
  return lista;
}

/** Confere e abre o `signed_request`. `null` se nenhum segredo bate. */
function abrir(signedRequest, listaDeSegredos) {
  const [assinatura, payload] = String(signedRequest || '').split('.');
  if (!assinatura || !payload) return null;
  const recebida = b64url(assinatura);
  for (const segredo of listaDeSegredos) {
    const esperada = crypto.createHmac('sha256', segredo).update(payload).digest();
    if (esperada.length === recebida.length && crypto.timingSafeEqual(esperada, recebida)) {
      try { return JSON.parse(b64url(payload).toString('utf8')); } catch { return null; }
    }
  }
  return null;
}

async function lerPedido(req) {
  return abrir(req.body?.signed_request, await segredos());
}

router.post('/deauthorize', async (req, res) => {
  const dados = await lerPedido(req).catch(() => null);
  if (!dados?.user_id) return res.status(400).json({ error: 'signed_request inválido' });
  const contas = await sql`
    update accounts set access_token = '', health_status = 'token_invalido',
      last_error = 'Autorização removida no Instagram — reconecte a conta em Contas'
    where ig_user_id = ${String(dados.user_id)} returning id, username, usuario_id`;
  for (const c of contas) {
    console.log(`🔌 [Meta] @${c.username} removeu o app — token apagado`);
    require('../events/broadcaster').broadcast('accounts', { action: 'health_update', accountId: c.id }, c.usuarioId);
  }
  res.json({ ok: true });
});

router.post('/data-deletion', async (req, res) => {
  const dados = await lerPedido(req).catch(() => null);
  if (!dados?.user_id) return res.status(400).json({ error: 'signed_request inválido' });
  const codigo = crypto.randomBytes(8).toString('hex');
  const apagadas = await sql`select id, username from accounts where ig_user_id = ${String(dados.user_id)}`;
  const contas = require('../services/contas');
  for (const c of apagadas) await contas.remover(c.id);
  console.log(`🗑️  [Meta] exclusão de dados ${codigo}: ${apagadas.map(c => '@' + c.username).join(', ') || 'nenhuma conta encontrada'}`);
  res.json({ url: `${config.frontendUrl}/privacidade?exclusao=${codigo}`, confirmation_code: codigo });
});

module.exports = router;
module.exports._abrir = abrir;

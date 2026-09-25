'use strict';

/**
 * Conexão das contas pela API oficial.
 *
 * Públicas (o navegador que autoriza pode não estar logado no painel):
 *   GET  /url               — URL de autorização: com login, ou com `dono`
 *                             assinado (link guiado)
 *   POST /connect/:state    — conclui com a URL de retorno (state assinado)
 *   GET  /callback          — retorno direto do Instagram, se configurado para cá
 * Com login:
 *   GET    /dono            — o `dono` assinado que vai no link guiado
 *   POST   /connect-by-token
 *   DELETE /disconnect/:accountId
 */

const router = require('express').Router();
const auth = require('../middleware/auth');
const config = require('../config');
const conexao = require('../services/conexao');
const accounts = require('../repos/accounts');

/**
 * O `redirect_uri` configurado é alcançável pelo navegador de quem autoriza?
 * `localhost` com o painel num domínio público é a máquina de quem clica, não
 * o servidor — o Instagram devolveria o código para lugar nenhum.
 * @returns {string|null}
 */
function avisoDoRedirect(redirect, frontend) {
  const bruto = String(redirect || '').trim();
  if (!bruto) return 'OAUTH_REDIRECT_URI não está configurado — o Instagram não tem para onde devolver a autorização.';
  let host;
  try { host = new URL(bruto).hostname.toLowerCase().replace(/^\[|\]$/g, ''); }
  catch { return `OAUTH_REDIRECT_URI não é uma URL válida: "${bruto.slice(0, 80)}".`; }
  const local = h => ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(h);
  if (!local(host)) return null;
  let frontHost = '';
  try { frontHost = new URL(String(frontend || '')).hostname.toLowerCase(); } catch { /* sem frontend */ }
  if (!frontHost || local(frontHost)) return null;
  return `OAUTH_REDIRECT_URI aponta para ${host}, que é a máquina de quem clica — não este servidor. `
    + `Troque para ${String(frontend).replace(/\/$/, '')}/oauth-callback no .env E cadastre o mesmo endereço no painel da Meta.`;
}

/** Com login, o dono é quem está logado; no link guiado, o `dono` assinado. */
async function donoDaUrl(req) {
  if (req.query.dono) return conexao.lerDono(String(req.query.dono));
  return (await auth.lerUsuario(req)).usuario?.id || null;
}

router.get('/dono', auth, (req, res) => {
  res.json({ dono: conexao.assinarDono(req.user.id) });
});

router.get('/url', async (req, res) => {
  const usuarioId = await donoDaUrl(req);
  if (!usuarioId) return res.status(401).json({ error: 'Link de conexão inválido — gere um novo no painel.' });
  const r = await conexao.urlDeAutorizacao({
    accountId: req.query.accountId || 'new',
    metaAppId: req.query.metaAppId || null,
    usuarioId,
  });
  if (!r) return res.status(400).json({ error: 'Nenhum App Meta cadastrado. Cadastre um app na página API Meta antes de conectar.' });
  const aviso = avisoDoRedirect(config.oauthRedirectUri, config.frontendUrl);
  res.json({ ...r, ...(aviso ? { aviso } : {}) });
});

router.post('/connect/:state', async (req, res) => {
  const state = conexao.lerState(req.params.state);
  if (!state) return res.status(403).json({ error: 'Autorização inválida ou adulterada. Tente conectar novamente.' });

  let code = null;
  try { code = new URL(String(req.body?.pastedUrl || '').trim()).searchParams.get('code'); }
  catch { return res.status(400).json({ error: 'URL inválida. Cole a URL completa da barra de endereços.' }); }
  if (!code) return res.status(400).json({ error: 'A URL não tem o código da autorização. Copie a URL inteira depois de autorizar.' });

  try {
    const conta = await conexao.conectarPorCodigo(code, state);
    res.json({ success: true, username: conta.username, message: `@${conta.username} conectada via OAuth.` });
  } catch (err) {
    console.error('❌ [OAuth]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/callback', async (req, res) => {
  const erro = msg => res.redirect(`${config.frontendUrl}/accounts?oauth=error&msg=${encodeURIComponent(msg)}`);
  if (req.query.error) return erro(req.query.error_description || req.query.error);
  if (!req.query.code) return erro('codigo_nao_encontrado');
  const state = conexao.lerState(req.query.state);
  if (!state) return erro('Autorização inválida ou adulterada. Tente conectar novamente.');

  try {
    const conta = await conexao.conectarPorCodigo(req.query.code, state);
    res.redirect(`${config.frontendUrl}/conectar?ok=${encodeURIComponent(conta.username)}`);
  } catch (err) {
    console.error('❌ [OAuth] callback:', err.message);
    erro(err.message);
  }
});

router.post('/connect-by-token', auth, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });
  try {
    const conta = await conexao.conectarPorToken(token, req.body?.accountId || 'new', req.user.id);
    res.json({ success: true, username: conta.username, message: `@${conta.username} conectada via token!` });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Token inválido ou sem permissão' });
  }
});

router.delete('/disconnect/:accountId', auth, async (req, res) => {
  const conta = await accounts.de(req.user.id).update(req.params.accountId, {
    accessToken: '', tokenExpiresAt: null, healthStatus: 'token_invalido', lastError: 'Desconectada no painel — reconecte para voltar a publicar',
  });
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json({ success: true });
});

module.exports = router;
module.exports.avisoDoRedirect = avisoDoRedirect;

'use strict';

/**
 * Apps da Meta: um cadastro da plataforma, feito pelo admin. Os usuários só
 * escolhem por qual app conectar as contas — veem nome e id, nada mais.
 */

const router = require('express').Router();
const metaApps = require('../repos/metaApps');
const config = require('../config');
const { soAdmin } = require('../middleware/auth');

const aparado = v => String(v ?? '').trim();

router.get('/', async (req, res) => {
  const lista = await metaApps.listar();
  if (req.user.papel === 'admin') return res.json(lista);
  res.json(lista.map(a => ({ id: a.id, name: a.name, appId: a.appId, isDefault: a.isDefault })));
});

/* O endereço de retorno que o servidor MANDA para a Meta. A tela mostrava um
   endereço deduzido no navegador — se o do servidor for outro, cadastrar o da
   tela dá "Invalid redirect_uri" com tudo parecendo certo. */
router.get('/config', (req, res) => {
  let dominio = '';
  try { dominio = new URL(config.oauthRedirectUri).hostname; } catch { /* URI mal formada: a tela mostra só ela */ }
  res.json({
    redirectUri: config.oauthRedirectUri,
    redirectAlternativa: `${config.publicUrl}/oauth/callback`,
    desautorizacao: `${config.publicUrl}/meta/deauthorize`,
    exclusaoDeDados: `${config.publicUrl}/meta/data-deletion`,
    siteUrl: config.frontendUrl,
    dominio,
  });
});

router.use(soAdmin);

router.post('/', async (req, res) => {
  const { name, appId, appSecret, loginConfigId, instagramAppId, instagramAppSecret } = req.body || {};
  if (!aparado(name)) return res.status(400).json({ error: 'Nome obrigatório' });
  if (!aparado(appId)) return res.status(400).json({ error: 'App ID obrigatório' });
  if (!aparado(appSecret)) return res.status(400).json({ error: 'App Secret obrigatório' });
  const app = await metaApps.criar({
    name: aparado(name), appId: aparado(appId), appSecret: aparado(appSecret),
    loginConfigId: aparado(loginConfigId), instagramAppId: aparado(instagramAppId),
    instagramAppSecret: aparado(instagramAppSecret),
  });
  res.status(201).json(app);
});

router.patch('/:id', async (req, res) => {
  const campos = {};
  for (const k of ['name', 'appId', 'appSecret', 'loginConfigId', 'instagramAppId', 'instagramAppSecret']) {
    if (req.body?.[k] !== undefined) campos[k] = aparado(req.body[k]);
  }
  const app = await metaApps.atualizar(req.params.id, campos);
  if (!app) return res.status(404).json({ error: 'App não encontrado' });
  res.json(app);
});

router.post('/:id/set-default', async (req, res) => {
  if (!(await metaApps.definirPadrao(req.params.id))) return res.status(404).json({ error: 'App não encontrado' });
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  if (!(await metaApps.remover(req.params.id))) return res.status(404).json({ error: 'App não encontrado' });
  res.json({ success: true });
});

module.exports = router;

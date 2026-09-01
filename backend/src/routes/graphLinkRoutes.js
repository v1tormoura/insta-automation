'use strict';

/**
 * Conexão Graph via Facebook Login — o token que permite link em story.
 *
 * ── Por que é um SEGUNDO fluxo, e não uma permissão a mais no primeiro
 *
 * A conexão que já existe usa a "Instagram API com Instagram Login": escopos
 * `instagram_business_*`, autorização em api.instagram.com. Ela publica story
 * normalmente e RECUSA a figurinha de link — a Graph responde erro 9007, e o
 * `storyService` já trata isso caindo em story sem link.
 *
 * Link em story exige a outra porta: "Instagram API com Facebook Login". Token
 * emitido pelo diálogo do Facebook, ligado a uma PÁGINA, com a conta do
 * Instagram no modo comercial e vinculada a ela. Não é a mesma autorização com
 * um escopo extra — é outro fluxo, outro token, outro endpoint de autorização.
 *
 * Por isso os dois tokens convivem no mesmo registro de conta. Guardar num
 * campo só faria a segunda conexão apagar a primeira, e a conta perderia a
 * publicação normal para ganhar o link.
 *
 * ── O que o usuário vê
 *
 * Conecta pela API oficial como sempre. Depois, um botão a mais: "Ativar link
 * em story". Ele abre o Facebook, pede a Página, e volta. A partir daí o story
 * com link funciona — e sem ele, continua funcionando sem link, como hoje.
 */

const express = require('express');
const router = express.Router();
const Account = require('../models/Account');

const FB_AUTH  = 'https://www.facebook.com/v21.0/dialog/oauth';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

/* Escopos do Facebook Login. Cada um existe por um motivo:
     pages_show_list          — listar as Páginas para você escolher
     instagram_basic          — ler a conta do Instagram ligada à Página
     instagram_content_publish— publicar (é ele que habilita o link sticker)
     business_management      — resolver a conta quando ela vive num Business
   Pedir menos derruba o link; pedir mais pede permissão que não usamos. */
const FB_SCOPES = [
  'pages_show_list',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',');

const REDIRECT_URI = process.env.GRAPH_LINK_REDIRECT_URI
  || process.env.OAUTH_REDIRECT_URI
  || 'http://localhost:5200/oauth-callback';

/**
 * As credenciais do app DO FACEBOOK.
 *
 * O registro `MetaApp` guarda dois pares: `appId`/`appSecret` são do app do
 * Facebook, e `instagramAppId`/`instagramAppSecret` são do Instagram. O outro
 * fluxo prefere os do Instagram — aqui é o contrário, e cair no par errado faz
 * o diálogo do Facebook recusar com "app inválido", uma mensagem que não sugere
 * em nada que existem dois pares.
 */
async function credenciais(metaAppId) {
  try {
    const MetaApp = require('../models/MetaApp');
    const doc = metaAppId
      ? await MetaApp.findById(metaAppId).lean()
      : await MetaApp.findOne({ isDefault: true }).lean();
    if (doc?.appId && doc?.appSecret) {
      return { appId: doc.appId, appSecret: doc.appSecret, metaAppId: String(doc._id) };
    }
  } catch { /* sem banco ou sem registro — cai no ambiente */ }

  return {
    appId:     process.env.META_APP_ID     || '',
    appSecret: process.env.META_APP_SECRET || '',
    metaAppId: '',
  };
}

/* O state carrega a conta E o app. Sem o app, o callback resolveria o padrão —
   e se o começo usou outro, a troca do código falha com "redirect_uri
   mismatch", que manda olhar a URL de retorno em vez do app. */
function montarState(accountId, metaAppId) {
  return `fb_${accountId}${metaAppId ? `:${metaAppId}` : ''}`;
}

function lerState(cru) {
  const [accountId, metaAppId = ''] = String(cru).slice(3).split(':');
  return { accountId, metaAppId };
}

/**
 * GET /graph-link/start?accountId=...
 * Devolve a URL do diálogo do Facebook.
 */
router.get('/start', async (req, res) => {
  try {
    const { appId, metaAppId } = await credenciais(req.query.metaAppId);
    if (!appId) {
      return res.status(500).json({
        error: 'O app da Meta não está configurado no servidor.',
        code: 'SEM_APP_META',
      });
    }

    const accountId = String(req.query.accountId || '').trim();
    if (!accountId) {
      return res.status(400).json({ error: 'accountId é obrigatório.', code: 'SEM_CONTA' });
    }

    /* Mesmo state assinado do outro fluxo. CSRF aqui não é teoria: o callback
       grava um token de publicação numa conta, e sem assinatura qualquer um
       poderia induzir a gravação numa conta que não é sua. */
    const { signState } = require('../services/csrfState');
    const state = signState(montarState(accountId, metaAppId));

    const params = new URLSearchParams({
      client_id:     appId,
      redirect_uri:  REDIRECT_URI,
      scope:         FB_SCOPES,
      response_type: 'code',
      state,
    });

    res.json({ url: `${FB_AUTH}?${params.toString()}`, redirectUri: REDIRECT_URI });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'GRAPH_LINK_START_ERRO' });
  }
});

/**
 * POST /graph-link/callback  { code, state }
 * Troca o código, descobre a Página e a conta do Instagram, e grava o token.
 */
router.post('/callback', async (req, res) => {
  try {
    const { code, state } = req.body || {};
    if (!code || !state) {
      return res.status(400).json({ error: 'code e state são obrigatórios.', code: 'FALTA_CODIGO' });
    }

    /* `verifyAndStripState` devolve `{ valid, state }`, não a string. Tratá-lo
       como string faria a comparação falhar sempre — e o sintoma seria toda
       autorização voltar como "inválida ou expirada", mandando procurar o
       defeito no Facebook. */
    const { verifyAndStripState } = require('../services/csrfState');
    const { valid, state: cru } = verifyAndStripState(state);
    if (!valid || !String(cru || '').startsWith('fb_')) {
      return res.status(400).json({ error: 'Autorização inválida ou expirada.', code: 'STATE_INVALIDO' });
    }
    const { accountId, metaAppId } = lerState(cru);

    const conta = await Account.findById(accountId);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada.', code: 'CONTA_NAO_ENCONTRADA' });

    // O MESMO app que abriu o diálogo — é ele que reconhece o código.
    const { appId, appSecret } = await credenciais(metaAppId);

    // 1. Código -> token de usuário
    const tk = await _json(`${FB_GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: appSecret, redirect_uri: REDIRECT_URI, code,
    }));
    if (tk.error) return _erroMeta(res, tk.error, 'Não foi possível trocar o código por um token.');

    /* 2. Token LONGO. O curto vale uma hora, e uma conexão que morre em uma
          hora é pior que nenhuma: ela funciona no teste e falha na primeira
          publicação real do dia seguinte. */
    const longo = await _json(`${FB_GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: appId,
      client_secret: appSecret, fb_exchange_token: tk.access_token,
    }));
    const tokenUsuario = longo.access_token || tk.access_token;
    const expiraEm = longo.expires_in
      ? new Date(Date.now() + Number(longo.expires_in) * 1000)
      : new Date(Date.now() + 60 * 864e5);

    // 3. Páginas, e a conta do Instagram ligada a cada uma.
    const pages = await _json(`${FB_GRAPH}/me/accounts?` + new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      access_token: tokenUsuario, limit: '50',
    }));
    if (pages.error) return _erroMeta(res, pages.error, 'Não foi possível listar suas Páginas.');

    const comIg = (pages.data || []).filter(p => p.instagram_business_account?.id);
    if (!comIg.length) {
      return res.status(422).json({
        code: 'SEM_PAGINA_COM_INSTAGRAM',
        error: 'Nenhuma Página sua tem uma conta do Instagram vinculada.',
        comoResolver: 'No Instagram, mude a conta para Comercial e vincule-a a uma Página do Facebook. '
                    + 'É esse vínculo que a Meta exige para permitir link em story.',
      });
    }

    /* Casa pelo @ quando dá. A conta pode gerenciar várias Páginas, e escolher
       a primeira pintaria o token da conta errada — com o sintoma de o story
       sair no perfil que não era. */
    const alvo = comIg.find(p =>
      String(p.instagram_business_account.username || '').toLowerCase()
      === String(conta.username || '').toLowerCase());

    if (!alvo) {
      return res.status(422).json({
        code: 'PAGINA_NAO_CORRESPONDE',
        error: `Nenhuma Página vinculada leva a @${conta.username}.`,
        disponiveis: comIg.map(p => ({ pagina: p.name, instagram: p.instagram_business_account.username })),
        comoResolver: 'Confira se você autorizou com a conta do Facebook que administra a Página desta conta.',
      });
    }

    /* O token da PÁGINA, não o do usuário: é ele que publica em nome dela e
       não expira junto com a sessão de quem autorizou. */
    const tokenPagina = alvo.access_token || tokenUsuario;

    conta.fbAccessToken    = tokenPagina;
    conta.fbPageId         = alvo.id;
    conta.fbPageName       = alvo.name || '';
    conta.fbTokenExpiresAt = expiraEm;
    /* Em campo próprio: este id vem do Facebook e só vale com o token do
       Facebook. Escrevê-lo em `igUserId` misturaria os dois espaços de id e a
       publicação normal passaria a usar um número emitido por outra porta. */
    conta.fbIgUserId = alvo.instagram_business_account.id;
    await conta.save();

    res.json({
      ok: true,
      pagina: alvo.name,
      instagram: alvo.instagram_business_account.username,
      expiraEm,
      mensagem: 'Link em story habilitado para esta conta.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'GRAPH_LINK_ERRO' });
  }
});

/** DELETE /graph-link/:accountId — desfaz, sem tocar na conexão normal. */
router.delete('/:accountId', async (req, res) => {
  try {
    const r = await Account.updateOne(
      { _id: req.params.accountId },
      /* `fbIgUserId` sai junto. Ele é o id do Instagram COMO AQUELA Página o
         enumera; deixado para trás, sobrevive à desconexão como se ainda fosse
         verdade — e volta a ser lido se alguém reconectar outra Página e algo
         falhar no meio do caminho. */
      { $set: {
        fbAccessToken: '', fbPageId: '', fbPageName: '',
        fbIgUserId: '', fbTokenExpiresAt: null,
      } }
    );
    res.json({ ok: true, alterou: (r.modifiedCount || 0) > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'GRAPH_LINK_ERRO' });
  }
});

/** GET /graph-link/:accountId/status */
router.get('/:accountId/status', async (req, res) => {
  try {
    const c = await Account.findById(req.params.accountId)
      .select('+fbAccessToken fbPageId fbPageName fbTokenExpiresAt username').lean();
    if (!c) return res.status(404).json({ error: 'Conta não encontrada.', code: 'CONTA_NAO_ENCONTRADA' });

    const vencido = c.fbTokenExpiresAt && new Date(c.fbTokenExpiresAt) < new Date();
    res.json({
      ativo: !!c.fbAccessToken && !vencido,
      vencido: !!vencido,
      pagina: c.fbPageName || '',
      expiraEm: c.fbTokenExpiresAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'GRAPH_LINK_ERRO' });
  }
});

/* ── Ajudas ───────────────────────────────────────────────────────────────── */

async function _json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return r.json().catch(() => ({ error: { message: 'resposta ilegível da Meta' } }));
}

/* O erro da Meta vai junto, não só uma frase curada. As mensagens dela são
   específicas — "a conta precisa ser comercial", "a Página não tem Instagram" —
   e substituí-las por um texto genérico manda depurar às cegas. */
function _erroMeta(res, erro, frase) {
  return res.status(422).json({
    code: 'META_RECUSOU',
    error: frase,
    detalhe: String(erro?.message || '').slice(0, 300),
    tipo: erro?.type || '',
    codigoMeta: erro?.code || null,
  });
}

module.exports = router;

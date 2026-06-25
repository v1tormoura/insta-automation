'use strict';

const router  = require('express').Router();
const Account = require('../models/Account');
const os      = require('os');
const path    = require('path');
const fs      = require('fs');

// Instagram Business Login — sub-app 790847580661717
const IG_AUTH  = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH = 'https://graph.instagram.com/v21.0';

function getAppId()     { return process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID; }
function getAppSecret() { return process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET; }

const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'https://localhost:3000/api/oauth/callback';
const FRONTEND     = 'http://localhost:5173';

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
].join(',');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id:     getAppId(),
    client_secret: getAppSecret(),
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT_URI,
    code,
  });

  console.log('📤 [OAuth] Trocando código por token...', { redirect_uri: REDIRECT_URI, appId: getAppId() });

  const res  = await fetch(IG_TOKEN, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  const text = await res.text();
  console.log('📦 [OAuth] Resposta token exchange:', text);

  const data = JSON.parse(text);
  if (data.error_type || data.error) {
    throw new Error(data.error_message || data.error?.message || JSON.stringify(data.error) || 'Troca de código falhou');
  }

  const shortToken = data.access_token;

  // Facebook Business Login NÃO retorna user_id na troca de código.
  // Busca o Instagram User ID via graph.instagram.com/me
  let userIdStr = null;
  const userIdMatch = text.match(/"user_id"\s*:\s*(\d+)/);
  if (userIdMatch) {
    userIdStr = userIdMatch[1];
  } else {
    // Instagram Business Login (IGAA token) — usa endpoint sem versão
    try {
      const meRes  = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${shortToken}`);
      const meData = await meRes.json();
      console.log('📦 [OAuth] /me response:', JSON.stringify(meData).slice(0, 200));
      if (meData.id) userIdStr = String(meData.id);
    } catch {}

    // Fallback v21
    if (!userIdStr) {
      try {
        const meRes2  = await fetch(`https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${shortToken}`);
        const meData2 = await meRes2.json();
        if (meData2.id) userIdStr = String(meData2.id);
      } catch {}
    }

    // Fallback: Facebook /me
    if (!userIdStr) {
      try {
        const fbRes  = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${shortToken}`);
        const fbData = await fbRes.json();
        if (fbData.id) userIdStr = String(fbData.id);
      } catch {}
    }
  }

  if (!userIdStr) throw new Error('Não foi possível obter o user_id do token. Verifique as permissões do app.');

  return { shortToken, userId: userIdStr };
}

async function getLongLivedToken(shortToken) {
  const secret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
  console.log('🔄 [OAuth] Trocando por long-lived token...');

  // Para Instagram Business Login (IGAA tokens), ig_exchange_token NÃO usa client_id.
  // Ref: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
  const attempts = [
    // 1. GET sem client_id (correto para Business Login)
    async () => {
      const url = new URL('https://graph.instagram.com/access_token');
      url.searchParams.set('grant_type',    'ig_exchange_token');
      url.searchParams.set('client_secret', secret);
      url.searchParams.set('access_token',  shortToken);
      return fetch(url.toString());
    },
    // 2. GET com versão explícita
    async () => {
      const url = new URL('https://graph.instagram.com/v21.0/access_token');
      url.searchParams.set('grant_type',    'ig_exchange_token');
      url.searchParams.set('client_secret', secret);
      url.searchParams.set('access_token',  shortToken);
      return fetch(url.toString());
    },
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const res  = await attempts[i]();
      const text = await res.text();
      console.log(`📦 [OAuth] Long-lived tentativa ${i + 1}:`, text.slice(0, 200));
      const data = JSON.parse(text);
      if (!data.error && data.access_token) {
        console.log(`✅ [OAuth] Long-lived token obtido via método ${i + 1}`);
        return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5_184_000 };
      }
    } catch {}
  }

  throw new Error('Nenhum método de troca para long-lived token funcionou');
}

async function getIgProfile(userId, accessToken) {
  // Business Login só suporta esses campos básicos (follows_count, account_type não são válidos)
  const IG_FIELDS = 'id,username,name,followers_count,media_count,profile_picture_url';

  // Tenta 1: graph.instagram.com/v21.0/me (versão explícita — Business Login)
  try {
    const url = new URL('https://graph.instagram.com/v21.0/me');
    url.searchParams.set('fields', IG_FIELDS);
    url.searchParams.set('access_token', accessToken);
    const res  = await fetch(url.toString());
    const data = await res.json();
    console.log('📦 [OAuth] graph.instagram.com/v21.0/me:', JSON.stringify(data).slice(0, 200));
    if (!data.error && data.username) return data;
  } catch {}

  // Tenta 2: /{userId} no graph.instagram.com/v21.0
  if (userId) {
    try {
      const url = new URL(`https://graph.instagram.com/v21.0/${userId}`);
      url.searchParams.set('fields', IG_FIELDS);
      url.searchParams.set('access_token', accessToken);
      const res  = await fetch(url.toString());
      const data = await res.json();
      console.log('📦 [OAuth] graph.instagram.com/v21.0/{id}:', JSON.stringify(data).slice(0, 200));
      if (!data.error && data.username) return data;
    } catch {}
  }

  // Tenta 3: Facebook Business Login — busca instagram_business_account via graph.facebook.com
  try {
    const url = new URL('https://graph.facebook.com/v21.0/me/instagram_business_accounts');
    url.searchParams.set('fields', 'id,username,name,followers_count,profile_picture_url');
    url.searchParams.set('access_token', accessToken);
    const res  = await fetch(url.toString());
    const data = await res.json();
    console.log('📦 [OAuth] /me/instagram_business_accounts:', JSON.stringify(data).slice(0, 300));
    if (!data.error && data.data?.length > 0) {
      const igAccount = data.data[0];
      return { ...igAccount, account_type: 'BUSINESS' };
    }
  } catch {}

  // Tenta 4: Pages → Instagram account
  try {
    const pagesRes  = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`);
    const pagesData = await pagesRes.json();
    console.log('📦 [OAuth] /me/accounts:', JSON.stringify(pagesData).slice(0, 300));
    if (pagesData.data?.length > 0) {
      for (const page of pagesData.data) {
        const igRes  = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account{id,username,name,followers_count}&access_token=${accessToken}`);
        const igData = await igRes.json();
        if (igData.instagram_business_account?.username) {
          return { ...igData.instagram_business_account, account_type: 'BUSINESS' };
        }
      }
    }
  } catch {}

  throw new Error('Perfil Instagram não encontrado. Certifique-se que a conta é Business/Creator e está vinculada a uma Página do Facebook.');
}

// ── GET /oauth/url ─────────────────────────────────────────────────────────────
// Gera a URL de autorização do Instagram (não Facebook).

router.get('/url', (req, res) => {
  // instagram.com/oauth/authorize requer INSTAGRAM_APP_ID (sub-app automação-IG: 790847580661717)
  const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: 'INSTAGRAM_APP_ID não configurado no .env' });

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    response_type: 'code',
    state:         req.query.accountId || 'new',
  });

  const url = `${IG_AUTH}?${params.toString()}`;
  console.log(`🔗 [OAuth] App ID: ${appId} | redirect_uri: ${REDIRECT_URI}`);
  res.json({ url });
});

// ── POST /oauth/connect/:accountId ────────────────────────────────────────────
// Recebe a URL colada pelo usuário (barra de endereços do navegador isolado).
// Extrai o 'code', troca por token e salva na conta.
// accountId = _id da conta existente  OU  'new' (cria nova conta a partir do perfil)

router.post('/connect/:accountId', async (req, res) => {
  const { accountId } = req.params;
  const { pastedUrl }  = req.body;

  if (!pastedUrl) return res.status(400).json({ error: 'Nenhuma URL fornecida.' });

  let code;
  try {
    const urlObj = new URL(pastedUrl.trim());
    code = urlObj.searchParams.get('code');
  } catch {
    return res.status(400).json({ error: 'URL inválida. Cole a URL completa da barra de endereços.' });
  }

  if (!code) {
    return res.status(400).json({
      error: 'Código OAuth não encontrado na URL. Certifique-se de copiar a URL completa após autorizar o aplicativo.',
    });
  }

  try {
    // 1. Código → token
    // Tokens do Instagram Business Login (IGAAL) já são long-lived (60 dias).
    // O endpoint ig_exchange_token não se aplica a eles — salva direto.
    const { shortToken, userId: userIdStr } = await exchangeCodeForToken(code);
    let accessToken    = shortToken;
    let tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000); // 60 dias

    // Troca short token → long-lived (60 dias)
    try {
      const ll = await getLongLivedToken(shortToken);
      accessToken    = ll.accessToken;
      tokenExpiresAt = new Date(Date.now() + ll.expiresIn * 1_000);
      console.log(`✅ [OAuth Connect] Long-lived token obtido (expira em ${Math.round(ll.expiresIn / 86400)} dias)`);
    } catch (llErr) {
      console.warn(`⚠️ [OAuth Connect] Long-lived falhou, usando short token (1h): ${llErr.message}`);
    }

    // 2. Conta existente — só salva o token, não muda username/perfil
    if (accountId !== 'new') {
      await Account.findByIdAndUpdate(accountId, {
        accessToken, igUserId: userIdStr, tokenExpiresAt, healthStatus: 'ativa',
      });
      const account = await Account.findById(accountId).lean();
      const username = account?.username || userIdStr;
      console.log(`✅ [OAuth Connect] @${username} — token salvo`);

      // Detecta tipo de conta via token IGAAL (sem browser, sem senha)
      let accountTypeWarning = null;
      try {
        const profile = await getIgProfile(userIdStr, accessToken);
        const aType = profile.account_type; // "PERSONAL", "BUSINESS", "MEDIA_CREATOR"
        console.log(`📊 [OAuth] @${username} — account_type: ${aType}`);
        if (aType === 'PERSONAL') {
          accountTypeWarning = 'conta_pessoal';
          await Account.findByIdAndUpdate(accountId, {
            healthStatus: 'conta_pessoal',
            lastError: 'Conta pessoal — converta para Creator no Instagram: Configurações → Tipo de conta → Conta profissional',
          });
        }
      } catch (e) {
        // Perfil não disponível via API — tenta conversão via private API mesmo assim
        console.log(`⚠️ [OAuth] Tipo de conta não detectado: ${e.message}`);
      }

      // Tenta converter via private API em background (só funciona se senha estiver correta no banco)
      setImmediate(() => {
        autoConvertToProfessional(account).catch(e =>
          console.log(`⚠️ [AutoConvert] @${username}: ${e.message}`)
        );
      });

      const msg = accountTypeWarning === 'conta_pessoal'
        ? `@${username} conectada, mas é conta PESSOAL. Vá no Instagram → Configurações → Tipo de conta → Conta profissional → Criador, depois reconecte.`
        : `@${username} conectada via OAuth.`;

      return res.json({ success: true, warning: accountTypeWarning, message: msg, username });
    }

    // 3. Nova conta — busca perfil e cria/atualiza no banco
    let profile = {};
    try { profile = await getIgProfile(userIdStr, accessToken); } catch (e) {
      console.warn('⚠️ [OAuth] Perfil não disponível, usando userId como fallback:', e.message);
    }
    const username = profile.username || userIdStr;

    const existing = await Account.findOne({ $or: [{ igUserId: userIdStr }, { username }] });
    if (existing) {
      Object.assign(existing, {
        accessToken, igUserId: userIdStr, tokenExpiresAt,
        name:       profile.name            || existing.name       || username,
        followers:  profile.followers_count || existing.followers  || 0,
        following:  profile.follows_count   || existing.following  || 0,
        postsCount: profile.media_count     || existing.postsCount || 0,
        healthStatus: 'ativa',
      });
      await existing.save();
    } else {
      await Account.create({
        username, name: profile.name || username,
        igUserId: userIdStr, accessToken, tokenExpiresAt,
        followers: profile.followers_count || 0,
        following: profile.follows_count   || 0,
        postsCount: profile.media_count    || 0,
        healthStatus: 'ativa',
      });
    }

    console.log(`✅ [OAuth Connect] @${existing?.username || username} criada/atualizada`);

    // Dispara conversão para conta profissional em background
    const savedAcc = await Account.findOne({ username }).lean();
    setImmediate(() => {
      autoConvertToProfessional(savedAcc).catch(e =>
        console.log(`⚠️ [AutoConvert] @${username}: ${e.message}`)
      );
    });

    return res.json({ success: true, message: `@${username} conectada via OAuth.`, username });

  } catch (err) {
    console.error('❌ [OAuth Connect] Erro:', err.message);
    return res.status(400).json({ error: err.message || 'Falha ao trocar código por token.' });
  }
});

// ── GET /oauth/callback ────────────────────────────────────────────────────────
// Instagram redireciona aqui após o login.
// Troca o código por token, cria/atualiza conta, redireciona pro frontend.

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND}/accounts?oauth=error&msg=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(`${FRONTEND}/accounts?oauth=error&msg=codigo_nao_encontrado`);
  }

  try {
    // 1. Código → short token
    const { shortToken, userId: userIdStr } = await exchangeCodeForToken(code);

    // 2. Troca short → long-lived (60 dias)
    let accessToken    = shortToken;
    let tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000);
    try {
      const ll = await getLongLivedToken(shortToken);
      accessToken    = ll.accessToken;
      tokenExpiresAt = new Date(Date.now() + ll.expiresIn * 1_000);
      console.log(`✅ [OAuth Callback] Long-lived token (expira em ${Math.round(ll.expiresIn / 86400)} dias)`);
    } catch (llErr) {
      console.warn(`⚠️ [OAuth Callback] Long-lived falhou, usando short token: ${llErr.message}`);
    }

    // 3. Se conta existente (state = _id), só salva o token — sem buscar perfil
    if (state && state !== 'new') {
      await Account.findByIdAndUpdate(state, {
        accessToken,
        igUserId: userIdStr,
        tokenExpiresAt,
        healthStatus: 'ativa',
      });
      const account = await Account.findById(state).lean();
      const username = account?.username || userIdStr;
      console.log(`✅ OAuth Instagram — @${username} token salvo`);
      return res.redirect(`${FRONTEND}/accounts?oauth=success&username=${encodeURIComponent(username)}`);
    }

    // 4. Nova conta — tenta buscar perfil, senão usa userId como fallback
    let profile = {};
    try { profile = await getIgProfile(userIdStr, accessToken); } catch (e) {
      console.warn('⚠️ [OAuth] Perfil não disponível, usando userId como username:', e.message);
    }
    const username = profile.username || userIdStr;

    // Busca conta por igUserId OU username (evita criar conta duplicada)
    const existing = await Account.findOne({ $or: [{ igUserId: userIdStr }, { username }] });
    if (existing) {
      Object.assign(existing, {
        accessToken, igUserId: userIdStr, tokenExpiresAt,
        name:       profile.name            || existing.name       || username,
        followers:  profile.followers_count || existing.followers  || 0,
        following:  profile.follows_count   || existing.following  || 0,
        postsCount: profile.media_count     || existing.postsCount || 0,
        healthStatus: 'ativa',
      });
      await existing.save();
    } else {
      await Account.create({
        username, name: profile.name || username,
        igUserId: userIdStr, accessToken, tokenExpiresAt,
        followers: profile.followers_count || 0,
        following: profile.follows_count   || 0,
        postsCount: profile.media_count    || 0,
        healthStatus: 'ativa',
      });
    }

    console.log(`✅ OAuth Instagram — @${username} conectada`);
    res.redirect(`${FRONTEND}/accounts?oauth=success&username=${encodeURIComponent(username)}`);

  } catch (err) {
    console.error('Erro OAuth Instagram callback:', err.message);
    res.redirect(`${FRONTEND}/accounts?oauth=error&msg=${encodeURIComponent(err.message)}`);
  }
});

// ── DELETE /oauth/disconnect/:accountId ───────────────────────────────────────

router.delete('/disconnect/:accountId', async (req, res) => {
  try {
    await Account.findByIdAndUpdate(req.params.accountId, {
      accessToken: '', igUserId: '', tokenExpiresAt: null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-converte conta para Profissional após OAuth connect ─────────────────
// 100% via API privada do Instagram (sem browser, sem Puppeteer).

async function autoConvertToProfessional(account) {
  if (!account) return;
  try {
    const { convertToProfessional } = require('../services/instagramPrivateService');
    await convertToProfessional(account);
  } catch (err) {
    console.log(`⚠️ [AutoConvert] @${account.username}: ${err.message}`);
  }
}

// ── Converte conta para Profissional (Criador) automaticamente via Puppeteer ──
async function tryConvertToProfessional(page, accountId) {
  try {
    console.log(`🔄 [OAuth] @${accountId} — verificando tipo de conta...`);

    await page.goto('https://www.instagram.com/accounts/edit/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await new Promise(r => setTimeout(r, 3000));

    // Verifica se há link para mudar para conta profissional
    const hasSwitchLink = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a, button, div[role="button"]')];
      return els.some(el => {
        const t = (el.innerText || el.textContent || '').toLowerCase();
        return t.includes('profissional') || t.includes('professional') || t.includes('mudar para');
      });
    }).catch(() => false);

    if (!hasSwitchLink) {
      console.log(`✅ [OAuth] @${accountId} — conta já é profissional`);
      return;
    }

    // Clica no link de conversão
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('a, button, div[role="button"]')];
      const el = els.find(e => {
        const t = (e.innerText || e.textContent || '').toLowerCase();
        return t.includes('profissional') || t.includes('professional') || t.includes('mudar para');
      });
      if (el) el.click();
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 3000));

    // Seleciona "Criador" (Creator)
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, div[role="button"], label')];
      const btn = btns.find(b => {
        const t = (b.innerText || b.textContent || '').toLowerCase();
        return t.includes('creator') || t.includes('criador');
      });
      if (btn) btn.click();
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 2000));

    // Clica em Próximo/Continuar/Done até 8 vezes para passar pelo wizard
    for (let i = 0; i < 8; i++) {
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => {
          const t = (b.innerText || '').trim().toLowerCase();
          return ['next', 'continue', 'continuar', 'próximo', 'proximo',
                  'done', 'concluir', 'ok', 'avançar', 'avancar'].includes(t);
        });
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
      }).catch(() => false);

      if (clicked) await new Promise(r => setTimeout(r, 2000));
      else break;
    }

    // Volta para a home após conversão
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    console.log(`✅ [OAuth] @${accountId} — conversão para conta profissional concluída!`);
  } catch (err) {
    console.log(`⚠️ [OAuth] @${accountId} — erro ao converter conta: ${err.message}`);
    // Falha silenciosa — continua para autorização mesmo sem converter
  }
}

// ── GET /oauth/browser/:accountId ─────────────────────────────────────────────
// Abre Puppeteer com perfil ISOLADO por conta (cookies separados).
// Retorna imediatamente; o login acontece no browser que abrir.
// Quando o Instagram redirecionar para /api/oauth/callback, o handler já trata tudo.

// Guard: impede abrir mais de um browser por vez por conta
const _openBrowsers = new Set();

router.get('/browser/:accountId', async (req, res) => {
  const accountId = req.params.accountId;
  // instagram.com/oauth/authorize só aceita INSTAGRAM_APP_ID (sub-app Instagram 790847580661717)
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) return res.status(500).json({ error: 'INSTAGRAM_APP_ID não configurado' });

  // Já tem um browser aberto para esta conta — não abre outro
  if (_openBrowsers.has(accountId)) {
    return res.json({ status: 'already_open' });
  }

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    response_type: 'code',
    state:         accountId,
  });
  const oauthUrl = `${IG_AUTH}?${params.toString()}`;

  // Responde imediatamente — browser abre em background
  res.json({ status: 'opening' });

  _openBrowsers.add(accountId);

  // Pasta de perfil isolada por conta — limpa antes para forçar login fresco
  const userDataDir = path.join(os.tmpdir(), `ig-oauth-${accountId}`);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

  try {
    let puppeteer;
    try {
      puppeteer = require('puppeteer-extra');
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());
    } catch {
      puppeteer = require('puppeteer');
    }

    const browser = await puppeteer.launch({
      headless: false,
      userDataDir,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=480,700'],
      defaultViewport: null,
    });

    // Fecha todas as abas extras e fica só com uma
    const pages = await browser.pages();
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }
    const page = pages[0];

    // PASSO 1: Abre login do Instagram primeiro (sem sessão ativa, oauth/authorize dá "Invalid platform app")
    console.log(`🌐 [OAuth Browser] @${accountId} — abrindo login do Instagram...`);
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });

    // PASSO 2: Aguarda o usuário fazer login — detecta quando a home carregar
    console.log(`⏳ [OAuth Browser] @${accountId} — aguardando login manual...`);
    await new Promise((resolve) => {
      const TIMEOUT = 10 * 60 * 1000;
      const timer = setTimeout(resolve, TIMEOUT);

      const check = async () => {
        try {
          const url = page.url();
          // Quando não está mais na tela de login = usuário logou
          if (url.includes('instagram.com') && !url.includes('/accounts/login') && !url.includes('/accounts/onetap')) {
            clearTimeout(timer);
            resolve();
            return;
          }
        } catch {}
        const connected = typeof browser.isConnected === 'function' ? browser.isConnected() : browser.isConnected;
        if (connected === false) { clearTimeout(timer); resolve(); return; }
        setTimeout(check, 1000);
      };

      page.on('close', () => { clearTimeout(timer); resolve(); });
      browser.on('disconnected', () => { clearTimeout(timer); resolve(); });
      check();
    });

    // PASSO 2.5: Tenta converter a conta para Profissional (Criador) automaticamente
    await tryConvertToProfessional(page, accountId);

    // PASSO 3: Ativa intercepção de requisições para capturar o redirect OAuth
    // (O redirect vai para https://localhost:3000 que não tem SSL — interceptamos antes de carregar)
    await page.setRequestInterception(true);
    let oauthCode = null;

    page.on('request', async (request) => {
      const url = request.url();
      // Detecta redirect para nosso callback (http ou https)
      if (url.includes('localhost:3000/api/oauth/callback') || url.includes('localhost:5173/accounts')) {
        try {
          const urlObj = new URL(url);
          const code  = urlObj.searchParams.get('code');
          const state = urlObj.searchParams.get('state') || accountId;
          if (code && !oauthCode) {
            oauthCode = code;
            console.log(`🔑 [OAuth Browser] @${accountId} — código OAuth capturado! Trocando por token...`);
            // Chama o callback do backend diretamente (HTTP, sem precisar de SSL)
            const callbackUrl = `http://localhost:3000/api/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
            fetch(callbackUrl).catch(e => console.error('❌ [OAuth] Erro no callback:', e.message));
          }
        } catch (e) {}
        try { request.abort(); } catch {}
      } else {
        try { request.continue(); } catch {}
      }
    });

    console.log(`✅ [OAuth Browser] @${accountId} — logado! Navegando para autorização...`);
    await new Promise(r => setTimeout(r, 2000));
    try {
      await page.goto(oauthUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (navErr) {
      console.log(`⚠️ [OAuth Browser] @${accountId} — navegação parcial: ${navErr.message}`);
    }

    // PASSO 4: Aguarda o usuário clicar "Autorizar" (max 5 min)
    await new Promise((resolve) => {
      const TIMEOUT = 5 * 60 * 1000;
      const timer = setTimeout(resolve, TIMEOUT);

      const check = () => {
        if (oauthCode) { clearTimeout(timer); resolve(); return; }
        const connected = typeof browser.isConnected === 'function' ? browser.isConnected() : browser.isConnected;
        if (connected === false) { clearTimeout(timer); resolve(); return; }
        setTimeout(check, 800);
      };

      page.on('close', () => { clearTimeout(timer); resolve(); });
      browser.on('disconnected', () => { clearTimeout(timer); resolve(); });
      check();
    });

    console.log(`✅ [OAuth Browser] @${accountId} — login concluído, capturando sessão...`);

    // Captura sessão da API privada enquanto o browser ainda está aberto e logado
    // Isso salva igSession no banco para postar stories via private API sem precisar de senha
    // Guarda: accountId pode ser 'new' quando a conta ainda não existia — findById('new') jogaria erro
    const accountForSession = (accountId !== 'new')
      ? await Account.findById(accountId).lean().catch(() => null)
      : null;
    if (accountForSession?.username) {
      try {
        const { capturePrivateApiSession } = require('../services/openAccountBrowser');
        await capturePrivateApiSession(page, accountForSession);
      } catch (e) {
        console.log('⚠️ [OAuth Browser] Captura de sessão falhou:', e.message);
      }
    }

    // Fecha o browser ANTES de copiar o profile (Chrome precisa estar fechado para copiar arquivos travados)
    await new Promise(r => setTimeout(r, 1000));
    try { await browser.close(); } catch {}
    await new Promise(r => setTimeout(r, 1000));

    // Copia o profile COMPLETO do temp dir para o profile permanente da conta
    // (apenas cookies não é suficiente — Chrome precisa do profile inteiro: localStorage, IndexedDB, etc.)
    try {
      if (accountForSession?.username) {
        const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
        const permanentProfile = path.join(SESSIONS_ROOT, accountForSession.username, 'profile');

        try { fs.rmSync(permanentProfile, { recursive: true, force: true }); } catch {}
        fs.cpSync(userDataDir, permanentProfile, { recursive: true });
        console.log(`💾 [OAuth Browser] Profile copiado para @${accountForSession.username}`);

        for (const lock of ['SingletonLock', 'SingletonCookie', 'lockfile']) {
          try { fs.unlinkSync(path.join(permanentProfile, lock)); } catch {}
        }
      }
    } catch (e) {
      console.log('⚠️ [OAuth Browser] Não foi possível copiar profile:', e.message);
    }

    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

  } catch (err) {
    console.error(`❌ [OAuth Browser] Erro @${accountId}:`, err.message);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  } finally {
    _openBrowsers.delete(accountId);
  }
});

// ── POST /oauth/auto-connect/:accountId ──────────────────────────────────────
router.post('/auto-connect/:accountId', async (req, res) => {
  const accountId = req.params.accountId;
  const appId     = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: 'INSTAGRAM_APP_ID não configurado' });

  const account = await Account.findById(accountId);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
  const cookiesPath   = path.join(SESSIONS_ROOT, account.username, 'cookies.json');
  if (!fs.existsSync(cookiesPath)) {
    return res.status(400).json({ error: `cookies.json não encontrado para @${account.username}. Importe os cookies primeiro (botão 🍪).` });
  }

  res.json({ status: 'starting', message: `Conectando @${account.username} via cookies em background...` });

  (async () => {
    try {
      let puppeteer;
      try {
        puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
      } catch {
        puppeteer = require('puppeteer');
      }

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        defaultViewport: { width: 430, height: 932 },
      });

      const page = (await browser.pages())[0];

      const rawCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      const puppeteerCookies = rawCookies
        .filter(c => (c.domain || '').includes('instagram.com'))
        .map(c => ({
          name:     c.name  || c.key,
          value:    c.value,
          domain:   c.domain  || '.instagram.com',
          path:     c.path    || '/',
          secure:   c.secure  ?? false,
          httpOnly: c.httpOnly ?? false,
          sameSite: 'Lax',
        }));
      await page.setCookie(...puppeteerCookies);

      const params = new URLSearchParams({
        client_id:     appId,
        redirect_uri:  REDIRECT_URI,
        scope:         SCOPES,
        response_type: 'code',
        state:         accountId,
      });
      const oauthUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;

      let oauthCode = null;
      await page.setRequestInterception(true);
      page.on('request', async req2 => {
        const url = req2.url();
        if (url.includes('localhost:3000/api/oauth/callback')) {
          const urlObj = new URL(url);
          const code   = urlObj.searchParams.get('code');
          const state  = urlObj.searchParams.get('state') || accountId;
          if (code && !oauthCode) {
            oauthCode = code;
            const cbUrl = `http://localhost:3000/api/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
            fetch(cbUrl).catch(() => {});
          }
          try { req2.abort(); } catch {}
        } else {
          try { req2.continue(); } catch {}
        }
      });

      await page.goto(oauthUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

      const pageUrl = page.url();
      if (pageUrl.includes('/accounts/login') || pageUrl.includes('login_required')) {
        console.log(`❌ [AutoConnect] @${account.username} — Sessão expirada, cookies inválidos.`);
        await browser.close();
        return;
      }

      // Aguarda até 90s pelo código OAuth (Instagram redireciona ao aceitar)
      for (let attempt = 0; attempt < 90 && !oauthCode; attempt++) {
        await new Promise(r => setTimeout(r, 1000));
      }

      try { await browser.close(); } catch {}

      if (!oauthCode) {
        console.log(`❌ [AutoConnect] @${account.username} — Timeout: nenhum código OAuth capturado em 90s.`);
      } else {
        console.log(`✅ [AutoConnect] @${account.username} — Código capturado com sucesso, token sendo processado...`);
      }

    } catch (err) {
      console.error(`❌ [AutoConnect] @${account.username}:`, err.message);
      try { /* browser may already be closed */ } catch {}
    }
  })();
});

module.exports = router;

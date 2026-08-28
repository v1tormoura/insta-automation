const router = require('express').Router();
const upload = require('../config/upload');
const Account = require('../models/Account');
const { exchangeToken, getIgUserId } = require('../services/instagramAPI');

const {
  createAccount,
  getAccounts,
  connectBulkAccounts,
  deleteAccount,
  syncAccount,
  syncAllAccounts,
  openAccount,
  importBulkAccounts,
  reconnectAllAccounts,
  getImportJob,
  bulkEditProfiles,
  updateProxy,
  testAccountProxy,
  testAllProxies,
  bulkApplyProxies,
} = require('../controllers/accountController');

const connectAccount = require('../services/connectAccount');

router.post('/', createAccount);
router.get('/', getAccounts);
router.post('/sync-all', syncAllAccounts);
router.post('/import-bulk', importBulkAccounts);
router.post('/reconnect-all', reconnectAllAccounts);
router.get('/import-job/:jobId', getImportJob);
router.post('/bulk-edit-profile', upload.single('photo'), bulkEditProfiles);
router.patch('/:id/proxy', updateProxy);
router.patch('/:id/username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== 'string') return res.status(400).json({ error: 'username inválido' });
    const clean = username.replace(/^@/, '').trim().toLowerCase();
    if (!clean) return res.status(400).json({ error: 'username vazio' });
    const Account = require('../models/Account');
    const exists = await Account.findOne({ username: clean, _id: { $ne: req.params.id } });
    if (exists) return res.status(400).json({ error: `@${clean} já existe em outra conta` });
    const acc = await Account.findByIdAndUpdate(req.params.id, { username: clean }, { new: true });
    if (!acc) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, username: acc.username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:id/proxy/test', testAccountProxy);
router.post('/proxies/test-all', testAllProxies);
router.post('/proxies/bulk-apply', bulkApplyProxies);
router.delete('/:id', deleteAccount);
router.post('/:id/sync', syncAccount);
router.post('/:id/open', openAccount);
router.post('/:id/reconnect', async (req, res) => {
  let account;
  try {
    account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    if (!account.password) return res.status(400).json({ error: 'Conta sem senha configurada' });
    // Login por senha sem proxy queima o IP do servidor e gera challenge.
    // Aceita o proxy da conta OU o proxy global ativo no painel.
    const { resolveProxyFor } = require('../services/globalProxy');
    if (!(await resolveProxyFor(account))) {
      // Sem proxy: limpa challengeState mas não tenta login (evita gerar novo challenge)
      await Account.findByIdAndUpdate(account._id, { challengeState: '' });
      return res.status(400).json({
        code: 'NO_PROXY',
        error: 'Ative o proxy global ou configure um proxy residencial nesta conta (botão Proxy) antes de reconectar por senha.',
      });
    }

    const { createClient } = require('../services/instagramPrivateService');
    await Account.findByIdAndUpdate(account._id, { challengeState: '' });
    const fresh = await Account.findById(account._id);
    await createClient(fresh, { forcePasswordLogin: true });
    await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '' });
    const { broadcast } = require('../events/broadcaster');
    broadcast('accounts', { action: 'synced' });
    res.json({ success: true });
  } catch (err) {
    const code = err.code || '';
    // Sempre limpa challengeState após falha — evita bloqueio no passo 4 do createClient
    await Account.findByIdAndUpdate(req.params.id, { challengeState: '' }).catch(() => {});
    const status = (code === 'CHALLENGE_REQUIRED' || code === 'TOTP_REQUIRED') ? 'sessao_expirada' : 'erro_login';
    await Account.findByIdAndUpdate(req.params.id, { healthStatus: status, lastError: err.message }).catch(() => {});
    res.status(400).json({ error: err.message, code });
  }
});
router.post('/connect-bulk', connectBulkAccounts);

router.post('/connect', (req, res) => {
  try {
    res.json({ message: 'Abrindo navegador...' });

    connectAccount()
      .then((acc) => {
        console.log('✅ Conta conectada:', acc.username);
      })
      .catch((err) => {
        console.log('💥 Erro:', err.message);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/connect-api
 * Body: { token: "<short or long-lived user access token>" }
 *
 * 1. Exchanges for long-lived token (if short-lived provided)
 * 2. Fetches the Instagram User ID linked to the token
 * 3. Saves igUserId, accessToken, tokenExpiresAt on the account
 */
router.post('/:id/connect-api', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Campo "token" obrigatório' });

    // Try to exchange for long-lived token; if it's already long-lived this may fail — use as-is
    let accessToken = token;
    let expiresIn   = 5_184_000; // 60 days default
    try {
      const exchanged = await exchangeToken(token);
      accessToken = exchanged.accessToken;
      expiresIn   = exchanged.expiresIn;
      console.log('✅ Token trocado por long-lived');
    } catch (err) {
      // Token might already be long-lived — continue with it
      console.log('ℹ️ Usando token como fornecido:', err.message);
    }

    // Fetch the Instagram User ID
    const { igUserId, pageName } = await getIgUserId(accessToken);
    console.log(`✅ IG User ID: ${igUserId} (${pageName})`);

    account.accessToken    = accessToken;
    account.igUserId       = igUserId;
    account.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    await account.save();

    res.json({
      success: true,
      igUserId,
      pageName,
      tokenExpiresAt: account.tokenExpiresAt,
      message: `Conta conectada via API! Publica automaticamente sem browser.`,
    });
  } catch (err) {
    console.error('Erro connect-api:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /accounts/:id/disconnect-api — remove API credentials */
router.delete('/:id/disconnect-api', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    account.accessToken    = '';
    account.igUserId       = '';
    account.tokenExpiresAt = null;
    await account.save();

    res.json({ success: true, message: 'Credenciais API removidas' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /accounts/:id/credentials
 * Update password and/or loginEmail; clears igSession so next login uses new creds.
 */
router.patch('/:id/credentials', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { password, loginEmail, accessToken } = req.body;

    if (accessToken !== undefined && accessToken.trim()) {
      await Account.findByIdAndUpdate(account._id, { accessToken: accessToken.trim(), healthStatus: 'ativa', lastError: '' });
      try {
        const meRes = await fetch(`https://graph.instagram.com/me?fields=id,username,name,followers_count,follows_count,media_count&access_token=${accessToken.trim()}`);
        const me = await meRes.json();
        if (me.id) {
          await Account.findByIdAndUpdate(account._id, {
            igUserId:   me.id,
            name:       me.name           || account.name,
            followers:  me.followers_count || 0,
            following:  me.follows_count   || 0,
            postsCount: me.media_count     || 0,
          });
        }
      } catch {}
      return res.json({ success: true, message: 'Token salvo e perfil carregado' });
    }

    const update = { igSession: '' };
    if (password  !== undefined && password.trim())  update.password   = password.trim();
    if (loginEmail !== undefined)                    update.loginEmail = loginEmail.trim();
    await Account.findByIdAndUpdate(account._id, update);
    res.json({ success: true, message: 'Credenciais atualizadas e sessão limpa' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/test-login
 * Tenta login via instagram-private-api e retorna sucesso ou erro detalhado.
 * Limpa a sessão salva antes para forçar login fresco.
 */
router.post('/:id/test-login', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    if (!account.password) return res.status(400).json({ error: 'Senha não configurada para esta conta' });

    let createClient;
    try {
      ({ createClient } = require('../services/instagramPrivateService'));
    } catch {
      return res.status(500).json({ error: 'Pacote instagram-private-api não instalado' });
    }

    // Força login com senha (sem apagar a sessão existente do banco)
    await createClient(account, { forcePasswordLogin: true });

    const loginId = account.loginEmail?.trim() || account.username;
    res.json({
      success: true,
      message: `Login OK com "${loginId}" — sessão salva no banco`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/capture-session
 * Abre Puppeteer em background, faz login via browser, extrai cookies e
 * salva a sessão da instagram-private-api no banco.
 * Depois disso stories/reels funcionam sem precisar de senha na API.
 */
router.post('/:id/capture-session', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    res.json({ success: true, message: 'Abrindo browser para capturar sessão...' });

    // Roda em background
    (async () => {
      try {
        const { launchBrowser, ensureLogin } = require('../services/instagramBot');
        const { capturePrivateApiSession } = require('../services/openAccountBrowser');
        const { browser, page } = await launchBrowser(account.proxy, account.username);
        await ensureLogin(page, account);
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 60000 });
        await capturePrivateApiSession(page, account);
        await browser.close();
        console.log(`✅ [CaptureSession] Browser fechado para @${account.username}`);
      } catch (err) {
        console.error(`❌ [CaptureSession] Erro @${account.username}:`, err.message);
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guard: impede abrir mais de um browser de login por vez por conta
const _webLoginBrowsers = new Set();

/**
 * POST /accounts/:id/web-login
 * Abre browser, preenche usuário/senha automaticamente, salva cookies.
 * Não usa Meta API — login direto no Instagram.
 * Browser fica visível para o usuário resolver 2FA/captcha se necessário.
 */
router.post('/:id/web-login', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    if (!account.password) return res.status(400).json({ error: 'Senha não configurada. Edite as credenciais primeiro.' });

    const accountId = account._id.toString();
    if (_webLoginBrowsers.has(accountId)) {
      return res.json({ success: false, message: `Login já em andamento para @${account.username}. Verifique o browser aberto.` });
    }

    res.json({ success: true, message: `Abrindo browser para @${account.username}...` });

    _webLoginBrowsers.add(accountId);

    (async () => {
      const { launchBrowser, loginInstagram, saveSession, isLoggedIn, waitManualLoginOr2FA } = require('../services/instagramBot');
      const Account = require('../models/Account');
      const { broadcast } = require('../events/broadcaster');
      const fs   = require('fs');
      const path = require('path');

      const sessionsDir = path.join(__dirname, '../../sessions', account.username);
      const cookiesPath = path.join(sessionsDir, 'cookies.json');
      const profilePath = path.join(sessionsDir, 'profile');

      // Remove cookies.json antigo para forçar login fresco
      try { fs.unlinkSync(cookiesPath); } catch {}

      // Remove o banco de cookies do Chrome para evitar conflito com sessão antiga
      // (o Chrome armazena cookies em SQLite separado do cookies.json)
      for (const relPath of [
        path.join('Default', 'Cookies'),
        path.join('Default', 'Cookies-journal'),
        path.join('Default', 'Login Data'),
        path.join('Default', 'Login Data-journal'),
      ]) {
        try { fs.unlinkSync(path.join(profilePath, relPath)); } catch {}
      }

      // Lança browser VISÍVEL (para o usuário ver e resolver 2FA se necessário)
      const origHeadless = process.env.HEADLESS;
      const origHidden   = process.env.HIDDEN_BROWSER;
      process.env.HEADLESS       = 'false';
      process.env.HIDDEN_BROWSER = 'false';

      let browser;
      try {
        const launched = await launchBrowser(account.proxy, account.username);
        browser = launched.browser;
        const page = launched.page;

        console.log(`🔑 [WebLogin] @${account.username} — iniciando login...`);

        // Faz login automático com usuário/senha
        const loginId = account.loginEmail?.trim() || account.username;
        await loginInstagram(page, loginId, account.password);

        // Aguarda login ou 2FA (até 10 min)
        const loggedIn = await isLoggedIn(page);
        if (!loggedIn) {
          console.log(`🔐 [WebLogin] @${account.username} — aguardando 2FA/captcha no browser...`);
          await waitManualLoginOr2FA(page, account.username);
        } else {
          await saveSession(page, account.username);
          console.log(`✅ [WebLogin] @${account.username} — sessão salva com sucesso!`);
        }

        // Navega algumas páginas para "aquecer" a sessão e evitar expiração rápida
        try {
          await page.goto(`https://www.instagram.com/${account.username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(r => setTimeout(r, 3000));
          await saveSession(page, account.username); // re-salva cookies aquecidos
        } catch {}

        // Atualiza status da conta no banco
        await Account.findByIdAndUpdate(account._id, {
          healthStatus: 'ativa',
          lastError: '',
          lastSync: new Date(),
        });
        broadcast('accounts', { action: 'synced' });
        console.log(`✅ [WebLogin] @${account.username} — status atualizado para ativa`);

        // Tenta capturar sessão mobile (igSession) a partir dos cookies do browser
        try {
          const { capturePrivateApiSession } = require('../services/openAccountBrowser');
          await capturePrivateApiSession(page, account);
        } catch (e) {
          console.log(`⚠️ [WebLogin] capturePrivateApiSession: ${e.message}`);
        }
      } catch (err) {
        console.error(`❌ [WebLogin] @${account.username}:`, err.message);
      } finally {
        process.env.HEADLESS       = origHeadless;
        process.env.HIDDEN_BROWSER = origHidden;
        try { await browser?.close(); } catch {}
        _webLoginBrowsers.delete(accountId);
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/clear-session
 * Force re-login on next post (clears saved instagram-private-api session).
 * Useful when Instagram flags the session or login is required.
 */
router.post('/:id/clear-session', async (req, res) => {
  try {
    await Account.findByIdAndUpdate(req.params.id, { igSession: '' });
    res.json({ success: true, message: 'Sessão limpa — próxima postagem fará login novamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/refresh-sessions
 * Executa o session keeper manualmente: reabre sessões de todas as contas
 * com cookies.json salvos para renovar os cookies e evitar expiração.
 */
router.post('/refresh-sessions', async (req, res) => {
  try {
    res.json({ success: true, message: 'Renovação de sessões iniciada em background...' });
    const { runKeeper } = require('../services/sessionKeeper');
    const { broadcast } = require('../events/broadcaster');
    runKeeper()
      .then(() => broadcast('accounts', { action: 'synced' }))
      .catch(e => console.log('SessionKeeper error:', e.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/quick-check-all
 * Verifica saúde de todas as contas via HTTP simples (sem Puppeteer).
 * Detecta contas banidas/restritas em segundos.
 */
router.post('/quick-check-all', async (req, res) => {
  try {
    res.json({ success: true, message: 'Verificação rápida de saúde iniciada em background...' });
    const { quickCheckAll } = require('../services/quickCheckAccount');
    const { broadcast } = require('../events/broadcaster');
    quickCheckAll()
      .then(() => broadcast('accounts', { action: 'synced' }))
      .catch(e => console.log('QuickCheck error:', e.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/quick-check
 * Verifica saúde de uma conta específica via HTTP simples.
 */
router.post('/:id/quick-check', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    const { quickCheckAndUpdate } = require('../services/quickCheckAccount');
    const { broadcast } = require('../events/broadcaster');
    const result = await quickCheckAndUpdate(account);
    broadcast('accounts', { action: 'synced' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/login-private
 * Conecta a conta via Private API (login com senha) em background.
 * - Faz login com a senha salva
 * - Envia código por email automaticamente se houver challenge
 * - Converte para Creator se conta for pessoal
 * Retorna: { status: 'connected' | 'challenge_required' | 'totp_required', autoSent }
 */
router.post('/:id/login-private', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    if (!account.password) return res.status(400).json({ error: 'Senha não configurada. Clique em 🔑 Senha primeiro.' });

    const { createClient, convertToProfessional, getAccountType } = require('../services/instagramPrivateService');

    // Limpa challengeState antes de fazer novo login para garantir que createClient não retorne early
    await Account.findByIdAndUpdate(account._id, { challengeState: '' });
    const freshAccount = await Account.findById(account._id);

    try {
      await createClient(freshAccount, { forcePasswordLogin: true });

      // Verifica e converte conta pessoal para Creator
      try {
        const typeInfo = await getAccountType(freshAccount);
        if (!typeInfo.isProfessional) {
          await convertToProfessional(freshAccount);
          await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '' });
          return res.json({ status: 'connected', converted: true, message: 'Conta conectada e convertida para Creator!' });
        }
      } catch {}

      await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '' });
      return res.json({ status: 'connected', message: 'Conta conectada com sucesso!' });

    } catch (apiErr) {
      if (apiErr.code === 'CHALLENGE_REQUIRED') {
        return res.json({ status: 'challenge_required', autoSent: apiErr.autoSent });
      }
      if (apiErr.code === 'TOTP_REQUIRED') {
        return res.json({ status: 'totp_required' });
      }
      if (apiErr.code === 'LOGIN_EMAIL_REQUIRED') {
        return res.json({ status: 'email_required' });
      }
      return res.status(400).json({ error: apiErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/init-mobile-session
 * Inicia sessão mobile via instagram-private-api.
 * Se Instagram pedir verificação, salva o challenge na memória e retorna needsCode: true.
 * O usuário deve verificar o email/telefone e enviar o código via /resolve-challenge.
 */
router.post('/:id/init-mobile-session', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    if (!account.password) return res.status(400).json({ error: 'Senha não configurada. Clique em 🔑 Senha primeiro.' });

    const { initMobileSession } = require('../services/instagramPrivateService');
    const result = await initMobileSession(account);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/bulk-import-sessions
 * Importa sessionids em lote: [{ username, sessionid }]
 */
router.post('/bulk-import-sessions', async (req, res) => {
  const { sessions } = req.body; // [{ username, sessionid }]
  if (!Array.isArray(sessions) || !sessions.length)
    return res.status(400).json({ error: 'Envie um array de { username, sessionid }' });

  const results = [];
  for (const { username, sessionid } of sessions) {
    if (!username || !sessionid) { results.push({ username, status: 'erro', error: 'username ou sessionid vazio' }); continue; }
    try {
      const account = await Account.findOne({ username: username.trim().replace(/^@/, '') });
      if (!account) { results.push({ username, status: 'erro', error: 'conta não encontrada na automação' }); continue; }

      let sid = sessionid.trim();
      try { sid = decodeURIComponent(sid); } catch {}

      // Valida sessionid via web API
      const r = await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', {
        headers: {
          'Cookie': `sessionid=${sid}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'X-IG-App-ID': '936619743392459',
        },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);

      const valid = r && r.status !== 401 && r.status !== 403;

      await Account.findByIdAndUpdate(account._id, {
        rawWebSessionid: sid,
        challengeState: '',
        healthStatus: valid ? 'ativa' : 'sessao_expirada',
        lastError: valid ? '' : 'sessionid pode estar expirado',
      });

      broadcast('accounts', { action: 'synced' });
      results.push({ username, status: valid ? 'ok' : 'salvo_sem_validar' });
    } catch (err) {
      results.push({ username, status: 'erro', error: err.message });
    }
  }

  const ok = results.filter(r => r.status === 'ok' || r.status === 'salvo_sem_validar').length;
  res.json({ total: sessions.length, imported: ok, results });
});

/**
 * POST /accounts/:id/import-session
 * Importa sessão diretamente pelo sessionid do cookie do Instagram.
 * O usuário copia o valor do cookie "sessionid" do browser e cola aqui.
 * Constrói uma sessão válida sem precisar de login/challenge.
 */
router.post('/:id/import-session', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    let sessionid = (req.body.sessionid || '').trim();
    if (!sessionid) return res.status(400).json({ error: 'sessionid não informado' });
    // Decodifica URL encoding (%3A → :) caso o usuário copie o valor bruto do DevTools
    try { sessionid = decodeURIComponent(sessionid); } catch { /* já está decodificado */ }

    const { IgApiClient } = require('instagram-private-api');
    const ig = new IgApiClient();
    const seed = account.username;
    ig.state.generateDevice(seed);

    // Injeta cookies no RequestJar usando a API async (setCookie sem Sync)
    const jar = ig.state.cookieJar;
    const base = 'https://www.instagram.com';
    await new Promise((resolve, reject) => {
      jar.setCookie(`sessionid=${sessionid}; Domain=.instagram.com; Path=/; Secure; HttpOnly`, base,
        err => err ? reject(err) : resolve());
    });
    await new Promise((resolve, reject) => {
      jar.setCookie(`ig_did=${ig.state.deviceId}; Domain=.instagram.com; Path=/; Secure`, base,
        err => err ? reject(err) : resolve());
    });
    await new Promise((resolve, reject) => {
      jar.setCookie(`ig_nrcb=1; Domain=.instagram.com; Path=/; Secure`, base,
        err => err ? reject(err) : resolve());
    });

    // Valida o sessionid via API web (mesmo domínio de onde veio o cookie)
    // Evita falsos "login_required" causados por mismatch de device fingerprint da API mobile
    let me = null;
    let needsCheckpoint = false;
    try {
      const r = await fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', {
        headers: {
          'Cookie': `sessionid=${sessionid}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-CSRFToken': 'missing',
          'X-IG-App-ID': '936619743392459',
          'Referer': 'https://www.instagram.com/',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 401 || r.status === 403) {
        return res.status(400).json({ error: 'sessionid inválido ou expirado. Copie novamente do browser.' });
      }
      const data = await r.json().catch(() => ({}));
      if (data?.user?.username) {
        me = data.user;
        console.log(`[SessionImport] @${me.username} -- sessionid válido via web API`);
      } else if (data?.message === 'checkpoint_required' || data?.checkpoint_url) {
        needsCheckpoint = true;
        console.log(`[SessionImport] @${account.username} -- checkpoint_required, salvando mesmo assim`);
      } else {
        // Resposta inesperada mas não é erro de auth — salva
        console.log(`[SessionImport] @${account.username} -- resposta inesperada (${r.status}), salvando`);
      }
    } catch (e) {
      // Timeout ou erro de rede — salva mesmo assim para não bloquear o usuário
      console.log(`[SessionImport] @${account.username} -- validação web falhou (${e.message}), salvando`);
    }

    // Salva sessão no banco (inclui sessionid bruto para uso direto na web API)
    const state = await ig.state.serialize();
    delete state.constants;
    state._deviceSeed     = seed;
    state._rawSessionid   = sessionid;
    const displayName = me?.username || account.username;
    await Account.findByIdAndUpdate(account._id, {
      igSession:        JSON.stringify(state),
      rawWebSessionid:  sessionid,   // campo separado — não é apagado pelo keepAlive
      challengeState:   '',
      healthStatus:     needsCheckpoint ? 'sessao_expirada' : 'ativa',
      lastError:        needsCheckpoint ? 'checkpoint_required — sessão salva, tente publicar' : '',
    });

    const msg = needsCheckpoint
      ? `Sessão salva para @${displayName}! (A conta pode precisar verificação na primeira publicação)`
      : `Conta @${displayName} conectada com sucesso!`;

    console.log(`[SessionImport] @${displayName} -- salvo. checkpoint=${needsCheckpoint}`);
    res.json({ success: true, message: msg, needsCheckpoint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /accounts/:id/clear-challenge — limpa challenge pendente para forçar novo login */
router.post('/:id/clear-challenge', async (req, res) => {
  try {
    await Account.findByIdAndUpdate(req.params.id, { challengeState: '', healthStatus: 'sessao_expirada' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PATCH /accounts/:id/totp-secret
 * Salva o segredo TOTP da conta para geração automática de códigos 2FA.
 */
router.patch('/:id/totp-secret', async (req, res) => {
  try {
    const secret = (req.body.totpSecret || '').trim().replace(/\s/g, '').toUpperCase();
    if (!secret) return res.status(400).json({ error: 'Segredo TOTP não informado' });

    // Valida o segredo gerando um código de teste
    // Valida que a chave tem apenas caracteres base32 válidos (A-Z, 2-7)
    if (!/^[A-Z2-7]+=*$/i.test(secret)) {
      return res.status(400).json({ error: 'Segredo TOTP inválido. Use apenas letras A-Z e números 2-7.' });
    }

    await Account.findByIdAndUpdate(req.params.id, { totpSecret: secret });
    console.log(`[TOTP] @${req.params.id} -- segredo salvo (${secret.length} chars)`);
    res.json({ success: true, message: 'Segredo TOTP salvo! Login automático ativado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /accounts/:id/resolve-challenge
 * Envia o código de verificação para completar o challenge da sessão mobile.
 */
router.post('/:id/resolve-challenge', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { code } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'Código não informado.' });

    const codeType = req.body.codeType || 'email'; // 'email' | 'totp'
    const { resolveChallenge } = require('../services/instagramPrivateService');
    await resolveChallenge(account, code.trim(), codeType);
    res.json({ success: true, message: 'Conta conectada com sucesso!' });
  } catch (err) {
    // Checkpoint resolvido mas agora precisa de TOTP
    if (err.code === 'TOTP_REQUIRED_AFTER_CHALLENGE') {
      return res.json({ success: false, totpRequired: true, message: 'Checkpoint OK! Agora insira o código do Google Authenticator.' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/resolve-totp
 * Finaliza login com código de 6 dígitos do autenticador (Google Authenticator / Authy).
 */
router.post('/:id/resolve-totp', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { code } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'Código não informado.' });

    const { resolveTotpLogin } = require('../services/instagramPrivateService');
    await resolveTotpLogin(account, code.trim());
    res.json({ success: true, message: 'Login 2FA concluído! Conta pronta para publicar.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/challenge-sms
 * Solicita reenvio do código de verificação via SMS/telefone
 * (alternativa quando o e-mail não chega).
 */
router.post('/:id/challenge-sms', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { resendChallengeSms } = require('../services/instagramPrivateService');
    const result = await resendChallengeSms(account);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /accounts/:id/import-cookies
 * Salva cookies exportados do Multilogin/Dolphin Anty como cookies.json
 * e marca a conta para usar autenticação via cookies na API privada.
 *
 * Body: { cookies: Array<{name,value,domain,...}> | string }
 */
router.post('/:id/import-cookies', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { cookies } = req.body;
    if (!cookies) return res.status(400).json({ error: 'Campo "cookies" obrigatório' });

    // Aceita string JSON ou array já parseado
    let cookieArray;
    try {
      cookieArray = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
    } catch {
      return res.status(400).json({ error: 'Cookies inválidos — cole um JSON válido.' });
    }

    if (!Array.isArray(cookieArray) || !cookieArray.length) {
      return res.status(400).json({ error: 'Array de cookies vazio ou inválido.' });
    }

    // Verifica se há sessionid (essencial para a API privada)
    const hasSession = cookieArray.some(c => c.name === 'sessionid' || c.key === 'sessionid');
    if (!hasSession) {
      return res.status(400).json({ error: 'Cookies não contém "sessionid". Exporte os cookies novamente enquanto está logado no Instagram.' });
    }

    // Normaliza cookies — aceita formato {name,value,...} ou {key,value,...}
    const normalized = cookieArray.map(c => ({
      name:     c.name     || c.key     || '',
      value:    c.value    || '',
      domain:   c.domain   || '.instagram.com',
      path:     c.path     || '/',
      secure:   c.secure   || false,
      httpOnly: c.httpOnly || false,
    }));

    // Salva em /sessions/{username}/cookies.json
    const fs   = require('fs');
    const path = require('path');
    const sessionsDir = path.join(__dirname, '../../sessions', account.username);
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'cookies.json'), JSON.stringify(normalized, null, 2));

    // Marca conta para usar cookies — seta igSession como marcador
    await Account.findByIdAndUpdate(account._id, {
      igSession:    'use_cookies',
      healthStatus: 'ativa',
      lastError:    '',
    });

    console.log(`🍪 [ImportCookies] @${account.username} — ${normalized.length} cookies salvos`);
    res.json({
      success: true,
      message: `${normalized.length} cookies importados. A conta usará autenticação via cookies nas próximas postagens.`,
    });
  } catch (err) {
    console.error('Erro import-cookies:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  TIPO DE CONTA — verificar e converter via Private API (sem browser)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /accounts/:id/account-type
 * Verifica via Private API se a conta é pessoal, Business ou Creator.
 */
router.get('/:id/account-type', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { getAccountType } = require('../services/instagramPrivateService');
    const info = await getAccountType(account);

    res.json({
      success: true,
      ...info,
      message: info.isProfessional
        ? `✅ Conta ${info.typeName} — apta para publicar Reels via API`
        : `⚠️ Conta pessoal — converta para Creator para habilitar Reels via API`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/convert-to-pro
 * Converte conta pessoal → Creator via Private API. Sem browser.
 */
router.post('/:id/convert-to-pro', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { getAccountType, convertToProfessional } = require('../services/instagramPrivateService');
    const info = await getAccountType(account);

    if (info.isProfessional) {
      return res.json({
        success: true,
        alreadyProfessional: true,
        accountType: info.typeName,
        message: `✅ @${account.username} já é conta ${info.typeName} — nenhuma conversão necessária.`,
      });
    }

    const result = await convertToProfessional(account);
    res.json({
      success: true,
      ...result,
      message: `✅ @${account.username} convertida para Creator! Agora pode publicar Reels via API.`,
    });
  } catch (err) {
    console.error(`[convert-to-pro] @${req.params.id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/import-and-setup
 * Fluxo completo: importa cookies + verifica autenticação + converte se pessoal.
 * Body (opcional): { cookies: Array }
 */
router.post('/:id/import-and-setup', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const steps = [];

    if (req.body.cookies) {
      let cookieArray;
      try {
        cookieArray = typeof req.body.cookies === 'string'
          ? JSON.parse(req.body.cookies) : req.body.cookies;
      } catch {
        return res.status(400).json({ error: 'Cookies inválidos — cole um JSON válido.' });
      }

      const hasSession = cookieArray.some(c => c.name === 'sessionid' || c.key === 'sessionid');
      if (!hasSession) {
        return res.status(400).json({ error: 'Cookies não contêm "sessionid".' });
      }

      const normalized = cookieArray.map(c => ({
        name: c.name || c.key || '', value: c.value || '',
        domain: c.domain || '.instagram.com', path: c.path || '/',
        secure: c.secure || false, httpOnly: c.httpOnly || false,
      }));

      const fs   = require('fs');
      const path = require('path');
      const dir  = path.join(__dirname, '../../sessions', account.username);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'cookies.json'), JSON.stringify(normalized, null, 2));

      await Account.findByIdAndUpdate(account._id, { igSession: 'use_cookies', healthStatus: 'ativa', lastError: '' });
      steps.push(`✅ ${normalized.length} cookies importados`);
    }

    const { getAccountType, convertToProfessional } = require('../services/instagramPrivateService');

    let info;
    try {
      const fresh = await Account.findById(account._id);
      info = await getAccountType(fresh);
      steps.push(`✅ Autenticada — @${info.username} (${info.followerCount} seguidores)`);
    } catch (authErr) {
      return res.status(401).json({ error: `Falha na autenticação: ${authErr.message}`, steps });
    }

    if (!info.isProfessional) {
       try {
        const fresh = await Account.findById(account._id);
        await convertToProfessional(fresh);
        steps.push('✅ Convertida para Creator');
      } catch (convErr) {
        steps.push(`⚠️ Conversão falhou: ${convErr.message}`);
      }
    } else {
      steps.push(`✅ Conta ${info.typeName} — nenhuma conversão necessária`);
    }

    res.json({ success: true, username: info.username, steps, message: `@${info.username} pronta para publicar via API.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  MULTILOGIN + SESSION KEEPALIVE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /accounts/keepalive-all
 * Força ciclo completo de keepalive para todas as contas imediatamente.
 * DEVE vir antes de /:id para não ser capturado como um ID
 */
router.post('/keepalive-all', async (req, res) => {
  try {
    const { runKeepAlive } = require('../jobs/sessionKeepAlive');
    const result = await runKeepAlive();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /accounts/:id/multilogin-profile
 * Salva o profileId do Multilogin para esta conta.
 */
router.patch('/:id/multilogin-profile', async (req, res) => {
  try {
    const { profileId } = req.body;
    if (!profileId?.trim()) return res.status(400).json({ error: 'profileId obrigatório' });

    const account = await Account.findByIdAndUpdate(
      req.params.id,
      { multiloginProfileId: profileId.trim() },
      { new: true }
    );
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    res.json({ success: true, message: `✅ Profile Multilogin salvo para @${account.username}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/multilogin-sync
 * Sincroniza cookies do Multilogin e valida sessão via Private API.
 */
router.post('/:id/multilogin-sync', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
    if (!account.multiloginProfileId?.trim()) {
      return res.status(400).json({ error: 'Configure o multiloginProfileId antes de sincronizar' });
    }

    const { syncCookiesFromMultilogin } = require('../services/multiloginService');
    const n = await syncCookiesFromMultilogin(account);

    // Valida sessão via Private API após sync
    const { createClient } = require('../services/instagramPrivateService');
    const fresh = await Account.findById(account._id);
    const ig    = await createClient(fresh);
    const state = await ig.state.serialize();
    delete state.constants;
    await Account.findByIdAndUpdate(account._id, {
      igSession: JSON.stringify(state),
      healthStatus: 'ativa',
      lastError: '',
      lastSessionKeepAlive: new Date(),
    });

    res.json({ success: true, message: `✅ ${n} cookies sincronizados e sessão validada para @${account.username}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/refresh-session
 * Força renovação imediata da sessão Instagram para esta conta.
 */
router.post('/:id/refresh-session', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { keepAliveAccount } = require('../jobs/sessionKeepAlive');
    const result = await keepAliveAccount(account);

    if (result.status === 'ok') {
      res.json({ success: true, message: `✅ Sessão de @${account.username} renovada com sucesso` });
    } else if (result.status === 'sem_sessao') {
      res.status(400).json({ error: `@${account.username}: sem sessão. Importe cookies (🍪) ou configure o Multilogin.` });
    } else {
      res.status(400).json({ error: `Sessão expirada: ${result.error}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/:id/challenge-sms
 * Solicita reenvio do código de verificação via SMS/telefone
 * (alternativa quando o e-mail não chega).
 */
router.post('/:id/challenge-sms', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { resendChallengeSms } = require('../services/instagramPrivateService');
    const result = await resendChallengeSms(account);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  INSTAGRAPI — conexão via Python service
// ─────────────────────────────────────────────────────────────────────────────

// broadcast is required at section level so every instagrapi handler can use it
// without repeating the require — earlier handlers in this file use their own
// handler-level require, which takes precedence via block scope.
const { broadcast } = require('../events/broadcaster');

/**
 * Error-code → user-facing message map.
 * Raw Python/httpx messages are NEVER sent to the frontend.
 */
const INSTA_ERROR_MESSAGES = {
  RATE_LIMITED:                   'Instagram limitou temporariamente novas tentativas. Aguarde alguns minutos antes de tentar novamente.',
  CHALLENGE_REQUIRED:             'O Instagram requer uma verificação adicional. Acesse o app oficial, resolva o desafio e tente novamente.',
  ACCOUNT_SUSPENDED:              'Esta conta está SUSPENSA pelo Instagram. Nenhuma automação consegue conectá-la enquanto isso durar — entre no app oficial com ela e siga o processo de recurso.',
  CHALLENGE_CODE_REJECTED:        'Código incorreto. Confira o e-mail/SMS e digite novamente.',
  CHALLENGE_FAILED:               'Não foi possível concluir a verificação. Faça o login novamente.',
  NO_PENDING_CHALLENGE:           'O prazo da verificação expirou (10 min). Faça o login novamente.',
  NOT_APPROVED_YET:               'O Instagram ainda não registrou a aprovação. Abra o app, aprove a tentativa de login e confirme aqui de novo.',
  TWO_FACTOR_NO_SESSION:          'O código foi aceito, mas o Instagram não liberou a sessão. Faça o login novamente — se repetir, aguarde alguns minutos antes de tentar.',
  TWO_FACTOR_REQUIRED:            'Digite o código enviado pelo seu método de autenticação.',
  // O Instagram devolve erro de credencial também quando recusa a tentativa por
  // padrão suspeito (IP de datacenter, proxy rotativo). Afirmar "senha errada"
  // manda o usuário trocar a senha quando o problema é outro.
  BAD_PASSWORD:                   'O Instagram recusou o login. Se a senha está certa, ele está bloqueando a tentativa — veja o detalhe abaixo.',
  USER_NOT_FOUND:                 'O Instagram não encontrou nenhuma conta com esse @. Confira o nome de usuário exatamente como aparece no perfil — ou tente o e-mail cadastrado.',
  SESSION_EXPIRED:                'Sessão expirada — faça login novamente.',
  FEEDBACK_REQUIRED:              'Instagram bloqueou temporariamente esta ação. Tente novamente mais tarde.',
  INSTAGRAPI_SERVICE_UNAVAILABLE: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
  SESSION_LOCKED:                 'Já existe uma operação em andamento para esta conta. Aguarde.',
  LOGIN_IN_PROGRESS:              'Já existe uma tentativa de login em andamento para esta conta. Aguarde e tente novamente.',
  NO_INSTAGRAPI_SESSION:          'Conta sem sessão — faça login pelo painel.',
  NO_PENDING_2FA:                 'Nenhum desafio 2FA pendente ou expirado. Inicie o login novamente.',
  TIMEOUT:                        'Tempo de conexão esgotado. Verifique a rede e tente novamente.',
};

function _igUserMessage(code, detail) {
  if (INSTA_ERROR_MESSAGES[code]) return INSTA_ERROR_MESSAGES[code];
  // Código não mapeado (UNKNOWN_ERROR): mostrar o motivo real é melhor que
  // chutar "credenciais incorretas" — o palpite manda o usuário trocar a senha
  // quando o problema pode ser proxy, rede ou mudança na API do Instagram.
  const raw = String(detail || '').trim();
  return raw
    ? `Falha não classificada no login: ${raw}`
    : 'Falha não classificada no login. Veja os logs do serviço instagrapi para o motivo exato.';
}

function _igHttpStatus(code) {
  const map = {
    RATE_LIMITED:                   429,
    CHALLENGE_REQUIRED:             428,
    TWO_FACTOR_REQUIRED:            202,
    SESSION_LOCKED:                 429,
    INSTAGRAPI_SERVICE_UNAVAILABLE: 503,
    FEEDBACK_REQUIRED:              403,
    ACCOUNT_SUSPENDED:              403,
    TIMEOUT:                        504,
    NO_PENDING_2FA:                 400,
    LOGIN_IN_PROGRESS:              409,
    // Instagram credential errors — must NOT be 401 (would trigger SaaS logout)
    BAD_PASSWORD:                   422,
    CHALLENGE_CODE_REJECTED:        422,
    CHALLENGE_FAILED:               422,
    NO_PENDING_CHALLENGE:           422,
    NOT_APPROVED_YET:               409,
    SESSION_EXPIRED:                422,
    AUTH_REQUIRED:                  422,
    NO_INSTAGRAPI_SESSION:          422,
  };
  // Fallback 422 (not 401) so the frontend interceptor never triggers a SaaS logout
  return map[code] || 422;
}

function _getHttp() {
  const { InstagrapiHttpClient } = require('../services/instagrapi/InstagrapiHttpClient');
  const { getSessionManager }    = require('../services/instagrapi/SessionManager');
  const sm = getSessionManager();
  return new InstagrapiHttpClient(null, sm);
}

// ── Helper: per-account login lock (Redis, TTL 35 s) ─────────────────────────
//
// Key: "iglock:login:{accountId}" — distinct from session mutation lock "iglock:{accountId}".
// Throws { code: 'LOGIN_IN_PROGRESS' } when a concurrent login is already running.
// The lock is ALWAYS released in finally — TTL is just a safety net for crashes.

async function _withLoginLock(accountId, fn) {
  const SessionLock = require('../services/instagrapi/SessionLock');
  const redis       = require('../queue/connection');
  const lock        = new SessionLock(redis);
  const lockKey     = `login:${accountId}`; // → Redis key "iglock:login:{accountId}"

  // TTL must exceed TIMEOUT_LOGIN (90 s) so the lock never expires during an active login.
  const token = await lock.acquire(lockKey, 95_000);
  if (!token) {
    console.warn(`[IG-LOGIN] lock status=BLOCKED accountId=${accountId} — LOGIN_IN_PROGRESS`);
    const err  = new Error('Login já em andamento para esta conta');
    err.code   = 'LOGIN_IN_PROGRESS';
    throw err;
  }
  console.log(`[IG-LOGIN] lock status=FREE acquired accountId=${accountId}`);
  try {
    return await fn();
  } finally {
    await lock.release(lockKey, token).catch(() => {});
    console.log(`[IG-LOGIN] lock released accountId=${accountId}`);
  }
}

// ── Helper: update DB after successful instagrapi login ───────────────────────

async function _markInstagrapiConnected(accountId) {
  await Account.findByIdAndUpdate(accountId, {
    provider:        'instagrapi',
    sessionStatus:   'VALID',
    healthStatus:    'ativa',
    lastError:       '',
    lastValidatedAt: new Date(),
  });
}

// ── Helper: try to restore existing session without a new login ───────────────
//
// Returns one of:
//   { restored: true }                           — session loaded; no login needed
//   { restored: false, networkError: true, err } — service unavailable; surface error
//   { restored: false }                          — no valid session; proceed to login

async function _tryRestoreSession(account, http) {
  const accountId = String(account._id);
  const { getSessionManager } = require('../services/instagrapi/SessionManager');
  const sm = getSessionManager();

  // 1. Does a session blob exist in MongoDB?
  const info = await sm.hasPersistedSession(accountId);
  if (!info.exists) return { restored: false };

  // 2. Is the local metadata valid (no network call to Instagram)?
  const validation = await sm.validate(accountId);
  if (!validation.valid) return { restored: false };

  // 3. Load the session into the Python pool
  try {
    await http.ensureSession(account);
    await Account.findByIdAndUpdate(accountId, {
      lastValidatedAt:         new Date(),
      lastSuccessfulRequestAt: new Date(),
    });
    return { restored: true };
  } catch (err) {
    const code = err?.code || '';
    // Transient infrastructure problems: DO NOT fall through to login
    if (code === 'INSTAGRAPI_SERVICE_UNAVAILABLE' || code === 'TIMEOUT') {
      return { restored: false, networkError: true, err };
    }
    // Session corrupt / invalid / not found: proceed to fresh login
    return { restored: false };
  }
}

// ── Helper: fetch public profile and save to Account (non-throwing) ──────────
//
// Always awaited before broadcasting success — errors are logged and swallowed
// so a failed profile fetch never breaks the login response.

async function _fetchAndSaveProfile(http, account, username) {
  try {
    const info = await http.getUserInfo(account, username);
    const update = {};
    if (info.full_name)              update.name        = info.full_name;
    if (info.profile_pic_url)        update.avatar      = info.profile_pic_url;
    if (info.follower_count  != null) update.followers   = info.follower_count;
    if (info.following_count != null) update.following   = info.following_count;
    if (info.media_count     != null) update.postsCount  = info.media_count;
    if (info.pk)                      update.igUserId    = String(info.pk);
    if (Object.keys(update).length) {
      await Account.findByIdAndUpdate(String(account._id), update);
    }
  } catch (e) {
    console.error(`[instagrapi] profile fetch failed for ${account._id}:`, e?.message?.slice(0, 100));
  }
}

// ── Helper: handle instagrapi errors uniformly ────────────────────────────────

async function _handleInstagrapiError(err, res, accountId = null) {
  const code = err?.code || 'UNKNOWN_ERROR';

  // Suspensão é estado da conta, não falha transitória: registra no healthStatus
  // para o painel parar de exibir "Saudável" numa conta que o Instagram derrubou.
  if (code === 'ACCOUNT_SUSPENDED' && accountId) {
    await Account.findByIdAndUpdate(accountId, {
      healthStatus: 'banida',
      lastError:    'Conta suspensa pelo Instagram',
    }).catch(() => {});
  }
  // Log the raw technical detail internally only — never forward to frontend
  const safeLog = err?.message?.slice(0, 200) || 'no message';
  console.error(`[instagrapi] code=${code} raw=${safeLog}`);
  // `detail` vai junto da mensagem curada, em campo separado: a tela mostra o
  // texto legível e, abaixo, o que o Instagram respondeu de fato. Sem isso, uma
  // mensagem curada errada (ex.: BAD_PASSWORD com senha certa) faz o usuário
  // depurar a coisa errada — foi o que aconteceu repetidamente aqui.
  const detail = String(err?.detail || '').slice(0, 300);
  return res.status(_igHttpStatus(code)).json({
    error: _igUserMessage(code, detail),
    code,
    detail,
  });
}

/**
 * POST /accounts/instagrapi-direct
 * Cria (se não existir) ou encontra uma conta pelo username e faz login.
 * Body: { username, password, totp? }
 *
 * Responses:
 *   200 { success: true, accountId }
 *   202 { status: 'TWO_FACTOR_REQUIRED', accountId } — user must call verify-2fa
 *   429 { error, code: 'RATE_LIMITED' }
 *   428 { error, code: 'CHALLENGE_REQUIRED' }
 *   401 { error, code: 'BAD_PASSWORD' | ... }
 */
/**
 * Diagnóstico de conexão — de onde as requisições saem e se o Instagram
 * responde ao handshake. Não faz login e não recebe senha.
 *
 * Existe porque `bad_password` em TODAS as contas ao mesmo tempo tem duas
 * causas possíveis com a mesma aparência: as senhas realmente erradas, ou o
 * Instagram recusando o nosso IP e disfarçando a recusa de erro de
 * credencial. Sem separar as duas, depura-se a hipótese errada.
 */
router.get('/:id/diagnostico', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const http = _getHttp();
    const dados = await http.diagnosticar(account);

    // O veredito fica aqui, não no serviço Python: ele conhece uma conta por
    // vez, e a conclusão depende de saber se a falha atinge todas.
    const handshakeOk = !!(dados?.handshake?.tem_chave);
    const identidadeOk = !!(dados?.identidade?.ua_concorda);
    res.json({
      ...dados,
      conta: account.username,
      leitura: {
        handshake_ok:  handshakeOk,
        identidade_ok: identidadeOk,
        proximo_passo: !handshakeOk
          ? 'O Instagram não devolveu a chave de criptografia. Sem ela a senha vai cifrada com chave inválida e ele responde bad_password mesmo com a senha certa. Verifique conectividade e proxy.'
          : !identidadeOk
            ? 'O User-Agent e o device_settings divergem. Toda tentativa de login sai se contradizendo.'
            : dados?.proxy_aplicado
              ? 'Saída pelo proxy e handshake OK. Se só algumas contas falham, é credencial. Se todas falham, troque o proxy.'
              : 'Saída direta pelo IP do servidor, sem proxy. Se todas as contas falham com bad_password, este IP é o suspeito principal — atribua proxies por conta.',
      },
    });
  } catch (err) {
    const code = err?.response?.data?.detail?.code || err?.code || 'ERRO';
    res.status(502).json({
      error: 'Não foi possível diagnosticar',
      code,
      detalhe: String(err?.response?.data?.detail?.message || err?.message || '').slice(0, 300),
    });
  }
});

router.post('/instagrapi-direct', async (req, res) => {
  const { username, password, totp = '', accountId: bodyAccountId } = req.body;
  console.log(`[IG-LOGIN] request received — username=${String(username || '').slice(0, 30)} bodyAccountId=${bodyAccountId || 'none'}`);

  if (!username?.trim() || !password?.trim()) {
    console.log('[IG-LOGIN] rejected — missing username or password');
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  }
  const clean = username.trim().replace(/^@/, '').toLowerCase();

  let account;
  let _isNewAccount = false; // rastreia se criou conta temporária — para limpeza em caso de falha
  try {
    if (bodyAccountId) {
      // Frontend passou accountId → busca por ID (evita criar duplicata)
      account = await Account.findById(bodyAccountId);
      if (!account) return res.status(404).json({ error: 'Conta não encontrada', code: 'ACCOUNT_NOT_FOUND' });
      console.log(`[IG-LOGIN] accountId=${account._id} provider=${account.provider} healthStatus=${account.healthStatus} (by ID)`);
    } else {
      // Sem accountId → busca por username; cria apenas se realmente não existir
      account = await Account.findOne({ username: clean });
      if (!account) {
        account = await Account.create({ username: clean, status: 'ativa', provider: 'official' });
        _isNewAccount = true;
        console.log(`[IG-LOGIN] accountId=${account._id} provider=official (new account created)`);
      } else {
        console.log(`[IG-LOGIN] accountId=${account._id} provider=${account.provider} healthStatus=${account.healthStatus} sessionStatus=${account.sessionStatus}`);
      }
    }
  } catch (err) {
    console.error('[IG-LOGIN] DB error:', err.message?.slice(0, 100));
    return res.status(500).json({ error: 'Erro ao localizar/criar conta no banco de dados.' });
  }

  const accountId = String(account._id);
  const http = _getHttp();

  // ── FASE 3: per-account login lock (95 s) — prevents duplicate logins ─────
  try {
    await _withLoginLock(accountId, async () => {

      // ── FASE 2: restore existing session before triggering a new login ────
      console.log(`[IG-LOGIN] restore attempt — accountId=${accountId}`);
      try {
        const restore = await _tryRestoreSession(account, http);
        console.log(`[IG-LOGIN] restore result — restored=${restore.restored} networkError=${!!restore.networkError} errCode=${restore.err?.code || 'none'}`);
        if (restore.networkError) {
          console.warn(`[IG-LOGIN] restore failed with network error — code=${restore.err?.code}`);
          _handleInstagrapiError(restore.err, res);
          return;
        }
        if (restore.restored) {
          await _markInstagrapiConnected(accountId);
          await _fetchAndSaveProfile(http, account, clean);
          broadcast('accounts', { action: 'synced' });
          console.log(`[IG-LOGIN] final response=200 (restored existing session)`);
          res.json({ success: true, accountId, message: `@${clean} — sessão existente restaurada` });
          return;
        }
      } catch (restoreErr) {
        console.error(`[IG-LOGIN] restore check threw — ${restoreErr?.message?.slice(0, 100)}`);
      }

      // ── Fresh login (no valid persisted session) ──────────────────────────
      // Comprimento da senha, nunca a senha: compara com o que o Python recebe e
      // prova se ela atravessa a pilha íntegra (há .trim() aqui e no frontend).
      const _pwd = password.trim();
      console.log(
        `[IG-LOGIN] password_len=${_pwd.length} ascii=${/^[\x20-\x7E]*$/.test(_pwd)}`
      );
      console.log(`[IG-LOGIN] calling Python service — POST /session/login (timeout=90s)`);
      const result = await http.login(account, clean, password.trim(), (totp || '').trim());
      console.log(`[IG-LOGIN] Python response — status=${result.status} has_settings=${!!result.settings}`);

      if (result.status === 'TWO_FACTOR_REQUIRED') {
        console.log('[IG-LOGIN] final response=202 (2FA required)');
        res.status(202).json({ status: 'TWO_FACTOR_REQUIRED', accountId, message: _igUserMessage('TWO_FACTOR_REQUIRED') });
        return;
      }

      // Desafio de verificação. `kind` decide a tela: 'approval' (aprovar no app,
      // sem código) ou 'code' (código por e-mail/SMS). Repassar este campo é
      // obrigatório — sem ele o front cai no padrão 'code' e pede um código que
      // o Instagram nunca enviou.
      if (result.status === 'CHALLENGE_REQUIRED') {
        const kind = result.kind === 'approval' ? 'approval' : 'code';
        console.log(`[IG-LOGIN] final response=202 (challenge required, kind=${kind}, canal=${result.channel || '-'})`);
        res.status(202).json({
          status:    'CHALLENGE_REQUIRED',
          accountId,
          kind,
          channel:   result.channel || null,
          message:   result.message || (kind === 'approval'
            ? 'Aprove a tentativa de login no app do Instagram e depois confirme aqui.'
            : 'O Instagram enviou um código de verificação. Digite-o para concluir.'),
        });
        return;
      }

      console.log(`[IG-LOGIN] session saved=${!!result.settings} — marking connected`);
      await _markInstagrapiConnected(accountId);

      console.log('[IG-LOGIN] profile fetch — starting');
      await _fetchAndSaveProfile(http, account, clean);

      console.log('[IG-LOGIN] broadcast — sending accounts synced');
      broadcast('accounts', { action: 'synced' });

      console.log('[IG-LOGIN] final response=200 (authenticated)');
      res.json({ success: true, accountId, message: `@${clean} conectada via API Mobile` });
    });
  } catch (err) {
    // Limpeza: se esta rota criou uma conta temporária e o login falhou, remove o órfão
    if (_isNewAccount) {
      await require('../utils/removerConta')(account?._id).catch(() => {});
      console.log(`[IG-LOGIN] orphan account ${account?._id} deleted — login failed with code=${err?.code}`);
    }
    console.error(`[IG-LOGIN] error — code=${err?.code} msg=${err?.message?.slice(0, 150)}`);
    // Passa o id só quando a conta permanece cadastrada — em conta órfã recém
    // removida não há o que marcar.
    return _handleInstagrapiError(err, res, _isNewAccount ? null : account?._id);
  }
});

/**
 * POST /accounts/instagrapi-verify-2fa
 * Completa o desafio 2FA iniciado por /instagrapi-direct.
 * Body: { username, code }
 */
router.post('/instagrapi-verify-2fa', async (req, res) => {
  const { username, code } = req.body;
  if (!username?.trim() || !code?.trim()) {
    return res.status(400).json({ error: 'username e code são obrigatórios' });
  }
  const clean = username.trim().replace(/^@/, '').toLowerCase();

  const account = await Account.findOne({ username: clean });
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  try {
    const http   = _getHttp();
    const result = await http.verify2fa(account, code.trim());
    // Sem settings não houve sessão — marcar conectada aqui produziria uma conta
    // verde no painel e desconectada no health check.
    if (!result?.settings) {
      return res.status(422).json({
        code:  'TWO_FACTOR_NO_SESSION',
        error: _igUserMessage('TWO_FACTOR_NO_SESSION'),
      });
    }
    await _markInstagrapiConnected(String(account._id));
    await _fetchAndSaveProfile(http, account, clean);
    broadcast('accounts', { action: 'synced' });
    return res.json({ success: true, message: `@${clean} conectada via API Mobile` });
  } catch (err) {
    return _handleInstagrapiError(err, res, account?._id);
  }
});

/**
 * GET /accounts/check-username/:username
 * Verifica se um @ existe no Instagram, usando a sessão de uma conta já
 * conectada como sonda. Serve para decidir entre "o @ está errado" e "o @ existe
 * e o Instagram está recusando o login por outro motivo" — distinção que a
 * resposta do endpoint de login não permite fazer.
 *
 * Respostas:
 *   200 { available: false }                     — nenhuma conta conectada para sondar
 *   200 { available: true, exists: false }       — o @ não existe
 *   200 { available: true, exists: true, ... }   — existe, com dados públicos
 */
router.get('/check-username/:username', async (req, res) => {
  const alvo = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase();
  if (!alvo) return res.status(400).json({ error: 'username é obrigatório' });

  try {
    // Sonda: qualquer conta com sessão instagrapi ativa, exceto a própria.
    const prober = await Account.findOne({
      provider: 'instagrapi',
      instagrapiSession: { $exists: true, $nin: [null, ''] },
      username: { $ne: alvo },
    });
    if (!prober) return res.json({ available: false });

    const http = _getHttp();
    await http.ensureSession(prober);
    const info = await http.getUserInfo(prober, alvo);

    return res.json({
      available:  true,
      exists:     true,
      username:   alvo,
      full_name:  info.full_name || '',
      followers:  info.follower_count || 0,
      posts:      info.media_count || 0,
      probed_by:  prober.username,
    });
  } catch (err) {
    if (err?.code === 'USER_NOT_FOUND') {
      return res.json({ available: true, exists: false, username: alvo });
    }
    // Qualquer outra falha (sessão da sonda expirada, rede) não é conclusiva.
    console.error(`[CHECK-USERNAME] @${alvo} — code=${err?.code} msg=${err?.message?.slice(0, 120)}`);
    return res.json({ available: false, error: err?.code || 'PROBE_FAILED' });
  }
});

/**
 * POST /accounts/instagrapi-challenge-approved
 * Reconhece o checkpoint "aprove no app" depois da aprovação manual.
 * Body: { username }
 *
 * Não conclui a conexão: o frontend deve repetir o login (a senha continua
 * apenas na tela, nunca é armazenada no servidor).
 *
 * Respostas:
 *   200 { status: 'DISMISSED' }            — reconhecido, refaça o login
 *   409 { code: 'NOT_APPROVED_YET' }       — aprovação ainda não registrada
 */
router.post('/instagrapi-challenge-approved', async (req, res) => {
  const { username } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'username é obrigatório' });
  const clean = username.trim().replace(/^@/, '').toLowerCase();

  const account = await Account.findOne({ username: clean });
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  try {
    const http   = _getHttp();
    const result = await http.challengeApproved(account);
    console.log(`[IG-CHALLENGE] @${clean} — checkpoint reconhecido`);
    return res.json({ status: result.status || 'DISMISSED', message: result.message || '' });
  } catch (err) {
    console.error(`[IG-CHALLENGE] @${clean} approve — code=${err?.code} msg=${err?.message?.slice(0, 150)}`);
    return _handleInstagrapiError(err, res);
  }
});

/**
 * POST /accounts/instagrapi-challenge-code
 * Conclui o desafio de verificação iniciado por /instagrapi-direct.
 * Body: { username, code }
 *
 * Respostas:
 *   200 { success: true }                          — conta conectada
 *   422 { code: 'CHALLENGE_CODE_REJECTED' }        — código errado, pode tentar outro
 *   422 { code: 'NO_PENDING_CHALLENGE' }           — prazo de 10 min expirou
 */
router.post('/instagrapi-challenge-code', async (req, res) => {
  const { username, code } = req.body;
  if (!username?.trim() || !code?.trim()) {
    return res.status(400).json({ error: 'username e code são obrigatórios' });
  }
  const clean = username.trim().replace(/^@/, '').toLowerCase();

  const account = await Account.findOne({ username: clean });
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  try {
    const http   = _getHttp();
    const result = await http.challengeCode(account, code.trim());

    // Checkpoint resolvido, porém sem sessão: o login precisa ser repetido.
    // Não marcamos a conta como conectada aqui — fazer isso deixaria o card
    // "conectado" sem sessão real, com 0 seguidores e sem sincronizar.
    if (result.status === 'RELOGIN_REQUIRED') {
      console.log(`[IG-CHALLENGE] @${clean} — checkpoint resolvido, relogin necessário`);
      return res.status(202).json({
        status:  'RELOGIN_REQUIRED',
        message: result.message || 'Verificação concluída. Concluindo a conexão...',
      });
    }

    await _markInstagrapiConnected(String(account._id));
    await _fetchAndSaveProfile(http, account, clean);
    broadcast('accounts', { action: 'synced' });
    console.log(`[IG-CHALLENGE] @${clean} conectada após verificação`);
    return res.json({ success: true, message: `@${clean} conectada via API Mobile` });
  } catch (err) {
    console.error(`[IG-CHALLENGE] @${clean} — code=${err?.code} msg=${err?.message?.slice(0, 150)}`);
    return _handleInstagrapiError(err, res);
  }
});

/**
 * POST /accounts/instagrapi-sessionid-new
 * Cria conta (se não existir) e conecta via Session ID — sem accountId prévio.
 * Usado quando não há nenhuma conta cadastrada ainda.
 * Body: { username, sessionid }
 */
router.post('/instagrapi-sessionid-new', async (req, res) => {
  const { broadcast } = require('../events/broadcaster');
  const http = _getHttp();

  const clean = (req.body.username || '').trim().replace(/^@/, '').toLowerCase();
  if (!clean) return res.status(400).json({ error: 'username não informado' });

  let sessionid = (req.body.sessionid || '').trim();
  try { sessionid = decodeURIComponent(sessionid); } catch { /* já decodificado */ }
  if (!sessionid) return res.status(400).json({ error: 'sessionid não informado' });

  let account;
  let _isNew = false;
  try {
    account = await Account.findOne({ username: clean });
    if (!account) {
      account = await Account.create({ username: clean, status: 'ativa', provider: 'official' });
      _isNew = true;
    }
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao localizar/criar conta no banco de dados.' });
  }

  const accountId = String(account._id);
  try {
    await _withLoginLock(accountId, async () => {
      await http.loginBySessionid(account, sessionid);
      await _markInstagrapiConnected(accountId);
      await _fetchAndSaveProfile(http, account, clean);
      broadcast('accounts', { action: 'synced' });
      res.json({ success: true, accountId, message: `@${clean} conectada via Session ID` });
    });
  } catch (err) {
    if (_isNew) await require('../utils/removerConta')(account._id).catch(() => {});
    _handleInstagrapiError(err, res);
  }
});

/**
 * POST /accounts/:id/instagrapi-sessionid
 * Conecta conta via Session ID do Instagram (cookie do browser).
 * NÃO chama accounts/login/ — imune ao bloqueio de IP por rate limit.
 *
 * Como obter o sessionid:
 *   1. Abra instagram.com no seu navegador
 *   2. F12 → Application → Cookies → https://www.instagram.com
 *   3. Copie o valor do cookie "sessionid"
 *
 * Body: { sessionid }
 */
router.post('/:id/instagrapi-sessionid', async (req, res) => {
  const account = await Account.findById(req.params.id).catch(() => null);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  let sessionid = (req.body.sessionid || '').trim();
  if (!sessionid) return res.status(400).json({ error: 'sessionid não informado' });
  try { sessionid = decodeURIComponent(sessionid); } catch { /* já decodificado */ }

  const accountId = String(account._id);
  const http = _getHttp();
  const { broadcast } = require('../events/broadcaster');

  try {
    await _withLoginLock(accountId, async () => {
      await http.loginBySessionid(account, sessionid);
      await _markInstagrapiConnected(accountId);
      await _fetchAndSaveProfile(http, account, account.username);
      broadcast('accounts', { action: 'synced' });
      console.log(`[SID-LOGIN] @${account.username} conectada via sessionid`);
      res.json({ success: true, accountId, message: `@${account.username} conectada via Session ID` });
    });
  } catch (err) {
    _handleInstagrapiError(err, res);
  }
});

/**
 * POST /accounts/:id/instagrapi-login
 * Login via instagrapi para conta já existente.
 * Body: { username, password, totp? }
 */
router.post('/:id/instagrapi-login', async (req, res) => {
  const account = await Account.findById(req.params.id).catch(() => null);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  const { username, password, totp = '' } = req.body;
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  }

  const accountId = String(account._id);
  const http = _getHttp();

  // ── FASE 3: per-account login lock (35 s) — prevents duplicate logins ─────
  try {
    await _withLoginLock(accountId, async () => {

      // ── FASE 2: restore existing session before triggering a new login ────
      try {
        const restore = await _tryRestoreSession(account, http);
        if (restore.networkError) { _handleInstagrapiError(restore.err, res); return; }
        if (restore.restored) {
          await _markInstagrapiConnected(accountId);
          await _fetchAndSaveProfile(http, account, account.username);
          broadcast('accounts', { action: 'synced' });
          res.json({ success: true, accountId, message: `@${account.username} — sessão existente restaurada` });
          return;
        }
      } catch (restoreErr) {
        console.error(`[instagrapi] restore check failed for ${accountId}:`, restoreErr?.message?.slice(0, 100));
      }

      // ── Fresh login (no valid persisted session) ──────────────────────────
      const result = await http.login(account, username.trim(), password.trim(), (totp || '').trim());

      if (result.status === 'TWO_FACTOR_REQUIRED') {
        res.status(202).json({ status: 'TWO_FACTOR_REQUIRED', accountId, message: _igUserMessage('TWO_FACTOR_REQUIRED') });
        return;
      }

      await _markInstagrapiConnected(accountId);
      await _fetchAndSaveProfile(http, account, account.username);
      broadcast('accounts', { action: 'synced' });
      res.json({ success: true, accountId, message: `@${account.username} conectada via API Mobile` });
    });
  } catch (err) {
    _handleInstagrapiError(err, res);
  }
});

/**
 * POST /accounts/:id/instagrapi-disconnect
 * Remove a sessão instagrapi e restaura o provider para 'official'.
 */
router.post('/:id/instagrapi-disconnect', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const { getSessionManager } = require('../services/instagrapi/SessionManager');
    await getSessionManager().invalidate(String(account._id));

    await Account.findByIdAndUpdate(account._id, {
      provider:      'official',
      sessionStatus: 'UNKNOWN',
    });

    broadcast('accounts', { action: 'synced' });
    res.json({ success: true, message: `@${account.username} desconectada do instagrapi` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /accounts/:id/session-status
 * Retorna o estado da sessão instagrapi de forma segura.
 * NUNCA retorna: password, cookies, instagrapiSession, sessionid, tokens.
 */
router.get('/:id/session-status', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id)
      .select('provider sessionStatus consecutiveFailures lastValidatedAt lastSuccessfulRequestAt lastSessionErrorAt sessionVersion instagrapiSession')
      .lean();
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    return res.json({
      provider:                 account.provider,
      sessionStatus:            account.sessionStatus,
      hasSession:               !!account.instagrapiSession,
      consecutiveFailures:      account.consecutiveFailures || 0,
      lastValidatedAt:          account.lastValidatedAt || null,
      lastSuccessfulRequestAt:  account.lastSuccessfulRequestAt || null,
      lastSessionErrorAt:       account.lastSessionErrorAt || null,
      sessionVersion:           account.sessionVersion || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /accounts/clear-oauth-tokens
 * Remove accessToken/tokenExpiresAt/igUserId antigos (legado OAuth removido).
 * Deixa o health check usar igSession/rawWebSessionid em vez do token expirado.
 */
router.post('/clear-oauth-tokens', async (req, res) => {
  try {
    const result = await Account.updateMany(
      { accessToken: { $exists: true, $ne: '' } },
      { $unset: { accessToken: '', tokenExpiresAt: '', igUserId: '' },
        $set:   { lastError: '', healthStatus: 'ativa' } }
    );
    broadcast('accounts', { action: 'synced' });
    res.json({ cleared: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

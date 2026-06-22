const Account = require('../models/Account');
const testProxy = require('../services/testProxy');
const { broadcast } = require('../events/broadcaster');

// Lazy-load para evitar carregar Puppeteer no startup (causa crash no Windows)
const getSyncAccountInfo    = () => require('../services/syncAccountInfo');
const getOpenAccountBrowser = () => require('../services/openAccountBrowser');
const getBulkConnectAccounts = () => require('../services/bulkConnectAccounts');
const getBulkEditProfiles   = () => require('../services/bulkEditProfiles');

exports.createAccount = async (req, res) => {
  try {
    const account = await Account.create({
      ...req.body,
      username: String(req.body.username || '')
        .trim()
        .replace(/^@+/, ''),
    });

    broadcast('accounts', { action: 'created' });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.connectBulkAccounts = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Conexão em lote iniciada.',
    });

    getBulkConnectAccounts()()
      .then((results) => {
        console.log('🎉 Conexão em lote finalizada:', results);
      })
      .catch((err) => {
        console.log('💥 Erro conexão em lote:', err.message);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAccounts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [accounts, total] = await Promise.all([
      Account.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Account.countDocuments(),
    ]);

    res.json({
      accounts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    await Account.findByIdAndDelete(req.params.id);
    broadcast('accounts', { action: 'deleted' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.syncAccount = async (req, res) => {
  try {
    const account = await getSyncAccountInfo()(req.params.id);
    broadcast('accounts', { action: 'synced' });
    res.json(account);
  } catch (err) {
    res.status(500).json({
      error: err.message || 'Erro ao sincronizar conta',
    });
  }
};

exports.syncAllAccounts = async (req, res) => {
  try {
    res.json({ success: true, message: 'Sincronização geral iniciada.' });

    const accounts = await Account.find({ isBusy: { $ne: true } }).sort({ lastSync: 1 });

    const syncViaAPI     = require('../services/syncAccountAPI');
    const syncInfoExists = require('fs').existsSync;
    const path           = require('path');
    const SESSIONS_ROOT  = path.resolve(__dirname, '../../sessions');

    let apiCount = 0, browserCount = 0, skipCount = 0;

    for (const account of accounts) {
      const hasApiToken  = !!(account.accessToken && account.igUserId);
      const cookiesPath  = path.join(SESSIONS_ROOT, account.username, 'cookies.json');
      const hasCookies   = syncInfoExists(cookiesPath);

      try {
        if (hasApiToken) {
          // Contas com token OAuth → sync rápido via API (sem Puppeteer)
          console.log(`🔄 [SyncAll] API @${account.username}`);
          await syncViaAPI(account);
          apiCount++;
          await new Promise(r => setTimeout(r, 1000)); // delay mínimo entre chamadas de API
        } else if (hasCookies) {
          // Contas com sessão browser → sync via Puppeteer
          console.log(`🔄 [SyncAll] Browser @${account.username}`);
          await getSyncAccountInfo()(account._id);
          browserCount++;
          await new Promise(r => setTimeout(r, 12000)); // Puppeteer precisa de mais tempo
        } else {
          // Sem sessão → apenas marca como sem sessão
          console.log(`⏭️  [SyncAll] Sem sessão @${account.username} — pulando`);
          await Account.findByIdAndUpdate(account._id, {
            healthStatus: 'sessao_expirada',
            lastError: 'Sem sessão — clique em "Entrar" para reconectar',
            lastSync: new Date(),
          });
          skipCount++;
        }
      } catch (err) {
        console.log(`❌ [SyncAll] @${account.username}: ${err.message}`);
      }
    }

    // Quick-check HTTP para detectar bans em contas que não passaram pelo Puppeteer
    try {
      const { quickCheckAll } = require('../services/quickCheckAccount');
      await quickCheckAll();
    } catch (e) {
      console.log('⚠️ QuickCheck falhou:', e.message);
    }

    broadcast('accounts', { action: 'synced' });
    console.log(`🎉 SyncAll concluído — API: ${apiCount}, Browser: ${browserCount}, Sem sessão: ${skipCount}`);
  } catch (err) {
    console.log('Erro syncAll:', err.message);
  }
};

exports.importBulkAccounts = async (req, res) => {
  try {
    const text = req.body.accountsText || '';
    const connectApi = req.body.connectApi !== false; // default: true

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const imported = [];
    const errors   = [];
    const apiResults = [];

    // Lazy-load private API service to avoid crash if package not installed
    let createClient, convertToProfessional, getAccountType;
    try {
      ({ createClient, convertToProfessional, getAccountType } = require('../services/instagramPrivateService'));
    } catch (_) {
      createClient = null;
    }

    for (const line of lines) {
      // Formatos aceitos:
      //   usuario:senha
      //   usuario:senha:email@exemplo.com
      //   usuario:senha:+5511999990000
      const parts = line.split(':');
      if (parts.length < 2) { errors.push(`Linha inválida (sem ':'): ${line}`); continue; }

      const usernameRaw  = parts[0];
      const passwordRaw  = parts[1];
      // email pode conter ':' (ex: nada normal, mas por segurança juntamos o resto)
      const loginEmailRaw = parts.slice(2).join(':').trim();

      const username   = String(usernameRaw || '').trim().replace(/^@+/, '');
      const password   = String(passwordRaw || '').trim();
      const loginEmail = loginEmailRaw || '';

      if (!username || !password) {
        errors.push(`Linha inválida (usuário ou senha vazios): ${line}`);
        continue;
      }

      // 1. Criar/atualizar conta no banco
      const updateFields = {
        username,
        password,
        name: username,
        status: 'ativa',
        healthStatus: 'ativa',
      };
      if (loginEmail) updateFields.loginEmail = loginEmail;

      const account = await Account.findOneAndUpdate(
        { username },
        updateFields,
        { upsert: true, new: true }
      );

      imported.push(account.username);

      // 2. Login via Private API + auto-conversão para conta profissional
      if (connectApi && createClient) {
        try {
          console.log(`🔐 [Import] Login @${username}...`);
          await createClient(account);
          console.log(`✅ [Import] @${username} autenticada`);

          // Verifica tipo de conta e converte se for pessoal
          if (getAccountType) {
            try {
              const typeInfo = await getAccountType(account);
              if (!typeInfo.isProfessional) {
                console.log(`🔄 [Import] @${username} é pessoal — convertendo para Creator...`);
                await convertToProfessional(account);
                await Account.findByIdAndUpdate(account._id, { accountType: 'creator' });
                apiResults.push({ username, apiStatus: 'convertida_para_creator' });
                console.log(`✅ [Import] @${username} convertida para Creator`);
              } else {
                apiResults.push({ username, apiStatus: 'conectada', accountType: typeInfo.typeName });
              }
            } catch (typeErr) {
              // Falha na verificação/conversão não impede o import
              apiResults.push({ username, apiStatus: 'conectada', conversionWarning: typeErr.message });
              console.warn(`⚠️ [Import] @${username} verificação de tipo falhou: ${typeErr.message}`);
            }
          } else {
            apiResults.push({ username, apiStatus: 'conectada' });
          }
        } catch (apiErr) {
          const msg = apiErr.message || String(apiErr);
          const isChallenge = apiErr.code === 'CHALLENGE_REQUIRED' || /challenge_required/i.test(msg);
          const isTotp      = apiErr.code === 'TOTP_REQUIRED';
          apiResults.push({
            username,
            accountId: String(account._id),
            apiStatus: isTotp ? 'totp_required' : isChallenge ? 'challenge_required' : 'erro',
            error: isTotp
              ? 'Conta com autenticador 2FA ativo. Abra o Google Authenticator / Authy e clique em "Inserir código".'
              : isChallenge
                ? 'Instagram pediu verificação por email/SMS. Clique em "Verificar" para enviar o código.'
                : msg,
          });
          console.warn(`⚠️ [Import] @${username} ${isChallenge ? 'challenge' : 'falhou'}: ${msg}`);
        }
      }
    }

    broadcast('accounts', { action: 'created' });

    res.json({
      success: true,
      imported,
      errors,
      total: imported.length,
      apiResults,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.openAccount = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Abrindo navegador logado na conta...',
    });

    getOpenAccountBrowser()(req.params.id).catch((err) => {
      console.log('💥 Erro ao abrir conta:', err.message);
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.bulkEditProfiles = async (req, res) => {
  try {
    const accountIds = JSON.parse(req.body.accountIds || '[]');

    if (!accountIds.length) {
      return res.status(400).json({
        error: 'Nenhuma conta selecionada',
      });
    }

    res.json({
      success: true,
      message: 'Edição em massa iniciada.',
    });

    getBulkEditProfiles()({
      accountIds,
      name:         req.body.name         || '',
      bio:          req.body.bio          !== undefined ? req.body.bio : '',
      externalLink: req.body.externalLink || '',
      photo:        req.file              || null,
      setGender:    req.body.setGender    !== 'false',  // default true
    })
      .then((results) => {
        console.log('🎉 Edição em massa finalizada:', results);
      })
      .catch((err) => {
        console.log('💥 Erro edição em massa:', err.message);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProxy = async (req, res) => {
  try {
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      {
        proxy: req.body.proxy || '',
        proxyStatus: 'nao_testado',
        proxyLastCheck: null,
      },
      { new: true }
    );

    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.testAccountProxy = async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);

    if (!account) {
      return res.status(404).json({ error: 'Conta não encontrada' });
    }

    const result = await testProxy(account.proxy);

    account.proxyStatus = result.ok ? 'online' : 'offline';
    account.proxyLastCheck = new Date();

    if (!result.ok) {
      account.lastError = result.error;
    }

    await account.save();

    res.json({
      success: result.ok,
      ip: result.ip,
      error: result.error,
      account,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.testAllProxies = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Teste geral de proxies iniciado.',
    });

    const accounts = await Account.find({
      proxy: { $ne: '' },
    });

    for (const account of accounts) {
      try {
        console.log(`🌐 Testando proxy de @${account.username}`);

        const result = await testProxy(account.proxy);

        account.proxyStatus = result.ok ? 'online' : 'offline';
        account.proxyLastCheck = new Date();

        if (!result.ok) {
          account.lastError = result.error;
        }

        await account.save();

        await new Promise((r) => setTimeout(r, 5000));
      } catch (err) {
        account.proxyStatus = 'offline';
        account.proxyLastCheck = new Date();
        account.lastError = err.message;
        await account.save();
      }
    }

    console.log('✅ Teste geral de proxies finalizado');
  } catch (err) {
    console.log('Erro testAllProxies:', err.message);
  }
};

exports.bulkApplyProxies = async (req, res) => {
  try {
    const proxiesText = req.body.proxiesText || '';

    const proxies = proxiesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!proxies.length) {
      return res.status(400).json({ error: 'Nenhum proxy informado' });
    }

    const accounts = await Account.find().sort({ createdAt: -1 });

    if (!accounts.length) {
      return res.status(400).json({ error: 'Nenhuma conta encontrada' });
    }

    let applied = 0;

    for (let i = 0; i < accounts.length; i++) {
      const proxy = proxies[i % proxies.length];

      accounts[i].proxy = proxy;
      accounts[i].proxyStatus = 'nao_testado';
      accounts[i].proxyLastCheck = null;

      await accounts[i].save();

      applied++;
    }

    res.json({
      success: true,      applied,
      message: `${applied} conta(s) atualizada(s) com proxies`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

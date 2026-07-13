const Account = require('../models/Account');
const testProxy = require('../services/testProxy');
const { broadcast } = require('../events/broadcaster');

// In-memory import job tracker
const _importJobs = new Map();
let _importSeq = 1;

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

    const [rawAccounts, total] = await Promise.all([
      Account.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Account.countDocuments(),
    ]);

    // Converte campos sensíveis em flags booleanos (não expõe dados para o frontend)
    const accounts = rawAccounts.map(a => {
      const obj = a.toObject();
      obj.hasTotpSecret    = !!obj.totpSecret;
      obj.hasPassword      = !!obj.password;
      obj.hasIgSession     = !!(obj.igSession || obj.rawWebSessionid);
      delete obj.totpSecret;
      delete obj.password;
      delete obj.igSession;
      delete obj.rawWebSessionid;
      return obj;
    });

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
    const syncViaAPI = require('../services/syncAccountAPI');
    const { syncOneAccountFast } = require('../jobs/accountFastSync');

    let apiCount = 0, privateCount = 0, skipCount = 0;

    for (const account of accounts) {
      const hasApiToken = !!(account.accessToken && account.igUserId);
      const hasSession  = !!(account.igSession);

      try {
        if (hasApiToken) {
          console.log(`🔄 [SyncAll] Graph API @${account.username}`);
          await syncViaAPI(account);
          apiCount++;
          await new Promise(r => setTimeout(r, 1000));
        } else if (hasSession) {
          console.log(`🔄 [SyncAll] Private API @${account.username}`);
          await syncOneAccountFast(account._id);
          privateCount++;
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.log(`⏭️  [SyncAll] Sem sessão @${account.username}`);
          await Account.findByIdAndUpdate(account._id, {
            healthStatus: 'sessao_expirada',
            lastError: 'Sem sessão — clique em API para conectar',
            lastSync: new Date(),
          });
          skipCount++;
        }
      } catch (err) {
        console.log(`❌ [SyncAll] @${account.username}: ${err.message}`);
      }
    }

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

exports.reconnectAllAccounts = async (req, res) => {
  try {
    let createClient;
    try { ({ createClient } = require('../services/instagramPrivateService')); } catch (_) {}
    if (!createClient) return res.status(500).json({ error: 'instagram-private-api não instalado' });

    const accounts = await Account.find({ password: { $ne: '' } }).lean();
    if (!accounts.length) return res.json({ success: true, message: 'Nenhuma conta com senha configurada.', jobId: null, total: 0 });

    const jobId = `reconnect_${_importSeq++}`;
    _importJobs.set(jobId, { status: 'running', total: accounts.length, done: 0, apiResults: [], startedAt: new Date() });
    res.json({ success: true, jobId, total: accounts.length });

    (async () => {
      for (const account of accounts) {
        const job = _importJobs.get(jobId);
        try {
          await Account.findByIdAndUpdate(account._id, { challengeState: '' });
          const fresh = await Account.findById(account._id);
          await createClient(fresh, { forcePasswordLogin: true });
          await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '' });
          job.apiResults.push({ username: account.username, apiStatus: 'conectada' });
        } catch (err) {
          const code = err.code || '';
          const apiStatus = code === 'TOTP_REQUIRED' ? 'totp_required'
            : (code === 'CHALLENGE_REQUIRED' || /challenge/i.test(err.message)) ? 'challenge_required'
            : 'erro';
          await Account.findByIdAndUpdate(account._id, {
            healthStatus: apiStatus === 'erro' ? 'erro_login' : 'sessao_expirada',
            lastError: err.message,
          });
          job.apiResults.push({ username: account.username, accountId: String(account._id), apiStatus, error: err.message, autoSent: err.autoSent || false });
        }
        job.done++;
        broadcast('accounts', { action: 'synced' });
        broadcast('import_job', { jobId, done: job.done, total: job.total, latest: job.apiResults[job.apiResults.length - 1] });
        await new Promise(r => setTimeout(r, 2000));
      }
      const job = _importJobs.get(jobId);
      job.status = 'done'; job.finishedAt = new Date();
      broadcast('import_job', { jobId, status: 'done', apiResults: job.apiResults });
      broadcast('accounts', { action: 'synced' });
    })().catch(err => { const j = _importJobs.get(jobId); if (j) { j.status = 'error'; j.error = err.message; } });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

function _parseAccountLines(text) {
  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!allLines.length) return { rows: [], errors: [] };

  const firstLower = allLines[0].toLowerCase();
  const sep = firstLower.includes('\t') ? '\t' : firstLower.includes(';') ? ';' : ',';
  const HEADER_WORDS = ['usuario', 'username', 'user', 'conta', 'account', 'senha', 'password', 'pass', 'login'];
  const isCSV = sep !== ':' && HEADER_WORDS.some(w => firstLower.includes(w));

  const rows = [];
  const errors = [];

  if (isCSV) {
    const rawHeaders = allLines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[\s"']/g, '').replace(/-/g, '_'));
    const idx = h => rawHeaders.findIndex(r => r.includes(h));
    const uIdx = rawHeaders.findIndex(r => ['usuario','username','user','conta','account','login'].some(k => r.includes(k)));
    const pIdx = rawHeaders.findIndex(r => ['senha','password','pass','pwd'].some(k => r.includes(k)));
    const tIdx = rawHeaders.findIndex(r => ['chave','totp','2fa','secret'].some(k => r.includes(k)));
    const eIdx = idx('email');

    if (uIdx < 0 || pIdx < 0) { errors.push('CSV inválido — colunas "usuario" e "senha" são obrigatórias'); return { rows, errors }; }

    for (const line of allLines.slice(1)) {
      const cols = line.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
      const username = (cols[uIdx] || '').replace(/^@+/, '');
      const password = cols[pIdx] || '';
      if (!username || !password) { errors.push(`Linha ignorada (vazia): ${line}`); continue; }
      rows.push({ username, password, loginEmail: eIdx >= 0 ? cols[eIdx] || '' : '', totpSecret: tIdx >= 0 ? (cols[tIdx] || '').replace(/\s/g, '').toUpperCase() : '' });
    }
  } else {
    for (const line of allLines) {
      const parts = line.split(':');
      if (parts.length < 2) { errors.push(`Linha inválida: ${line}`); continue; }
      const username = String(parts[0] || '').trim().replace(/^@+/, '');
      const password = String(parts[1] || '').trim();
      let loginEmail = '', totpSecret = '';
      if (parts.length >= 4) {
        loginEmail = parts.slice(2, parts.length - 1).join(':').trim();
        totpSecret = parts[parts.length - 1].replace(/\s/g, '').toUpperCase();
      } else if (parts.length === 3) {
        const third = parts[2].trim();
        if (/^[A-Z2-7]{16,64}$/i.test(third.replace(/\s/g, ''))) totpSecret = third.replace(/\s/g, '').toUpperCase();
        else loginEmail = third;
      }
      if (!username || !password) { errors.push(`Linha inválida (usuário ou senha vazios): ${line}`); continue; }
      rows.push({ username, password, loginEmail, totpSecret });
    }
  }
  return { rows, errors };
}

exports.importBulkAccounts = async (req, res) => {
  try {
    const text       = req.body.accountsText || '';
    const connectApi = req.body.connectApi !== false;

    const { rows, errors: parseErrors } = _parseAccountLines(text);
    const errors = [...parseErrors];

    const imported      = [];
    const savedAccounts = [];

    // Lazy-load private API service
    let createClient, convertToProfessional, getAccountType;
    try {
      ({ createClient, convertToProfessional, getAccountType } = require('../services/instagramPrivateService'));
    } catch (_) { createClient = null; }

    // ── Passo 1: salva todas as contas no banco (rápido) ─────────────────────
    for (const { username, password, loginEmail, totpSecret } of rows) {

      const updateFields = { username, password, name: username, status: 'ativa', healthStatus: 'ativa' };
      if (loginEmail) updateFields.loginEmail = loginEmail;
      if (totpSecret) updateFields.totpSecret = totpSecret;

      const account = await Account.findOneAndUpdate({ username }, updateFields, { upsert: true, new: true });
      imported.push(account.username);
      savedAccounts.push(account);
    }

    broadcast('accounts', { action: 'created' });

    // ── Passo 2: responde imediatamente ──────────────────────────────────────
    const jobId = `import_${_importSeq++}`;
    _importJobs.set(jobId, {
      status: connectApi && createClient && savedAccounts.length ? 'running' : 'done',
      total:  savedAccounts.length,
      done:   0,
      apiResults: [],
      startedAt: new Date(),
    });

    res.json({ success: true, imported, errors, total: imported.length, jobId, status: _importJobs.get(jobId).status });

    // ── Passo 3: conecta em background ───────────────────────────────────────
    if (connectApi && createClient && savedAccounts.length) {
      (async () => {
        for (const account of savedAccounts) {
          const job = _importJobs.get(jobId);
          try {
            console.log(`[Import] Login @${account.username}...`);
            await createClient(account);
            console.log(`[Import] @${account.username} autenticada`);

            let apiStatus = 'conectada';
            if (getAccountType) {
              try {
                const typeInfo = await getAccountType(account);
                if (!typeInfo.isProfessional) {
                  await convertToProfessional(account);
                  await Account.findByIdAndUpdate(account._id, { accountType: 'creator' });
                  apiStatus = 'convertida_para_creator';
                  console.log(`[Import] @${account.username} convertida para Creator`);
                } else {
                  apiStatus = typeInfo.typeName || 'conectada';
                }
              } catch (typeErr) {
                console.warn(`[Import] @${account.username} tipo falhou: ${typeErr.message}`);
              }
            }

            job.apiResults.push({ username: account.username, apiStatus });
          } catch (apiErr) {
            const msg        = apiErr.message || String(apiErr);
            const isTotp     = apiErr.code === 'TOTP_REQUIRED';
            const isChallenge = apiErr.code === 'CHALLENGE_REQUIRED' || /challenge_required/i.test(msg);
            job.apiResults.push({
              username:  account.username,
              accountId: String(account._id),
              apiStatus: isTotp ? 'totp_required' : isChallenge ? 'challenge_required' : 'erro',
              error:     msg,
              autoSent:  apiErr.autoSent || false,
            });
            console.warn(`[Import] @${account.username} falhou: ${msg}`);
          }

          job.done++;
          broadcast('accounts', { action: 'synced' });
          broadcast('import_job', { jobId, done: job.done, total: job.total, latest: job.apiResults[job.apiResults.length - 1] });
        }

        const job = _importJobs.get(jobId);
        job.status     = 'done';
        job.finishedAt = new Date();
        broadcast('import_job', { jobId, status: 'done', apiResults: job.apiResults });
        broadcast('accounts',   { action: 'synced' });
      })().catch(err => {
        const job = _importJobs.get(jobId);
        if (job) { job.status = 'error'; job.error = err.message; }
      });
    }

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};

exports.getImportJob = (req, res) => {
  const job = _importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json(job);
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

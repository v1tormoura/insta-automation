const fs = require('fs');
const path = require('path');
const Account = require('../models/Account');

function hasSession(username) {
  const cookiesPath = path.resolve(__dirname, '../../sessions', username, 'cookies.json');
  return fs.existsSync(cookiesPath);
}

function calculateScore(account) {
  // Conta banida = 0 imediatamente
  if (account.healthStatus === 'banida') return 0;

  let score = 100;

  // Sessão / autenticação
  const hasApiToken = !!(account.accessToken && account.igUserId);
  const hasMobileSession = !!account.igSession;
  const hasCookieSession = hasSession(account.username);

  if (!hasApiToken && !hasMobileSession && !hasCookieSession) score -= 35;

  // Status de saúde
  if (account.healthStatus === 'restrita')       score -= 30;
  if (account.healthStatus === 'erro_login')     score -= 45;
  if (account.healthStatus === 'sessao_expirada') score -= 40;

  // Erros recentes
  if (account.lastError) score -= 15;

  // Proxy offline
  if (account.proxy && account.proxyStatus === 'offline') score -= 15;

  // Ocupada há mais de 30 min (travada)
  if (account.isBusy && account.busySince) {
    const busyMs = Date.now() - new Date(account.busySince).getTime();
    if (busyMs > 30 * 60 * 1000) score -= 20; // travada
    else score -= 5;
  }

  // Sync desatualizada há mais de 48h → incerteza
  if (account.lastSync) {
    const hoursAgo = (Date.now() - new Date(account.lastSync).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 72) score -= 20;
    else if (hoursAgo > 48) score -= 10;
  } else {
    score -= 20; // nunca sincronizado
  }

  // Token API expirando em menos de 7 dias
  if (account.tokenExpiresAt) {
    const daysLeft = (new Date(account.tokenExpiresAt) - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0)  score -= 40;
    else if (daysLeft < 7) score -= 15;
  }

  return Math.max(0, score);
}

function getLevel(score, account) {
  if (account.healthStatus === 'banida') return 'banida';
  if (score >= 75) return 'saudavel';
  if (score >= 45) return 'atencao';
  return 'risco';
}

exports.getHealth = async (req, res) => {
  try {
    const accounts = await Account.find().sort({ updatedAt: -1 });

    const rows = accounts.map((account) => {
      const sessionOk = hasSession(account.username);
      const score = calculateScore(account);
      const level = getLevel(score, account);

      const hasApiToken      = !!(account.accessToken && account.igUserId);
      const hasMobileSession = !!account.igSession;
      const syncAgeHours     = account.lastSync
        ? (Date.now() - new Date(account.lastSync).getTime()) / (1000 * 60 * 60)
        : null;
      const tokenDaysLeft    = account.tokenExpiresAt
        ? Math.ceil((new Date(account.tokenExpiresAt) - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        _id: account._id,
        username: account.username,
        name: account.name,
        avatar: account.avatar,
        healthStatus: account.healthStatus,
        status: account.status,
        score,
        level,
        sessionOk,
        hasApiToken,
        hasMobileSession,
        proxy: account.proxy || '',
        proxyStatus: account.proxyStatus || 'nao_testado',
        postsToday: account.postsToday || 0,
        dailyPostLimit: account.dailyPostLimit || 0,
        lastPostAt: account.lastPostAt,
        lastSync: account.lastSync,
        syncAgeHours: syncAgeHours ? Math.round(syncAgeHours) : null,
        lastError: account.lastError,
        isBusy: account.isBusy,
        busyReason: account.busyReason,
        tokenDaysLeft,
      };
    });

    const summary = {
      total: rows.length,
      saudavel: rows.filter((r) => r.level === 'saudavel').length,
      atencao: rows.filter((r) => r.level === 'atencao').length,
      risco: rows.filter((r) => r.level === 'risco').length,
      banida: rows.filter((r) => r.level === 'banida').length,
      semSessao: rows.filter((r) => !r.sessionOk).length,
      proxyOffline: rows.filter((r) => r.proxy && r.proxyStatus !== 'online').length,
    };

    res.json({
      summary,
      accounts: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

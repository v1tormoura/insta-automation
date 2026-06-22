'use strict';

/**
 * Session KeepAlive
 *
 * Roda a cada 2 horas. Para cada conta:
 *   1. Se tem multiloginProfileId → sync automático de cookies do Multilogin
 *   2. Tenta restaurar/validar a sessão do Instagram Private API
 *   3. Re-serializa e salva a sessão (DB + arquivo) para manter sempre fresca
 *
 * Isso elimina a necessidade de importar cookies manualmente.
 * Uma única importação inicial é suficiente — o keepalive cuida do resto.
 */

const fs   = require('fs');
const path = require('path');

const Account = require('../models/Account');

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
const DELAY_BETWEEN = 5_000; // 5s entre contas para não sobrecarregar

// Lazy-loads para evitar circular dependency
function getPrivateService() {
  return require('./instagramPrivateService');
}
function getMultiloginService() {
  return require('./multiloginService');
}

async function keepAliveAccount(account) {
  const label = `@${account.username}`;

  // ── 1. Multilogin auto-sync ───────────────────────────────────────────────
  if (account.multiloginProfileId?.trim()) {
    try {
      const { syncCookiesFromMultilogin } = require('../services/multiloginService');
      const n = await syncCookiesFromMultilogin(account);
      console.log(`✅ [KeepAlive] ${label} — Multilogin: ${n} cookies sincronizados`);
    } catch (mlErr) {
      console.log(`⚠️ [KeepAlive] ${label} — Multilogin sync falhou: ${mlErr.message}`);
      // Não interrompe — tenta sessão existente abaixo
    }
  }

  // ── 2. Verifica se tem alguma sessão disponível ───────────────────────────
  const hasCookies  = fs.existsSync(path.join(SESSIONS_ROOT, account.username, 'cookies.json'));
  const hasSession  = !!account.igSession && account.igSession !== 'use_cookies';
  const hasFile     = fs.existsSync(path.join(SESSIONS_ROOT, account.username, 'ig_session.json'));

  if (!hasCookies && !hasSession && !hasFile && !account.password) {
    // Sem nenhuma forma de autenticar — pula
    return { status: 'sem_sessao' };
  }

  // ── 3. Valida/restaura sessão via Private API ─────────────────────────────
  try {
    const { createClient } = require('../services/instagramPrivateService');

    // Recarrega conta do banco para ter dados mais recentes
    const fresh = await Account.findById(account._id);
    const ig    = await createClient(fresh);

    // Força re-serialização para renovar timestamps
    const state = await ig.state.serialize();
    delete state.constants;

    // Salva sessão fresca no banco
    await Account.findByIdAndUpdate(account._id, {
      igSession:            JSON.stringify(state),
      healthStatus:         'ativa',
      lastError:            '',
      lastSessionKeepAlive: new Date(),
    });

    // Salva também em arquivo
    try {
      const dir = path.join(SESSIONS_ROOT, account.username);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ig_session.json'), JSON.stringify(state), 'utf8');
    } catch {}

    console.log(`✅ [KeepAlive] ${label} — sessão renovada`);
    return { status: 'ok' };

  } catch (err) {
    const isExpired = /login_required|session|401|403|expired/i.test(err.message);
    console.log(`⚠️ [KeepAlive] ${label} — ${err.message.slice(0, 80)}`);

    if (isExpired) {
      // Limpa sessão podre do banco — próxima postagem tentará re-login
      await Account.findByIdAndUpdate(account._id, {
        igSession:    '',
        healthStatus: 'sessao_expirada',
        lastError:    `Sessão expirada — ${account.multiloginProfileId ? 'Multilogin offline?' : 'importe cookies (🍪)'}`,
      });
      // Remove arquivo de sessão também
      try { fs.unlinkSync(path.join(SESSIONS_ROOT, account.username, 'ig_session.json')); } catch {}
    }

    return { status: 'expirada', error: err.message };
  }
}

async function runKeepAlive() {
  console.log('🔄 [KeepAlive] Iniciando ciclo de renovação de sessões...');

  const accounts = await Account.find({
    status: { $ne: 'banida' },
    $or: [
      { igSession:            { $exists: true, $ne: '' } },
      { multiloginProfileId:  { $exists: true, $ne: '' } },
      { password:             { $exists: true, $ne: '' } },
    ],
  });

  let ok = 0, skip = 0, expired = 0;

  for (const account of accounts) {
    const r = await keepAliveAccount(account);
    if      (r.status === 'ok')          ok++;
    else if (r.status === 'sem_sessao')  skip++;
    else if (r.status === 'expirada')    expired++;

    await new Promise(r => setTimeout(r, DELAY_BETWEEN));
  }

  console.log(`✅ [KeepAlive] Concluído — OK: ${ok}, expiradas: ${expired}, sem sessão: ${skip}`);
}

function startSessionKeepAlive() {
  const INTERVAL = 2 * 60 * 60 * 1000; // 2 horas

  // Primeira execução após 30s (deixa o servidor estabilizar)
  setTimeout(() => {
    runKeepAlive().catch(err => console.error('❌ [KeepAlive] Erro:', err.message));
  }, 30_000);

  // Ciclo periódico
  setInterval(() => {
    runKeepAlive().catch(err => console.error('❌ [KeepAlive] Erro:', err.message));
  }, INTERVAL);

  console.log('⏰ [KeepAlive] Agendado — primeira execução em 30s, depois a cada 2h');
}

module.exports = { startSessionKeepAlive, runKeepAlive, keepAliveAccount };

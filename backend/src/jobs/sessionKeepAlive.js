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

/**
 * KeepAlive para contas instagrapi.
 *
 * Contrato:
 *  - Usa APENAS ensureSession() — nunca senha, nunca login.
 *  - Erro de rede/Python → retorna ok (transitório), sessão preservada.
 *  - Sessão inválida localmente → retorna expirada (sem chamar rede).
 *  - Lock por conta: se ocupado por publish/login, pula este ciclo.
 *  - NUNCA apaga instagrapiSession por erro técnico.
 *
 * @returns {{ status: 'ok'|'expirada', error?: string }}
 */
async function _keepAliveInstagrapi(account) {
  const { InstagrapiHttpClient } = require('../services/instagrapi/InstagrapiHttpClient');
  const { getSessionManager }    = require('../services/instagrapi/SessionManager');
  const sm        = getSessionManager();
  const http      = new InstagrapiHttpClient(null, sm);
  const accountId = String(account._id);
  const label     = `@${account.username}`;

  /* ── 1. Validação local ───────────────────────────────────────────────────
     Só decide quando não há sessão para testar. Antes ela barrava por contagem
     de falhas, e o efeito era circular: uma queda de rede enchia o contador, o
     contador impedia o keep-alive, e o keep-alive era exatamente o que traria a
     conta de volta ao chamar `recordSuccess`. A conta ficava presa fora do ar
     por um problema que já tinha passado. */
  const validation = await sm.validate(accountId);
  if (!validation.valid && /sem sessão|não encontrada/i.test(validation.reason || '')) {
    console.log(`⚠️ [KeepAlive] ${label} (instagrapi) — ${validation.reason}`);
    return { status: 'expirada', error: validation.reason };
  }
  if (!validation.valid) {
    console.log(`ℹ️ [KeepAlive] ${label} — ${validation.reason}; testando mesmo assim`);
  }

  // ── 2. Tenta adquirir lock por conta ─────────────────────────────────────
  // Se outra operação (publish, login) está em andamento, pula este ciclo.
  const token = await sm.acquireLock(accountId, 20_000);
  if (!token) {
    console.log(`⏩ [KeepAlive] ${label} (instagrapi) — lock ocupado, pulando ciclo`);
    return { status: 'ok' };
  }

  try {
    // ── 3. Garante sessão no pool Python (sem login novo) ──────────────────
    await http.ensureSession(account);

    // ── 4. Ping leve ao Instagram ─────────────────────────────────────────
    // ensureSession apenas carrega o blob na memória do serviço Python — não
    // fala com o Instagram. Sem este ping o "keep-alive" não mantinha nada:
    // a sessão ficava meses sem uso aparente para o Instagram, e o blob salvo
    // nunca recebia os cookies/tokens que ele rotaciona a cada requisição.
    // pingSession persiste o estado atualizado.
    await http.pingSession(account);

    await Account.findByIdAndUpdate(accountId, {
      lastSessionKeepAlive:    new Date(),
      lastSuccessfulRequestAt: new Date(),
    });
    console.log(`✅ [KeepAlive] ${label} (instagrapi) — sessão renovada`);
    return { status: 'ok' };

  } catch (err) {
    const code = err?.code || '';

    // Erros de infraestrutura — transitórios, NÃO apagar sessão
    if (
      code === 'INSTAGRAPI_SERVICE_UNAVAILABLE' || code === 'TIMEOUT' ||
      code === 'NETWORK_ERROR'                  || code === 'PROXY_ERROR'
    ) {
      console.log(`⚠️ [KeepAlive] ${label} (instagrapi) — ${code}, sessão preservada`);
      return { status: 'ok' };
    }

    // Sem sessão no banco — fluxo de login normal tratará isto
    if (code === 'NO_INSTAGRAPI_SESSION') {
      console.log(`⚠️ [KeepAlive] ${label} (instagrapi) — sem sessão no banco`);
      return { status: 'expirada', error: 'Sessão não encontrada — reconecte a conta' };
    }

    // Sessão expirada / autenticação rejeitada pelo Instagram
    if (code === 'SESSION_EXPIRED' || code === 'AUTH_REQUIRED' || code === 'BAD_PASSWORD') {
      await sm.recordFailure(accountId, err).catch(() => {});
      await Account.findByIdAndUpdate(accountId, {
        healthStatus: 'sessao_expirada',
        lastError:    'Sessão expirada — reconecte a conta',
      }).catch(() => {});
      console.log(`⚠️ [KeepAlive] ${label} (instagrapi) — sessão expirada, aguardando relogin manual`);
      return { status: 'expirada', error: err.message };
    }

    // Desafio / rate-limit — preservar sessão
    if (
      code === 'CHALLENGE_REQUIRED' || code === 'FEEDBACK_REQUIRED' ||
      code === 'RATE_LIMITED'
    ) {
      console.log(`⚠️ [KeepAlive] ${label} (instagrapi) — ${code}, sessão preservada`);
      return { status: 'ok' };
    }

    // Erro desconhecido — tratar como transitório para evitar falso positivo
    console.log(`⚠️ [KeepAlive] ${label} (instagrapi) — erro desconhecido: ${code || err?.message?.slice(0, 60)}`);
    return { status: 'ok' };

  } finally {
    await sm.releaseLock(accountId, token).catch(() => {});
  }
}

async function keepAliveAccount(account) {
  // ── Instagrapi: nunca usa senha, nunca login, apenas ensureSession ────────
  if (account.provider === 'instagrapi' || account.instagrapiSession) {
    return _keepAliveInstagrapi(account);
  }
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

  // ── 2. Se tem token OAuth válido, não precisa de Private API session ────────
  if (account.accessToken) {
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
    const daysLeft  = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
    console.log(`✅ [KeepAlive] ${label} — token IGAA${daysLeft !== null ? ` (expira em ${daysLeft} dias)` : ' (sem data de expiração)'}`);
    return { status: 'ok' };
  }

  // ── 3. Verifica se tem alguma sessão disponível ───────────────────────────
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
      { provider:             'instagrapi' },
      { instagrapiSession:    { $exists: true, $ne: '' } },
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

module.exports = { startSessionKeepAlive, runKeepAlive, keepAliveAccount, _keepAliveInstagrapi };

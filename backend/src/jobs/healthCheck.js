'use strict';

/**
 * Health Check — verifica saúde de todas as contas a cada 10 minutos.
 *
 * Detecta automaticamente (via API, sem browser):
 *   - Conta banida / desativada pelo Instagram
 *   - Conta restrita (ações limitadas)
 *   - Sessão / token expirado
 *   - Checkpoint / verificação necessária
 *   - Conta funcionando normalmente
 *
 * Atualiza healthStatus no DB e emite SSE em tempo real para o frontend.
 */

const Account       = require('../models/Account');
const { broadcast } = require('../events/broadcaster');

const delay = ms => new Promise(r => setTimeout(r, ms));

let running = false;

// ── Classificação de erros Instagram ─────────────────────────────────────────

/**
 * Detecta ban/desativação baseado em erro da API.
 * Códigos documentados e observados em produção.
 */
function classifyError(err) {
  const msg  = String(err?.message || err || '').toLowerCase();
  const code = err?.code || err?.response?.statusCode || 0;

  // ── BAN / conta desativada ────────────────────────────────────────────────
  if (
    /account.*disabled|disabled.*account|has been disabled/i.test(msg) ||
    /your account has been|permanently disabled/i.test(msg) ||
    /account.*banned|banned.*account/i.test(msg) ||
    /violat.*terms|terms.*service/i.test(msg) ||
    code === 326 ||   // IgLoginBadPasswordError + disabled
    code === 400 && /disabled/i.test(msg)
  ) {
    return 'banida';
  }

  // ── CHECKPOINT / verificação humana ──────────────────────────────────────
  if (
    /checkpoint|challenge.*required|checkpoint_required/i.test(msg) ||
    /verify.*identity|confirm.*identity/i.test(msg) ||
    /suspicious.*activity|unusual.*login/i.test(msg) ||
    code === 403 ||
    /IgCheckpointError/i.test(msg)
  ) {
    return 'restrita';
  }

  // ── SPAM / ação bloqueada ─────────────────────────────────────────────────
  if (
    /feedback_required|action_blocked|spam/i.test(msg) ||
    /blocked.*action|rate.*limit/i.test(msg) ||
    /please.*wait|try.*again.*later/i.test(msg) ||
    /IgActionSpamError/i.test(msg)
  ) {
    return 'restrita';
  }

  // ── SESSÃO / TOKEN expirado ───────────────────────────────────────────────
  if (
    /login.*required|session.*invalid|not.*logged/i.test(msg) ||
    /session.*expired|token.*expired|token.*invalid/i.test(msg) ||
    /190|OAuthException/i.test(msg) ||
    code === 190 || code === 401 ||
    /IgLoginRequiredError|user_has_logged_out/i.test(msg)
  ) {
    return 'sessao_expirada';
  }

  // ── ERRO DE LOGIN ─────────────────────────────────────────────────────────
  if (
    /bad.*password|wrong.*password|incorrect.*password/i.test(msg) ||
    /IgLoginBadPasswordError|IgLoginTwoFactorRequiredError/i.test(msg) ||
    code === 400 && /password/i.test(msg)
  ) {
    return 'erro_login';
  }

  return null; // erro transitório — não altera status
}

/**
 * Verifica saúde de uma conta com token OAuth via Graph API.
 */
async function checkViaGraphAPI(account) {
  try {
    const url = new URL('https://graph.instagram.com/me');
    url.searchParams.set('fields', 'id,username');
    url.searchParams.set('access_token', account.accessToken);

    const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    const data = await res.json();

    if (data.error) {
      const code    = data.error.code;
      const subcode = data.error.error_subcode || 0;
      const errMsg  = data.error.message || '';

      // Conta banida/desativada
      if (/disabled|banned|violat/i.test(errMsg) || code === 326 || subcode === 458) {
        return { status: 'banida', error: 'Conta banida ou desativada pelo Instagram' };
      }
      // Token inválido / sessão encerrada — precisa reconectar via OAuth
      if (
        code === 190 ||
        data.error.type === 'OAuthException' ||
        /token.*invalid|invalid.*token|token.*expired|expired.*token/i.test(errMsg) ||
        /cannot access.*app|log in to .*instagram|follow the instructions/i.test(errMsg) ||
        /session.*invalid|session.*expired|user.*logged.*out/i.test(errMsg) ||
        subcode === 460 || subcode === 463 || subcode === 467
      ) {
        const subcodeMsg = subcode === 460 ? 'Senha alterada'
          : subcode === 463 ? 'Sessão encerrada'
          : subcode === 467 ? 'Permissão revogada'
          : 'Token expirado';
        return { status: 'token_invalido', error: `${subcodeMsg} — reconecte via 🔗 API` };
      }
      // Restrita / checkpoint
      if (/checkpoint|feedback_required|spam|action_blocked/i.test(errMsg)) {
        return { status: 'restrita', error: 'Conta restrita ou com checkpoint pendente' };
      }

      // Qualquer outro erro OAuth → token inválido (conservador)
      if (data.error.type === 'OAuthException') {
        return { status: 'token_invalido', error: `Erro de autenticação (code ${code}) — reconecte via 🔗 API` };
      }

      return { status: null, error: `Erro da API (code ${code})` }; // erro transitório
    }

    if (data.id) {
      return { status: 'ativa', error: '' };
    }

    return { status: null, error: 'Resposta inesperada' };
  } catch (err) {
    if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(err.message)) {
      return { status: null, error: 'timeout' }; // rede instável — não altera status
    }
    return { status: null, error: err.message };
  }
}

/**
 * Verifica saúde de uma conta via Private API (sem browser).
 */
async function checkViaPrivateAPI(account) {
  try {
    const { IgApiClient } = require('instagram-private-api');
    const ig   = new IgApiClient();
    const seed = `${account.username}_${String(account._id)}`;
    ig.state.generateDevice(seed);

    const saved = typeof account.igSession === 'string'
      ? JSON.parse(account.igSession)
      : account.igSession;

    ig.state.generateDevice(saved._deviceSeed || seed);
    await ig.state.deserialize(saved);

    // Chamada leve — só busca ID do usuário logado
    const me = await ig.account.currentUser();

    if (me?.pk) return { status: 'ativa', error: '' };
    return { status: null, error: 'sem resposta' };

  } catch (err) {
    const classified = classifyError(err);
    return { status: classified, error: err.message };
  }
}

/**
 * Roda o health check em uma conta.
 */
async function checkOneAccount(account) {
  // Recarrega do DB para usar sempre o token mais recente (evita race com OAuth)
  const fresh = await Account.findById(account._id)
    .select('username _id accessToken igSession healthStatus status lastError lastSync');
  if (!fresh) return;

  // Pula verificação se a conta foi sincronizada nos últimos 2 minutos
  // (evita sobrescrever um OAuth recém-conectado com resultado de token antigo)
  const twoMinAgo = Date.now() - 2 * 60 * 1000;
  if (fresh.lastSync && new Date(fresh.lastSync).getTime() > twoMinAgo) return;

  let result = { status: null, error: '' };

  // Prioridade: Graph API (token OAuth) → Private API (igSession)
  if (fresh.accessToken) {
    result = await checkViaGraphAPI(fresh);
  } else if (fresh.igSession) {
    result = await checkViaPrivateAPI(fresh);
  } else {
    return; // sem credenciais — nada a checar
  }

  // Só atualiza se houve mudança real de status
  if (!result.status) return; // erro transitório — mantém status atual

  const currentStatus = fresh.healthStatus || 'ativa';
  if (result.status === currentStatus && !result.error) return;

  const update = {
    healthStatus: result.status,
    lastError:    result.error || '',
    lastSync:     new Date(),
  };

  // Se banida, marca status principal também
  if (result.status === 'banida') {
    update.status = 'banida';
    console.log(`🚫 [HealthCheck] @${fresh.username} — BANIDA/DESATIVADA`);
  } else if (result.status === 'sessao_expirada') {
    console.log(`⚠️ [HealthCheck] @${fresh.username} — sessão expirada`);
  } else if (result.status === 'restrita') {
    console.log(`⚠️ [HealthCheck] @${fresh.username} — restrita/checkpoint`);
  } else if (result.status === 'ativa' && currentStatus !== 'ativa') {
    console.log(`✅ [HealthCheck] @${fresh.username} — recuperada (era ${currentStatus})`);
  }

  await Account.findByIdAndUpdate(fresh._id, update);

  // Emite SSE em tempo real para o frontend
  broadcast('accounts', {
    action:      'health_update',
    accountId:   String(fresh._id),
    username:    fresh.username,
    healthStatus: result.status,
    error:       result.error || '',
  });
}

async function runHealthCheck() {
  if (running) return;
  running = true;

  try {
    const accounts = await Account.find({
      isBusy: { $ne: true },
      $or: [
        { accessToken: { $exists: true, $ne: '' } },
        { igSession:   { $exists: true, $ne: '' } },
      ],
    }).select('username _id accessToken igSession healthStatus status lastError');

    console.log(`🩺 [HealthCheck] Verificando ${accounts.length} conta(s)...`);

    let ok = 0, warn = 0, banned = 0;

    for (const acc of accounts) {
      try {
        const before = acc.healthStatus;
        await checkOneAccount(acc);
        // Recarrega para ver resultado
        const after = await Account.findById(acc._id).select('healthStatus');
        if (after?.healthStatus === 'banida')          banned++;
        else if (after?.healthStatus !== 'ativa')      warn++;
        else                                            ok++;
      } catch {}
      await delay(800); // pausa gentil entre contas
    }

    console.log(`✅ [HealthCheck] OK: ${ok}, alertas: ${warn}, banidas: ${banned}`);

    // Broadcast geral para o dashboard atualizar contadores
    broadcast('accounts', { action: 'health_check_done' });

  } catch (err) {
    console.log('💥 [HealthCheck] Erro geral:', err.message);
  } finally {
    running = false;
  }
}

async function refreshAllTokens() {
  const accounts = await Account.find({
    accessToken: { $exists: true, $ne: '' },
    igUserId:    { $exists: true, $ne: '' },
  }).lean();

  let renewed = 0;
  for (const account of accounts) {
    const daysLeft = account.tokenExpiresAt
      ? (new Date(account.tokenExpiresAt) - Date.now()) / (1000 * 60 * 60 * 24)
      : 0;
    if (daysLeft > 20) continue; // só renova se vence em menos de 20 dias

    try {
      const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.accessToken}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      if (data.access_token) {
        const expiresIn = data.expires_in ?? 5_184_000;
        await Account.findByIdAndUpdate(account._id, {
          accessToken:    data.access_token,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          healthStatus:   'ativa',
          lastError:      '',
        });
        console.log(`🔄 [TokenRefresh] @${account.username} — renovado por ${Math.round(expiresIn / 86400)} dias`);
        renewed++;
      }
    } catch {}
    await delay(1000);
  }
  if (renewed > 0) {
    broadcast('accounts', { action: 'tokens_refreshed', renewed });
  }
}

function startHealthCheck() {
  // Primeira execução: 30s após o servidor subir
  setTimeout(runHealthCheck, 30_000);
  // Depois: a cada 5 minutos
  setInterval(runHealthCheck, 5 * 60 * 1000);
  // Renovação de tokens: a cada 24h
  setInterval(refreshAllTokens, 24 * 60 * 60 * 1000);
  setTimeout(refreshAllTokens, 60_000); // primeira renovação após 1min
  console.log('🩺 [HealthCheck] Agendado — health a cada 5min, token refresh a cada 24h');
}

module.exports = { startHealthCheck, runHealthCheck, classifyError };

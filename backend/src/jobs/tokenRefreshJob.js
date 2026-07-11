'use strict';

/**
 * Token Refresh Job — roda a cada 6 horas.
 *
 * Renova automaticamente tokens Meta/Instagram que estão com menos de
 * 30 dias de vida restante. Isso garante que a conta nunca expira enquanto
 * o servidor estiver rodando, sem precisar reconectar via OAuth.
 *
 * Tokens Instagram (IGAA/IGQ): renova em graph.instagram.com/refresh_access_token
 * Tokens Facebook (EAA):       renova em graph.facebook.com/oauth/access_token
 *
 * Instagram permite refresh a qualquer momento antes do token expirar.
 * Após o refresh, o novo token tem mais 60 dias a partir da data de renovação.
 */

const Account   = require('../models/Account');
const { broadcast } = require('../events/broadcaster');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function refreshIgToken(token) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type',   'ig_refresh_token');
  url.searchParams.set('access_token', token);

  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return { accessToken: d.access_token, expiresIn: d.expires_in };
}

async function refreshFbToken(token) {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('META_APP_ID / META_APP_SECRET não configurados');

  const url = new URL('https://graph.facebook.com/oauth/access_token');
  url.searchParams.set('grant_type',        'fb_exchange_token');
  url.searchParams.set('client_id',         appId);
  url.searchParams.set('client_secret',     appSecret);
  url.searchParams.set('fb_exchange_token', token);

  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return { accessToken: d.access_token, expiresIn: d.expires_in };
}

async function refreshOneToken(account) {
  const token = account.accessToken;
  if (!token) return { skipped: true, reason: 'no_token' };

  let result;
  if (/^(IGAAL|IGQ|IG)/i.test(token)) {
    result = await refreshIgToken(token);
  } else if (/^EAA/i.test(token)) {
    result = await refreshFbToken(token);
  } else {
    return { skipped: true, reason: 'token_type_unknown' };
  }

  const newExpiry = new Date(Date.now() + result.expiresIn * 1000);
  await Account.findByIdAndUpdate(account._id, {
    accessToken:    result.accessToken,
    tokenExpiresAt: newExpiry,
    healthStatus:   'ativa',
    lastError:      '',
  });

  console.log(`[TokenRefresh] @${account.username} — novo vencimento: ${newExpiry.toLocaleDateString('pt-BR')}`);
  return { refreshed: true, expiresAt: newExpiry };
}

let _running = false;

async function runTokenRefresh() {
  if (_running) return;
  _running = true;

  const now     = new Date();
  const cutoff  = new Date(now.getTime() + THIRTY_DAYS_MS); // expira em menos de 30 dias

  try {
    const accounts = await Account.find({
      accessToken: { $nin: [null, ''] },
      $or: [
        { tokenExpiresAt: { $lt: cutoff } },      // expira em menos de 30 dias
        { tokenExpiresAt: null },                  // sem data registrada
        { healthStatus: 'sessao_expirada' },       // expirou — tenta recuperar
      ],
    }).select('username accessToken tokenExpiresAt healthStatus');

    if (!accounts.length) {
      console.log('[TokenRefresh] Nenhum token para renovar.');
      _running = false;
      return;
    }

    console.log(`[TokenRefresh] Verificando ${accounts.length} conta(s)...`);
    let refreshed = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const acc of accounts) {
      // Pula contas banidas (ban é permanente)
      if (acc.healthStatus === 'banida') { skipped++; continue; }

      const expiredAt    = acc.tokenExpiresAt ? new Date(acc.tokenExpiresAt) : null;
      const alreadyExpired = expiredAt && expiredAt < now;

      if (alreadyExpired) {
        // Sessão expirada: tenta refresh de recuperação (Instagram pode ter sido temporário)
        console.log(`[TokenRefresh] @${acc.username} — sessão expirada, tentando recuperação...`);
        try {
          const r = await refreshOneToken(acc);
          if (r.refreshed) {
            refreshed++;
            console.log(`[TokenRefresh] @${acc.username} — ✅ recuperada com sucesso!`);
            broadcast('accounts', { action: 'token_recovered', username: acc.username });
          } else {
            console.log(`[TokenRefresh] @${acc.username} — sem token válido para recuperar`);
            skipped++;
          }
        } catch (err) {
          // Recuperação falhou — requer reconexão manual via OAuth
          console.log(`[TokenRefresh] @${acc.username} — recuperação falhou (${err.message}) — reconexão OAuth necessária`);
          await Account.findByIdAndUpdate(acc._id, {
            healthStatus: 'sessao_expirada',
            lastError:    `Token inválido — reconecte via 🔗 API (erro: ${err.message.slice(0, 80)})`,
          });
          errors++;
        }
        continue;
      }

      try {
        const r = await refreshOneToken(acc);
        if (r.refreshed) refreshed++;
        else skipped++;
      } catch (err) {
        console.error(`[TokenRefresh] @${acc.username} erro: ${err.message}`);
        // Não altera healthStatus nem tokenExpiresAt — o token pode ainda ser válido
        // (ex: Instagram exige 24h entre refreshes). O health check vai determinar o estado real.
        await Account.findByIdAndUpdate(acc._id, {
          lastError: `Falha ao renovar token: ${err.message.slice(0, 100)}`,
        });
        errors++;
      }

      // Pequena pausa entre refreshes para não sobrecarregar a API
      await new Promise(r => setTimeout(r, 500));
    }

    if (refreshed > 0) {
      broadcast('accounts', { action: 'tokens_refreshed', refreshed, errors });
    }

    console.log(`[TokenRefresh] Concluído — renovados: ${refreshed}, ignorados: ${skipped}, erros: ${errors}`);
  } catch (err) {
    console.error('[TokenRefresh] Erro fatal:', err.message);
  } finally {
    _running = false;
  }
}

function startTokenRefreshJob() {
  // Primeira verificação: 2 minutos após o servidor subir
  setTimeout(() => runTokenRefresh().catch(() => {}), 2 * 60 * 1000);

  // Depois: a cada 6 horas
  setInterval(() => runTokenRefresh().catch(() => {}), 6 * 60 * 60 * 1000);

  console.log('[TokenRefresh] Job iniciado — verifica tokens a cada 6 horas.');
}

module.exports = { startTokenRefreshJob, runTokenRefresh };

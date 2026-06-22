'use strict';

/**
 * Verificação leve de saúde da conta Instagram.
 * Não usa Puppeteer — apenas um fetch HTTP simples.
 *
 * Retorna: 'ativa' | 'banida' | 'restrita' | 'desconhecido'
 */

const Account = require('../models/Account');

const UA_MOBILE = 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2340; samsung; SM-S901B; r0s; exynos2200; pt_BR; 458229258)';
const UA_WEB    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Verifica se a conta do Instagram está acessível.
 *
 * Estratégia (mais confiável primeiro):
 * 1. API JSON do Instagram (web_profile_info) → retorna dados estruturados
 * 2. Scrape da meta og:title na página pública
 *
 * @param {string} username
 * @returns {Promise<'ativa'|'banida'|'restrita'|'desconhecido'>}
 */
async function checkInstagramProfile(username) {
  if (/^\d+$/.test(username)) return 'desconhecido'; // userId numérico — ignora

  // ── Método 1: API JSON web_profile_info ──────────────────────────────────
  // Esse endpoint retorna JSON estruturado sem precisar de JS no browser
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);

    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          'User-Agent':      UA_WEB,
          'Accept':          'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'X-IG-App-ID':     '936619743392459',
          'X-Requested-With':'XMLHttpRequest',
          'Referer':         `https://www.instagram.com/${username}/`,
          'Origin':          'https://www.instagram.com',
        },
        signal: ctrl.signal,
      }
    );
    clearTimeout(tid);

    console.log(`🔍 [QuickCheck] @${username} — web_profile_info HTTP ${res.status}`);

    if (res.status === 404) {
      console.log(`🚫 [QuickCheck] @${username} — 404 (banida/deletada)`);
      return 'banida';
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      // Resposta esperada: { data: { user: { id, username, ... } } }
      if (data?.data?.user) {
        const user = data.data.user;
        if (user.is_private !== undefined) {
          // Conta existe — verifica se está restrita
          if (user.has_blocked_viewer || user.is_blocked_by_reel_sharing) {
            return 'restrita';
          }
          return 'ativa';
        }
      }
      // Se veio 200 mas sem dados do usuário → conta não existe / banida
      if (data?.data?.user === null) {
        console.log(`🚫 [QuickCheck] @${username} — user null na resposta (banida)`);
        return 'banida';
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.log(`⚠️ [QuickCheck] @${username} — web_profile_info falhou: ${err.message}`);
    }
  }

  // ── Método 2: Verificar og:title na página pública ───────────────────────
  // Para perfis válidos, og:title contém o nome do usuário.
  // Para perfis banidos/inexistentes, og:title é genérico ou vazio.
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);

    const res = await fetch(`https://www.instagram.com/${username}/`, {
      headers: {
        'User-Agent':      UA_WEB,
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept':          'text/html',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(tid);

    if (res.status === 404) return 'banida';
    if (!res.ok) return 'desconhecido';

    // Lê apenas os primeiros 8KB (suficiente para as meta tags no <head>)
    const reader = res.body.getReader();
    let html = '';
    while (html.length < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      html += Buffer.from(value).toString('utf-8');
    }
    reader.cancel().catch(() => {});

    const lower = html.toLowerCase();

    // og:title de perfil válido contém o username
    const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
                      || html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
    if (ogTitleMatch) {
      const title = ogTitleMatch[1].toLowerCase();
      if (title.includes(username.toLowerCase())) return 'ativa';
      // Títulos genéricos indicam que o perfil não foi encontrado
      if (title === 'instagram' || title.includes('page not found') || title.includes('página não encontrada')) {
        return 'banida';
      }
    }

    // Se o username aparece no HTML como dado JSON → ativa
    if (html.includes(`"username":"${username}"`) || html.includes(`"username": "${username}"`)) {
      return 'ativa';
    }

    // Frases de ban no SSR (raras, mas possíveis)
    if (
      lower.includes("page isn't available") ||
      lower.includes('conta foi desativada') ||
      lower.includes('account has been disabled')
    ) {
      return 'banida';
    }

    return 'desconhecido';
  } catch (err) {
    if (err.name !== 'AbortError') console.log(`⚠️ [QuickCheck] @${username} — HTTP falhou: ${err.message}`);
    return 'desconhecido';
  }
}

/**
 * Verifica e atualiza o healthStatus de uma conta no banco.
 * Só atualiza se detectar algo definitivo (banida/restrita) ou se estava marcada errada.
 *
 * @param {Object} account - documento Account do Mongoose
 * @returns {Promise<{username, status, changed}>}
 */
async function quickCheckAndUpdate(account) {
  const username = account.username;
  console.log(`🔍 [QuickCheck] Verificando @${username}...`);

  const status = await checkInstagramProfile(username);
  console.log(`🔍 [QuickCheck] @${username} → ${status}`);

  const now = new Date();
  let changed = false;

  if (status === 'banida' && account.healthStatus !== 'banida') {
    await Account.findByIdAndUpdate(account._id, {
      healthStatus: 'banida',
      lastError:    'Conta banida ou desativada — perfil indisponível no Instagram',
      lastSync:      now,
    });
    changed = true;
    console.log(`🚫 [QuickCheck] @${username} — BANIDA`);

  } else if (status === 'restrita' && account.healthStatus === 'ativa') {
    await Account.findByIdAndUpdate(account._id, {
      healthStatus: 'restrita',
      lastError:    'Conta com atividade restrita pelo Instagram',
      lastSync:      now,
    });
    changed = true;
    console.log(`⚠️  [QuickCheck] @${username} — RESTRITA`);

  } else if (status === 'ativa' && account.healthStatus === 'banida') {
    // Estava marcada como banida mas agora está ok — corrige
    await Account.findByIdAndUpdate(account._id, {
      healthStatus: 'ativa',
      lastError:    '',
      lastSync:      now,
    });
    changed = true;
    console.log(`✅ [QuickCheck] @${username} — REATIVADA`);

  } else {
    // Atualiza apenas o lastSync para indicar que foi checada
    await Account.findByIdAndUpdate(account._id, { lastSync: now });
  }

  return { username, status, changed };
}

/**
 * Roda quickCheck em todas as contas em paralelo (lotes de 5).
 * Retorna resumo com quantas foram banidas/restritas/ok.
 */
async function quickCheckAll() {
  const accounts = await Account.find({}).lean();
  const results  = { banida: [], restrita: [], ativa: [], desconhecido: [] };

  // Processa em lotes de 5 para não sobrecarregar o Instagram
  for (let i = 0; i < accounts.length; i += 5) {
    const batch = accounts.slice(i, i + 5);
    const checks = await Promise.all(batch.map(acc => quickCheckAndUpdate(acc)));
    checks.forEach(r => results[r.status]?.push(r.username));
    if (i + 5 < accounts.length) {
      await new Promise(r => setTimeout(r, 3000)); // pausa entre lotes
    }
  }

  console.log(`✅ [QuickCheck] Concluído — banidas: ${results.banida.length}, restritas: ${results.restrita.length}, ativas: ${results.ativa.length}`);
  return results;
}

module.exports = { checkInstagramProfile, quickCheckAndUpdate, quickCheckAll };

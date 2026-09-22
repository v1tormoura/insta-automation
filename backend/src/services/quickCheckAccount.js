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
 * O QuickCheck saía por `fetch()` cru — o IP do VPS, direto, sem proxy. Rodando
 * a cada poucos minutos em TODA conta, era um IP de datacenter batendo no
 * `web_profile_info` do Instagram sem parar: 429 na certa, e o 429 é do IP, não
 * da conta — envenenava o endereço que outras operações também usam. Pior, era
 * a MESMA rota para todas as contas, o oposto do isolamento por conta que o
 * resto do sistema mantém. Agora cada verificação sai pelo proxy da conta (o
 * mesmo `dispatcher` que o healthCheck já usa), residencial e isolado. */
function _proxyDispatcher(proxyUrl) {
  if (!proxyUrl?.trim()) return undefined;
  try { return new (require('undici').ProxyAgent)(proxyUrl.trim()); } catch { return undefined; }
}

/**
 * Verifica se a conta do Instagram está acessível.
 *
 * Estratégia (mais confiável primeiro):
 * 1. API JSON do Instagram (web_profile_info) → retorna dados estruturados
 * 2. Scrape da meta og:title na página pública
 *
 * @param {string} username
 * @param {import('undici').Dispatcher} [dispatcher] proxy da conta; sem ele, sai
 *        pelo IP do host (só use assim em contexto que não tem conta — teste manual).
 * @returns {Promise<'ativa'|'banida'|'restrita'|'desconhecido'>}
 */
async function checkInstagramProfile(username, dispatcher) {
  if (/^\d+$/.test(username)) return 'desconhecido'; // userId numérico — ignora
  const comProxy = dispatcher ? { dispatcher } : {};

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
        ...comProxy,
      }
    );
    clearTimeout(tid);

    console.log(`🔍 [QuickCheck] @${username} — web_profile_info HTTP ${res.status}`);

    if (res.status === 404) {
      console.log(`🚫 [QuickCheck] @${username} — 404 (banida/deletada)`);
      return 'banida';
    }

    /* 429 é o IP throttled, não sinal de ban. Devolve 'desconhecido' e para
       aqui: insistir no método 2 seria outra batida no mesmo endereço já
       limitado, piorando o bloqueio em vez de descobrir algo. */
    if (res.status === 429) {
      console.log(`🐢 [QuickCheck] @${username} — 429 (IP throttled), pulando verificação`);
      return 'desconhecido';
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
      ...comProxy,
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
 * Valida o token OAuth da conta chamando /me na Graph API.
 * Retorna true se válido, false se expirado/inválido.
 *
 * ── Dois defeitos que faziam token bom parecer morto
 *
 * 1. `account.accessToken` ia direto pra URL, sem descriptografar. Com
 *    `ENCRYPTION_KEY` configurada (ver tokenEncryption.js), o valor gravado
 *    é `enc1:...` — cifra, não o token. Mandar isso pro Meta como
 *    `access_token` é o mesmo que mandar uma senha errada de propósito: ele
 *    responde erro sempre, e aqui isso virava "token inválido, reconecte".
 *
 * 2. A URL tinha `/v21.0/` fixo. `syncAccountAPI.js` — o outro lugar que faz
 *    essa mesma pergunta ao Meta — descobriu e documentou que
 *    `graph.instagram.com/me` SEM versão é o que funciona para todo tipo de
 *    token (IGAAL, IGQ, EAA); com versão, alguns tipos de token são
 *    recusados por um motivo que não tem nada a ver com o token estar
 *    expirado. Reaproveita a mesma forma comprovada em vez de inventar uma
 *    terceira.
 */
async function validateOAuthToken(account) {
  if (!account.accessToken || !account.igUserId) return null; // sem token OAuth
  try {
    const { decrypt } = require('./tokenEncryption');
    const token = decrypt(account.accessToken);
    const res = await fetch(
      `https://graph.instagram.com/me?fields=id&access_token=${token}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    if (data.error) {
      console.log(`🔑 [TokenCheck] @${account.username} — token inválido: ${data.error.message}`);
      /* A mensagem fica guardada para o chamador distinguir VERIFICAÇÃO
         ("log in to www.instagram.com…") de token morto. Devolver só `false`
         fazia o QuickCheck rebaixar para token_invalido uma conta que o sync
         já sabia estar em verificação — e o vai-e-vem restrita → token_invalido
         → restrita gerava um "Conta parou" a cada 6h sem nada ter mudado. */
      _ultimoErroDoToken.set(String(account._id), String(data.error.message || ''));
      return false;
    }
    _ultimoErroDoToken.delete(String(account._id));
    return true;
  } catch {
    return null; // timeout ou erro de rede — não muda o status
  }
}

/** accountId → última mensagem de erro do /me. Só para o QuickCheck ler logo em seguida. */
const _ultimoErroDoToken = new Map();

/**
 * Verifica e atualiza o healthStatus de uma conta no banco.
 */
async function quickCheckAndUpdate(account) {
  const username = account.username;
  console.log(`🔍 [QuickCheck] Verificando @${username}...`);

  const now = new Date();
  let changed = false;

  /* Conta instagrapi não passa pelo passo 1 — mesma exceção que
     `syncAllAccounts` já faz (accountController.js) e que este arquivo não
     fazia. Sem isto, uma conta que publica pela sessão do instagrapi, com a
     sessão perfeitamente viva, mas que também tem (ou já teve) um
     `accessToken` da API oficial guardado — as duas conexões coexistem, o
     painel mostra os dois botões — ficava com o healthStatus inteiro
     derrubado por causa de um token secundário que ela nem usa para
     publicar. É esse cruzamento que fazia a sessão "não aguentar": o
     instagrapi seguia publicando normalmente por baixo, e o quickCheck
     apagava esse resultado a cada rodada. */
  const usaInstagrapi = account.provider === 'instagrapi' || !!account.instagrapiSession;

  // 1. Valida token OAuth (detecta sessão expirada no Meta) — só quando a
  //    conta de fato depende dele para publicar.
  const tokenOk = usaInstagrapi ? null : await validateOAuthToken(account);
  if (tokenOk === false) {
    const verificacao = require('./verificacaoDoInstagram');
    const erroDoToken = _ultimoErroDoToken.get(String(account._id)) || '';
    /* Verificação pendente: a mesma leitura do sync (syncAccountAPI). Só
       escreve na TRANSIÇÃO — repetir o mesmo estado não é notícia. */
    if (verificacao.ehVerificacaoPendente(erroDoToken)) {
      if (account.healthStatus !== 'restrita') {
        await Account.findByIdAndUpdate(account._id, { ...verificacao.saudeDeVerificacao(), lastSync: now });
        console.log(`⚠️ [QuickCheck] @${username} — em VERIFICAÇÃO no Instagram`);
      }
      return { username, status: 'restrita', changed: account.healthStatus !== 'restrita' };
    }
    if (account.healthStatus !== 'token_invalido') {
      await Account.findByIdAndUpdate(account._id, {
        healthStatus: 'token_invalido',
        lastError:    /malformed|invalid user id/i.test(erroDoToken)
          ? 'O Instagram não reconhece mais o usuário deste token — a conta pode ter sido desativada. Confira se ela ainda existe; se sim, reconecte via API.'
          : 'Token OAuth expirado — reconecte a conta via API',
        lastSync:      now,
      });
      console.log(`🔑 [QuickCheck] @${username} — TOKEN INVÁLIDO`);
    }
    return { username, status: 'token_invalido', changed: true };
  }
  // Token válido: zera qualquer status ruim vindo da Private API
  if (tokenOk === true) {
    const badStatuses = ['sessao_expirada', 'erro_login', 'token_invalido'];
    if (badStatuses.includes(account.healthStatus)) {
      await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '', lastSync: now });
      console.log(`✅ [QuickCheck] @${username} — token OK, status corrigido para ativa`);
      return { username, status: 'ativa', changed: true };
    }
  }

  /* ── Conta oficial: o Graph é a única fonte. Acaba aqui. ──────────────────
     O passo 2 (perfil público em instagram.com) era redundante para ela e
     custava caro: sem proxy na conta e sem proxy global, saía pelo IP cru do
     host — datacenter — lendo o perfil de TODAS as contas oficiais a cada
     Sincronizar. Não é login e não carrega sessão, mas é um IP de datacenter
     agrupando todos os perfis que o painel conhece, e era de onde vinham os
     429 (que são do IP, e envenenam o endereço para o resto do sistema).

     O que o perfil público diria que o token não diz: nada que importe. Conta
     desativada perde o token (o Meta invalida), então "banida" já apareceu no
     passo 1 como token_invalido. O "restrita" da leitura anônima era heurística
     fraca; o `syncAccountAPI` já marca restrita pelo Graph (checkpoint,
     feedback_required, spam), com prova de verdade — e por isso NÃO é desfeito
     aqui: token válido não significa conta liberada para publicar.

     Token válido é prova de vida: desfaz uma 'banida' antiga (só o passo 2
     gravava isso em conta oficial), limpa erro obsoleto, marca a sincronização.
     `null` (sem token, ou o Graph não respondeu) não muda status nenhum — e
     também não vai perguntar ao instagram.com. */
  if (!usaInstagrapi) {
    if (tokenOk !== true) {
      await Account.findByIdAndUpdate(account._id, { lastSync: now });
      return { username, status: 'desconhecido', changed: false };
    }
    const patch = { lastSync: now };
    let changed = false;
    if (account.healthStatus === 'banida') {
      Object.assign(patch, { healthStatus: 'ativa', lastError: '' });
      changed = true;
      console.log(`✅ [QuickCheck] @${username} — token OK, 'banida' antiga desfeita`);
    } else if (account.healthStatus === 'ativa' && account.lastError) {
      patch.lastError = '';
      changed = true;
      console.log(`🧹 [QuickCheck] @${username} — erro obsoleto da API limpo (token OK)`);
    }
    await Account.findByIdAndUpdate(account._id, patch);
    return { username, status: 'ativa', changed };
  }

  // 2. Verifica ban/restrição via perfil público — SEMPRE pelo proxy da conta,
  //    nunca pelo IP cru do host (era o que envenenava o datacenter).
  //    Só chega aqui conta instagrapi: para ela a sessão é a fonte, e o perfil
  //    público é o que sobra para detectar ban sem gastar a sessão.
  let dispatcher;
  try {
    const { resolveProxyFor } = require('./globalProxy');
    dispatcher = _proxyDispatcher(await resolveProxyFor(account));
  } catch { /* sem proxy configurado — cai no fetch direto, como antes */ }
  const status = await checkInstagramProfile(username, dispatcher);
  console.log(`🔍 [QuickCheck] @${username} → ${status}`);

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
    await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '', lastSync: now });
    changed = true;
    console.log(`✅ [QuickCheck] @${username} — REATIVADA`);

  } else {
    /* ── Limpa erro obsoleto de uma conta que está saudável AGORA ──────────
       O `lastError` era gravado por uma operação passada (ex.: um publish ou
       uma sincronização que bateu num endpoint da Graph com o método errado —
       "Unsupported request - method type: get") e ficava congelado no card
       para sempre: nenhum ramo acima o limpava numa conta que já era 'ativa'.
       Se a verificação de agora confirma saúde (token respondeu, ou o perfil
       está no ar), o erro antigo não é mais verdade e sai. Só limpo com prova
       positiva de saúde — não apago o motivo de uma conta 'restrita'/'banida',
       e não limpo em 'desconhecido' sem o token ter validado. */
    const saudavelAgora = tokenOk === true || status === 'ativa';
    const limpaErro = (saudavelAgora && account.healthStatus === 'ativa' && account.lastError)
      ? { lastError: '' }
      : {};
    if (limpaErro.lastError === '') {
      console.log(`🧹 [QuickCheck] @${username} — erro obsoleto da API limpo (conta saudável agora)`);
      changed = true;
    }
    await Account.findByIdAndUpdate(account._id, { lastSync: now, ...limpaErro });
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

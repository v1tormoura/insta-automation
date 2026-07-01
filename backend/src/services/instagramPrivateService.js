'use strict';

/**
 * Instagram posting via the private mobile API.
 * Session hierarchy: DB -> cookies.json -> file -> Multilogin (se configurado) -> senha
 * Multilogin e completamente opcional.
 */

const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const { execSync }         = require('child_process');
const Account              = require('../models/Account');
const { convertToReelFormat } = require('./videoProcessor');
const speakeasy = require('speakeasy');

function generateTotpCode(rawSecret) {
  const secret = rawSecret.replace(/\s/g, '').toUpperCase();
  return speakeasy.totp({ secret, encoding: 'base32' });
}

// Mapa de 2FA TOTP pendentes: accountId → { ig, twoFactorIdentifier, seed, username }
const _pendingTotp = new Map();

const delay = ms => new Promise(r => setTimeout(r, ms));

function getIgApiClient() {
  try {
    const { IgApiClient } = require('instagram-private-api');
    return IgApiClient;
  } catch {
    throw new Error('Pacote instagram-private-api nao instalado. Execute: npm install instagram-private-api');
  }
}

const _pendingChallenges = new Map();

async function resolveChallenge(account, code, codeType = 'email') {
  const IgApiClient = getIgApiClient();

  // Tenta usar o cliente em memória (mesmo processo)
  let ig   = _pendingChallenges.get(String(account._id))?.ig;
  let seed = _pendingChallenges.get(String(account._id))?.seed;

  // Processo reiniciou — reconstrói o cliente a partir do estado salvo no banco
  if (!ig) {
    const fresh = await Account.findById(account._id);
    if (!fresh?.challengeState) {
      throw new Error(
        'Sessão de challenge expirou (servidor foi reiniciado). ' +
        'Reimporte a conta para receber um novo código.'
      );
    }
    const saved = JSON.parse(fresh.challengeState);
    seed = saved._deviceSeed || fresh.username;
    ig = new IgApiClient();
    ig.state.generateDevice(seed);
    await ig.state.deserialize(saved);

    // Restaura checkpoint — tenta 3 fontes
    if (!ig.state.checkpoint && saved._checkpointRaw) {
      ig.state.checkpoint = saved._checkpointRaw;
      console.log(`[PrivateAPI] @${account.username} -- checkpoint restaurado de _checkpointRaw`);
    }
    // Se ainda null, reconstrói a partir do api_path salvo
    if (!ig.state.checkpoint && saved._challengeApiPath) {
      ig.state.checkpoint = {
        challenge: { api_path: saved._challengeApiPath, url: `https://i.instagram.com${saved._challengeApiPath}` },
        lock: false, logout: false,
      };
      console.log(`[PrivateAPI] @${account.username} -- checkpoint reconstruído de _challengeApiPath: ${saved._challengeApiPath}`);
    }
    console.log(`[PrivateAPI] @${account.username} -- checkpoint: ${ig.state.checkpoint ? JSON.stringify(ig.state.checkpoint).slice(0, 120) : 'NULO'}`);
  }

  if (!ig.state.checkpoint) {
    throw new Error('Sessão de challenge inválida. Clique em "Novo código" para gerar uma nova sessão.');
  }

  if (codeType === 'totp') {
    // TOTP dentro de checkpoint: seleciona método autenticador (0) antes de enviar o código
    try {
      await ig.challenge.selectVerifyMethod('0');
      console.log(`[PrivateAPI] @${account.username} -- método autenticador selecionado`);
    } catch (selErr) {
      console.log(`[PrivateAPI] @${account.username} -- selectVerifyMethod('0') falhou: ${selErr.message} — enviando código diretamente`);
    }
  }

  await ig.challenge.sendSecurityCode(code);

  // Após o checkpoint, o Instagram pode ainda exigir TOTP (2FA)
  let me;
  try {
    me = await ig.account.currentUser();
  } catch (postErr) {
    const { IgLoginTwoFactorRequiredError } = require('instagram-private-api');
    if (postErr instanceof IgLoginTwoFactorRequiredError) {
      const twoFactorInfo       = postErr.response?.body?.two_factor_info;
      const twoFactorIdentifier = twoFactorInfo?.two_factor_identifier;
      console.log(`[PrivateAPI] @${account.username} -- checkpoint OK, agora precisa de TOTP`);
      _pendingTotp.set(String(account._id), { ig, twoFactorIdentifier, seed, username: account.username });
      // Salva challengeState para caso de reinício do servidor
      const snap = await ig.state.serialize();
      delete snap.constants; snap._deviceSeed = seed;
      await Account.findByIdAndUpdate(account._id, { challengeState: JSON.stringify(snap) });
      const err = new Error('TOTP_REQUIRED_AFTER_CHALLENGE');
      err.code = 'TOTP_REQUIRED_AFTER_CHALLENGE';
      throw err;
    }
    throw postErr;
  }

  const serialized = await ig.state.serialize();
  delete serialized.constants;
  serialized._deviceSeed = seed;
  await Account.findByIdAndUpdate(account._id, {
    igSession:      JSON.stringify(serialized),
    challengeState: '',
    healthStatus:   'ativa',
    lastError:      '',
  });
  _pendingChallenges.delete(String(account._id));
  console.log(`[PrivateAPI] @${me.username} -- sessão ativa após challenge`);
}

async function initMobileSession(account) {
  try {
    await createClient(account, { forcePasswordLogin: true });
    return { success: true };
  } catch (err) {
    if (err.code === 'CHALLENGE_REQUIRED') {
      return { needsCode: true, message: 'Codigo enviado. Insira abaixo.' };
    }
    throw err;
  }
}

async function extractCoverFrame(videoPath) {
  const outPath = path.join(os.tmpdir(), `ig_cover_${Date.now()}.jpg`);
  try {
    try {
      execSync(`ffmpeg -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${outPath}" -y`, { stdio: 'pipe' });
    } catch {
      execSync(`ffmpeg -i "${videoPath}" -vframes 1 -q:v 2 "${outPath}" -y`, { stdio: 'pipe' });
    }
    return fs.readFileSync(outPath);
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
}

function getVideoDuration(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${videoPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString();
    const info = JSON.parse(out);
    const vs = info.streams?.find(s => s.codec_type === 'video');
    return {
      duration: parseFloat(vs?.duration || '15'),
      width:    parseInt(vs?.width  || '1080'),
      height:   parseInt(vs?.height || '1920'),
    };
  } catch {
    return { duration: 15, width: 1080, height: 1920 };
  }
}

async function _tryAuthWithCookies(ig, account) {
  const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
  const cookiesPath   = path.join(SESSIONS_ROOT, account.username, 'cookies.json');
  if (!fs.existsSync(cookiesPath)) return false;

  const browserCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
  const sessionCookie  = browserCookies.find(c => c.name === 'sessionid' || c.key === 'sessionid');
  if (!sessionCookie) return false;

  const igCookies = browserCookies
    .filter(c => (c.domain || '').includes('instagram.com'))
    .map(c => ({
      key:          c.name || c.key,
      value:        c.value,
      domain:       c.domain?.startsWith('.') ? c.domain : `.${c.domain || 'instagram.com'}`,
      path:         c.path   || '/',
      secure:       c.secure   || false,
      httpOnly:     c.httpOnly  || false,
      hostOnly:     false,
      creation:     new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    }));

  const cookieSeed = `${account.username}_${String(account._id)}`;
  ig.state.generateDevice(cookieSeed);
  await ig.state.deserializeCookieJar(JSON.stringify({
    version: 'tough-cookie@4.1.2', storeType: 'MemoryCookieStore',
    rejectPublicSuffixes: true, enableLooseMode: false,
    allowSpecialUseDomain: true, cookies: igCookies,
  }));
  await ig.account.currentUser();

  const SESSIONS_ROOT2 = path.resolve(__dirname, '../../sessions');
  const serialized = await ig.state.serialize();
  delete serialized.constants;
  serialized._deviceSeed = cookieSeed;
  const sessionStr = JSON.stringify(serialized);
  await Account.findByIdAndUpdate(account._id, { igSession: sessionStr });
  try {
    fs.writeFileSync(path.join(SESSIONS_ROOT2, account.username, 'ig_session.json'), sessionStr, 'utf8');
  } catch {}
  console.log(`[PrivateAPI] @${account.username} -- autenticado via cookies.json`);
  return true;
}

// Session hierarchy:
//   1. Sessao no banco
//   2. cookies.json
//   3. Arquivo ig_session.json
//   4. Multilogin (se MULTILOGIN_MODE definido e ML6 rodando)
//   5. Login com senha (se password configurado)
async function createClient(account, { forcePasswordLogin = false } = {}) {
  // Se há um challenge pendente aguardando código do usuário, não tenta novo login
  // (o KeepAlive chamaria createClient e sobrescreveria o challengeState válido)
  if (!forcePasswordLogin && account.challengeState) {
    const freshAcc = await Account.findById(account._id);
    if (freshAcc?.challengeState) {
      console.log(`[PrivateAPI] @${account.username} -- challenge pendente, aguardando código do usuário`);
      const err = new Error('CHALLENGE_REQUIRED');
      err.code = 'CHALLENGE_REQUIRED';
      err.autoSent = false;
      throw err;
    }
  }

  const IgApiClient = getIgApiClient();
  const ig = new IgApiClient();

  // Força versão recente do Instagram para evitar bloqueio por versão antiga
  try {
    ig.state.constants.APP_VERSION      = '361.0.0.39.109';
    ig.state.constants.APP_VERSION_CODE = '574767436';
  } catch {}

  // Proxy só é aplicado no login com senha (mais abaixo), não no carregamento de sessão

  const _skipToFile = (account.igSession === 'use_cookies');

  // 1. Sessao do banco
  if (account.igSession && !_skipToFile) {
    let dbSaved = null;
    try {
      dbSaved = typeof account.igSession === 'string'
        ? JSON.parse(account.igSession) : account.igSession;
      const dbSeed = dbSaved._deviceSeed || account.username;
      ig.state.generateDevice(dbSeed);
      await ig.state.deserialize(dbSaved);
      // NÃO aplica proxy ao carregar sessão existente — proxy invalida sessão criada sem ele
      await ig.account.currentUser();
      console.log(`[PrivateAPI] @${account.username} -- sessao do banco OK`);
      return ig;
    } catch (sessErr) {
      const sessMsg = (sessErr?.message || '').toLowerCase();
      if (sessMsg.includes('checkpoint_required') || sessMsg.includes('checkpoint')) {
        const dbSeed = dbSaved?._deviceSeed || account.username;
        // Extrai checkpoint URL do body da resposta
        const rawBody = sessErr?.response?.body;
        const errBody = rawBody ? (typeof rawBody === 'string' ? (() => { try { return JSON.parse(rawBody); } catch { return {}; } })() : rawBody) : {};
        console.log(`[PrivateAPI] @${account.username} -- checkpoint body: ${JSON.stringify(errBody).slice(0,300)}`);

        // Reconstrói ig.state.checkpoint a partir da URL no body
        const cpUrl = errBody.checkpoint_url || errBody.challenge?.api_path || null;
        const isUsableCheckpoint = cpUrl && cpUrl.startsWith('/') && !cpUrl.includes('unsupported_version');
        if (isUsableCheckpoint) {
          ig.state.checkpoint = { challenge: { api_path: cpUrl }, lock: false, logout: false };
          console.log(`[PrivateAPI] @${account.username} -- checkpoint URL: ${cpUrl}`);
        } else if (cpUrl?.includes('unsupported_version')) {
          console.log(`[PrivateAPI] @${account.username} -- IP bloqueado (unsupported_version) — necessário proxy residencial`);
        }

        console.log(`[PrivateAPI] @${account.username} -- sessão válida mas IP requer checkpoint`);

        // Tenta TOTP automático se a conta tem segredo salvo
        const freshForChallenge = await Account.findById(account._id);
        if (freshForChallenge?.totpSecret) {
          try {
            console.log(`[PrivateAPI] @${account.username} -- tentando resolver challenge com TOTP automático...`);
            await ig.challenge.reset();
            await ig.challenge.selectVerifyMethod('0'); // método autenticador
            const autoCode = generateTotpCode(freshForChallenge.totpSecret);
            await ig.challenge.sendSecurityCode(autoCode);
            const me = await ig.account.currentUser();
            const snapOk = await ig.state.serialize(); delete snapOk.constants; snapOk._deviceSeed = dbSeed;
            await Account.findByIdAndUpdate(account._id, { igSession: JSON.stringify(snapOk), challengeState: '', healthStatus: 'ativa', lastError: '' });
            console.log(`[PrivateAPI] @${account.username} -- challenge resolvido com TOTP automático!`);
            return ig;
          } catch (totpChallengeErr) {
            console.log(`[PrivateAPI] @${account.username} -- TOTP automático no challenge falhou: ${totpChallengeErr.message}`);
          }
        }

        // Fallback: envia código por email/SMS e aguarda usuário
        let autoSent = false;
        try { await ig.challenge.reset(); await ig.challenge.auto(true); autoSent = true; console.log(`[PrivateAPI] @${account.username} -- código enviado`); } catch (ae) { console.log(`[PrivateAPI] @${account.username} -- auto() falhou: ${ae.message}`); }
        const snap = await ig.state.serialize(); delete snap.constants; snap._deviceSeed = dbSeed;
        snap._checkpointRaw = ig.state.checkpoint ? JSON.parse(JSON.stringify(ig.state.checkpoint)) : null;
        await Account.findByIdAndUpdate(account._id, { challengeState: JSON.stringify(snap), healthStatus: 'sessao_expirada' });
        _pendingChallenges.set(String(account._id), { ig, seed: dbSeed, username: account.username });
        const err = new Error('CHALLENGE_REQUIRED'); err.code = 'CHALLENGE_REQUIRED'; err.autoSent = autoSent; throw err;
      }
      console.log(`[PrivateAPI] @${account.username} -- sessao do banco expirada: ${sessErr?.message?.slice(0,60)}`);
    }
  }

  // 2. cookies.json
  try {
    if (await _tryAuthWithCookies(ig, account)) return ig;
  } catch (e) {
    console.log(`[PrivateAPI] @${account.username} -- cookies expirados: ${e.message.slice(0, 60)}`);
  }

  // 3. Arquivo ig_session.json
  const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
  const sessionFile = path.join(SESSIONS_ROOT, account.username, 'ig_session.json');
  if (fs.existsSync(sessionFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      ig.state.generateDevice(saved._deviceSeed || account.username);
      await ig.state.deserialize(saved);
      await ig.account.currentUser();
      console.log(`[PrivateAPI] @${account.username} -- sessao do arquivo OK`);
      return ig;
    } catch {
      console.log(`[PrivateAPI] @${account.username} -- sessao do arquivo expirada`);
    }
  }

  // 4. Multilogin (completamente opcional -- so tenta se configurado e ML6 acessivel)
  const mlMode = (process.env.MULTILOGIN_MODE || '').toLowerCase();
  if (mlMode && (process.env.MULTILOGIN_EMAIL || mlMode === 'local')) {
    try {
      const freshAcc = await Account.findById(account._id);
      const { syncCookiesFromMultilogin } = require('./multiloginService');
      await syncCookiesFromMultilogin(freshAcc);
      const ig2 = new IgApiClient();
      if (account.proxy?.trim()) { try { ig2.state.proxyUrl = account.proxy.trim(); } catch {} }
      const freshAcc2 = await Account.findById(account._id);
      if (await _tryAuthWithCookies(ig2, freshAcc2)) {
        console.log(`[PrivateAPI] @${account.username} -- recuperado via Multilogin`);
        await Account.findByIdAndUpdate(account._id, { healthStatus: 'ativa', lastError: '' });
        return ig2;
      }
    } catch (mlErr) {
      console.log(`[PrivateAPI] @${account.username} -- Multilogin ignorado: ${mlErr.message.slice(0, 80)}`);
    }
  }

  // 5. Login com senha (sempre tenta se tiver senha configurada)
  if (!account.password && !forcePasswordLogin) {
    const err = new Error(
      `@${account.username}: sem sessao valida. ` +
      'Importe cookies (botao cookie) ou configure uma senha na conta.'
    );
    err.code = 'SESSION_EXPIRED';
    await Account.findByIdAndUpdate(account._id, { healthStatus: 'sessao_expirada', lastError: err.message });
    throw err;
  }

  if (account.password) {
    const newSeed = `${account.username}_${String(account._id)}`;
    ig.state.generateDevice(newSeed);
    // Aplica proxy no login com senha (IP residencial do proxy evita bloqueio do Instagram)
    if (account.proxy?.trim()) ig.state.proxyUrl = account.proxy.trim();
    const loginId = account.loginEmail?.trim() || account.username;
    console.log(`[PrivateAPI] @${account.username} -- tentando login com senha...`);

    try { await ig.simulate.preLoginFlow(); } catch {}

    let user;
    try {
      user = await ig.account.login(loginId, account.password);
    } catch (loginErr) {
      // Diagnóstico: mostra estrutura do erro para identificar tipo correto
      const rawBody = loginErr?.response?.body;
      const parsedBody = rawBody ? (typeof rawBody === 'string' ? (() => { try { return JSON.parse(rawBody); } catch { return {}; } })() : rawBody) : {};
      console.log(`[PrivateAPI:DBG] @${account.username} -- errName=${loginErr?.name} status=${loginErr?.response?.statusCode} msg=${parsedBody.message} checkpoint_state=${JSON.stringify(ig.state.checkpoint)?.slice(0,100)} errBodyChallenge=${JSON.stringify(parsedBody.challenge)?.slice(0,100)}`);

      // Usuário não encontrado pelo username — precisa de email/telefone
      const { IgLoginInvalidUserError, IgLoginTwoFactorRequiredError } = require('instagram-private-api');
      if (loginErr instanceof IgLoginInvalidUserError || (loginErr?.name === 'IgLoginInvalidUserError')) {
        console.log(`[PrivateAPI] @${account.username} -- username não reconhecido, precisa de email/telefone`);
        const err = new Error('LOGIN_EMAIL_REQUIRED');
        err.code = 'LOGIN_EMAIL_REQUIRED';
        throw err;
      }

      // 2FA com autenticador (TOTP)
      if (loginErr instanceof IgLoginTwoFactorRequiredError) {
        const twoFactorInfo       = loginErr.response?.body?.two_factor_info;
        const twoFactorIdentifier = twoFactorInfo?.two_factor_identifier;

        // Se a conta tem segredo TOTP salvo, gera o código automaticamente
        const freshAccount = await Account.findById(account._id);
        if (freshAccount?.totpSecret) {
          try {
            const autoCode = generateTotpCode(freshAccount.totpSecret);
            console.log(`[PrivateAPI] @${account.username} -- TOTP auto-gerado (segredo salvo)`);
            const user = await ig.account.twoFactorLogin({
              username:            account.username,
              verificationCode:    autoCode,
              twoFactorIdentifier: twoFactorIdentifier || '',
              verificationMethod:  '3',
              trustThisDevice:     '1',
            });
            const snap = await ig.state.serialize(); delete snap.constants; snap._deviceSeed = newSeed;
            await Account.findByIdAndUpdate(account._id, {
              igSession: JSON.stringify(snap), challengeState: '', healthStatus: 'ativa', lastError: '',
            });
            console.log(`[PrivateAPI] @${user.username} -- login com TOTP automático OK`);
            return ig;
          } catch (totpErr) {
            console.log(`[PrivateAPI] @${account.username} -- TOTP auto falhou: ${totpErr.message}`);
          }
        }

        console.log(`[PrivateAPI] @${account.username} -- 2FA TOTP necessário (sem segredo salvo)`);
        _pendingTotp.set(String(account._id), { ig, twoFactorIdentifier, seed: newSeed, username: account.username });
        const err = new Error('TOTP_REQUIRED');
        err.code  = 'TOTP_REQUIRED';
        throw err;
      }

      const msg    = (loginErr?.message || '').toLowerCase();
      const status = loginErr?.response?.statusCode;

      const isEmailChallenge =
        msg.includes('email to help') || msg.includes('get back into your account') || msg.includes('we can send you');

      const needsChallenge =
        loginErr?.name === 'IgCheckpointError' ||
        msg.includes('checkpoint') || msg.includes('challenge') ||
        isEmailChallenge || msg.includes('verify your account') ||
        (status === 400 && ig.state.checkpoint);

      if (needsChallenge || ig.state.checkpoint) {
        // Quando Instagram retorna IgLoginBadPasswordError com mensagem de email,
        // ig.state.checkpoint fica null. Segunda tentativa de login geralmente retorna
        // IgCheckpointError com checkpoint URL correto.
        if (isEmailChallenge && !ig.state.checkpoint) {
          console.log(`[PrivateAPI] @${account.username} -- sem checkpoint, tentando 2ª vez para obter checkpoint URL...`);
          try {
            await ig.account.login(loginId, account.password);
          } catch (loginErr2) {
            // Ignora — só queremos que ig.state.checkpoint seja preenchido
            console.log(`[PrivateAPI] @${account.username} -- 2ª tentativa: ${loginErr2?.name} checkpoint=${ig.state.checkpoint ? 'ok' : 'null'}`);
          }
        }

        // Detecta se o checkpoint está pedindo o código do autenticador (TOTP)
        const checkpointStepData = ig.state.checkpoint?.step_data;
        const contactPoint = checkpointStepData?.contact_point || '';
        const isTotpChallenge =
          contactPoint.includes('authenticator') ||
          msg.includes('authenticator') ||
          loginErr?.response?.body?.two_factor_info?.totp_two_factor_on;

        if (isTotpChallenge) {
          const twoFactorInfo = loginErr?.response?.body?.two_factor_info || {};
          _pendingTotp.set(String(account._id), {
            ig, twoFactorIdentifier: twoFactorInfo.two_factor_identifier || '',
            seed: newSeed, username: account.username, fromChallenge: true,
          });
          const err = new Error('TOTP_REQUIRED'); err.code = 'TOTP_REQUIRED'; throw err;
        }

        // Extrai challenge api_path do checkpoint (agora deve estar preenchido após 2ª tentativa)
        const challengeApiPath = ig.state.checkpoint?.challenge?.api_path
          || parsedBody.challenge?.api_path
          || null;
        console.log(`[PrivateAPI] @${account.username} -- challenge api_path: ${challengeApiPath}`);

        // Salva estado ANTES de reset/auto
        const stateSnap = await ig.state.serialize();
        delete stateSnap.constants;
        stateSnap._deviceSeed     = newSeed;
        stateSnap._challengeApiPath = challengeApiPath; // URL direta para POST do código
        // Tenta salvar checkpoint completo também
        stateSnap._checkpointRaw = ig.state.checkpoint
          ? JSON.parse(JSON.stringify(ig.state.checkpoint))
          : null;
        await Account.findByIdAndUpdate(account._id, {
          challengeState: JSON.stringify(stateSnap),
          healthStatus: 'sessao_expirada',
        });

        // Tenta enviar o código por email/SMS automaticamente (após salvar estado)
        let autoSent = false;
        // Tenta resolver challenge com TOTP automaticamente se tiver segredo salvo
        const freshForChallenge = await Account.findById(account._id);
        if (freshForChallenge?.totpSecret) {
          try {
            const autoCode = generateTotpCode(freshForChallenge.totpSecret);
            // Tenta resolver challenge com código TOTP (método 0 = TOTP, método 1 = email)
            await ig.challenge.reset();
            await ig.challenge.selectVerifyMethod('0'); // 0 = authenticator app
            await ig.challenge.sendSecurityCode(autoCode);
            const snap2 = await ig.state.serialize(); delete snap2.constants; snap2._deviceSeed = newSeed;
            await Account.findByIdAndUpdate(account._id, {
              igSession: JSON.stringify(snap2), challengeState: '', healthStatus: 'ativa', lastError: '',
            });
            console.log(`[PrivateAPI] @${account.username} -- challenge resolvido com TOTP automático!`);
            return ig;
          } catch (chalTotpErr) {
            console.log(`[PrivateAPI] @${account.username} -- TOTP no challenge falhou: ${chalTotpErr.message}`);
          }
        }

        try {
          await ig.challenge.reset();
          await ig.challenge.auto(true);
          autoSent = true;
          console.log(`[PrivateAPI] @${account.username} -- código enviado por email`);
        } catch {
          console.log(`[PrivateAPI] @${account.username} -- auto() falhou, usuário insere código manual`);
        }

        // Mantém em memória também (se o processo não reiniciar)
        _pendingChallenges.set(String(account._id), { ig, seed: newSeed, username: account.username });

        const err = new Error('CHALLENGE_REQUIRED');
        err.code     = 'CHALLENGE_REQUIRED';
        err.autoSent = autoSent;
        throw err;
      }

      await Account.findByIdAndUpdate(account._id, { healthStatus: 'sessao_expirada', lastError: loginErr.message });
      throw loginErr;
    }

    console.log(`[PrivateAPI] @${user.username} -- login com senha OK`);
    process.nextTick(async () => { try { await ig.simulate.postLoginFlow(); } catch {} });

    try {
      const state = await ig.state.serialize();
      delete state.constants;
      state._deviceSeed = newSeed;
      const sessionStr = JSON.stringify(state);
      await Account.findByIdAndUpdate(account._id, { igSession: sessionStr, healthStatus: 'ativa', lastError: '' });
      fs.mkdirSync(path.join(SESSIONS_ROOT, account.username), { recursive: true });
      fs.writeFileSync(path.join(SESSIONS_ROOT, account.username, 'ig_session.json'), sessionStr, 'utf8');
    } catch {}

    return ig;
  }

  const err = new Error(`@${account.username}: sem metodo de autenticacao disponivel.`);
  err.code = 'SESSION_EXPIRED';
  throw err;
}

async function postReelViaClips(ig, videoBuffer, videoPath, { caption, coverBuffer }) {
  const { duration, width, height } = getVideoDuration(videoPath);
  const uploadId   = Date.now().toString();
  const videoSize  = videoBuffer.length;
  const uploadName = `${uploadId}_0_${Math.floor(Math.random() * 1e10)}`;

  console.log(`[Clips] Upload (${Math.round(videoSize / 1024 / 1024)}MB)...`);

  // Usa fetch direto para evitar conflito com baseUrl do ig.request
  const igCookies = ig.state.cookieJar ? await new Promise(resolve => {
    ig.state.cookieJar.getCookies('https://i.instagram.com', (err, cookies) => {
      resolve(err ? [] : cookies);
    });
  }) : [];
  const cookieHeader = igCookies.map(c => `${c.key}=${c.value}`).join('; ');
  const csrfToken = igCookies.find(c => c.key === 'csrftoken')?.value || ig.state.csrftoken || '';

  const uploadRes = await fetch(`https://i.instagram.com/rupload_igvideo/${uploadName}`, {
    method: 'POST',
    headers: {
      'X-Entity-Type': 'video/mp4', 'Offset': '0',
      'X-Entity-Name': uploadName, 'X-Entity-Length': String(videoSize),
      'Content-Type': 'application/octet-stream', 'Content-Length': String(videoSize),
      'Cookie': cookieHeader,
      'X-CSRFToken': csrfToken,
      'X-IG-App-ID': '567067343352427',
      'User-Agent': ig.state.appUserAgent || 'Instagram 195.0.0.31.123 Android',
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) {
    const txt = await uploadRes.text().catch(() => '');
    throw new Error(`Upload vídeo falhou: ${uploadRes.status} ${txt.slice(0, 100)}`);
  }

  let coverUploadId;
  if (coverBuffer) {
    try {
      const coverId = `${Date.now()}_cover`;
      const coverName = `${coverId}_${Math.floor(Math.random() * 1e10)}`;
      await fetch(`https://i.instagram.com/rupload_igphoto/${coverName}`, {
        method: 'POST',
        headers: {
          'X-Entity-Type': 'image/jpeg', 'Offset': '0',
          'X-Entity-Name': coverName, 'X-Entity-Length': String(coverBuffer.length),
          'Content-Type': 'application/octet-stream',
          'Cookie': cookieHeader,
          'X-CSRFToken': csrfToken,
          'X-IG-App-ID': '567067343352427',
          'User-Agent': ig.state.appUserAgent || 'Instagram 195.0.0.31.123 Android',
        },
        body: coverBuffer,
      });
      coverUploadId = coverId;
    } catch {}
  }

  const params = {
    upload_id: uploadId, source_type: '3', caption: caption || '',
    clips_share_preview_to_feed: '1', configure_mode: '2', video_result: '',
    creation_logger_session_id: ig.state.uuid, timezone_offset: '-10800',
    length: String(Math.round(duration * 1000)),
    width: String(width), height: String(height),
    extra: JSON.stringify({ source_width: width, source_height: height }),
    audio_muted: 'false', poster_frame_time_ms: '1000',
  };
  if (coverUploadId) { params.clips_cover_photo_upload_id = coverUploadId; delete params.poster_frame_time_ms; }

  const result = await ig.request.send({
    url: '/api/v2/media/configure_to_clips/', method: 'POST', form: ig.request.sign(params),
  });

  const mediaId = result?.body?.media?.pk || result?.body?.media?.id || 'ok';
  console.log(`[Clips] Publicado! ID: ${mediaId}`);
  return mediaId;
}

const BRASIL_LAT = -15.7801;
const BRASIL_LNG = -47.9292;
const _locationCache = new Map();

async function searchLocation(ig, query) {
  if (_locationCache.has(query)) return _locationCache.get(query);
  try {
    const results = await ig.locationSearch.index(BRASIL_LAT, BRASIL_LNG, query);
    if (results?.length) { _locationCache.set(query, results[0]); return results[0]; }
  } catch {}
  return null;
}

async function postReel(account, post) {
  const ig = await createClient(account);

  const rawPath = path.resolve(__dirname, '../../uploads', post.media);
  const videoPath = await convertToReelFormat(rawPath);
  const videoBuffer = fs.readFileSync(videoPath);

  let coverBuffer = null;
  if (post.cover) { try { coverBuffer = fs.readFileSync(path.resolve(__dirname, '../../uploads', post.cover)); } catch {} }
  if (!coverBuffer) { try { coverBuffer = await extractCoverFrame(videoPath); } catch {} }

  const location = post.location ? await searchLocation(ig, post.location) : null;
  const caption  = post.caption || '';

  try {
    return await postReelViaClips(ig, videoBuffer, videoPath, { caption, coverBuffer });
  } catch (clipsErr) {
    console.log(`[Clips] falhou: ${clipsErr.message} -- fallback publish.video`);
  }

  const opts = { video: videoBuffer, caption };
  if (coverBuffer) opts.coverImage = coverBuffer;
  if (location)   opts.location   = location;
  await ig.publish.video(opts);
  console.log(`[PrivateAPI] Publicado (@${account.username})`);
  return 'feed_video_ok';
}

async function convertToProfessional(account) {
  const ig = await createClient(account);
  const user = await ig.account.currentUser();
  if (user.account_type !== 1) return { alreadyProfessional: true, accountType: user.account_type };
  await ig.request.send({
    url: '/api/v1/accounts/convert_to_professional/', method: 'POST',
    form: ig.request.sign(JSON.stringify({
      category_id: '2218', _csrftoken: ig.state.cookieCsrfToken,
      _uid: ig.state.cookieUserId, _uuid: ig.state.uuid,
    })),
  });
  await Account.findByIdAndUpdate(account._id, { accountType: 'creator' });
  return { success: true, accountType: 3 };
}

async function getAccountType(account) {
  const ig   = await createClient(account);
  const user = await ig.account.currentUser();
  const typeMap = { 1: 'personal', 2: 'business', 3: 'creator' };
  return {
    accountType: user.account_type, typeName: typeMap[user.account_type] || 'unknown',
    isProfessional: user.account_type !== 1, username: user.username,
    fullName: user.full_name, followerCount: user.follower_count,
  };
}

async function clearSession(accountId) {
  await Account.findByIdAndUpdate(accountId, { igSession: '' });
}

async function resendChallengeSms(account) {
  const pending = _pendingChallenges.get(String(account._id));
  if (!pending) throw new Error('Nenhum desafio pendente. Reinicie a sessao mobile.');
  try {
    await pending.ig.challenge.selectVerifyMethod('1');
    return { success: true, message: 'Codigo enviado por SMS.' };
  } catch (err) {
    throw new Error(`Falha ao solicitar SMS: ${err.message}`);
  }
}

/**
 * Finaliza login 2FA com código TOTP do autenticador (Google Authenticator / Authy).
 * Deve ser chamado após createClient lançar erro com code === 'TOTP_REQUIRED'.
 */
async function resolveTotpLogin(account, totpCode) {
  let pending = _pendingTotp.get(String(account._id));

  // Se não há estado em memória, reconstrói do banco (servidor reiniciou)
  if (!pending) {
    const IgApiClient = getIgApiClient();
    const fresh = await Account.findById(account._id);
    if (fresh?.challengeState) {
      // Veio de um checkpoint que é TOTP na verdade — usa o challengeState
      const saved = JSON.parse(fresh.challengeState);
      const seed = saved._deviceSeed || fresh.username;
      const ig = new IgApiClient();
      ig.state.generateDevice(seed);
      await ig.state.deserialize(saved);
      if (!ig.state.checkpoint && saved._checkpointRaw) ig.state.checkpoint = saved._checkpointRaw;
      pending = { ig, twoFactorIdentifier: '', seed, fromChallenge: true };
    } else {
      throw new Error('Sessão TOTP expirou. Clique em API novamente para receber novo código.');
    }
  }

  const { ig, twoFactorIdentifier, seed, fromChallenge } = pending;

  try {
    let user;
    if (fromChallenge && !twoFactorIdentifier) {
      // Veio de checkpoint — tenta via challenge.sendSecurityCode (alguns casos)
      try {
        await ig.challenge.sendSecurityCode(totpCode.replace(/\s/g, ''));
        user = await ig.account.currentUser();
      } catch {
        // Fallback: tenta twoFactorLogin sem identifier (Instagram às vezes aceita)
        user = await ig.account.twoFactorLogin({
          username:           account.username,
          verificationCode:   totpCode.replace(/\s/g, ''),
          twoFactorIdentifier: twoFactorIdentifier || '',
          verificationMethod: '3',
          trustThisDevice:    '1',
        });
      }
    } else {
      user = await ig.account.twoFactorLogin({
        username:           account.username,
        verificationCode:   totpCode.replace(/\s/g, ''),
        twoFactorIdentifier,
        verificationMethod: '3', // 3 = TOTP app
        trustThisDevice:    '1',
      });
    }

    // Salva sessão
    const state = await ig.state.serialize();
    delete state.constants;
    state._deviceSeed = seed;
    const sessionStr  = JSON.stringify(state);
    await Account.findByIdAndUpdate(account._id, {
      igSession: sessionStr, healthStatus: 'ativa', lastError: '',
    });

    _pendingTotp.delete(String(account._id));
    console.log(`[PrivateAPI] @${user.username} -- 2FA TOTP resolvido, sessao salva`);
    return { success: true };
  } catch (err) {
    throw new Error(`Código TOTP inválido ou expirado: ${err.message}`);
  }
}

module.exports = {
  postReel, createClient, initMobileSession, resolveChallenge,
  resendChallengeSms, convertToProfessional, getAccountType, clearSession,
  resolveTotpLogin,
};

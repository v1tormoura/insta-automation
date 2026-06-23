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

async function resolveChallenge(account, code) {
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
    console.log(`[PrivateAPI] @${account.username} -- challenge state restaurado do banco`);
  }

  await ig.challenge.sendSecurityCode(code);
  const me = await ig.account.currentUser();
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
  const IgApiClient = getIgApiClient();
  const ig = new IgApiClient();

  if (account.proxy?.trim()) {
    try { process.env.HTTPS_PROXY = account.proxy.trim(); } catch {}
  }

  const _skipToFile = (account.igSession === 'use_cookies');

  // 1. Sessao do banco
  if (account.igSession && !_skipToFile) {
    try {
      const saved = typeof account.igSession === 'string'
        ? JSON.parse(account.igSession) : account.igSession;
      ig.state.generateDevice(saved._deviceSeed || account.username);
      await ig.state.deserialize(saved);
      await ig.account.currentUser();
      console.log(`[PrivateAPI] @${account.username} -- sessao do banco OK`);
      return ig;
    } catch {
      console.log(`[PrivateAPI] @${account.username} -- sessao do banco expirada`);
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
      if (account.proxy?.trim()) { try { process.env.HTTPS_PROXY = account.proxy.trim(); } catch {} }
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
    const loginId = account.loginEmail?.trim() || account.username;
    console.log(`[PrivateAPI] @${account.username} -- tentando login com senha...`);

    try { await ig.simulate.preLoginFlow(); } catch {}

    let user;
    try {
      user = await ig.account.login(loginId, account.password);
    } catch (loginErr) {
      // 2FA com autenticador (TOTP) — precisa do código do Google Authenticator/Authy
      const { IgLoginTwoFactorRequiredError } = require('instagram-private-api');
      if (loginErr instanceof IgLoginTwoFactorRequiredError) {
        const twoFactorInfo       = loginErr.response?.body?.two_factor_info;
        const twoFactorIdentifier = twoFactorInfo?.two_factor_identifier;
        console.log(`[PrivateAPI] @${account.username} -- 2FA TOTP necessário`);
        _pendingTotp.set(String(account._id), { ig, twoFactorIdentifier, seed: newSeed, username: account.username });
        const err = new Error('TOTP_REQUIRED');
        err.code  = 'TOTP_REQUIRED';
        throw err;
      }

      const msg    = (loginErr?.message || '').toLowerCase();
      const status = loginErr?.response?.statusCode;

      const needsChallenge =
        loginErr?.name === 'IgCheckpointError' ||
        msg.includes('checkpoint') || msg.includes('challenge') ||
        msg.includes('email to help') || msg.includes('get back into your account') ||
        msg.includes('we can send you') || msg.includes('verify your account') ||
        (status === 400 && ig.state.checkpoint);

      if (needsChallenge || ig.state.checkpoint) {
        // Detecta se o checkpoint está pedindo o código do autenticador (TOTP)
        const checkpointStepData = ig.state.checkpoint?.step_data;
        const contactPoint = checkpointStepData?.contact_point || '';
        const isTotpChallenge =
          contactPoint.includes('authenticator') ||
          msg.includes('authenticator') ||
          loginErr?.response?.body?.two_factor_info?.totp_two_factor_on;

        if (isTotpChallenge) {
          // Checkpoint pedindo TOTP — trata igual ao IgLoginTwoFactorRequiredError
          const twoFactorInfo = loginErr?.response?.body?.two_factor_info || {};
          _pendingTotp.set(String(account._id), {
            ig, twoFactorIdentifier: twoFactorInfo.two_factor_identifier || '',
            seed: newSeed, username: account.username, fromChallenge: true,
          });
          const err = new Error('TOTP_REQUIRED'); err.code = 'TOTP_REQUIRED'; throw err;
        }

        // Tenta enviar o código por email/SMS automaticamente
        let autoSent = false;
        try {
          await ig.challenge.reset();
          await ig.challenge.auto(true);
          autoSent = true;
          console.log(`[PrivateAPI] @${account.username} -- código enviado por email`);
        } catch {
          console.log(`[PrivateAPI] @${account.username} -- auto() falhou, usuário insere código manual`);
        }

        // Persiste estado do ig no banco para sobreviver a reinicializações
        const stateSnap = await ig.state.serialize();
        delete stateSnap.constants;
        stateSnap._deviceSeed = newSeed;
        await Account.findByIdAndUpdate(account._id, {
          challengeState: JSON.stringify(stateSnap),
          healthStatus: 'sessao_expirada',
        });

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

  await ig.request.send({
    url: `https://i.instagram.com/rupload_igvideo/${uploadName}`,
    method: 'POST',
    headers: {
      'X-Entity-Type': 'video/mp4', 'Offset': '0',
      'X-Entity-Name': uploadName, 'X-Entity-Length': String(videoSize),
      'Content-Type': 'application/octet-stream', 'Content-Length': String(videoSize),
    },
    body: videoBuffer, json: false,
  });

  let coverUploadId;
  if (coverBuffer) {
    try {
      const coverId = `${Date.now()}_cover`;
      const coverName = `${coverId}_${Math.floor(Math.random() * 1e10)}`;
      await ig.request.send({
        url: `https://i.instagram.com/rupload_igphoto/${coverName}`,
        method: 'POST',
        headers: {
          'X-Entity-Type': 'image/jpeg', 'Offset': '0',
          'X-Entity-Name': coverName, 'X-Entity-Length': String(coverBuffer.length),
          'Content-Type': 'application/octet-stream',
        },
        body: coverBuffer, json: false,
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

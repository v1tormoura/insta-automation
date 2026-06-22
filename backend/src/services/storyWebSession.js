'use strict';

/**
 * Posta story usando cookies da sessão web (cookies.json).
 *
 * Fluxo:
 * 1. Tenta upload + configure via i.instagram.com (mobile API) com headers completos
 *    → suporta story_link_stickers
 * 2. Se mobile falhar, fallback para www.instagram.com (web API)
 *    → story posta sem link sticker
 *
 * Não abre nenhum browser — 100% HTTP.
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const SESSIONS_ROOT    = path.resolve(__dirname, '../../sessions');
const IG_WEB_APP_ID    = '936619743392459';   // Web
const IG_ANDROID_APP_ID = '567067343352427';  // Android

const MOBILE_UA = 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2340; samsung; SM-S901B; r0s; exynos2200; pt_BR; 458229258)';
const WEB_UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadCookies(username) {
  const p = path.join(SESSIONS_ROOT, username, 'cookies.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function cookieVal(cookies, name) {
  return cookies.find(c => c.name === name)?.value || '';
}

function buildCookieHeader(cookies) {
  const keep = ['sessionid','csrftoken','ds_user_id','mid','ig_did','rur','x-ig-www-claim'];
  return cookies.filter(c => keep.includes(c.name)).map(c => `${c.name}=${c.value}`).join('; ');
}

function hasPuppeteerSession(username) {
  const cookies = loadCookies(username);
  return !!(cookies && cookieVal(cookies, 'sessionid'));
}

// ── Core ──────────────────────────────────────────────────────────────────────

async function postStoryWebSession(account, { imageUrl, imageBuffer, linkUrl }) {
  // ── 1. Cookies ──
  const cookies = loadCookies(account.username);
  if (!cookies) throw new Error(`Sessão não encontrada para @${account.username}. Clique em "Entrar".`);

  const sessionid  = cookieVal(cookies, 'sessionid');
  if (!sessionid) throw new Error(`sessionid não encontrado para @${account.username}. Faça login via "Entrar".`);

  const cookieHeader = buildCookieHeader(cookies);
  const csrfToken    = cookieVal(cookies, 'csrftoken');
  const igUserId     = cookieVal(cookies, 'ds_user_id');
  const igDid        = cookieVal(cookies, 'ig_did');
  const mid          = cookieVal(cookies, 'mid');

  // Device identifiers derivados da sessão
  const androidId  = 'android-' + crypto.createHash('md5').update(sessionid).digest('hex').slice(0, 16);
  const deviceUuid = igDid || crypto.createHash('md5').update(sessionid + '_uuid').digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

  console.log(`🔑 [StoryWeb] @${account.username} uid=${igUserId} ig_did=${igDid ? '✅' : '❌'} mid=${mid ? '✅' : '❌'}`);

  // ── 2. Imagem ──
  let buffer = imageBuffer;
  if (!buffer && imageUrl) {
    const r = await fetch(imageUrl);
    if (!r.ok) throw new Error(`Erro ao baixar imagem: HTTP ${r.status}`);
    buffer = Buffer.from(await r.arrayBuffer());
  }
  if (!buffer) throw new Error('Imagem não fornecida');

  const uploadId = Date.now().toString();

  // ── 3. Headers ──
  const mobileHeaders = {
    'Cookie':                cookieHeader,
    'X-CSRFToken':           csrfToken,
    'X-IG-App-ID':           IG_ANDROID_APP_ID,
    'X-IG-Device-ID':        igDid,        // ← CRÍTICO: deve coincidir com cookie ig_did
    'X-IG-Android-ID':       androidId,    // ← CRÍTICO: formato android-{hex16}
    'X-MID':                 mid,          // ← CRÍTICO: cookie mid
    'X-IG-Connection-Type':  'WIFI',
    'X-IG-Capabilities':     '3brTvw==',
    'User-Agent':             MOBILE_UA,
    'Accept':                '*/*',
    'Accept-Language':       'pt-BR,pt;q=0.9',
    'Accept-Encoding':       'gzip, deflate',
  };

  const webHeaders = {
    'Cookie':           cookieHeader,
    'X-CSRFToken':      csrfToken,
    'X-IG-App-ID':      IG_WEB_APP_ID,
    'X-Requested-With': 'XMLHttpRequest',
    'Origin':           'https://www.instagram.com',
    'Referer':          'https://www.instagram.com/',
    'User-Agent':       WEB_UA,
    'Accept':           '*/*',
    'Accept-Language':  'pt-BR,pt;q=0.9',
  };

  const ruploadParams = {
    media_type:          1,
    upload_id:           uploadId,
    upload_media_height: 1920,
    upload_media_width:  1080,
    xsharing_user_ids:   '[]',
    image_compression:   JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
  };

  const uploadExtraHeaders = {
    'Content-Type':               'image/jpeg',
    'X-Entity-Type':              'image/jpeg',
    'X-Entity-Name':              uploadId,
    'X-Entity-Length':            String(buffer.length),
    'Offset':                     '0',
    'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
    'Accept':                     'application/json',
  };

  // ── 4. Upload: tenta i.instagram.com primeiro ──
  let useMobile = true;
  console.log(`📤 [StoryWeb] Upload via i.instagram.com...`);

  let uploadRes = await fetch(`https://i.instagram.com/rupload_igphoto/${uploadId}`, {
    method: 'POST',
    headers: { ...mobileHeaders, ...uploadExtraHeaders },
    body: buffer,
  });
  let uploadData = await uploadRes.json().catch(() => ({}));
  console.log(`📤 [StoryWeb] i.instagram.com upload (HTTP ${uploadRes.status}):`, uploadData);

  const mobileOk = uploadRes.ok && !uploadData.debug_info?.type && uploadData.status !== 'fail';
  if (!mobileOk) {
    console.log(`⚠️  [StoryWeb] Mobile upload falhou — tentando www.instagram.com (sem link sticker)...`);
    useMobile = false;

    uploadRes = await fetch(`https://www.instagram.com/rupload_igphoto/${uploadId}`, {
      method: 'POST',
      headers: { ...webHeaders, ...uploadExtraHeaders },
      body: buffer,
    });
    uploadData = await uploadRes.json().catch(() => ({}));
    console.log(`📤 [StoryWeb] www.instagram.com upload (HTTP ${uploadRes.status}):`, uploadData);

    const webOk = uploadRes.ok && !uploadData.debug_info?.type && uploadData.status !== 'fail';
    if (!webOk) {
      throw new Error(`Falha no upload: ${uploadData.debug_info?.message || uploadData.message || JSON.stringify(uploadData)}`);
    }
  }

  await delay(2000);

  // ── 5. Configure ──
  const now = Math.floor(Date.now() / 1000);
  const configBody = new URLSearchParams({
    upload_id:                 uploadId,
    source_type:               '4',
    configure_mode:            '1',
    story_media_creation_date: String(now - 5),
    client_shared_at:          String(now),
    device_timestamp:          uploadId,
    media_folder:              'Camera',
    scene_type:                'null',
    scene_capture_type:        '',
    _uid:                      igUserId,
    _uuid:                     deviceUuid,
  });

  if (useMobile) {
    configBody.set('device', JSON.stringify({
      manufacturer:    'samsung',
      model:           'SM-S901B',
      android_version: 33,
      android_release: '13',
    }));
  }

  const hasLink = !!(linkUrl && useMobile);
  if (hasLink) {
    const fullUrl = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    const linkStickers = [{
      link_url:         fullUrl,
      x:                0.5,
      y:                0.85,
      z:                0,
      width:            0.32,
      height:           0.065,
      rotation:         0.0,
      sticker_type:     0,
      tap_state:        0,
      tap_state_str_id: 'link',
      product_type:     'link',
      open_in_browser:  false,
      is_pinned:        0,
      is_hidden:        0,
    }];
    configBody.set('story_link_stickers', JSON.stringify(linkStickers));
    console.log(`🔗 [StoryWeb] story_link_stickers: ${fullUrl}`);
  } else if (linkUrl && !useMobile) {
    console.log(`⚠️  [StoryWeb] Link sticker ignorado — upload mobile falhou, usando www sem link`);
  }

  const configEndpoint = useMobile
    ? 'https://i.instagram.com/api/v1/media/configure_to_story/'
    : 'https://www.instagram.com/api/v1/media/configure_to_story/';

  const configReqHeaders = useMobile
    ? { ...mobileHeaders, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
    : { ...webHeaders,    'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };

  console.log(`📢 [StoryWeb] Configure via ${useMobile ? 'i.instagram.com' : 'www.instagram.com'}...`);
  const configRes  = await fetch(configEndpoint, { method: 'POST', headers: configReqHeaders, body: configBody.toString() });
  const configData = await configRes.json().catch(() => ({}));
  console.log(`📢 [StoryWeb] Configure (HTTP ${configRes.status}):`, configData);

  if (configData.status !== 'ok') {
    throw new Error(`Falha ao criar story: ${configData.message || configData.error_type || JSON.stringify(configData)}`);
  }

  console.log(`✅ [StoryWeb] @${account.username} — story publicado! mobile=${useMobile} link=${hasLink}`);
  return { method: 'web_session', withLink: hasLink };
}

module.exports = { postStoryWebSession, hasPuppeteerSession };

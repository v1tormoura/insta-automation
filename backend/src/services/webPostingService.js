/**
 * Instagram Reel posting via internal web API.
 * Usa cookies exportados do Multilogin para postar sem OAuth ou senha.
 *
 * Fluxo:
 *  1. Converter video para Reel (1080x1920, H.264)
 *  2. Upload do video via rupload_igvideo
 *  3. Extrair frame de capa e upload via rupload_igphoto
 *  4. Publicar via configure_to_clips com cover upload ID
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync }        = require('child_process');
const { convertToReelFormat } = require('./videoProcessor');

const SESSIONS_ROOT = path.resolve(__dirname, '../../sessions');
const IG_BASE       = 'https://www.instagram.com';
const delay         = ms => new Promise(r => setTimeout(r, ms));

function getFfmpegPath() {
  try { return require('ffmpeg-static'); } catch {}
  return 'ffmpeg';
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function loadCookies(username) {
  const cookiesPath = path.join(SESSIONS_ROOT, username, 'cookies.json');
  if (!fs.existsSync(cookiesPath)) {
    throw new Error('cookies.json nao encontrado para @' + username + '. Importe via botao no painel.');
  }
  let cookies;
  try { cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8')); }
  catch { throw new Error('cookies.json corrompido para @' + username + '. Reimporte.'); }

  const get = name => cookies.find(c => (c.name || c.key) === name)?.value || '';
  const sessionId = get('sessionid');
  if (!sessionId) throw new Error('Cookie sessionid nao encontrado para @' + username + '.');

  const csrfToken = get('csrftoken');
  const dsUserId  = get('ds_user_id');
  const cookieStr = cookies
    .filter(c => (c.domain || '').includes('instagram.com'))
    .map(c => (c.name || c.key) + '=' + c.value)
    .join('; ');

  return { sessionId, csrfToken, dsUserId, cookieStr };
}

// ── Video info ────────────────────────────────────────────────────────────────

function getVideoInfo(videoPath) {
  try {
    const ffmpeg = getFfmpegPath();
    let stderr = '';
    try {
      execSync('"' + ffmpeg + '" -i "' + videoPath + '" -f null - 2>&1', { stdio: 'pipe' });
    } catch (e) {
      stderr = (e.stderr || e.stdout || Buffer.from('')).toString();
    }
    const dm = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const vm = stderr.match(/Stream.*Video.*?(\d{3,4})x(\d{3,4})/);
    const duration = dm ? parseInt(dm[1])*3600 + parseInt(dm[2])*60 + parseFloat(dm[3]) : 30;
    const width    = vm ? parseInt(vm[1]) : 1080;
    const height   = vm ? parseInt(vm[2]) : 1920;
    return { duration, width, height };
  } catch {
    return { duration: 30, width: 1080, height: 1920 };
  }
}

// ── Cover frame extraction ────────────────────────────────────────────────────

function extractCoverFrame(videoPath) {
  const ffmpeg  = getFfmpegPath();
  const outPath = path.join(os.tmpdir(), 'ig_webcover_' + Date.now() + '.jpg');
  try {
    try {
      execSync('"' + ffmpeg + '" -i "' + videoPath + '" -ss 00:00:00.500 -vframes 1 -q:v 2 -vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920 "' + outPath + '" -y', { stdio: 'pipe' });
    } catch {
      execSync('"' + ffmpeg + '" -i "' + videoPath + '" -vframes 1 -q:v 2 "' + outPath + '" -y', { stdio: 'pipe' });
    }
    return fs.readFileSync(outPath);
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
}

// ── Upload video ──────────────────────────────────────────────────────────────

async function uploadVideo(videoPath, baseHeaders, uploadId, numReupload, coverUploadId) {
  numReupload = numReupload || 0;
  const videoBuffer = fs.readFileSync(videoPath);
  const fileSize    = videoBuffer.length;
  const uploadName  = uploadId + '_0_-' + Math.floor(Math.random() * 9e9);
  const info        = getVideoInfo(videoPath);
  const { duration, width, height } = info;

  if (numReupload === 0) console.log('[WebAPI] Video: ' + width + 'x' + height + ', ' + duration.toFixed(1) + 's, ' + (fileSize/1024/1024).toFixed(1) + ' MB');

  const retryContext = JSON.stringify({ num_step_auto_retry: 0, num_reupload: numReupload, num_step_manual_retry: 0 });
  const ruploadParamsObj = {
    upload_id:                uploadId,
    media_type:               2,
    upload_media_height:      height,
    upload_media_width:       width,
    upload_media_duration_ms: Math.floor(duration * 1000),
    for_direct_story:         false,
    for_clips:                true,
    content_tags:             '',
    is_sidecar:               false,
    video_format:             '',
    retry_context:            retryContext,
  };
  // Referencia o cover no upload do vídeo — Instagram exige isso para Reels
  if (coverUploadId) ruploadParamsObj.clips_cover_photo_upload_id = coverUploadId;
  const ruploadParams = JSON.stringify(ruploadParamsObj);

  const uploadUrl     = IG_BASE + '/rupload_igvideo/' + uploadName;
  const uploadHeaders = Object.assign({}, baseHeaders, {
    'X-Instagram-Rupload-Params': ruploadParams,
    'X-Entity-Name':   uploadName,
    'X-Entity-Type':   'video/mp4',
    'X-Entity-Length': String(fileSize),
    'Offset':          '0',
  });

  // Init
  if (numReupload === 0) console.log('[WebAPI] Inicializando upload do video...');
  else                   console.log('[WebAPI] Re-upload ' + numReupload + '...');
  const initRes  = await fetch(uploadUrl, { method: 'POST', headers: Object.assign({}, uploadHeaders, { 'Content-Length': '0' }), body: Buffer.alloc(0) });
  const initText = await initRes.text();
  console.log('   Init: ' + initRes.status + ' - ' + initText.slice(0, 80));
  if (!initRes.ok && !initText.includes('upload already exist')) {
    throw new Error('[WebAPI] Init video falhou (' + initRes.status + '): ' + initText.slice(0, 200));
  }

  // Upload bytes
  const uploadRes  = await fetch(uploadUrl, {
    method: 'POST',
    headers: Object.assign({}, uploadHeaders, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize) }),
    body: videoBuffer,
  });
  const uploadText = await uploadRes.text();
  console.log('   Upload: ' + uploadRes.status + ' - ' + uploadText.slice(0, 80));
  if (!uploadRes.ok) throw new Error('[WebAPI] Upload video falhou (' + uploadRes.status + '): ' + uploadText.slice(0, 200));

  return { uploadId, duration };
}

// ── Upload cover photo ────────────────────────────────────────────────────────

async function uploadCoverPhoto(videoPath, baseHeaders) {
  let imageBuffer;
  try {
    imageBuffer = extractCoverFrame(videoPath);
    console.log('[WebAPI] Frame extraido: ' + (imageBuffer.length/1024).toFixed(0) + ' KB');
  } catch (e) {
    console.log('[WebAPI] Nao foi possivel extrair frame: ' + e.message);
    return null;
  }

  const coverUploadId = String(Date.now() + 1);
  const coverName     = coverUploadId + '_0_-' + Math.floor(Math.random() * 9e9);
  const fileSize      = imageBuffer.length;

  const ruploadParams = JSON.stringify({
    upload_id:         coverUploadId,
    media_type:        '1',
    image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.3.17', quality: '80' }),
  });

  const coverUrl     = IG_BASE + '/rupload_igphoto/' + coverName;
  const coverHeaders = Object.assign({}, baseHeaders, {
    'X-Instagram-Rupload-Params': ruploadParams,
    'X-Entity-Name':   coverName,
    'X-Entity-Type':   'image/jpeg',
    'X-Entity-Length': String(fileSize),
    'Offset':          '0',
  });

  // Step 1: Init (igual ao video)
  console.log('[WebAPI] Init upload da capa...');
  const initRes  = await fetch(coverUrl, { method: 'POST', headers: Object.assign({}, coverHeaders, { 'Content-Length': '0' }), body: Buffer.alloc(0) });
  const initText = await initRes.text();
  console.log('   Cover init: ' + initRes.status + ' - ' + initText.slice(0, 80));

  // Step 2: Upload bytes
  console.log('[WebAPI] Upload bytes da capa...');
  const res  = await fetch(coverUrl, {
    method: 'POST',
    headers: Object.assign({}, coverHeaders, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize) }),
    body: imageBuffer,
  });
  const text = await res.text();
  console.log('   Cover bytes: ' + res.status + ' - ' + text.slice(0, 120));

  if (!res.ok) {
    console.log('[WebAPI] Cover upload falhou - continuando sem capa');
    return null;
  }
  return coverUploadId;
}

// ── Configure (publish) ───────────────────────────────────────────────────────

async function configureReel(uploadId, coverUploadId, duration, caption, baseHeaders, dsUserId) {
  const sessionId = require('crypto').randomUUID();

  const params = new URLSearchParams();
  params.set('upload_id',                     uploadId);
  params.set('caption',                       caption || '');
  params.set('source_type',                   '4');
  params.set('product_type',                  'clips');
  params.set('clips_share_preview_to_feed',   '1');
  params.set('clips',                         JSON.stringify([{ length: duration, source_type: '4' }]));
  params.set('like_and_view_counts_disabled', '0');
  params.set('disable_comments',              '0');
  params.set('creation_logger_session_id',    sessionId);

  // Cover: só inclui se tiver um upload de FOTO real (não usar o ID do vídeo)
  if (coverUploadId) {
    params.set('clips_cover_photo_upload_id', coverUploadId);
  } else {
    // Sem cover: usa frame do vídeo por tempo (poster_frame_time_ms)
    params.set('poster_frame_time_ms', '1000');
  }

  if (dsUserId) {
    params.set('_uid',       dsUserId);
    params.set('_uuid',      sessionId);
    params.set('_csrftoken', baseHeaders['X-CSRFToken'] || '');
  }

  await delay(8000);

  console.log('[WebAPI] Publicando Reel... (cover=' + (coverUploadId || 'frame') + ')');

  const res  = await fetch(IG_BASE + '/api/v1/media/configure_to_clips/', {
    method: 'POST',
    headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: params.toString(),
  });
  const text = await res.text();
  console.log('[WebAPI] configure_to_clips (' + res.status + '): ' + text.slice(0, 400));

  if (!res.ok) throw new Error('[WebAPI] configure_to_clips HTTP ' + res.status);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('[WebAPI] Resposta inválida: ' + text.slice(0, 100)); }

  const mediaId = data.media && (data.media.pk || data.media.id);
  if (mediaId && String(mediaId) !== uploadId) {
    console.log('[WebAPI] ✅ REEL PUBLICADO! ID: ' + mediaId);
    return mediaId;
  }
  if (data.status === 'ok' && !data.message) {
    console.log('[WebAPI] ✅ REEL PUBLICADO!');
    return uploadId;
  }

  const errMsg = data.message || data.error_title || data.status || '';
  if (errMsg === 'media_needs_reupload') throw new Error('media_needs_reupload');
  throw new Error('[WebAPI] configure_to_clips: ' + errMsg + ' (error_id=' + (data.error_id || '?') + ')');
}

// ── Busca X-IG-WWW-Claim ─────────────────────────────────────────────────────
// Instagram exige este token em chamadas de escrita (configure_to_clips etc).
// Ele é retornado como header x-ig-set-www-claim em qualquer request autenticado.

async function fetchWwwClaim(cookieStr, userAgent) {
  try {
    const res = await fetch('https://www.instagram.com/', {
      headers: {
        'Cookie':          cookieStr,
        'User-Agent':      userAgent,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
    const claim = res.headers.get('x-ig-set-www-claim');
    console.log('[WebAPI] X-IG-WWW-Claim: ' + (claim ? claim.slice(0, 30) + '...' : 'não retornado (usando 0)'));
    return claim || '0';
  } catch (e) {
    console.log('[WebAPI] fetchWwwClaim erro: ' + e.message);
    return '0';
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

async function postReelWeb(account, post) {
  const rawCookies = JSON.parse(fs.readFileSync(
    path.join(SESSIONS_ROOT, account.username, 'cookies.json'), 'utf8'
  ));
  const get = name => rawCookies.find(c => (c.name || c.key) === name)?.value || '';

  const csrfToken = get('csrftoken');
  const dsUserId  = get('ds_user_id');
  const mid       = get('mid');
  const cookieStr = rawCookies
    .filter(c => (c.domain || '').includes('instagram.com'))
    .map(c => (c.name || c.key) + '=' + c.value)
    .join('; ');

  const rawPath   = path.resolve(__dirname, '../../uploads', post.media);
  console.log('[WebAPI] @' + account.username + ' - convertendo video...');
  const videoPath = await convertToReelFormat(rawPath);
  console.log('[WebAPI] Convertido: ' + path.basename(videoPath));

  const uploadId  = Date.now().toString();
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Busca X-IG-WWW-Claim — Instagram exige este token em chamadas de escrita
  const wwwClaim = await fetchWwwClaim(cookieStr, userAgent);

  const baseHeaders = {
    'User-Agent':        userAgent,
    'Accept':            '*/*',
    'Accept-Language':   'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept-Encoding':   'gzip, deflate, br',
    'Cookie':            cookieStr,
    'X-CSRFToken':       csrfToken || '',
    'X-IG-App-ID':       '936619743392459',
    'X-Instagram-AJAX':  '1',
    'X-Requested-With':  'XMLHttpRequest',
    'X-MID':             mid || '',
    'X-IG-WWW-Claim':    wwwClaim,
    'Referer':           'https://www.instagram.com/reels/create/',
    'Origin':            'https://www.instagram.com',
    'Sec-Fetch-Site':    'same-origin',
    'Sec-Fetch-Mode':    'cors',
    'Sec-Fetch-Dest':    'empty',
    'sec-ch-ua':         '"Chromium";v="124", "Google Chrome";v="124"',
    'sec-ch-ua-mobile':  '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

  // Ordem correta: cover primeiro → vídeo referenciando cover → configure
  // Instagram exige que o rupload do vídeo já referencie o cover photo upload ID

  // 1. Upload cover photo (extrai frame do vídeo e envia como imagem)
  console.log('[WebAPI] Fazendo upload do cover antes do vídeo...');
  const coverUploadId = await uploadCoverPhoto(videoPath, baseHeaders);
  if (coverUploadId) {
    console.log('[WebAPI] Cover OK: ' + coverUploadId);
  } else {
    console.log('[WebAPI] Cover falhou — tentando sem cover');
  }

  // 2. Upload vídeo com cover ID referenciado nos params
  let duration;
  ({ duration } = await uploadVideo(videoPath, baseHeaders, uploadId, 0, coverUploadId));

  // 3. Aguarda Instagram processar o vídeo
  await delay(5000);

  // 4. Configure — com cover se disponível
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) {
      console.log('[WebAPI] media_needs_reupload — re-enviando (tentativa ' + attempt + ')...');
      await delay(5000);
      ({ duration } = await uploadVideo(videoPath, baseHeaders, uploadId, attempt, coverUploadId));
      await delay(3000);
    }
    try {
      const mediaId = await configureReel(uploadId, coverUploadId, duration, post.caption, baseHeaders, dsUserId);
      return mediaId;
    } catch (e) {
      if (attempt < 2 && e.message === 'media_needs_reupload') continue;
      throw e;
    }
  }

  throw new Error('[WebAPI] configure_to_clips falhou após 3 tentativas.');
}

module.exports = { postReelWeb };

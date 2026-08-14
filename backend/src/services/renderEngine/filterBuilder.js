'use strict';
const fs = require('fs');

// Detect a usable font file at startup (cached once)
function detectFont() {
  const candidates = [
    process.env.VIDEO_RENDER_FONT,
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/Liberation_Sans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
  ].filter(Boolean);

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

const DETECTED_FONT = detectFont();

function escapeText(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g,  "\\'")
    .replace(/:/g,  '\\:')
    .replace(/%/g,  '%%');
}

function resolveVars(str, vars) {
  if (!str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? vars[name] : ''));
}

function bgToFFmpeg(hex) {
  return '0x' + (hex || '#000000').replace(/^#/, '').toUpperCase().padEnd(6, '0');
}

function buildMainVideoScale(fit, W, H, bgHex) {
  const bg = bgToFFmpeg(bgHex);
  switch (fit) {
    case 'contain':
      return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}`;
    case 'stretch':
      return `scale=${W}:${H}`;
    case 'blur':
      return null; // handled with split
    case 'cover':
    default:
      return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  }
}

/**
 * Build FFmpeg inputs + filter_complex from a template + resolved variable map.
 *
 * resolvedVars format: { VIDEO: '/path/video.mp4', LOGO: '/path/logo.png', TITLE: 'text', ... }
 *
 * Returns { inputs, filterComplex, videoMap, audioMap }
 */
function buildFilterComplex(template, resolvedVars) {
  const { canvas = {}, elements = [], audio = {} } = template;
  const W = canvas.width  || 1080;
  const H = canvas.height || 1920;
  const bgHex = canvas.background || '#000000';

  const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const videoEl = sorted.find(el => el.type === 'video') || { fit: 'cover' };
  const imageEls = sorted.filter(el => el.type === 'image');
  const textEls  = sorted.filter(el => el.type === 'text');

  const mainVideoPath = resolvedVars['VIDEO'] || '';
  const inputs = [mainVideoPath];
  const filters = [];
  let inputIdx = 1;
  let curLabel = 'base';

  // ── Template PNG mode (fundo PNG + janela de vídeo posicionável) ─────────────
  const tplPng    = template.templatePng;
  const tplEnabled = tplPng?.enabled && Array.isArray(tplPng.templates) && tplPng.templates.length > 0;

  if (tplEnabled) {
    const tplDef  = tplPng.templates[0]; // índice 0 por padrão; rotação pode ser adicionada futuramente
    const tplPath = tplDef.serverPath;

    if (tplPath && fs.existsSync(tplPath)) {
      inputs.push(tplPath);
      const tplIdx = inputIdx++;

      const vW  = Math.max(10, Math.round(tplPng.videoW || W * 0.5));
      const vH  = Math.max(10, Math.round(tplPng.videoH || H * 0.5));
      const vX  = Math.round(tplPng.videoX || 0);
      const vY  = Math.round(tplPng.videoY || 0);
      const fit = (tplPng.videoFit && tplPng.videoFit !== 'blur') ? tplPng.videoFit : (videoEl.fit !== 'blur' ? videoEl.fit : 'cover');

      const winScale = buildMainVideoScale(fit, vW, vH, bgHex);
      filters.push(`[0:v]${winScale}[vid_win]`);
      filters.push(`[${tplIdx}:v]scale=${W}:${H}[tmpl_base]`);
      filters.push(`[tmpl_base][vid_win]overlay=x=${vX}:y=${vY}[base]`);
    } else {
      // PNG ausente — renderiza sem template (fallback seguro)
      console.warn(`[filterBuilder] Template PNG não encontrado: ${tplPath}`);
      if (videoEl.fit === 'blur') {
        filters.push(`[0:v]split[raw1][raw2]`);
        filters.push(`[raw1]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20[bg]`);
        filters.push(`[raw2]scale=-2:${H}[fg]`);
        filters.push(`[bg][fg]overlay=x=(main_w-overlay_w)/2:y=0[base]`);
      } else {
        filters.push(`[0:v]${buildMainVideoScale(videoEl.fit, W, H, bgHex)}[base]`);
      }
    }

  // ── Main video fit (modo normal) ─────────────────────────────────────────────
  } else if (videoEl.fit === 'blur') {
    filters.push(`[0:v]split[raw1][raw2]`);
    filters.push(`[raw1]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20[bg]`);
    filters.push(`[raw2]scale=-2:${H}[fg]`);
    filters.push(`[bg][fg]overlay=x=(main_w-overlay_w)/2:y=0[base]`);
  } else {
    const mainScale = buildMainVideoScale(videoEl.fit, W, H, bgHex);
    filters.push(`[0:v]${mainScale}[base]`);
  }

  // ── Image overlays ───────────────────────────────────────────────
  for (let i = 0; i < imageEls.length; i++) {
    const el = imageEls[i];
    const src = resolveVars(el.source || '', resolvedVars);
    if (!src || src.includes('{{')) continue; // unresolved variable → skip

    inputs.push(src);
    const idx   = inputIdx++;
    const iLabel = `oi${i}`;
    const nLabel = `vi${i}`;

    const iW = Math.round(el.width  || 120);
    const iH = el.height ? Math.round(el.height) : -1;
    const scaleExpr = iH > 0 ? `scale=${iW}:${iH}` : `scale=${iW}:-2`;
    filters.push(`[${idx}:v]${scaleExpr}[${iLabel}]`);

    const x = Math.round(el.x || 0);
    const y = Math.round(el.y || 0);
    let timeStr = '';
    if (el.startTime || el.endTime) {
      timeStr = `:enable='between(t,${el.startTime || 0},${el.endTime || 999999})'`;
    }

    filters.push(`[${curLabel}][${iLabel}]overlay=x=${x}:y=${y}${timeStr}[${nLabel}]`);
    curLabel = nLabel;
  }

  // ── Text overlays (drawtext) ─────────────────────────────────────
  if (!DETECTED_FONT && textEls.length > 0) {
    console.warn('[filterBuilder] Nenhuma fonte detectada — elementos de texto ignorados. Defina VIDEO_RENDER_FONT.');
  }

  if (DETECTED_FONT) {
    for (let i = 0; i < textEls.length; i++) {
      const el = textEls[i];
      const rawText = resolveVars(el.text || '', resolvedVars);
      if (!rawText) continue;

      const nLabel    = `vt${i}`;
      const fontPath  = DETECTED_FONT.replace(/\\/g, '/');
      const fontsize  = Math.round(el.fontSize || 48);
      const fontcolor = '0x' + (el.color || '#FFFFFF').replace(/^#/, '').toUpperCase();
      const x = Math.round(el.x || 0);
      const y = Math.round(el.y || 0);

      const opts = [
        `fontfile='${fontPath}'`,
        `text=${escapeText(rawText)}`,
        `x=${x}`,
        `y=${y}`,
        `fontsize=${fontsize}`,
        `fontcolor=${fontcolor}`,
      ];

      if (el.bgColor) {
        opts.push(`box=1`);
        opts.push(`boxcolor=${'0x' + el.bgColor.replace(/^#/, '').toUpperCase()}@0.6`);
        opts.push(`boxborderw=8`);
      }

      if (el.startTime || el.endTime) {
        opts.push(`enable='between(t,${el.startTime || 0},${el.endTime || 999999})'`);
      }

      filters.push(`[${curLabel}]drawtext=${opts.join(':')}[${nLabel}]`);
      curLabel = nLabel;
    }
  }

  // ── Audio ────────────────────────────────────────────────────────
  let audioMap = '0:a?';
  const musicSrc = audio.musicTrack ? resolveVars(audio.musicTrack, resolvedVars) : '';
  const hasMusicFile = musicSrc && !musicSrc.includes('{{') && fs.existsSync(musicSrc);

  if (hasMusicFile) {
    inputs.push(musicSrc);
    const mIdx   = inputIdx++;
    const origVol = audio.originalVolume ?? 1.0;
    const musVol  = audio.musicVolume  ?? 0.3;
    filters.push(`[0:a]volume=${origVol}[ao0]`);
    filters.push(`[${mIdx}:a]volume=${musVol}[ao1]`);
    filters.push(`[ao0][ao1]amix=inputs=2:normalize=0[a_out]`);
    audioMap = '[a_out]';
  }

  // ── Border (drawbox) ─────────────────────────────────────────────
  const border = template.border;
  if (border?.enabled && (border.thickness || 0) > 0) {
    const thick = Math.max(1, Math.round(border.thickness || 4));
    const col   = bgToFFmpeg(border.color || '#FFFFFF');
    const alpha = Math.min(1, Math.max(0, border.opacity ?? 1)).toFixed(2);
    filters.push(`[${curLabel}]drawbox=x=0:y=0:w=iw:h=ih:color=${col}@${alpha}:t=${thick}[brd]`);
    curLabel = 'brd';
  }

  return {
    inputs,
    filterComplex: filters.join(';'),
    videoMap: `[${curLabel}]`,
    audioMap,
    hasOriginalAudio: audio.keepOriginal !== false,
  };
}

module.exports = { buildFilterComplex, DETECTED_FONT };

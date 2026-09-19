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
/**
 * Cadeia de ajuste de imagem, a partir dos valores -100..100 da interface.
 *
 * Cada filtro do ffmpeg tem uma escala própria e nada intuitiva: `eq` usa
 * brilho em [-1,1] mas contraste e saturação em torno de 1.0, `unsharp` usa
 * intensidade, `noise` usa 0..100 numa curva diferente. Traduzir aqui deixa a
 * tela com um único vocabulário (-100 a 100, 0 = sem alteração) e concentra a
 * conversão num lugar só.
 *
 * As faixas são deliberadamente conservadoras — ±0.3 de brilho, ±0.5 de
 * contraste. Um slider no máximo precisa entregar um vídeo publicável, não um
 * vídeo destruído.
 *
 * @param {Object}   ajustes
 * @param {number}   W
 * @param {number}   H
 * @param {Function} rand  injetável para o teste ser determinístico
 * @returns {string} cadeia pronta para concatenar, ou '' quando não há ajuste
 */
function buildAjustes(ajustes = {}, W = 1080, H = 1920, rand = Math.random) {
  if (!ajustes.enabled) return '';

  const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

  let brilho    = num(ajustes.brilho,    -100, 100) / 100;
  let contraste = num(ajustes.contraste, -100, 100) / 100;
  let saturacao = num(ajustes.saturacao, -100, 100) / 100;
  let zoom      = num(ajustes.zoom,         0, 100) / 100;
  const nitidez = num(ajustes.nitidez,      0, 100) / 100;
  const ruido   = num(ajustes.ruido,        0, 100) / 100;

  // Quebra de hash: variação minúscula e aleatória A CADA render. Sozinha ela é
  // imperceptível — o objetivo não é mudar o visual, é garantir que dois envios
  // do mesmo arquivo não produzam bytes idênticos.
  if (ajustes.quebrarHash) {
    brilho    += (rand() - 0.5) * 0.02;
    contraste += (rand() - 0.5) * 0.02;
    saturacao += (rand() - 0.5) * 0.02;
    zoom      = Math.max(zoom, 0.004 + rand() * 0.006);
  }

  const partes = [];

  // Zoom antes da cor: cortar depois de ajustar desperdiçaria processamento em
  // pixels que serão descartados.
  if (zoom > 0) {
    const fator = 1 - Math.min(0.2, zoom * 0.10);
    partes.push(`crop=iw*${fator.toFixed(4)}:ih*${fator.toFixed(4)}`);
    partes.push(`scale=${W}:${H}`);
  }

  if (ajustes.espelhar) partes.push('hflip');

  const b = brilho * 0.3;                 // eq: -1..1, neutro 0
  const c = 1 + contraste * 0.5;          // eq: 0..3,  neutro 1
  const s = 1 + saturacao * 0.6;          // eq: 0..3,  neutro 1
  if (Math.abs(b) > 0.0005 || Math.abs(c - 1) > 0.0005 || Math.abs(s - 1) > 0.0005) {
    partes.push(`eq=brightness=${b.toFixed(4)}:contrast=${c.toFixed(4)}:saturation=${s.toFixed(4)}`);
  }

  if (nitidez > 0) {
    partes.push(`unsharp=5:5:${(nitidez * 1.5).toFixed(3)}:5:5:0`);
  }

  if (ruido > 0) {
    // `allf=t+u`: temporal e uniforme — grão que muda a cada quadro, como o de
    // câmera. Ruído fixo aparece como sujeira parada na imagem.
    partes.push(`noise=alls=${Math.round(ruido * 20)}:allf=t+u`);
  }

  return partes.join(',');
}

/**
 * Voz alterada — EXPERIMENTAL.
 *
 * Pitch e velocidade da fala original, para testar se o casamento por áudio
 * do Instagram baixa do limiar. É uma aposta declarada: fingerprint de áudio
 * foi feito para atravessar ruído, EQ e pequenas variações de velocidade, e
 * ninguém fora do Meta sabe o limiar. O que dá para dizer é o que a técnica
 * tolera pouco — deslocamento de pitch e de tempo juntos — e é isso que este
 * bloco mexe. Quem decide se funcionou é o alcance, uma semana depois.
 *
 * Como funciona no ffmpeg (não há filtro "pitch" nativo sem rubberband):
 *
 *   aresample=44100         normaliza a taxa — sem isto, `asetrate` numa
 *                           entrada de 48 kHz deslocaria o pitch errado
 *   asetrate=44100*p        toca as amostras mais rápido/devagar: pitch × p
 *                           E duração × 1/p
 *   aresample=44100         volta à taxa de saída
 *   atempo=t/p              compensa a duração: sobra pitch × p e duração × 1/t
 *
 * O vídeo recebe `setpts=PTS/t` para acompanhar — senão a fala termina antes
 * (ou depois) da imagem. Pitch sozinho não mexe no vídeo.
 *
 * Limites: pitch ±20 % e velocidade −20..+30 % — além disso a voz não é mais
 * uma pessoa, e `atempo` fica dentro da faixa que o ffmpeg aceita.
 */
const VOZ_PITCH_MAX = 20;
const VOZ_VEL_MIN = -20;
const VOZ_VEL_MAX = 30;

function buildVoz(voz) {
  if (!voz || voz.enabled !== true) return { ativo: false, p: 1, t: 1, filtroAudio: '', filtroVideo: '' };
  const lim = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
  const pitchPct = lim(voz.pitch, -VOZ_PITCH_MAX, VOZ_PITCH_MAX);
  const velPct   = lim(voz.velocidade, VOZ_VEL_MIN, VOZ_VEL_MAX);
  const p = 1 + pitchPct / 100;
  const t = 1 + velPct / 100;
  if (p === 1 && t === 1) return { ativo: false, p, t, filtroAudio: '', filtroVideo: '' };

  const partes = ['aresample=44100'];
  if (p !== 1) partes.push(`asetrate=${Math.round(44100 * p)}`, 'aresample=44100');
  const k = t / p;
  if (Math.abs(k - 1) > 1e-4) partes.push(`atempo=${k.toFixed(4)}`);

  return {
    ativo: true, p, t,
    filtroAudio: partes.join(','),
    filtroVideo: t !== 1 ? `setpts=PTS/${t.toFixed(4)}` : '',
  };
}

function buildFilterComplex(template, resolvedVars, { rand = Math.random } = {}) {
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
  let cortarNoMaisCurto = false;

  /* Voz alterada (experimental): o áudio ORIGINAL passa por pitch/tempo antes
     de qualquer mistura. Com a voz ligada o áudio deixa de ser opcional
     (`0:a?`) — um filtro precisa da faixa existir. Vídeo sem áudio com voz
     ligada falha alto em vez de sair mudo em silêncio; é o certo para um
     preset que só faz sentido em vídeo com fala. */
  const voz = buildVoz(template.voz);
  let origemAudio = '0:a';
  if (voz.ativo && audio.keepOriginal !== false) {
    filters.push(`[0:a]${voz.filtroAudio}[a_voz]`);
    origemAudio = 'a_voz';
    audioMap = '[a_voz]';
  }
  const musicSrc = audio.musicTrack ? resolveVars(audio.musicTrack, resolvedVars) : '';
  const hasMusicFile = Boolean(musicSrc && !musicSrc.includes('{{') && fs.existsSync(musicSrc));

  /* Trilha configurada que não está no disco: o render seguia mudo e o vídeo
     saía sem a 2ª camada sem ninguém entender por quê. Não é para falhar — um
     caminho errado não vale perder o lote inteiro —, mas tem que ir para o log. */
  if (musicSrc && !musicSrc.includes('{{') && !hasMusicFile) {
    console.warn(`⚠️ [Render] trilha não encontrada, vídeo sai sem 2ª camada: ${musicSrc}`);
  }

  if (hasMusicFile) {
    inputs.push(musicSrc);
    const mIdx   = inputIdx++;
    const origVol = audio.originalVolume ?? 1.0;
    const musVol  = audio.musicVolume  ?? 0.3;

    if (audio.keepOriginal === false) {
      /* SUBSTITUIR, não misturar: só a trilha vai para a saída. Antes,
         `keepOriginal: false` virava `-an` no comando e descartava TUDO — o
         vídeo saía mudo mesmo com trilha escolhida, que é o oposto do que a
         caixa desmarcada + trilha quer dizer.

         `apad` estende a trilha com silêncio para além do fim dela, e o
         `-shortest` (ver `cortarNoMaisCurto`) corta a saída no fim do VÍDEO:
         trilha curta completa com silêncio, trilha longa é cortada. Sem os
         dois, uma música de 3 min faria o arquivo ter 3 min. */
      filters.push(`[${mIdx}:a]volume=${musVol},apad[a_out]`);
      cortarNoMaisCurto = true;
    } else {
      filters.push(`[${origemAudio}]volume=${origVol}[ao0]`);
      filters.push(`[${mIdx}:a]volume=${musVol}[ao1]`);
      /* duration=first: sem isto o amix usa "longest", e uma música de 3 min num
         vídeo de 15s gera um arquivo de 3 min — vídeo congelado e trilha tocando
         sozinha. "first" é o áudio original, ou seja, a duração do vídeo. Música
         mais curta que o vídeo completa com silêncio, que é o comportamento certo. */
      filters.push(`[ao0][ao1]amix=inputs=2:duration=first:normalize=0[a_out]`);
    }
    audioMap = '[a_out]';
  }

  // ── Ajuste de imagem ─────────────────────────────────────────────
  //
  // Entra depois da composição e ANTES da borda: brilho e contraste devem valer
  // para o quadro inteiro (vídeo, imagens e textos sobrepostos), mas a borda é
  // moldura — escurecer ou saturar a moldura junto seria efeito colateral.
  const cadeiaAjustes = buildAjustes(template.ajustes, W, H, rand);
  if (cadeiaAjustes) {
    filters.push(`[${curLabel}]${cadeiaAjustes}[ajus]`);
    curLabel = 'ajus';
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

  // ── Velocidade (voz alterada) ────────────────────────────────────────
  // Por último: acompanha o atempo do áudio para a fala não descolar da
  // imagem. Depois do drawtext, então o "3s" do gancho vira ~2,8s a +7 % —
  // desprezível, e mantém a regra simples: acelera o vídeo inteiro.
  if (voz.filtroVideo) {
    filters.push(`[${curLabel}]${voz.filtroVideo}[vel]`);
    curLabel = 'vel';
  }

  return {
    inputs,
    filterComplex: filters.join(';'),
    videoMap: `[${curLabel}]`,
    audioMap,
    /* A saída tem faixa de áudio? Original mantido, OU trilha substituindo.
       Era `keepOriginal !== false` sozinho — e por isso trilha-sem-original
       virava vídeo mudo. */
    temAudio: audio.keepOriginal !== false || hasMusicFile,
    cortarNoMaisCurto,
  };
}

module.exports = { buildFilterComplex, buildAjustes, buildVoz, DETECTED_FONT, VOZ_PITCH_MAX, VOZ_VEL_MIN, VOZ_VEL_MAX };

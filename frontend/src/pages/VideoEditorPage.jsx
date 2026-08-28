import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Toast from '../components/Toast';

// ── Constants ─────────────────────────────────────────────────────────────────
const ITEM_H = 72;

const DEFAULT_TMPL = {
  name: '',
  canvas:      { width: 1080, height: 1920, fps: 30, background: '#000000' },
  output:      { crf: 20, preset: 'medium', removeMetadata: true },
  elements:    [{ id: 'vid0', type: 'video', source: '{{VIDEO}}', fit: 'cover', label: 'Vídeo', zIndex: 0, x: 0, y: 0, width: 0, height: 0 }],
  audio:       { keepOriginal: true, originalVolume: 1.0, musicTrack: '', musicVolume: 0.3 },
  border:      { enabled: false, thickness: 4, color: 'var(--mf-text)', opacity: 1.0 },
  ajustes:     { enabled: false, brilho: 0, contraste: 0, saturacao: 0, nitidez: 0, ruido: 0, zoom: 0, espelhar: false, quebrarHash: false },
  trim:        { startTime: 0, endTime: null },
  templatePng: { enabled: false, templates: [], videoX: 0, videoY: 0, videoW: 540, videoH: 960, videoFit: 'cover' },
};

const QUALITY_OPTS = [
  { id: '720p',     label: '720p — Rápido',         crf: 26, preset: 'fast'   },
  { id: '1080p',    label: '1080p — Balanceado',     crf: 20, preset: 'medium' },
  { id: '1440p',    label: '1440p — Alta qualidade', crf: 16, preset: 'slow'   },
  { id: 'original', label: 'Original — Máxima',      crf: 18, preset: 'medium' },
];

const FIT_OPTS = [
  { id: 'cover',   label: 'Preencher (Cover)',   desc: 'Corta a sobra para preencher o canvas' },
  { id: 'contain', label: 'Conter (Contain)',    desc: 'Todo o vídeo visível, adiciona barras' },
  { id: 'blur',    label: 'Blur Inteligente',    desc: 'Fundo borrado + vídeo centralizado'   },
  { id: 'stretch', label: 'Esticar (Stretch)',   desc: 'Deforma o vídeo para preencher'       },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function fmtSize(b) {
  if (!b) return '';
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function fmtDur(s) {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function batchQuality(crf) {
  if (crf >= 26) return 'fast';
  if (crf >= 20) return 'balanced';
  return 'high';
}

function extractVars(elements) {
  const found = new Map();
  for (const el of (elements || [])) {
    for (const t of [el.source, el.text].filter(Boolean)) {
      for (const [, name] of t.matchAll(/\{\{(\w+)\}\}/g)) {
        if (!found.has(name)) found.set(name, {
          name, label: name,
          type: el.type === 'video' ? 'video' : el.type === 'image' ? 'image' : 'text',
          required: el.type === 'video', defaultValue: '',
        });
      }
    }
  }
  return [...found.values()];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FileThumbnail({ fileItem, cache }) {
  const [src, setSrc] = useState(() => cache.get(fileItem.id) || null);
  useEffect(() => {
    if (src || cache.has(fileItem.id)) {
      if (!src && cache.has(fileItem.id)) setSrc(cache.get(fileItem.id));
      return;
    }
    const url = URL.createObjectURL(fileItem.file);
    const vid = document.createElement('video');
    vid.muted = true; vid.preload = 'metadata'; vid.src = url;
    vid.addEventListener('loadedmetadata', () => { vid.currentTime = Math.min(1, (vid.duration || 2) * 0.1); });
    vid.addEventListener('seeked', () => {
      try {
        const c = document.createElement('canvas'); c.width = 90; c.height = 54;
        c.getContext('2d').drawImage(vid, 0, 0, 90, 54);
        const d = c.toDataURL('image/jpeg', 0.55);
        cache.set(fileItem.id, d); setSrc(d);
      } catch {}
      URL.revokeObjectURL(url);
    });
    vid.addEventListener('error', () => URL.revokeObjectURL(url));
  }, [fileItem.id]);

  if (!src) return <div style={{ width: 60, height: 34, borderRadius: 'var(--mf-r-xs)', background: 'var(--mf-border)', flexShrink: 0 }} />;
  return <img src={src} alt="" style={{ width: 60, height: 34, objectFit: 'cover', borderRadius: 'var(--mf-r-xs)', flexShrink: 0 }} />;
}

function Acc({ title, id, open, toggle, children, count }) {
  return (
    <div style={{ borderBottom: '1px solid var(--mf-border-subtle)' }}>
      <button onClick={() => toggle(id)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 7,
        padding: '9px 14px', background: 'none', border: 'none',
        color: open ? 'var(--mf-text)' : 'var(--mf-text-2)', cursor: 'pointer',
        transition: 'color .14s', textAlign: 'left',
      }}>
        <svg width="8" height="8" viewBox="0 0 8 8" style={{ transition: 'transform .17s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>
          <polygon points="0,0 8,4 0,8" fill="currentColor" opacity="0.55" />
        </svg>
        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, fontFamily: 'var(--mf-mono)', textTransform: 'uppercase', letterSpacing: '.07em', flex: 1 }}>{title}</span>
        {count != null && <span style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', background: 'var(--mf-border)', borderRadius: 'var(--mf-r-xl)', padding: '1px 6px' }}>{count}</span>}
      </button>
      {open && <div style={{ padding: '2px 14px 14px' }}>{children}</div>}
    </div>
  );
}

function Fld({ label, children, span2 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: span2 ? 'span 2' : undefined }}>
      <label style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 600, fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>
      {children}
    </div>
  );
}

function CanvasPreview({ tmpl, previewUrl, onVideoWindowChange }) {
  const W = tmpl.canvas?.width  || 1080;
  const H = tmpl.canvas?.height || 1920;
  const maxH = 520, maxW = 320;
  const scale = Math.min(maxW / W, maxH / H);
  const PW = Math.round(W * scale);
  const PH = Math.round(H * scale);

  const videoEl  = tmpl.elements?.find(el => el.type === 'video') || { fit: 'cover' };
  const imageEls = tmpl.elements?.filter(el => el.type === 'image') || [];
  const textEls  = tmpl.elements?.filter(el => el.type === 'text')  || [];

  const tplPng     = tmpl.templatePng;
  const tplEnabled = tplPng?.enabled && (tplPng?.templates || []).length > 0;
  const firstTpl   = tplEnabled ? tplPng.templates[0] : null;

  // Constrói URL completa do PNG para exibição no browser
  const tplImgSrc = firstTpl
    ? (firstTpl.url?.startsWith('http')
        ? firstTpl.url
        : `${api.defaults.baseURL.replace(/\/$/, '')}${firstTpl.url}`)
    : null;

  // Posição e tamanho da janela do vídeo dentro do template (em pixels do canvas)
  const vX = Math.round(tplPng?.videoX ?? 0);
  const vY = Math.round(tplPng?.videoY ?? 0);
  const vW = Math.round(tplPng?.videoW ?? Math.round(W * 0.5));
  const vH = Math.round(tplPng?.videoH ?? Math.round(H * 0.5));

  // Em pixels da prévia (escalonados)
  const pvX = Math.round(vX * scale);
  const pvY = Math.round(vY * scale);
  const pvW = Math.round(vW * scale);
  const pvH = Math.round(vH * scale);

  const dragRef = useRef(null);

  const startDrag = useCallback((e, mode, handle = null) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, handle, cx: e.clientX, cy: e.clientY, vX, vY, vW, vH };

    const onMove = mv => {
      if (!dragRef.current) return;
      const d  = dragRef.current;
      const dx = (mv.clientX - d.cx) / scale;
      const dy = (mv.clientY - d.cy) / scale;
      const MIN = 80;
      let nx = d.vX, ny = d.vY, nw = d.vW, nh = d.vH;

      if (d.mode === 'move') {
        nx = Math.round(Math.max(0, Math.min(W - nw, d.vX + dx)));
        ny = Math.round(Math.max(0, Math.min(H - nh, d.vY + dy)));
      } else {
        if (d.handle === 'br') {
          nw = Math.round(Math.max(MIN, Math.min(W - d.vX, d.vW + dx)));
          nh = Math.round(Math.max(MIN, Math.min(H - d.vY, d.vH + dy)));
        } else if (d.handle === 'bl') {
          const newX = Math.round(Math.max(0, d.vX + dx));
          nw = Math.round(Math.max(MIN, d.vW + d.vX - newX));
          nh = Math.round(Math.max(MIN, Math.min(H - d.vY, d.vH + dy)));
          nx = newX;
        } else if (d.handle === 'tr') {
          const newY = Math.round(Math.max(0, d.vY + dy));
          nw = Math.round(Math.max(MIN, Math.min(W - d.vX, d.vW + dx)));
          nh = Math.round(Math.max(MIN, d.vH + d.vY - newY));
          ny = newY;
        } else if (d.handle === 'tl') {
          const newX = Math.round(Math.max(0, d.vX + dx));
          const newY = Math.round(Math.max(0, d.vY + dy));
          nw = Math.round(Math.max(MIN, d.vW + d.vX - newX));
          nh = Math.round(Math.max(MIN, d.vH + d.vY - newY));
          nx = newX; ny = newY;
        }
      }
      onVideoWindowChange?.(nx, ny, nw, nh);
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [vX, vY, vW, vH, scale, W, H, onVideoWindowChange]);

  const objFit = videoEl.fit === 'contain' ? 'contain' : videoEl.fit === 'stretch' ? 'fill' : 'cover';

  return (
    <div style={{
      position: 'relative', width: PW, height: PH, flexShrink: 0,
      background: tmpl.canvas?.background || '#000',
      borderRadius: 'var(--mf-r-md)', overflow: 'hidden',
      border: '1px solid var(--mf-border-strong)',
      boxShadow: 'var(--mf-shadow-3)',
    }}>

      {tplEnabled ? (
        <>
          {/* Template PNG como fundo (z=1) */}
          {tplImgSrc && (
            <img src={tplImgSrc} alt="" draggable={false} style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'fill', zIndex: 1, pointerEvents: 'none',
            }} />
          )}

          {/* Janela do vídeo (z=2) */}
          <div style={{
            position: 'absolute', left: pvX, top: pvY, width: pvW, height: pvH,
            zIndex: 2, overflow: 'hidden',
          }}>
            {previewUrl
              ? <video key={previewUrl} src={previewUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: objFit }} autoPlay muted loop playsInline />
              : <div style={{ width: '100%', height: '100%', background: 'oklch(0.55 0.18 235 / 0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 'var(--mf-t-nano)', color: 'color-mix(in oklch, var(--mf-info-500) 40%, transparent)', fontFamily: 'var(--mf-mono)', userSelect: 'none' }}>VÍDEO</span>
                </div>
            }
          </div>

          {/* Camada de interação: arrasto + handles de resize (z=10) */}
          <div
            onMouseDown={e => startDrag(e, 'move')}
            style={{
              position: 'absolute', left: pvX, top: pvY, width: pvW, height: pvH,
              cursor: 'move', zIndex: 10,
              outline: '2px dashed color-mix(in oklch, var(--mf-info-500) 65%, transparent)',
              outlineOffset: -1,
            }}
          >
            {[
              ['tl', 0,      0,      'nwse-resize'],
              ['tr', '100%', 0,      'nesw-resize'],
              ['bl', 0,      '100%', 'nesw-resize'],
              ['br', '100%', '100%', 'nwse-resize'],
            ].map(([h, l, t, c]) => (
              <div key={h}
                onMouseDown={e => { e.stopPropagation(); startDrag(e, 'resize', h); }}
                style={{
                  position: 'absolute', left: l, top: t,
                  width: 10, height: 10, borderRadius: 'var(--mf-r-xs)',
                  background: 'var(--mf-info-500)', border: '1.5px solid #1e3a5f',
                  cursor: c, transform: 'translate(-50%,-50%)', zIndex: 11,
                }}
              />
            ))}
          </div>

          {/* Badge de posição */}
          <div style={{
            position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)',
            zIndex: 15, fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)',
            color: 'color-mix(in oklch, var(--mf-info-500) 85%, transparent)', background: 'rgba(0,0,0,.65)',
            padding: '2px 7px', borderRadius: 'var(--mf-r-xs)', pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            x:{vX} y:{vY} · {vW}×{vH}
          </div>
        </>
      ) : (
        previewUrl
          ? <video key={previewUrl} src={previewUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: objFit }} autoPlay muted loop playsInline />
          : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, background: 'linear-gradient(160deg,color-mix(in oklch, var(--mf-primary-500) 15%, transparent) 0%,color-mix(in oklch, var(--mf-mod-publicar) 8%, transparent) 100%)' }}>
              <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="color-mix(in oklch, var(--mf-mod-publicar) 40%, transparent)" strokeWidth="1.2" strokeLinecap="round"><path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.9L15 14"/><rect x="1" y="8" width="14" height="13" rx="2"/></svg>
              <span style={{ fontSize: 'var(--mf-t-nano)', color: 'color-mix(in oklch, var(--mf-mod-publicar) 55%, transparent)', fontFamily: 'var(--mf-mono)' }}>Selecione um vídeo</span>
            </div>
          )
      )}

      {/* Blur vignette no modo blur (sem template) */}
      {!tplEnabled && videoEl.fit === 'blur' && previewUrl && (
        <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(18px)', background: 'rgba(0,0,0,.25)', pointerEvents: 'none' }} />
      )}

      {/* Overlays de imagem */}
      {imageEls.map(el => {
        const realSrc = el.source && !el.source.includes('{{') ? el.source : null;
        const px = x => Math.round(x * scale);
        return realSrc
          ? <img key={el.id} src={realSrc} alt="" style={{ position: 'absolute', left: px(el.x||0), top: px(el.y||0), width: Math.max(8, px(el.width||120)), height: el.height ? px(el.height) : 'auto', opacity: el.opacity??1, zIndex: tplEnabled ? 3 : undefined }} />
          : (
            <div key={el.id} style={{ position: 'absolute', left: px(el.x||0), top: px(el.y||0), width: Math.max(10, px(el.width||120)), height: Math.max(6, px(el.height||40)), background: 'color-mix(in oklch, var(--mf-info-500) 18%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-info-500) 45%, transparent)', borderRadius: 'var(--mf-r-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: tplEnabled ? 3 : undefined }}>
              <span style={{ fontSize: 5, color: 'var(--mf-info-500)', fontFamily: 'var(--mf-mono)' }}>{el.label||'IMG'}</span>
            </div>
          );
      })}

      {/* Overlays de texto */}
      {textEls.map(el => {
        const txt = el.text && !el.text.includes('{{') ? el.text : `[${el.label||'TEXT'}]`;
        return (
          <div key={el.id} style={{ position: 'absolute', left: Math.round((el.x||0)*scale), top: Math.round((el.y||0)*scale), fontSize: Math.max(8,Math.round((el.fontSize||48)*scale)), color: el.color||'var(--mf-text)', fontWeight: el.fontWeight||'bold', background: el.bgColor ? el.bgColor+'AA' : 'transparent', padding: el.bgColor ? '1px 4px' : 0, whiteSpace: 'nowrap', lineHeight: 1.2, borderRadius: 'var(--mf-r-xs)', zIndex: tplEnabled ? 4 : undefined }}>
            {txt}
          </div>
        );
      })}

      {/* Borda (FFmpeg drawbox) */}
      {tmpl.border?.enabled && (tmpl.border.thickness||0) > 0 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxSizing: 'border-box', border: `${Math.max(1,Math.round((tmpl.border.thickness||4)*scale))}px solid ${tmpl.border.color||'var(--mf-text)'}`, opacity: tmpl.border.opacity??1, zIndex: 20 }} />
      )}

      {/* Grid de referência */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(var(--mf-border-subtle) 1px,transparent 1px),linear-gradient(90deg,var(--mf-border-subtle) 1px,transparent 1px)', backgroundSize: `${Math.round(W/4*scale)}px ${Math.round(H/8*scale)}px`, zIndex: 0 }} />

      {/* Badge de dimensão */}
      <div style={{ position: 'absolute', bottom: 5, right: 5, fontSize: 7, fontFamily: 'var(--mf-mono)', color: 'oklch(1 0 0 / 0.86)', background: 'rgba(0,0,0,.45)', padding: '2px 5px', borderRadius: 'var(--mf-r-xs)', zIndex: 25 }}>{W}×{H}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
/* Tamanhos de fonte dentro do preview NÃO usam a escala tipográfica.
   O preview é uma miniatura de uma tela de 1080×1920, e o número ali é
   proporcional ao quadro, não ao navegador: `fontSize: 5` representa um texto
   grande no vídeo final. Trocar por `--mf-t-nano` faria o rótulo estourar a
   miniatura e mentir sobre o resultado. A escala vale para a interface em
   volta; o que está dentro da moldura obedece ao vídeo. */
export default function VideoEditorPage() {
  const navigate = useNavigate();

  const [files,      setFiles]      = useState([]);
  const [previewId,  setPreviewId]  = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [tmpl,       setTmpl]       = useState(() => ({ ...DEFAULT_TMPL, elements: [{ ...DEFAULT_TMPL.elements[0], id: uid() }] }));
  const [batchName,  setBatchName]  = useState('');
  const [sections,   setSections]   = useState({ canvas: false, enquadramento: true, reels: false, moldura: false, borda: false, ajustes: false, overlays: false, textos: false, corte: false, volume: false, audio: false, qualidade: true, metadados: false });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const [savedTpls, setSavedTpls] = useState([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [listH,     setListH]     = useState(400);

  const fileInputRef   = useRef();
  const folderInputRef = useRef();
  const pngInputRef    = useRef();
  const listRef        = useRef();
  const thumbCache     = useRef(new Map());
  const urlCache       = useRef(new Map());

  function toast3(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  // load saved templates
  useEffect(() => { api.get('/video-templates').then(r => setSavedTpls(r.data || [])).catch(() => {}); }, []);

  // list height observer
  useEffect(() => {
    if (!listRef.current) return;
    const ro = new ResizeObserver(([e]) => setListH(e.contentRect.height));
    ro.observe(listRef.current);
    return () => ro.disconnect();
  }, []);

  // cleanup object URLs on unmount
  useEffect(() => () => { for (const u of urlCache.current.values()) URL.revokeObjectURL(u); }, []);

  // ── File helpers ─────────────────────────────────────────────────────────────
  function addFiles(fileList) {
    const seen = new Set(files.map(f => f.name + f.size));
    const items = [];
    for (const f of fileList) {
      if (!f.type.startsWith('video/') && !f.name.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/i)) continue;
      if (seen.has(f.name + f.size)) continue;
      items.push({ id: uid(), file: f, name: f.name, size: f.size, duration: null, resolution: null, selected: true });
    }
    if (!items.length) return;
    setFiles(prev => [...prev, ...items]);
    items.slice(0, 8).forEach(probeFile);
  }

  function probeFile(item) {
    const url = URL.createObjectURL(item.file);
    const vid = document.createElement('video');
    vid.preload = 'metadata'; vid.src = url;
    vid.onloadedmetadata = () => {
      const duration = vid.duration;
      const resolution = vid.videoWidth ? `${vid.videoWidth}×${vid.videoHeight}` : null;
      URL.revokeObjectURL(url);
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, duration, resolution } : f));
    };
    vid.onerror = () => URL.revokeObjectURL(url);
  }

  function selectPreview(item) {
    setPreviewId(item.id);
    if (!urlCache.current.has(item.id)) urlCache.current.set(item.id, URL.createObjectURL(item.file));
    setPreviewUrl(urlCache.current.get(item.id));
  }

  function clearFiles() {
    for (const u of urlCache.current.values()) URL.revokeObjectURL(u);
    urlCache.current.clear();
    thumbCache.current.clear();
    setFiles([]); setPreviewId(null); setPreviewUrl(null);
  }

  // ── Template helpers ─────────────────────────────────────────────────────────
  function setT(path, val) {
    setTmpl(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let o = next;
      for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] == null) o[parts[i]] = {};
        o = o[parts[i]];
      }
      o[parts[parts.length - 1]] = val;
      return next;
    });
  }

  function onVideoWindowChange(x, y, w, h) {
    setTmpl(prev => ({
      ...prev,
      templatePng: { ...(prev.templatePng || {}), videoX: x, videoY: y, videoW: w, videoH: h },
    }));
  }

  async function handlePngUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/video-templates/upload-png', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const { serverPath, name, url } = r.data;
      setTmpl(prev => {
        const next = JSON.parse(JSON.stringify(prev));
        if (!next.templatePng) next.templatePng = { ...DEFAULT_TMPL.templatePng };
        const W = next.canvas?.width  || 1080;
        const H = next.canvas?.height || 1920;
        next.templatePng.enabled   = true;
        next.templatePng.templates = [...(next.templatePng.templates || []), { serverPath, name, url }];
        if (!next.templatePng.videoW || next.templatePng.videoW === 540) next.templatePng.videoW = Math.round(W * 0.5);
        if (!next.templatePng.videoH || next.templatePng.videoH === 960) next.templatePng.videoH = Math.round(H * 0.5);
        return next;
      });
      setSections(s => ({ ...s, moldura: true }));
      toast3('success', 'Template PNG', `"${name}" carregado.`);
    } catch (err) {
      toast3('error', 'Erro', err?.response?.data?.error || 'Falha ao enviar PNG.');
    }
  }

  function removeTplPng(idx) {
    setTmpl(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.templatePng.templates = next.templatePng.templates.filter((_, i) => i !== idx);
      if (!next.templatePng.templates.length) next.templatePng.enabled = false;
      return next;
    });
  }

  const videoEl  = tmpl.elements?.find(el => el.type === 'video') || tmpl.elements?.[0];
  const imageEls = tmpl.elements?.filter(el => el.type === 'image') || [];
  const textEls  = tmpl.elements?.filter(el => el.type === 'text')  || [];

  function updEl(id, patch) {
    setTmpl(prev => ({ ...prev, elements: prev.elements.map(el => el.id === id ? { ...el, ...patch } : el) }));
  }
  function removeEl(id) {
    setTmpl(prev => ({ ...prev, elements: prev.elements.filter(el => el.id !== id) }));
  }
  function addImageEl() {
    setTmpl(prev => ({ ...prev, elements: [...prev.elements, { id: uid(), type: 'image', label: 'Overlay', source: '{{LOGO}}', x: 0, y: 0, width: 120, height: 0, opacity: 1, zIndex: imageEls.length + 1 }] }));
    setSections(s => ({ ...s, overlays: true }));
  }
  function addTextEl() {
    setTmpl(prev => ({ ...prev, elements: [...prev.elements, { id: uid(), type: 'text', label: 'Título', text: '{{TITULO}}', x: 60, y: 200, fontSize: 60, color: 'var(--mf-text)', bgColor: '', zIndex: textEls.length + 2 }] }));
    setSections(s => ({ ...s, textos: true }));
  }

  async function loadTemplate(id) {
    try {
      const r = await api.get(`/video-templates/${id}`);
      const t = r.data;
      setTmpl({ _id: t._id, name: t.name, canvas: t.canvas || DEFAULT_TMPL.canvas, output: t.output || DEFAULT_TMPL.output, elements: t.elements?.length ? t.elements : DEFAULT_TMPL.elements, audio: t.audio || DEFAULT_TMPL.audio, border: t.border || DEFAULT_TMPL.border, ajustes: t.ajustes || DEFAULT_TMPL.ajustes, trim: t.trim || DEFAULT_TMPL.trim, templatePng: t.templatePng || DEFAULT_TMPL.templatePng });
      toast3('success', 'Carregado', t.name);
    } catch { toast3('error', 'Erro', 'Falha ao carregar template.'); }
  }

  async function saveTemplate() {
    const name = tmpl.name?.trim() || 'Template Editor';
    try {
      const payload = { ...tmpl, name, variables: extractVars(tmpl.elements) };
      if (tmpl._id) {
        await api.put(`/video-templates/${tmpl._id}`, payload);
        toast3('success', 'Salvo', 'Template atualizado.');
      } else {
        const r = await api.post('/video-templates', payload);
        setTmpl(t => ({ ...t, _id: r.data._id, name }));
        setSavedTpls(prev => [r.data, ...prev]);
        toast3('success', 'Salvo', 'Template criado.');
      }
    } catch { toast3('error', 'Erro', 'Falha ao salvar template.'); }
  }

  // ── Processing ───────────────────────────────────────────────────────────────
  const selectedFiles = useMemo(() => files.filter(f => f.selected), [files]);
  const selectedCount = selectedFiles.length;

  async function startProcessing() {
    setSaving(true); setConfirmOpen(false);
    try {
      const name = tmpl.name?.trim() || 'Template Editor';
      const payload = { ...tmpl, name, variables: extractVars(tmpl.elements) };
      let tplId = tmpl._id;
      if (!tplId) {
        const r = await api.post('/video-templates', payload);
        tplId = r.data._id;
        setTmpl(t => ({ ...t, _id: tplId, name }));
      } else {
        await api.put(`/video-templates/${tplId}`, payload);
      }
      const fd = new FormData();
      fd.append('templateId', tplId);
      fd.append('name', batchName || `Lote ${new Date().toLocaleDateString('pt-BR')}`);
      fd.append('quality', batchQuality(tmpl.output?.crf ?? 20));
      for (const f of selectedFiles) fd.append('videos', f.file, f.name);
      const res = await api.post('/video-batches', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      navigate(`/video-batches/${res.data.batch._id}`);
    } catch (err) {
      toast3('error', 'Erro', err?.response?.data?.error || 'Falha ao criar lote.');
      setSaving(false);
    }
  }

  // ── Virtual list ─────────────────────────────────────────────────────────────
  const overscan = 4;
  const visStart = Math.max(0, Math.floor(scrollTop / ITEM_H) - overscan);
  const visEnd   = Math.min(files.length, Math.ceil((scrollTop + listH) / ITEM_H) + overscan);

  const toggleSection = useCallback(id => setSections(s => ({ ...s, [id]: !s[id] })), []);

  const currentQ = QUALITY_OPTS.find(q => q.crf === (tmpl.output?.crf)) || QUALITY_OPTS[1];

  // ── INP shorthand ────────────────────────────────────────────────────────────
  const INP = { width: '100%', boxSizing: 'border-box' };
  const CARD_SM = { background: 'var(--mf-border-subtle)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', padding: '9px 10px' };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* ── Confirm Modal ── */}
      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setConfirmOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'oklch(0.13 0.04 235)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', padding: '24px 26px', width: 400, maxWidth: '100%',
            /* Teto de altura com rolagem interna: sem ele, um modal mais
               alto que a viewport esconde o próprio botão de confirmar. */
            maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
            <h2 style={{ margin: '0 0 18px', fontSize: 'var(--mf-t-h2)', fontWeight: 700, color: 'var(--mf-text)' }}>Confirmar processamento</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {[
                ['Vídeos', `${selectedCount} selecionado${selectedCount !== 1 ? 's' : ''}`],
                ['Template', tmpl.name || '(sem nome — será criado)'],
                ['Formato',  `${tmpl.canvas?.width}×${tmpl.canvas?.height}`],
                ['Qualidade', currentQ.label],
                ['Enquadramento', videoEl?.fit || 'cover'],
                ['Borda', tmpl.border?.enabled ? `${tmpl.border.thickness}px ${tmpl.border.color}` : 'desativada'],
                ['Ajustes', tmpl.ajustes?.enabled
                  ? [
                      tmpl.ajustes.brilho    ? `brilho ${tmpl.ajustes.brilho > 0 ? '+' : ''}${tmpl.ajustes.brilho}` : '',
                      tmpl.ajustes.contraste ? `contraste ${tmpl.ajustes.contraste > 0 ? '+' : ''}${tmpl.ajustes.contraste}` : '',
                      tmpl.ajustes.saturacao ? `saturação ${tmpl.ajustes.saturacao > 0 ? '+' : ''}${tmpl.ajustes.saturacao}` : '',
                      tmpl.ajustes.nitidez   ? `nitidez ${tmpl.ajustes.nitidez}` : '',
                      tmpl.ajustes.ruido     ? `ruído ${tmpl.ajustes.ruido}` : '',
                      tmpl.ajustes.zoom      ? `zoom ${tmpl.ajustes.zoom}` : '',
                      tmpl.ajustes.espelhar  ? 'espelhado' : '',
                      tmpl.ajustes.quebrarHash ? 'hash novo' : '',
                    ].filter(Boolean).join(', ') || 'ativado, sem alteração'
                  : 'desativados'],
                ['Corte', (tmpl.trim?.startTime||0) > 0 || tmpl.trim?.endTime ? `${tmpl.trim.startTime||0}s → ${tmpl.trim.endTime ?? 'fim'}` : 'sem corte'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--mf-t-sm)', gap: 8 }}>
                  <span style={{ color: 'var(--mf-text-3)' }}>{k}</span>
                  <span style={{ color: 'var(--mf-text)', fontWeight: 600, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 600, fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>Nome do lote</label>
              <input className="inp" value={batchName} onChange={e => setBatchName(e.target.value)} placeholder={`Lote ${new Date().toLocaleDateString('pt-BR')}`} style={INP} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} className="btn-ghost" style={{ flex: 1, padding: '9px 0', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)' }}>Cancelar</button>
              <button onClick={startProcessing} disabled={saving} style={{ flex: 2, padding: '9px 0', borderRadius: 'var(--mf-r-sm)', border: 'none', cursor: saving ? 'default' : 'pointer', background: saving ? 'var(--mf-border)' : 'linear-gradient(135deg,var(--mf-success-500),var(--mf-success-500))', color: saving ? 'var(--mf-text-3)' : 'var(--mf-text)', fontWeight: 700, fontSize: 'var(--mf-t-body)' }}>
                {saving ? '⚙ Criando…' : `▶ Processar ${selectedCount} vídeo${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          LEFT PANEL — Files
      ══════════════════════════════════════════════════════════ */}
      <div style={{ width: 278, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--mf-border)', background: 'oklch(0.095 0.03 235 / 0.98)', flexShrink: 0 }}>

        {/* Header */}
        <div style={{ padding: '11px 12px 9px', borderBottom: '1px solid var(--mf-border)', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 9 }}>
            Arquivos · {files.length} carregados
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => fileInputRef.current?.click()} className="btn-ghost" style={{ flex: 1, padding: '6px 0', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
              Vídeos
            </button>
            <button onClick={() => folderInputRef.current?.click()} className="btn-ghost" style={{ flex: 1, padding: '6px 0', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              Pasta
            </button>
            {files.length > 0 && (
              <button onClick={clearFiles} className="btn-ghost" style={{ padding: '6px 9px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)' }} title="Limpar lista">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" multiple accept="video/*,.mp4,.mov,.avi,.mkv,.webm" style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={folderInputRef} type="file" multiple accept="video/*" webkitdirectory="" directory="" style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={pngInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" style={{ display: 'none' }} onChange={handlePngUpload} />
        </div>

        {/* Selection bar */}
        {files.length > 0 && (
          <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--mf-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)' }}>
              {selectedCount}/{files.length} selecionados
            </span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={() => setFiles(fs => fs.map(f => ({ ...f, selected: true })))}  className="btn-ghost" style={{ padding: '2px 7px', borderRadius: 'var(--mf-r-xs)', fontSize: 'var(--mf-t-nano)' }}>Todos</button>
              <button onClick={() => setFiles(fs => fs.map(f => ({ ...f, selected: false })))} className="btn-ghost" style={{ padding: '2px 7px', borderRadius: 'var(--mf-r-xs)', fontSize: 'var(--mf-t-nano)' }}>Nenhum</button>
              <button onClick={() => setFiles(fs => fs.map(f => ({ ...f, selected: !f.selected })))} className="btn-ghost" style={{ padding: '2px 7px', borderRadius: 'var(--mf-r-xs)', fontSize: 'var(--mf-t-nano)' }}>Inverter</button>
            </div>
          </div>
        )}

        {/* Virtual list */}
        <div ref={listRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {files.length === 0
            ? (
              <div style={{ padding: '50px 14px', textAlign: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--mf-border-strong)" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 10 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', margin: 0, lineHeight: 1.5 }}>Clique em <strong>Vídeos</strong> ou arraste arquivos</p>
              </div>
            )
            : (
              <div style={{ height: files.length * ITEM_H, position: 'relative' }}>
                <div style={{ position: 'absolute', top: visStart * ITEM_H, left: 0, right: 0 }}>
                  {files.slice(visStart, visEnd).map(item => (
                    <div key={item.id} onClick={() => selectPreview(item)} style={{ height: ITEM_H, display: 'flex', alignItems: 'center', gap: 8, padding: '0 11px', cursor: 'pointer', borderBottom: '1px solid var(--mf-border-subtle)', background: previewId === item.id ? 'oklch(0.55 0.18 235 / 0.13)' : 'transparent', borderLeft: `2px solid ${previewId === item.id ? 'var(--mf-info-500)' : 'transparent'}`, transition: 'background .1s' }}>
                      <input type="checkbox" checked={item.selected} onChange={e => { e.stopPropagation(); setFiles(fs => fs.map(f => f.id === item.id ? { ...f, selected: e.target.checked } : f)); }} onClick={e => e.stopPropagation()} style={{ flexShrink: 0, accentColor: 'var(--mf-success-500)' }} />
                      <FileThumbnail fileItem={item} cache={thumbCache.current} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 600, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</div>
                        <div style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', marginTop: 2 }}>
                          {[fmtDur(item.duration), item.resolution, fmtSize(item.size)].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          }
        </div>

        {/* Output info */}
        <div style={{ padding: '9px 12px', borderTop: '1px solid var(--mf-border)', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>Saída dos renders</div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', background: 'var(--mf-border-subtle)', borderRadius: 'var(--mf-r-xs)', padding: '4px 8px' }}>uploads/renders/&lt;lote&gt;/</div>
          <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-border-strong)', marginTop: 4, lineHeight: 1.4 }}>Download disponível pelo painel do lote após processamento.</div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          CENTER PANEL — Preview
      ══════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.065 0.022 235)', overflow: 'auto', gap: 14, padding: '20px 20px' }}>

        <CanvasPreview tmpl={tmpl} previewUrl={previewUrl} onVideoWindowChange={onVideoWindowChange} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 340, width: '100%' }}>
          <input className="inp" value={tmpl.name} onChange={e => setT('name', e.target.value)} placeholder="Nome do template…" style={{ flex: 1 }} />
          <button onClick={saveTemplate} className="btn-ghost" style={{ padding: '8px 14px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', flexShrink: 0 }}>
            Salvar
          </button>
        </div>

        {savedTpls.length > 0 && (
          <div style={{ maxWidth: 340, width: '100%' }}>
            <select className="inp" value="" onChange={e => { if (e.target.value) loadTemplate(e.target.value); }} style={{ width: '100%' }}>
              <option value="">Carregar template salvo…</option>
              {savedTpls.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {!previewUrl && files.length > 0 && (
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', textAlign: 'center' }}>
            Clique em um vídeo da lista para pré-visualizar
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          RIGHT PANEL — Settings
      ══════════════════════════════════════════════════════════ */}
      <div style={{ width: 310, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--mf-border)', background: 'oklch(0.095 0.03 235 / 0.98)', flexShrink: 0 }}>
        <div style={{ padding: '11px 14px 9px', borderBottom: '1px solid var(--mf-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Configurações do template</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* CANVAS */}
          <Acc title="Canvas" id="canvas" open={sections.canvas} toggle={toggleSection}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Fld label="Largura"><input className="inp" type="number" value={tmpl.canvas.width} onChange={e => setT('canvas.width', Number(e.target.value))} style={INP} /></Fld>
              <Fld label="Altura"><input className="inp" type="number" value={tmpl.canvas.height} onChange={e => setT('canvas.height', Number(e.target.value))} style={INP} /></Fld>
              <Fld label="FPS">
                <select className="inp" value={tmpl.canvas.fps} onChange={e => setT('canvas.fps', Number(e.target.value))} style={INP}>
                  {[24, 25, 30, 60].map(f => <option key={f} value={f}>{f} fps</option>)}
                </select>
              </Fld>
              <Fld label="Fundo">
                <div style={{ display: 'flex', gap: 5 }}>
                  <input type="color" value={tmpl.canvas.background} onChange={e => setT('canvas.background', e.target.value)} style={{ width: 28, height: 28, padding: 1, borderRadius: 'var(--mf-r-xs)', border: '1px solid var(--mf-border-strong)', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                  <input className="inp" value={tmpl.canvas.background} onChange={e => setT('canvas.background', e.target.value)} style={{ flex: 1 }} />
                </div>
              </Fld>
            </div>
          </Acc>

          {/* ENQUADRAMENTO */}
          <Acc title="Enquadramento" id="enquadramento" open={sections.enquadramento} toggle={toggleSection}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {FIT_OPTS.map(opt => (
                <label key={opt.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', background: videoEl?.fit === opt.id ? 'oklch(0.55 0.18 235 / 0.16)' : 'var(--mf-border-subtle)', border: `1px solid ${videoEl?.fit === opt.id ? 'oklch(0.65 0.18 235 / 0.38)' : 'var(--mf-border)'}`, transition: 'background .12s' }}>
                  <input type="radio" name="fit" value={opt.id} checked={videoEl?.fit === opt.id} onChange={() => updEl(videoEl.id, { fit: opt.id })} style={{ marginTop: 2, accentColor: 'var(--mf-info-500)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 600, color: 'var(--mf-text)' }}>{opt.label}</div>
                    <div style={{ fontSize: '.65rem', color: 'var(--mf-text-3)', marginTop: 1 }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Acc>

          {/* REELS */}
          <Acc title="Formato Reels 9:16" id="reels" open={sections.reels} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text)', padding: '4px 0' }}>
              <input type="checkbox" checked={tmpl.canvas.width === 1080 && tmpl.canvas.height === 1920} onChange={e => { if (e.target.checked) { setT('canvas.width', 1080); setT('canvas.height', 1920); } }} style={{ accentColor: 'var(--mf-success-500)' }} />
              Converter para 1080×1920 (Reels/TikTok)
            </label>
            <p style={{ margin: '8px 0 0', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.5 }}>Usa o enquadramento selecionado acima para adaptar qualquer vídeo ao formato vertical.</p>
          </Acc>

          {/* MOLDURA / TEMPLATE PNG */}
          <Acc title="Moldura / Template PNG" id="moldura" open={sections.moldura} toggle={toggleSection} count={(tmpl.templatePng?.templates || []).length || undefined}>
            <p style={{ margin: '0 0 10px', fontSize: '.67rem', color: 'var(--mf-text-3)', lineHeight: 1.5 }}>
              O PNG vira o fundo do canvas. Arraste o quadro azul na prévia para posicionar onde o vídeo aparece dentro do template.
            </p>

            {/* Lista de templates enviados */}
            {(tmpl.templatePng?.templates || []).map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-border-subtle)', border: '1px solid var(--mf-border)', marginBottom: 6 }}>
                <img
                  src={t.url?.startsWith('http') ? t.url : `${api.defaults.baseURL.replace(/\/$/, '')}${t.url}`}
                  alt=""
                  style={{ width: 44, height: 28, objectFit: 'cover', borderRadius: 'var(--mf-r-xs)', flexShrink: 0, background: 'var(--mf-border)' }}
                />
                <span style={{ flex: 1, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <button onClick={() => removeTplPng(i)} className="btn-ghost" style={{ padding: '1px 7px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', borderRadius: 'var(--mf-r-xs)', flexShrink: 0 }}>✕</button>
              </div>
            ))}

            {/* Botão de upload */}
            <button
              onClick={() => pngInputRef.current?.click()}
              className="btn-ghost"
              style={{ width: '100%', padding: '8px 0', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 10, border: '1px dashed oklch(0.55 0.18 235 / 0.45)', color: 'var(--mf-info-500)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {(tmpl.templatePng?.templates || []).length > 0 ? '+ Adicionar outro (rotação)' : 'Escolher Template PNG'}
            </button>

            {/* Controles da janela do vídeo */}
            {(tmpl.templatePng?.templates || []).length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Fld label="X (pixels)">
                  <input className="inp" type="number" min="0" value={tmpl.templatePng?.videoX ?? 0} onChange={e => setT('templatePng.videoX', Number(e.target.value))} style={INP} />
                </Fld>
                <Fld label="Y (pixels)">
                  <input className="inp" type="number" min="0" value={tmpl.templatePng?.videoY ?? 0} onChange={e => setT('templatePng.videoY', Number(e.target.value))} style={INP} />
                </Fld>
                <Fld label="Largura">
                  <input className="inp" type="number" min="50" value={tmpl.templatePng?.videoW ?? 540} onChange={e => setT('templatePng.videoW', Number(e.target.value))} style={INP} />
                </Fld>
                <Fld label="Altura">
                  <input className="inp" type="number" min="50" value={tmpl.templatePng?.videoH ?? 960} onChange={e => setT('templatePng.videoH', Number(e.target.value))} style={INP} />
                </Fld>
                <Fld label="Enquadramento" span2>
                  <select className="inp" value={tmpl.templatePng?.videoFit || 'cover'} onChange={e => setT('templatePng.videoFit', e.target.value)} style={INP}>
                    <option value="cover">Preencher (corta sobra)</option>
                    <option value="contain">Conter (com barras)</option>
                    <option value="stretch">Esticar</option>
                  </select>
                </Fld>
              </div>
            )}
          </Acc>

          {/* BORDA */}
          <Acc title="Borda / Moldura" id="borda" open={sections.borda} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text)', marginBottom: 10 }}>
              <input type="checkbox" checked={tmpl.border?.enabled || false} onChange={e => setT('border.enabled', e.target.checked)} style={{ accentColor: 'var(--mf-info-500)' }} />
              Ativar borda
            </label>
            {tmpl.border?.enabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Fld label="Espessura (px)"><input className="inp" type="number" min="1" max="500" value={tmpl.border.thickness || 4} onChange={e => setT('border.thickness', Number(e.target.value))} style={INP} /></Fld>
                <Fld label="Opacidade (0–1)"><input className="inp" type="number" step="0.05" min="0" max="1" value={tmpl.border.opacity ?? 1} onChange={e => setT('border.opacity', Number(e.target.value))} style={INP} /></Fld>
                <Fld label="Cor" span2>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="color" value={tmpl.border.color || 'var(--mf-text)'} onChange={e => setT('border.color', e.target.value)} style={{ width: 30, height: 28, padding: 1, borderRadius: 'var(--mf-r-xs)', border: '1px solid var(--mf-border-strong)', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                    <input className="inp" value={tmpl.border.color || 'var(--mf-text)'} onChange={e => setT('border.color', e.target.value)} style={{ flex: 1 }} />
                  </div>
                </Fld>
              </div>
            )}
          </Acc>

          {/* AJUSTES DE IMAGEM */}
          <Acc title="Ajustes de imagem" id="ajustes" open={sections.ajustes} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text)', marginBottom: 10 }}>
              <input type="checkbox" checked={tmpl.ajustes?.enabled || false} onChange={e => setT('ajustes.enabled', e.target.checked)} style={{ accentColor: 'var(--mf-info-500)' }} />
              Ativar ajustes
            </label>

            {tmpl.ajustes?.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['brilho',    'Brilho',     -100, 100],
                  ['contraste', 'Contraste',  -100, 100],
                  ['saturacao', 'Saturação',  -100, 100],
                  ['nitidez',   'Nitidez',       0, 100],
                  ['ruido',     'Ruído / grão', 0, 100],
                  ['zoom',      'Micro-zoom',   0, 100],
                ].map(([campo, rotulo, min, max]) => (
                  <div key={campo}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 3 }}>
                      <span>{rotulo}</span>
                      <span style={{ fontFamily: 'var(--mf-mono)', color: (tmpl.ajustes[campo] || 0) !== 0 ? 'var(--mf-info-500)' : 'var(--mf-text-3)' }}>
                        {(tmpl.ajustes[campo] || 0) > 0 ? '+' : ''}{tmpl.ajustes[campo] || 0}
                      </span>
                    </div>
                    <input
                      type="range" min={min} max={max} step="1"
                      value={tmpl.ajustes[campo] || 0}
                      onChange={e => setT(`ajustes.${campo}`, Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--mf-info-500)', cursor: 'pointer' }}
                    />
                  </div>
                ))}

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)' }}>
                  <input type="checkbox" checked={tmpl.ajustes.espelhar || false} onChange={e => setT('ajustes.espelhar', e.target.checked)} style={{ accentColor: 'var(--mf-info-500)' }} />
                  Espelhar horizontalmente
                </label>

                <div style={{ borderTop: '1px solid var(--mf-border)', paddingTop: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)' }}>
                    <input type="checkbox" checked={tmpl.ajustes.quebrarHash || false} onChange={e => setT('ajustes.quebrarHash', e.target.checked)} style={{ accentColor: 'var(--mf-success-500)' }} />
                    Gerar arquivo novo a cada render
                  </label>
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6, marginTop: 5 }}>
                    Aplica variações mínimas e aleatórias em cada processamento, então
                    dois envios do mesmo vídeo nunca saem com os bytes iguais. É
                    imperceptível na tela.
                  </div>
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-warning-500)', lineHeight: 1.6, marginTop: 6 }}>
                    Muda o arquivo, não o conteúdo. O Instagram compara vídeos por
                    semelhança visual e por áudio, não pelo hash — repostar o mesmo
                    vídeo continua sendo reconhecível para ele.
                  </div>
                </div>
              </div>
            )}
          </Acc>

          {/* OVERLAYS */}
          <Acc title="Overlays / Imagens" id="overlays" open={sections.overlays} toggle={toggleSection} count={imageEls.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {imageEls.map(el => (
                <div key={el.id} style={CARD_SM}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 600, color: 'var(--mf-info-500)' }}>{el.label || 'Imagem'}</span>
                    <button onClick={() => removeEl(el.id)} className="btn-ghost" style={{ padding: '1px 7px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', borderRadius: 'var(--mf-r-xs)' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <Fld label="Variável {{VAR}}" span2><input className="inp" value={el.source} onChange={e => updEl(el.id, { source: e.target.value })} placeholder="{{LOGO}}" style={INP} /></Fld>
                    <Fld label="X"><input className="inp" type="number" value={el.x||0} onChange={e => updEl(el.id, { x: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Y"><input className="inp" type="number" value={el.y||0} onChange={e => updEl(el.id, { y: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Largura"><input className="inp" type="number" value={el.width||120} onChange={e => updEl(el.id, { width: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Opacidade"><input className="inp" type="number" step="0.1" min="0" max="1" value={el.opacity??1} onChange={e => updEl(el.id, { opacity: Number(e.target.value) })} style={INP} /></Fld>
                  </div>
                </div>
              ))}
              <button onClick={addImageEl} className="btn-ghost" style={{ padding: '7px 0', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Adicionar overlay
              </button>
            </div>
          </Acc>

          {/* TEXTOS */}
          <Acc title="Textos / Legendas" id="textos" open={sections.textos} toggle={toggleSection} count={textEls.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {textEls.map(el => (
                <div key={el.id} style={CARD_SM}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 600, color: 'var(--mf-success-500)' }}>{el.label || 'Texto'}</span>
                    <button onClick={() => removeEl(el.id)} className="btn-ghost" style={{ padding: '1px 7px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', borderRadius: 'var(--mf-r-xs)' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <Fld label="Texto ou {{VAR}}" span2><input className="inp" value={el.text} onChange={e => updEl(el.id, { text: e.target.value })} placeholder="{{TITULO}}" style={INP} /></Fld>
                    <Fld label="X"><input className="inp" type="number" value={el.x||0} onChange={e => updEl(el.id, { x: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Y"><input className="inp" type="number" value={el.y||0} onChange={e => updEl(el.id, { y: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Tamanho fonte"><input className="inp" type="number" value={el.fontSize||48} onChange={e => updEl(el.id, { fontSize: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Cor">
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input type="color" value={el.color||'var(--mf-text)'} onChange={e => updEl(el.id, { color: e.target.value })} style={{ width: 27, height: 28, padding: 1, borderRadius: 'var(--mf-r-xs)', border: '1px solid var(--mf-border-strong)', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                        <input className="inp" value={el.color||'var(--mf-text)'} onChange={e => updEl(el.id, { color: e.target.value })} style={{ flex: 1 }} />
                      </div>
                    </Fld>
                  </div>
                </div>
              ))}
              <button onClick={addTextEl} className="btn-ghost" style={{ padding: '7px 0', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Adicionar texto
              </button>
            </div>
          </Acc>

          {/* CORTE */}
          <Acc title="Corte / Trim" id="corte" open={sections.corte} toggle={toggleSection}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Fld label="De (segundos)"><input className="inp" type="number" min="0" step="0.5" value={tmpl.trim?.startTime || 0} onChange={e => setT('trim.startTime', Number(e.target.value))} style={INP} /></Fld>
              <Fld label="Até (vazio = fim)"><input className="inp" type="number" min="0" step="0.5" value={tmpl.trim?.endTime ?? ''} onChange={e => setT('trim.endTime', e.target.value === '' ? null : Number(e.target.value))} placeholder="fim" style={INP} /></Fld>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.5 }}>
              Corta o vídeo antes das demais operações. Aplicado via -ss / -to no FFmpeg.
            </p>
          </Acc>

          {/* VOLUME */}
          <Acc title="Volume" id="volume" open={sections.volume} toggle={toggleSection}>
            <Fld label={`Volume original: ${Math.round((tmpl.audio?.originalVolume ?? 1) * 100)}%`}>
              <input type="range" min="0" max="2" step="0.05" value={tmpl.audio?.originalVolume ?? 1} onChange={e => setT('audio.originalVolume', Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--mf-success-500)', marginTop: 2 }} />
            </Fld>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)', marginTop: 10 }}>
              <input type="checkbox" checked={tmpl.audio?.keepOriginal !== false} onChange={e => setT('audio.keepOriginal', e.target.checked)} style={{ accentColor: 'var(--mf-success-500)' }} />
              Manter áudio original
            </label>
          </Acc>

          {/* ÁUDIO 2ª CAMADA */}
          <Acc title="Áudio (2ª camada)" id="audio" open={sections.audio} toggle={toggleSection}>
            <Fld label="Trilha de fundo (caminho no servidor)">
              <input className="inp" value={tmpl.audio?.musicTrack || ''} onChange={e => setT('audio.musicTrack', e.target.value)} placeholder="/uploads/musica.mp3" style={INP} />
            </Fld>
            <Fld label={`Volume da trilha: ${Math.round((tmpl.audio?.musicVolume ?? 0.3) * 100)}%`} style={{ marginTop: 8 }}>
              <input type="range" min="0" max="2" step="0.05" value={tmpl.audio?.musicVolume ?? 0.3} onChange={e => setT('audio.musicVolume', Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--mf-info-500)', marginTop: 2 }} />
            </Fld>
            <p style={{ margin: '8px 0 0', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.4 }}>Mistura automaticamente com o áudio original via amix no FFmpeg.</p>
          </Acc>

          {/* QUALIDADE */}
          <Acc title="Qualidade" id="qualidade" open={sections.qualidade} toggle={toggleSection}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {QUALITY_OPTS.map(q => (
                <label key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', background: tmpl.output?.crf === q.crf ? 'oklch(0.55 0.18 235 / 0.16)' : 'var(--mf-border-subtle)', border: `1px solid ${tmpl.output?.crf === q.crf ? 'oklch(0.65 0.18 235 / 0.38)' : 'var(--mf-border)'}` }}>
                  <input type="radio" name="quality" checked={tmpl.output?.crf === q.crf} onChange={() => { setT('output.crf', q.crf); setT('output.preset', q.preset); }} style={{ accentColor: 'var(--mf-info-500)', flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)' }}>{q.label}</span>
                </label>
              ))}
            </div>
          </Acc>

          {/* METADADOS */}
          <Acc title="Metadados" id="metadados" open={sections.metadados} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text)' }}>
              <input type="checkbox" checked={tmpl.output?.removeMetadata !== false} onChange={e => setT('output.removeMetadata', e.target.checked)} style={{ accentColor: 'var(--mf-info-500)' }} />
              Remover metadados do arquivo final
            </label>
            <p style={{ margin: '8px 0 0', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.4 }}>Remove EXIF, GPS, câmera e informações do autor via -map_metadata -1 no FFmpeg.</p>
          </Acc>

        </div>

        {/* Process button */}
        <div style={{ padding: '11px 12px', borderTop: '1px solid var(--mf-border)', flexShrink: 0 }}>
          {selectedCount === 0 && files.length > 0 && (
            <p style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', textAlign: 'center', margin: '0 0 8px' }}>Marque os vídeos na lista para processar</p>
          )}
          {files.length === 0 && (
            <p style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', textAlign: 'center', margin: '0 0 8px' }}>Adicione vídeos para começar</p>
          )}
          <button
            onClick={() => selectedCount > 0 && !saving && setConfirmOpen(true)}
            disabled={selectedCount === 0 || saving}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 'var(--mf-r-md)', border: 'none',
              cursor: selectedCount === 0 || saving ? 'not-allowed' : 'pointer',
              background: selectedCount > 0 && !saving
                ? 'linear-gradient(135deg, var(--mf-success-500) 0%, var(--mf-success-500) 100%)'
                : 'var(--mf-border)',
              color: selectedCount > 0 && !saving ? 'var(--mf-text)' : 'var(--mf-text-3)',
              fontWeight: 700, fontSize: 'var(--mf-t-body)', letterSpacing: '.02em',
              boxShadow: selectedCount > 0 && !saving ? '0 4px 18px color-mix(in oklch, var(--mf-success-500) 28%, transparent)' : 'none',
              transition: 'background .18s, box-shadow .18s',
            }}
          >
            {saving
              ? '⚙ Criando lote…'
              : selectedCount > 0
                ? `▶ Processar ${selectedCount} vídeo${selectedCount !== 1 ? 's' : ''}`
                : '▶ Processar vídeos'
            }
          </button>
        </div>
      </div>
    </div>
  );
}

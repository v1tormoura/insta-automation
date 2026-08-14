import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Toast from '../components/Toast';

// ── Constants ─────────────────────────────────────────────────────────────────
const ITEM_H = 72;

const DEFAULT_TMPL = {
  name: '',
  canvas:  { width: 1080, height: 1920, fps: 30, background: '#000000' },
  output:  { crf: 20, preset: 'medium', removeMetadata: true },
  elements: [{ id: 'vid0', type: 'video', source: '{{VIDEO}}', fit: 'cover', label: 'Vídeo', zIndex: 0, x: 0, y: 0, width: 0, height: 0 }],
  audio:   { keepOriginal: true, originalVolume: 1.0, musicTrack: '', musicVolume: 0.3 },
  border:  { enabled: false, thickness: 4, color: '#FFFFFF', opacity: 1.0 },
  trim:    { startTime: 0, endTime: null },
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

  if (!src) return <div style={{ width: 60, height: 34, borderRadius: 4, background: 'oklch(1 0 0 / 0.07)', flexShrink: 0 }} />;
  return <img src={src} alt="" style={{ width: 60, height: 34, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />;
}

function Acc({ title, id, open, toggle, children, count }) {
  return (
    <div style={{ borderBottom: '1px solid oklch(1 0 0 / 0.055)' }}>
      <button onClick={() => toggle(id)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 7,
        padding: '9px 14px', background: 'none', border: 'none',
        color: open ? 'var(--text)' : 'var(--text2)', cursor: 'pointer',
        transition: 'color .14s', textAlign: 'left',
      }}>
        <svg width="8" height="8" viewBox="0 0 8 8" style={{ transition: 'transform .17s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>
          <polygon points="0,0 8,4 0,8" fill="currentColor" opacity="0.55" />
        </svg>
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.07em', flex: 1 }}>{title}</span>
        {count != null && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text3)', background: 'oklch(1 0 0 / 0.07)', borderRadius: 20, padding: '1px 6px' }}>{count}</span>}
      </button>
      {open && <div style={{ padding: '2px 14px 14px' }}>{children}</div>}
    </div>
  );
}

function Fld({ label, children, span2 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: span2 ? 'span 2' : undefined }}>
      <label style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>
      {children}
    </div>
  );
}

function CanvasPreview({ tmpl, previewUrl }) {
  const W = tmpl.canvas?.width  || 1080;
  const H = tmpl.canvas?.height || 1920;
  const maxH = 520, maxW = 320;
  const scale = Math.min(maxW / W, maxH / H);
  const PW = Math.round(W * scale);
  const PH = Math.round(H * scale);

  const videoEl  = tmpl.elements?.find(el => el.type === 'video') || { fit: 'cover' };
  const imageEls = tmpl.elements?.filter(el => el.type === 'image') || [];
  const textEls  = tmpl.elements?.filter(el => el.type === 'text')  || [];

  const objFit = videoEl.fit === 'contain' ? 'contain' : videoEl.fit === 'stretch' ? 'fill' : 'cover';

  return (
    <div style={{
      position: 'relative', width: PW, height: PH, flexShrink: 0,
      background: tmpl.canvas?.background || '#000',
      borderRadius: 10, overflow: 'hidden',
      border: '1px solid oklch(1 0 0 / 0.14)',
      boxShadow: '0 20px 60px rgba(0,0,0,.8)',
    }}>
      {previewUrl
        ? <video key={previewUrl} src={previewUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: objFit }} autoPlay muted loop playsInline />
        : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, background: 'linear-gradient(160deg,rgba(99,102,241,.15) 0%,rgba(139,92,246,.08) 100%)' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,.4)" strokeWidth="1.2" strokeLinecap="round"><path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.9L15 14"/><rect x="1" y="8" width="14" height="13" rx="2"/></svg>
            <span style={{ fontSize: 10, color: 'rgba(139,92,246,.55)', fontFamily: 'var(--font-mono)' }}>Selecione um vídeo</span>
          </div>
        )
      }

      {/* blur vignette when fit=blur */}
      {videoEl.fit === 'blur' && previewUrl && (
        <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(18px)', background: 'rgba(0,0,0,.25)', pointerEvents: 'none' }} />
      )}

      {/* image overlays */}
      {imageEls.map(el => {
        const realSrc = el.source && !el.source.includes('{{') ? el.source : null;
        const px = x => Math.round(x * scale);
        return realSrc
          ? <img key={el.id} src={realSrc} alt="" style={{ position: 'absolute', left: px(el.x||0), top: px(el.y||0), width: Math.max(8, px(el.width||120)), height: el.height ? px(el.height) : 'auto', opacity: el.opacity??1 }} />
          : (
            <div key={el.id} style={{ position: 'absolute', left: px(el.x||0), top: px(el.y||0), width: Math.max(10, px(el.width||120)), height: Math.max(6, px(el.height||40)), background: 'rgba(96,165,250,.18)', border: '1px solid rgba(96,165,250,.45)', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 5, color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>{el.label||'IMG'}</span>
            </div>
          );
      })}

      {/* text overlays */}
      {textEls.map(el => {
        const txt = el.text && !el.text.includes('{{') ? el.text : `[${el.label||'TEXT'}]`;
        return (
          <div key={el.id} style={{ position: 'absolute', left: Math.round((el.x||0)*scale), top: Math.round((el.y||0)*scale), fontSize: Math.max(8,Math.round((el.fontSize||48)*scale)), color: el.color||'#FFF', fontWeight: el.fontWeight||'bold', background: el.bgColor ? el.bgColor+'AA' : 'transparent', padding: el.bgColor ? '1px 4px' : 0, whiteSpace: 'nowrap', lineHeight: 1.2, borderRadius: 2 }}>
            {txt}
          </div>
        );
      })}

      {/* border */}
      {tmpl.border?.enabled && (tmpl.border.thickness||0) > 0 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxSizing: 'border-box', border: `${Math.max(1,Math.round((tmpl.border.thickness||4)*scale))}px solid ${tmpl.border.color||'#FFF'}`, opacity: tmpl.border.opacity??1 }} />
      )}

      {/* reference grid */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px)', backgroundSize: `${Math.round(W/4*scale)}px ${Math.round(H/8*scale)}px` }} />

      {/* dimension badge */}
      <div style={{ position: 'absolute', bottom: 5, right: 5, fontSize: 7, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,.38)', background: 'rgba(0,0,0,.45)', padding: '2px 5px', borderRadius: 3 }}>{W}×{H}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function VideoEditorPage() {
  const navigate = useNavigate();

  const [files,      setFiles]      = useState([]);
  const [previewId,  setPreviewId]  = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [tmpl,       setTmpl]       = useState(() => ({ ...DEFAULT_TMPL, elements: [{ ...DEFAULT_TMPL.elements[0], id: uid() }] }));
  const [batchName,  setBatchName]  = useState('');
  const [sections,   setSections]   = useState({ canvas: false, enquadramento: true, reels: false, borda: false, overlays: false, textos: false, corte: false, volume: false, audio: false, qualidade: true, metadados: false });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const [savedTpls, setSavedTpls] = useState([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [listH,     setListH]     = useState(400);

  const fileInputRef   = useRef();
  const folderInputRef = useRef();
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
    setTmpl(prev => ({ ...prev, elements: [...prev.elements, { id: uid(), type: 'text', label: 'Título', text: '{{TITULO}}', x: 60, y: 200, fontSize: 60, color: '#FFFFFF', bgColor: '', zIndex: textEls.length + 2 }] }));
    setSections(s => ({ ...s, textos: true }));
  }

  async function loadTemplate(id) {
    try {
      const r = await api.get(`/video-templates/${id}`);
      const t = r.data;
      setTmpl({ _id: t._id, name: t.name, canvas: t.canvas || DEFAULT_TMPL.canvas, output: t.output || DEFAULT_TMPL.output, elements: t.elements?.length ? t.elements : DEFAULT_TMPL.elements, audio: t.audio || DEFAULT_TMPL.audio, border: t.border || DEFAULT_TMPL.border, trim: t.trim || DEFAULT_TMPL.trim });
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
  const CARD_SM = { background: 'oklch(1 0 0 / 0.04)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 8, padding: '9px 10px' };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* ── Confirm Modal ── */}
      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setConfirmOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'oklch(0.13 0.04 235)', border: '1px solid oklch(1 0 0 / 0.1)', borderRadius: 16, padding: '24px 26px', width: 400, maxWidth: '100%' }}>
            <h2 style={{ margin: '0 0 18px', fontSize: '.95rem', fontWeight: 700, color: 'var(--text)' }}>Confirmar processamento</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {[
                ['Vídeos', `${selectedCount} selecionado${selectedCount !== 1 ? 's' : ''}`],
                ['Template', tmpl.name || '(sem nome — será criado)'],
                ['Formato',  `${tmpl.canvas?.width}×${tmpl.canvas?.height}`],
                ['Qualidade', currentQ.label],
                ['Enquadramento', videoEl?.fit || 'cover'],
                ['Borda', tmpl.border?.enabled ? `${tmpl.border.thickness}px ${tmpl.border.color}` : 'desativada'],
                ['Corte', (tmpl.trim?.startTime||0) > 0 || tmpl.trim?.endTime ? `${tmpl.trim.startTime||0}s → ${tmpl.trim.endTime ?? 'fim'}` : 'sem corte'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', gap: 8 }}>
                  <span style={{ color: 'var(--text3)' }}>{k}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>Nome do lote</label>
              <input className="inp" value={batchName} onChange={e => setBatchName(e.target.value)} placeholder={`Lote ${new Date().toLocaleDateString('pt-BR')}`} style={INP} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} className="btn-ghost" style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: '.82rem' }}>Cancelar</button>
              <button onClick={startProcessing} disabled={saving} style={{ flex: 2, padding: '9px 0', borderRadius: 8, border: 'none', cursor: saving ? 'default' : 'pointer', background: saving ? 'oklch(1 0 0 / 0.08)' : 'linear-gradient(135deg,#22c55e,#16a34a)', color: saving ? 'var(--text3)' : '#fff', fontWeight: 700, fontSize: '.88rem' }}>
                {saving ? '⚙ Criando…' : `▶ Processar ${selectedCount} vídeo${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          LEFT PANEL — Files
      ══════════════════════════════════════════════════════════ */}
      <div style={{ width: 278, display: 'flex', flexDirection: 'column', borderRight: '1px solid oklch(1 0 0 / 0.07)', background: 'oklch(0.095 0.03 235 / 0.98)', flexShrink: 0 }}>

        {/* Header */}
        <div style={{ padding: '11px 12px 9px', borderBottom: '1px solid oklch(1 0 0 / 0.07)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 9 }}>
            Arquivos · {files.length} carregados
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => fileInputRef.current?.click()} className="btn-ghost" style={{ flex: 1, padding: '6px 0', borderRadius: 7, fontSize: '.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
              Vídeos
            </button>
            <button onClick={() => folderInputRef.current?.click()} className="btn-ghost" style={{ flex: 1, padding: '6px 0', borderRadius: 7, fontSize: '.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              Pasta
            </button>
            {files.length > 0 && (
              <button onClick={clearFiles} className="btn-ghost" style={{ padding: '6px 9px', borderRadius: 7, fontSize: '.72rem', color: '#f87171' }} title="Limpar lista">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" multiple accept="video/*,.mp4,.mov,.avi,.mkv,.webm" style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={folderInputRef} type="file" multiple accept="video/*" webkitdirectory="" directory="" style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {/* Selection bar */}
        {files.length > 0 && (
          <div style={{ padding: '6px 12px', borderBottom: '1px solid oklch(1 0 0 / 0.055)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text3)' }}>
              {selectedCount}/{files.length} selecionados
            </span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={() => setFiles(fs => fs.map(f => ({ ...f, selected: true })))}  className="btn-ghost" style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10 }}>Todos</button>
              <button onClick={() => setFiles(fs => fs.map(f => ({ ...f, selected: false })))} className="btn-ghost" style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10 }}>Nenhum</button>
              <button onClick={() => setFiles(fs => fs.map(f => ({ ...f, selected: !f.selected })))} className="btn-ghost" style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10 }}>Inverter</button>
            </div>
          </div>
        )}

        {/* Virtual list */}
        <div ref={listRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {files.length === 0
            ? (
              <div style={{ padding: '50px 14px', textAlign: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="oklch(1 0 0 / 0.18)" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 10 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p style={{ fontSize: '.76rem', color: 'var(--text3)', margin: 0, lineHeight: 1.5 }}>Clique em <strong>Vídeos</strong> ou arraste arquivos</p>
              </div>
            )
            : (
              <div style={{ height: files.length * ITEM_H, position: 'relative' }}>
                <div style={{ position: 'absolute', top: visStart * ITEM_H, left: 0, right: 0 }}>
                  {files.slice(visStart, visEnd).map(item => (
                    <div key={item.id} onClick={() => selectPreview(item)} style={{ height: ITEM_H, display: 'flex', alignItems: 'center', gap: 8, padding: '0 11px', cursor: 'pointer', borderBottom: '1px solid oklch(1 0 0 / 0.04)', background: previewId === item.id ? 'oklch(0.55 0.18 235 / 0.13)' : 'transparent', borderLeft: `2px solid ${previewId === item.id ? '#60a5fa' : 'transparent'}`, transition: 'background .1s' }}>
                      <input type="checkbox" checked={item.selected} onChange={e => { e.stopPropagation(); setFiles(fs => fs.map(f => f.id === item.id ? { ...f, selected: e.target.checked } : f)); }} onClick={e => e.stopPropagation()} style={{ flexShrink: 0, accentColor: '#4ade80' }} />
                      <FileThumbnail fileItem={item} cache={thumbCache.current} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '.7rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</div>
                        <div style={{ fontSize: '.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text3)', marginTop: 2 }}>
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
        <div style={{ padding: '9px 12px', borderTop: '1px solid oklch(1 0 0 / 0.07)', flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>Saída dos renders</div>
          <div style={{ fontSize: '.68rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)', background: 'oklch(1 0 0 / 0.04)', borderRadius: 5, padding: '4px 8px' }}>uploads/renders/&lt;lote&gt;/</div>
          <div style={{ fontSize: 10, color: 'oklch(1 0 0 / 0.28)', marginTop: 4, lineHeight: 1.4 }}>Download disponível pelo painel do lote após processamento.</div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          CENTER PANEL — Preview
      ══════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.065 0.022 235)', overflow: 'auto', gap: 14, padding: '20px 20px' }}>

        <CanvasPreview tmpl={tmpl} previewUrl={previewUrl} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 340, width: '100%' }}>
          <input className="inp" value={tmpl.name} onChange={e => setT('name', e.target.value)} placeholder="Nome do template…" style={{ flex: 1 }} />
          <button onClick={saveTemplate} className="btn-ghost" style={{ padding: '8px 14px', borderRadius: 8, fontSize: '.76rem', flexShrink: 0 }}>
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
          <div style={{ fontSize: '.72rem', color: 'oklch(1 0 0 / 0.35)', textAlign: 'center' }}>
            Clique em um vídeo da lista para pré-visualizar
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          RIGHT PANEL — Settings
      ══════════════════════════════════════════════════════════ */}
      <div style={{ width: 310, display: 'flex', flexDirection: 'column', borderLeft: '1px solid oklch(1 0 0 / 0.07)', background: 'oklch(0.095 0.03 235 / 0.98)', flexShrink: 0 }}>
        <div style={{ padding: '11px 14px 9px', borderBottom: '1px solid oklch(1 0 0 / 0.07)', flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Configurações do template</span>
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
                  <input type="color" value={tmpl.canvas.background} onChange={e => setT('canvas.background', e.target.value)} style={{ width: 28, height: 28, padding: 1, borderRadius: 4, border: '1px solid oklch(1 0 0 / 0.12)', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                  <input className="inp" value={tmpl.canvas.background} onChange={e => setT('canvas.background', e.target.value)} style={{ flex: 1 }} />
                </div>
              </Fld>
            </div>
          </Acc>

          {/* ENQUADRAMENTO */}
          <Acc title="Enquadramento" id="enquadramento" open={sections.enquadramento} toggle={toggleSection}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {FIT_OPTS.map(opt => (
                <label key={opt.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8, cursor: 'pointer', background: videoEl?.fit === opt.id ? 'oklch(0.55 0.18 235 / 0.16)' : 'oklch(1 0 0 / 0.03)', border: `1px solid ${videoEl?.fit === opt.id ? 'oklch(0.65 0.18 235 / 0.38)' : 'oklch(1 0 0 / 0.06)'}`, transition: 'background .12s' }}>
                  <input type="radio" name="fit" value={opt.id} checked={videoEl?.fit === opt.id} onChange={() => updEl(videoEl.id, { fit: opt.id })} style={{ marginTop: 2, accentColor: '#60a5fa', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--text)' }}>{opt.label}</div>
                    <div style={{ fontSize: '.65rem', color: 'var(--text3)', marginTop: 1 }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Acc>

          {/* REELS */}
          <Acc title="Formato Reels 9:16" id="reels" open={sections.reels} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.8rem', color: 'var(--text)', padding: '4px 0' }}>
              <input type="checkbox" checked={tmpl.canvas.width === 1080 && tmpl.canvas.height === 1920} onChange={e => { if (e.target.checked) { setT('canvas.width', 1080); setT('canvas.height', 1920); } }} style={{ accentColor: '#4ade80' }} />
              Converter para 1080×1920 (Reels/TikTok)
            </label>
            <p style={{ margin: '8px 0 0', fontSize: '.68rem', color: 'var(--text3)', lineHeight: 1.5 }}>Usa o enquadramento selecionado acima para adaptar qualquer vídeo ao formato vertical.</p>
          </Acc>

          {/* BORDA */}
          <Acc title="Borda / Moldura" id="borda" open={sections.borda} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.8rem', color: 'var(--text)', marginBottom: 10 }}>
              <input type="checkbox" checked={tmpl.border?.enabled || false} onChange={e => setT('border.enabled', e.target.checked)} style={{ accentColor: '#60a5fa' }} />
              Ativar borda
            </label>
            {tmpl.border?.enabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Fld label="Espessura (px)"><input className="inp" type="number" min="1" max="500" value={tmpl.border.thickness || 4} onChange={e => setT('border.thickness', Number(e.target.value))} style={INP} /></Fld>
                <Fld label="Opacidade (0–1)"><input className="inp" type="number" step="0.05" min="0" max="1" value={tmpl.border.opacity ?? 1} onChange={e => setT('border.opacity', Number(e.target.value))} style={INP} /></Fld>
                <Fld label="Cor" span2>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="color" value={tmpl.border.color || '#FFFFFF'} onChange={e => setT('border.color', e.target.value)} style={{ width: 30, height: 28, padding: 1, borderRadius: 5, border: '1px solid oklch(1 0 0 / 0.12)', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                    <input className="inp" value={tmpl.border.color || '#FFFFFF'} onChange={e => setT('border.color', e.target.value)} style={{ flex: 1 }} />
                  </div>
                </Fld>
              </div>
            )}
          </Acc>

          {/* OVERLAYS */}
          <Acc title="Overlays / Imagens" id="overlays" open={sections.overlays} toggle={toggleSection} count={imageEls.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {imageEls.map(el => (
                <div key={el.id} style={CARD_SM}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: '.7rem', fontWeight: 600, color: '#60a5fa' }}>{el.label || 'Imagem'}</span>
                    <button onClick={() => removeEl(el.id)} className="btn-ghost" style={{ padding: '1px 7px', fontSize: '.68rem', color: '#f87171', borderRadius: 4 }}>✕</button>
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
              <button onClick={addImageEl} className="btn-ghost" style={{ padding: '7px 0', borderRadius: 7, fontSize: '.74rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
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
                    <span style={{ fontSize: '.7rem', fontWeight: 600, color: '#4ade80' }}>{el.label || 'Texto'}</span>
                    <button onClick={() => removeEl(el.id)} className="btn-ghost" style={{ padding: '1px 7px', fontSize: '.68rem', color: '#f87171', borderRadius: 4 }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <Fld label="Texto ou {{VAR}}" span2><input className="inp" value={el.text} onChange={e => updEl(el.id, { text: e.target.value })} placeholder="{{TITULO}}" style={INP} /></Fld>
                    <Fld label="X"><input className="inp" type="number" value={el.x||0} onChange={e => updEl(el.id, { x: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Y"><input className="inp" type="number" value={el.y||0} onChange={e => updEl(el.id, { y: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Tamanho fonte"><input className="inp" type="number" value={el.fontSize||48} onChange={e => updEl(el.id, { fontSize: Number(e.target.value) })} style={INP} /></Fld>
                    <Fld label="Cor">
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input type="color" value={el.color||'#FFFFFF'} onChange={e => updEl(el.id, { color: e.target.value })} style={{ width: 27, height: 28, padding: 1, borderRadius: 4, border: '1px solid oklch(1 0 0 / 0.12)', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
                        <input className="inp" value={el.color||'#FFFFFF'} onChange={e => updEl(el.id, { color: e.target.value })} style={{ flex: 1 }} />
                      </div>
                    </Fld>
                  </div>
                </div>
              ))}
              <button onClick={addTextEl} className="btn-ghost" style={{ padding: '7px 0', borderRadius: 7, fontSize: '.74rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
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
            <p style={{ margin: '8px 0 0', fontSize: '.68rem', color: 'var(--text3)', lineHeight: 1.5 }}>
              Corta o vídeo antes das demais operações. Aplicado via -ss / -to no FFmpeg.
            </p>
          </Acc>

          {/* VOLUME */}
          <Acc title="Volume" id="volume" open={sections.volume} toggle={toggleSection}>
            <Fld label={`Volume original: ${Math.round((tmpl.audio?.originalVolume ?? 1) * 100)}%`}>
              <input type="range" min="0" max="2" step="0.05" value={tmpl.audio?.originalVolume ?? 1} onChange={e => setT('audio.originalVolume', Number(e.target.value))} style={{ width: '100%', accentColor: '#4ade80', marginTop: 2 }} />
            </Fld>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.78rem', color: 'var(--text)', marginTop: 10 }}>
              <input type="checkbox" checked={tmpl.audio?.keepOriginal !== false} onChange={e => setT('audio.keepOriginal', e.target.checked)} style={{ accentColor: '#4ade80' }} />
              Manter áudio original
            </label>
          </Acc>

          {/* ÁUDIO 2ª CAMADA */}
          <Acc title="Áudio (2ª camada)" id="audio" open={sections.audio} toggle={toggleSection}>
            <Fld label="Trilha de fundo (caminho no servidor)">
              <input className="inp" value={tmpl.audio?.musicTrack || ''} onChange={e => setT('audio.musicTrack', e.target.value)} placeholder="/uploads/musica.mp3" style={INP} />
            </Fld>
            <Fld label={`Volume da trilha: ${Math.round((tmpl.audio?.musicVolume ?? 0.3) * 100)}%`} style={{ marginTop: 8 }}>
              <input type="range" min="0" max="2" step="0.05" value={tmpl.audio?.musicVolume ?? 0.3} onChange={e => setT('audio.musicVolume', Number(e.target.value))} style={{ width: '100%', accentColor: '#60a5fa', marginTop: 2 }} />
            </Fld>
            <p style={{ margin: '8px 0 0', fontSize: '.68rem', color: 'var(--text3)', lineHeight: 1.4 }}>Mistura automaticamente com o áudio original via amix no FFmpeg.</p>
          </Acc>

          {/* QUALIDADE */}
          <Acc title="Qualidade" id="qualidade" open={sections.qualidade} toggle={toggleSection}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {QUALITY_OPTS.map(q => (
                <label key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 8, cursor: 'pointer', background: tmpl.output?.crf === q.crf ? 'oklch(0.55 0.18 235 / 0.16)' : 'oklch(1 0 0 / 0.03)', border: `1px solid ${tmpl.output?.crf === q.crf ? 'oklch(0.65 0.18 235 / 0.38)' : 'oklch(1 0 0 / 0.06)'}` }}>
                  <input type="radio" name="quality" checked={tmpl.output?.crf === q.crf} onChange={() => { setT('output.crf', q.crf); setT('output.preset', q.preset); }} style={{ accentColor: '#60a5fa', flexShrink: 0 }} />
                  <span style={{ fontSize: '.76rem', color: 'var(--text)' }}>{q.label}</span>
                </label>
              ))}
            </div>
          </Acc>

          {/* METADADOS */}
          <Acc title="Metadados" id="metadados" open={sections.metadados} toggle={toggleSection}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.8rem', color: 'var(--text)' }}>
              <input type="checkbox" checked={tmpl.output?.removeMetadata !== false} onChange={e => setT('output.removeMetadata', e.target.checked)} style={{ accentColor: '#60a5fa' }} />
              Remover metadados do arquivo final
            </label>
            <p style={{ margin: '8px 0 0', fontSize: '.68rem', color: 'var(--text3)', lineHeight: 1.4 }}>Remove EXIF, GPS, câmera e informações do autor via -map_metadata -1 no FFmpeg.</p>
          </Acc>

        </div>

        {/* Process button */}
        <div style={{ padding: '11px 12px', borderTop: '1px solid oklch(1 0 0 / 0.08)', flexShrink: 0 }}>
          {selectedCount === 0 && files.length > 0 && (
            <p style={{ fontSize: '.7rem', color: 'var(--text3)', textAlign: 'center', margin: '0 0 8px' }}>Marque os vídeos na lista para processar</p>
          )}
          {files.length === 0 && (
            <p style={{ fontSize: '.7rem', color: 'var(--text3)', textAlign: 'center', margin: '0 0 8px' }}>Adicione vídeos para começar</p>
          )}
          <button
            onClick={() => selectedCount > 0 && !saving && setConfirmOpen(true)}
            disabled={selectedCount === 0 || saving}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
              cursor: selectedCount === 0 || saving ? 'not-allowed' : 'pointer',
              background: selectedCount > 0 && !saving
                ? 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)'
                : 'oklch(1 0 0 / 0.07)',
              color: selectedCount > 0 && !saving ? '#fff' : 'var(--text3)',
              fontWeight: 700, fontSize: '.85rem', letterSpacing: '.02em',
              boxShadow: selectedCount > 0 && !saving ? '0 4px 18px rgba(34,197,94,.28)' : 'none',
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

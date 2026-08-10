import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Plus, Pause, Play, Trash2, Clock, Film,
  History, AlertTriangle, CheckCircle, X,
  Upload, Hash, Sparkles,
} from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import PageShell from '../components/PageShell';
import AccountPicker from '../components/AccountPicker';
import LibraryPickerModal from '../components/LibraryPickerModal';
import { getCTASuffix, setCTASuffix, applyCTASuffix } from '../services/captionSuffix';
import './Loop.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const HASHTAG_SETS = [
  { label: '🔥 Virais',  tags: ['#viral', '#viralbrasil', '#fyp', '#foryoupage', '#trending', '#explorepage', '#explore'] },
  { label: '🎬 Reels BR', tags: ['#reels', '#reelsdobrasil', '#reelsbrasil', '#reelsviral', '#instareels', '#reelsvideo'] },
  { label: '💬 Engaja',   tags: ['#comentaaqui', '#comenta', '#segueme', '#follow', '#curtaaqui', '#dica', '#compartilha'] },
  { label: '💼 Negócios', tags: ['#empreendedor', '#empreendedorismo', '#marketingdigital', '#negócios', '#dinheiro', '#riqueza'] },
];

/* ── Deriva URL de thumbnail a partir do nome do arquivo ── */
function thumbSrc(filename) {
  if (!filename) return null;
  const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(filename);
  if (isVideo) return `${API_URL}/uploads/${filename.replace(/\.[^.]+$/, '')}.thumb.jpg`;
  return `${API_URL}/uploads/${filename}`;
}

/* ── Thumbnail de arquivo no servidor (loop existente ou modal) ── */
function MediaThumb({ filename, thumbnail, index, selected, onClick, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const src = thumbnail ? `${API_URL}/uploads/${thumbnail}` : thumbSrc(filename);
  return (
    <button
      type="button"
      className={`lm-thumb lm-thumb--${size}${selected ? ' sel' : ''}`}
      onClick={onClick}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="lm-thumb-fallback"><Film size={size === 'sm' ? 14 : 20} /></div>
      )}
      <span className="lm-num">#{index + 1}</span>
      {selected && <div className="lm-chk2"><CheckCircle size={12} /></div>}
    </button>
  );
}

/* ── Thumbnail compacta para o strip do LoopCard ── */
function LoopThumb({ filename, index }) {
  const [failed, setFailed] = useState(false);
  const src = thumbSrc(filename);
  return (
    <div className="lc-thumb-item">
      {src && !failed
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <div className="lc-thumb-fallback"><Film size={13} /></div>}
      <span className="lc-thumb-num">#{index + 1}</span>
    </div>
  );
}

function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  return `${Math.floor(s / 3600)}h atrás`;
}
function timeUntil(date) {
  if (!date) return '—';
  const s = Math.floor((new Date(date) - Date.now()) / 1000);
  if (s <= 0) return 'agora';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}
function formatNum(n) {
  if (n == null) return null;
  if (n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'K';
  return n.toString();
}
function healthLabel(s) {
  const m = { ativa:'Saudável', restrita:'Restrita', erro_login:'Erro login',
    sessao_expirada:'Sessão exp.', banida:'Banida',
    token_invalido:'Token inv.', conta_pessoal:'Pessoal' };
  return m[s] || 'Saudável';
}
function healthCls(s) {
  if (!s || s === 'ativa') return 'ok';
  if (s === 'restrita' || s === 'sessao_expirada') return 'warn';
  if (s === 'conta_pessoal') return 'muted';
  return 'err';
}

/* ──────────────────── Loop Card ──────────────────── */
function LoopCard({ loop, onToggle, onDelete, onHistory }) {
  const running     = loop.status === 'ativo';
  const mediaCount  = loop.mediaFiles?.length || 0;
  const processando = loop._jobStatus === 'running' ? 1 : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className={`lc ${running ? 'lc--on' : 'lc--off'}`}
    >
      <span className={`lc-dot ${running ? 'on' : 'off'}`} />

      <div className="lc-body">
        <div className="lc-top">
          <span className="lc-name">{loop.name || `Loop #${loop._id?.slice(-4)}`}</span>
          <div className="lc-btns">
            <button onClick={() => onHistory(loop)}><History size={12} /></button>
            <button onClick={() => onToggle(loop)} className={running ? 'warn' : 'ok'}>
              {running ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button onClick={() => onDelete(loop)} className="del"><Trash2 size={12} /></button>
          </div>
        </div>
        <div className="lc-meta">
          <span className="lc-sub">{loop.type} · {mediaCount} mídias</span>
          <div className="lc-chips">
            <span className="lc-chip"><Clock size={9} /> {loop.intervalMinutes}m</span>
            {mediaCount > 0 && (
              <span className="lc-chip lc-chip--fila">
                FILA: {mediaCount}, {processando} processando
              </span>
            )}
            <span className="lc-chip">{loop.roundsCompleted || loop.postsCount || 0} ciclos</span>
            {running && <span className="lc-chip lc-chip--next">em {timeUntil(loop.nextRunAt)}</span>}
            {loop.lastRunAt && <span className="lc-chip">{timeAgo(loop.lastRunAt)}</span>}
          </div>
        </div>
        {loop.lastError && (
          <div className="lc-err"><AlertTriangle size={10} />{loop.lastError}</div>
        )}
      </div>

      {mediaCount > 0 && (
        <div className="lc-thumbs">
          {(loop.mediaFiles || []).slice(0, 8).map((f, i) => (
            <LoopThumb key={f} filename={f} index={i} />
          ))}
          {mediaCount > 8 && (
            <div className="lc-thumbs-more">+{mediaCount - 8}</div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ──────────────────── Modal ──────────────────── */
function LoopModal({ onClose, onCreated }) {
  const [accounts,      setAccounts]      = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [legends,       setLegends]       = useState([]);
  const [uploading,     setUploading]     = useState(false);
  const [uploadingCover,setUploadingCover]= useState(false);
  const [dragOver,      setDragOver]      = useState(false);
  const [dragOverCover, setDragOverCover] = useState(false);
  const [legendOpen,    setLegendOpen]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState('');
  const [hashtagCat,    setHashtagCat]    = useState(null);
  const [mediaSource,   setMediaSource]   = useState('upload');
  const [showLibPicker, setShowLibPicker] = useState(false);
  const [ctaSuffix,     setCtaSuffixState] = useState(() => getCTASuffix());
  const fileInputRef  = useRef();
  const coverInputRef = useRef();

  function updateCtaSuffix(patch) {
    const next = { ...ctaSuffix, ...patch };
    setCtaSuffixState(next);
    setCTASuffix(next);
  }
  const legendRef     = useRef();

  const [form, setForm] = useState({
    name: '', accounts: [], mediaFiles: [],
    type: 'reel', intervalMinutes: '', caption: '', coverFile: '', ctaComment: '', engageComment: '',
    processMode: 'limpeza_leve',
  });

  const processModes = [
    { id: 'sem_limpeza',  label: 'Sem Limpeza',  tag: 'SAFE',  desc: 'Posta o vídeo original, sem alterar nada',             color: '#10b981' },
    { id: 'limpeza_leve', label: 'Limpeza Leve', tag: 'RECOM', desc: 'Remove metadados e gera hash diferente',                color: '#3b82f6' },
    { id: 'ultra_clean',  label: 'Ultra Clean',  tag: 'ULTRA', desc: 'Remove todos metadados + re-encoda o vídeo',            color: '#8b5cf6' },
    { id: 'humanizador',  label: 'Humanizador',  tag: 'MAX',   desc: 'Micro-crop + cor + pitch áudio + CRF aleatório',        color: '#f59e0b' },
  ];

  useEffect(() => {
    api.get('/accounts').then(r => setAccounts(r.data?.accounts || r.data || [])).catch(() => {});
    api.get('/legends').then(r => setLegends(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!legendOpen) return;
    const close = e => { if (legendRef.current && !legendRef.current.contains(e.target)) setLegendOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [legendOpen]);

  const tog = (key, val) => setForm(f => ({
    ...f,
    [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val],
  }));

  async function handleUpload(files, isCover = false) {
    if (!files?.length) return;
    if (isCover) setUploadingCover(true); else setUploading(true);
    setErr('');
    const fileArr = Array.from(files);
    try {
      if (isCover) {
        // capa: envia arquivo único
        const fd = new FormData();
        fd.append('file', fileArr[0]);
        const res = await api.post('/loops/upload-media', fd);
        const newFiles = res.data.files || [];
        if (newFiles.length > 0) setForm(f => ({ ...f, coverFile: newFiles[newFiles.length - 1].filename }));
      } else {
        // reels: envia um por vez, adiciona na lista conforme vai subindo
        for (const file of fileArr) {
          try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post('/loops/upload-media', fd);
            const newFiles = res.data.files || [];
            if (newFiles.length > 0) {
              setUploadedFiles(prev => [...prev, ...newFiles]);
              setForm(f => ({ ...f, mediaFiles: [...new Set([...f.mediaFiles, ...newFiles.map(x => x.filename)])] }));
            }
          } catch (ex) {
            const status = ex.response?.status;
            const data   = ex.response?.data;
            const msg    = data?.error
              || (typeof data === 'string' ? data.slice(0, 120) : null)
              || ex.message
              || 'sem resposta do servidor';
            setErr(`[${status ?? 'network'}] ${msg}`);
          }
        }
      }
    } finally {
      if (isCover) setUploadingCover(false); else setUploading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.accounts.length) return setErr('Selecione ao menos uma conta.');
    if (!form.mediaFiles.length) return setErr('Envie ao menos um reel para o loop.');
    const intervalVal = Number(String(form.intervalMinutes).trim());
    if (!intervalVal || intervalVal < 1) return setErr('Informe um intervalo válido (mínimo 1 minuto).');
    setSaving(true);
    try {
      const res = await api.post('/loops', { ...form, caption: applyCTASuffix(form.caption, ctaSuffix), intervalMinutes: intervalVal });
      onCreated(res.data); onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally { setSaving(false); }
  }

  const selectedLegendLabel = () => {
    if (!form.caption) return 'Sem legenda';
    const found = legends.find(l => (l.text || l.content || '') === form.caption);
    return found ? (found.title || form.caption.slice(0, 40)) : form.caption.slice(0, 40) + (form.caption.length > 40 ? '…' : '');
  };

  return (
    <motion.div
      className="lm-bg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="lm"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      >

        {/* Header */}
        <div className="lm-hd">
          <div className="lm-hd-l">
            <div className="lm-ico"><RefreshCw size={16} /></div>
            <div>
              <h2>Novo loop contínuo</h2>
              <p>{form.mediaFiles.length > 0
                ? `${form.mediaFiles.length} mídia(s)${form.coverFile ? ' · capa definida' : ''}`
                : 'Configure as opções do loop'}</p>
            </div>
          </div>
          <button className="lm-x" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Single-page form */}
        <form onSubmit={submit} className="lm-body">

          {/* Nome */}
          <div className="lm-row">
            <label className="lm-label">Nome</label>
            <input className="lm-input" placeholder="Ex.: Ciclo motivacional"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {/* Contas */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label">
                Contas&nbsp;<span className="lm-count">({form.accounts.length} selecionada{form.accounts.length !== 1 ? 's' : ''})</span>
              </label>
            </div>
            <AccountPicker
              accounts={accounts}
              selected={form.accounts}
              onChange={ids => setForm(f => ({ ...f, accounts: ids }))}
            />
          </div>

          {/* Tipo + Intervalo */}
          <div className="lm-2col">
            <div className="lm-row">
              <label className="lm-label">Tipo</label>
              <div className="lm-tabs">
                {[['reel','Reels'],['post','Feed'],['story','Stories']].map(([v,l]) => (
                  <button key={v} type="button"
                    className={form.type === v ? 'a' : ''}
                    onClick={() => setForm(f => ({ ...f, type: v }))}>{l}</button>
                ))}
              </div>
            </div>
            <div className="lm-row">
              <label className="lm-label">Intervalo entre posts</label>
              <div className="lm-int">
                <input type="text" inputMode="numeric" placeholder="minutos"
                  value={form.intervalMinutes}
                  onChange={e => setForm(f => ({ ...f, intervalMinutes: e.target.value }))} />
                <span>min</span>
              </div>
              <span className="lm-hint">Mínimo 5 min</span>
            </div>
          </div>

          {/* Reels do loop */}
          {showLibPicker && (
            <LibraryPickerModal
              onClose={() => setShowLibPicker(false)}
              onConfirm={items => {
                const newFilenames = items.map(m => m.filename).filter(Boolean);
                setForm(f => ({ ...f, mediaFiles: [...new Set([...f.mediaFiles, ...newFilenames])] }));
              }}
            />
          )}
          <div className="lm-section">
            <div className="lm-section-hd">
              <div className="lm-section-hd-l">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/></svg>
                <span className="lm-label">Reels do loop</span>
                {form.mediaFiles.length === 0
                  ? <span className="lm-section-note">Nenhum reel — envie agora</span>
                  : <span className="lm-section-count">{form.mediaFiles.length}</span>}
              </div>
              {/* Source toggle */}
              <div style={{ display: 'flex', background: 'oklch(0.10 0.03 235 / 0.8)', border: '1px solid oklch(1 0 0 / 0.08)', borderRadius: 7, padding: 2, gap: 2, marginRight: 4 }}>
                {[['upload','⬆ Upload'],['library','📁 Biblioteca']].map(([src, lbl]) => (
                  <button key={src} type="button"
                    onClick={() => setMediaSource(src)}
                    style={{ padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: mediaSource === src ? 700 : 400, cursor: 'pointer', border: 'none', transition: '.15s',
                      background: mediaSource === src ? 'oklch(0.60 0.22 295)' : 'transparent',
                      color: mediaSource === src ? '#fff' : 'var(--text3)',
                    }}>{lbl}</button>
                ))}
              </div>
              {mediaSource === 'upload' && (
                <>
                  <button type="button" className="lm-upload-btn" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={11} /> Enviar reels
                  </button>
                  <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" hidden
                    onChange={e => handleUpload(e.target.files)} />
                </>
              )}
            </div>

            {mediaSource === 'upload' ? (
              <>
                <div
                  className={`lm-dropzone lm-dropzone--sm ${dragOver ? 'drag' : ''}`}
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
                >
                  <div className="lm-dz-inner">
                    {uploading
                      ? <><RefreshCw size={20} className="spin lm-dz-ic" /><span className="lm-dz-sub">Fazendo upload...</span></>
                      : <><Upload size={20} className="lm-dz-ic" />
                          <span className="lm-dz-sub">Arraste ou envie seus reels</span>
                          <span className="lm-dz-formats">MP4, MOV — envio em paralelo</span></>}
                  </div>
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="lm-grid" style={{ marginTop: 8 }}>
                    {uploadedFiles.map((m, i) => {
                      const sel = form.mediaFiles.includes(m.filename);
                      return (
                        <MediaThumb
                          key={m.filename}
                          filename={m.filename}
                          thumbnail={m.thumbnail}
                          index={i}
                          selected={sel}
                          onClick={() => tog('mediaFiles', m.filename)}
                        />
                      );
                    })}
                  </div>
                )}
                <p className="lm-section-footer">
                  Reels enviados aqui rodam somente neste loop e são apagados automaticamente após publicar — não ficam salvos no sistema.
                </p>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setShowLibPicker(true)}
                  style={{ width: '100%', marginTop: 8, padding: '16px', border: '1.5px dashed oklch(0.82 0.19 196 / 0.35)', borderRadius: 10, background: 'oklch(0.82 0.19 196 / 0.04)', cursor: 'pointer', color: 'var(--cyan)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: '.15s' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Escolher da biblioteca</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>Selecione mídias já salvas nas suas pastas</span>
                </button>
                {form.mediaFiles.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{form.mediaFiles.length} selecionado(s)</span>
                      <button type="button" onClick={() => setShowLibPicker(true)} style={{ fontSize: 10, color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Adicionar mais</button>
                    </div>
                    <div className="lm-grid">
                      {form.mediaFiles.map((filename, i) => (
                        <MediaThumb
                          key={filename}
                          filename={filename}
                          index={i}
                          selected
                          onClick={() => setForm(f => ({ ...f, mediaFiles: f.mediaFiles.filter(x => x !== filename) }))}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <p className="lm-section-footer" style={{ marginTop: 8 }}>
                  Arquivos da biblioteca ficam salvos permanentemente — o loop os usa sem deletar.
                </p>
              </>
            )}
          </div>

          {/* Capa dos Reels */}
          <div className="lm-section">
            <div className="lm-section-hd">
              <div className="lm-section-hd-l">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="lm-label">Capa dos Reels (opcional)</span>
              </div>
              <button type="button" className="lm-upload-btn" onClick={() => coverInputRef.current?.click()}>
                <Upload size={11} /> Enviar capa
              </button>
              <input ref={coverInputRef} type="file" accept="image/*" hidden
                onChange={e => handleUpload(e.target.files, true)} />
            </div>

            {form.coverFile ? (
              <div className="lm-cover-preview">
                <img src={`${API_URL}/uploads/${form.coverFile}`} alt="Capa" />
                <button type="button" className="lm-cover-remove" onClick={() => setForm(f => ({ ...f, coverFile: '' }))}>
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div
                className={`lm-dropzone lm-dropzone--sm ${dragOverCover ? 'drag' : ''}`}
                onClick={() => !uploadingCover && coverInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOverCover(true); }}
                onDragLeave={() => setDragOverCover(false)}
                onDrop={e => { e.preventDefault(); setDragOverCover(false); handleUpload(e.dataTransfer.files, true); }}
              >
                <div className="lm-dz-inner">
                  {uploadingCover
                    ? <><RefreshCw size={20} className="spin lm-dz-ic" /><span className="lm-dz-sub">Enviando capa...</span></>
                    : <><svg width="20" height="20" className="lm-dz-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <span className="lm-dz-sub">Arraste ou envie uma imagem 1080×1920</span></>}
                </div>
              </div>
            )}

            <p className="lm-section-footer">Sem capa selecionada — usa o primeiro frame do vídeo.</p>
          </div>

          {/* Legenda */}
          <div className="lm-row">
            <label className="lm-label">Legenda</label>
            <div ref={legendRef} className="lm-legend-wrap">
              <button type="button" className="lm-legend-trigger" onClick={() => setLegendOpen(o => !o)}>
                <span>{selectedLegendLabel()}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: legendOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {legendOpen && (
                <div className="lm-legend-panel">
                  <div className={`lm-legend-opt ${!form.caption ? 'sel' : ''}`}
                    onClick={() => { setForm(f => ({ ...f, caption: '' })); setLegendOpen(false); }}>
                    <span className="lm-leg-dot" /> Sem legenda
                  </div>
                  {legends.length > 0 && <div className="lm-legend-divider" />}
                  {legends.map(leg => {
                    const txt = leg.text || leg.content || '';
                    const sel = form.caption === txt;
                    return (
                      <div key={leg._id || txt} className={`lm-legend-opt ${sel ? 'sel' : ''}`}
                        onClick={() => { setForm(f => ({ ...f, caption: txt })); setLegendOpen(false); }}>
                        <span className="lm-leg-dot" />
                        <span className="lm-legend-opt-text">{leg.title || txt.slice(0, 60)}</span>
                      </div>
                    );
                  })}
                  {legends.length === 0 && (
                    <div className="lm-legend-empty">Nenhuma legenda salva ainda.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sufixo automático na legenda */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={ctaSuffix.enabled} onChange={e => updateCtaSuffix({ enabled: e.target.checked })}
                  style={{ accentColor: 'var(--cyan)', width: 14, height: 14 }} />
                Sufixo automático na legenda
              </label>
            </div>
            {ctaSuffix.enabled && (
              <>
                <textarea className="lm-input" rows={2}
                  value={ctaSuffix.text}
                  onChange={e => updateCtaSuffix({ text: e.target.value })}
                  placeholder={'Ex: \n\n🔗 Link na bio'} />
                <div className="lm-cta-hint">Adicionado ao final da legenda em cada publicação do loop</div>
              </>
            )}
          </div>

          {/* Comentário CTA */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                Comentário CTA (auto-postado)
              </label>
              <label className="lm-cta-toggle">
                <input type="checkbox"
                  checked={!!form.ctaComment}
                  onChange={e => setForm(f => ({ ...f, ctaComment: e.target.checked ? '👇 Acesse meu bot no Telegram!\n🤖 {link}' : '' }))}
                />
                <span className="lm-cta-knob" />
              </label>
            </div>
            {!!form.ctaComment && (
              <>
                <textarea className="lm-input" rows={2}
                  value={form.ctaComment}
                  onChange={e => setForm(f => ({ ...f, ctaComment: e.target.value }))} />
                <div className="lm-cta-hint">Postado ~2 min após publicar · Use <code>{'{link}'}</code> <code>{'{username}'}</code></div>
              </>
            )}
          </div>

          {/* Pergunta de engajamento */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label">Pergunta de engajamento</label>
              <label className="lm-cta-toggle">
                <input type="checkbox"
                  checked={!!form.engageComment}
                  onChange={e => setForm(f => ({ ...f, engageComment: e.target.checked ? 'O que acharam? 👇 Comenta aí!' : '' }))}
                />
                <span className="lm-cta-knob" />
              </label>
            </div>
            {!!form.engageComment && (
              <>
                <textarea className="lm-input" rows={2}
                  value={form.engageComment}
                  onChange={e => setForm(f => ({ ...f, engageComment: e.target.value }))} />
                <div className="lm-cta-hint">Postado ~60 min após publicar</div>
              </>
            )}
          </div>

          {/* Modo de processamento */}
          <div className="lm-row">
            <label className="lm-label">Modo de processamento</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {processModes.map(m => (
                <div key={m.id} onClick={() => setForm(f => ({ ...f, processMode: m.id }))}
                  style={{
                    padding: '9px 12px', borderRadius: 9, cursor: 'pointer', border: '1px solid',
                    background: form.processMode === m.id ? `${m.color}14` : 'oklch(0.10 0.03 235 / 0.5)',
                    borderColor: form.processMode === m.id ? `${m.color}44` : 'oklch(1 0 0 / 0.07)',
                    transition: 'all .15s',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: form.processMode === m.id ? m.color : 'var(--text)' }}>{m.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${m.color}22`, color: m.color, fontFamily: 'var(--font-mono)' }}>{m.tag}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hashtags para viralizar */}
          <div className="lm-row lm-htag-row">
            <div className="lm-row-hd">
              <label className="lm-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
                <Hash size={12} /> Hashtags para viralizar
              </label>
              <span className="lm-viral-badge"><Sparkles size={9} /> viralize</span>
            </div>
            <div className="lm-htag-cats">
              {HASHTAG_SETS.map(cat => (
                <button key={cat.label} type="button"
                  className={`lm-htag-cat${hashtagCat === cat.label ? ' active' : ''}`}
                  onClick={() => setHashtagCat(h => h === cat.label ? null : cat.label)}>
                  {cat.label}
                </button>
              ))}
            </div>
            {hashtagCat && (
              <div className="lm-htag-chips">
                {HASHTAG_SETS.find(c => c.label === hashtagCat)?.tags.map(tag => {
                  const used = form.caption.includes(tag);
                  return (
                    <button key={tag} type="button"
                      className={`lm-htag-chip${used ? ' used' : ''}`}
                      onClick={() => !used && setForm(f => ({ ...f, caption: (f.caption + ' ' + tag).trim() }))}>
                      {tag} {used && <CheckCircle size={9} />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="lm-viral-tips">
              <span>⏰ <strong>7h-9h · 12h-14h · 19h-22h</strong></span>
              <span className="lm-vtip-sep">·</span>
              <span>📅 Intervalo ideal: <strong>8-12h</strong></span>
              <span className="lm-vtip-sep">·</span>
              <span>🎯 3-5 hashtags de nicho</span>
            </div>
          </div>

          {err && <div className="lm-err"><AlertTriangle size={13} />{err}</div>}

          <div className="lm-ft">
            <button type="button" className="lm-cancel" onClick={onClose}>Cancelar</button>
            <button type="submit" className="lm-next" disabled={saving || uploading}>
              {saving ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
              {saving ? 'Criando...' : 'Criar loop'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* ──────────────────── Página ──────────────────── */
export default function LoopPage() {
  const [loops,     setLoops]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [histLoop,    setHistLoop]    = useState(null);
  const [histPosts,   setHistPosts]   = useState([]);
  const [genThumb,    setGenThumb]    = useState('idle'); // idle|loading|done|error
  const [deleteModal, setDeleteModal] = useState(null);

  const load = useCallback(async () => {
    try { const r = await api.get('/loops'); setLoops(r.data || []); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  async function handleGenThumbs() {
    if (genThumb === 'loading') return;
    setGenThumb('loading');
    try {
      await api.post('/loops/generate-thumbs');
      setGenThumb('done');
      setTimeout(() => { setGenThumb('idle'); load(); }, 4000);
    } catch {
      setGenThumb('error');
      setTimeout(() => setGenThumb('idle'), 3000);
    }
  }

  async function handleToggle(loop) {
    try {
      const r = await api.post(`/loops/${loop._id}/toggle`);
      setLoops(ls => ls.map(l => l._id === loop._id ? r.data : l));
    } catch (e) { alert(e.response?.data?.error || e.message); }
  }
  function handleDelete(loop) {
    setDeleteModal(loop);
  }
  async function confirmDelete() {
    const loop = deleteModal;
    setDeleteModal(null);
    try { await api.delete(`/loops/${loop._id}`); setLoops(ls => ls.filter(l => l._id !== loop._id)); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }
  async function handleHistory(loop) {
    setHistLoop(loop);
    try { const r = await api.get(`/loops/${loop._id}/history`); setHistPosts(r.data || []); }
    catch { setHistPosts([]); }
  }

  const byAccount = {};
  for (const loop of loops) {
    for (const acc of (loop.accounts || [])) {
      const k = acc._id || acc;
      if (!byAccount[k]) byAccount[k] = { account: acc, loops: [] };
      byAccount[k].loops.push(loop);
    }
  }

  const activeCount = loops.filter(l => l.status === 'ativo').length;
  const totalPosts  = loops.reduce((s, l) => s + (l.postsCount || 0), 0);

  const pageActions = (
    <>
      <div className="lp-chip"><RefreshCw size={12} /> {activeCount} ativos</div>
      <div className="lp-chip"><Film size={12} /> {totalPosts} publicados</div>
      <button
        onClick={handleGenThumbs}
        disabled={genThumb === 'loading'}
        title="Gerar thumbnails para vídeos antigos que não têm preview"
        style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 13px', fontSize:'.78rem', fontWeight:600, borderRadius:9, border:'1px solid var(--border)', background:'transparent', color: genThumb === 'done' ? '#34d399' : genThumb === 'error' ? '#f87171' : 'var(--text2)', cursor: genThumb === 'loading' ? 'default' : 'pointer', transition:'color .2s' }}>
        {genThumb === 'loading' ? <RefreshCw size={12} className="spin" /> : <Film size={12} />}
        {genThumb === 'done' ? 'Pronto!' : genThumb === 'error' ? 'Erro' : 'Gerar thumbs'}
      </button>
      <button className="btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 16px', fontSize:'.83rem', fontWeight:700, borderRadius:9 }} onClick={() => setShowModal(true)}>
        <Plus size={14} /> Novo loop
      </button>
    </>
  );

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  );

  return (
    <>
      <PageShell
        icon={pageIcon}
        title="Loop Contínuo"
        subtitle="Ciclos automáticos de postagem em escala"
        accent="cyan"
        actions={pageActions}
      >
        {loading ? (
          <div className="lp-load"><RefreshCw size={18} className="spin" /> Carregando...</div>
        ) : loops.length === 0 ? (
          <motion.div
            className="lp-empty"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="lp-empty-ic"><RefreshCw size={24} /></div>
            <strong>Nenhum loop criado</strong>
            <span>Crie um loop para postar em ciclo contínuo em todas as suas contas.</span>
            <button
              className="btn-primary"
              style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:4 }}
              onClick={() => setShowModal(true)}
            >
              <Plus size={13} /> Criar loop
            </button>
          </motion.div>
        ) : (
          <motion.div
            style={{ display:'flex', flexDirection:'column', gap:20 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            {Object.values(byAccount).map(({ account, loops: al }) => (
              <div key={account._id || account} className="lp-group">
                <div className="lp-group-hd">
                  <div className="lp-av">
                    {account.avatar
                      ? <img src={`${API_URL}${account.avatar}`} alt="" />
                      : <span>{(account.username || '?')[0].toUpperCase()}</span>}
                    <i className={healthCls(account.healthStatus)} />
                  </div>

                  <div className="lp-profile">
                    <div className="lp-profile-top">
                      <strong>{account.name || account.username}</strong>
                      {account.accountType && (
                        <span className="lp-type-badge">{account.accountType}</span>
                      )}
                      <span className={`lp-health lp-health--${healthCls(account.healthStatus)}`}>
                        ● {healthLabel(account.healthStatus)}
                      </span>
                    </div>
                    <span className="lp-handle">@{account.username}</span>
                    <div className="lp-profile-stats">
                      {formatNum(account.followers) && (
                        <span><b>{formatNum(account.followers)}</b> seg</span>
                      )}
                      {formatNum(account.following) && (
                        <span><b>{formatNum(account.following)}</b> seguindo</span>
                      )}
                      {formatNum(account.postsCount) && (
                        <span><b>{formatNum(account.postsCount)}</b> pub</span>
                      )}
                      {(account.accessToken || account.igSession) && (
                        <span className="lp-api-chip">📶 API</span>
                      )}
                    </div>
                  </div>

                  <div className="lp-loop-summary">
                    <span><b>{al.length}</b> loop{al.length !== 1 ? 's' : ''}</span>
                    <span><b>{al.filter(l => l.status==='ativo').length}</b> ativo{al.filter(l => l.status==='ativo').length !== 1 ? 's' : ''}</span>
                    <span><b>{al.reduce((s,l)=>s+(l.postsCount||0),0)}</b> posts</span>
                  </div>
                </div>
                <div className="lp-loop-list">
                  <AnimatePresence>
                    {al.map(loop => (
                      <LoopCard key={loop._id} loop={loop}
                        onToggle={handleToggle} onDelete={handleDelete} onHistory={handleHistory} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </PageShell>

      <AnimatePresence>
        {showModal && (
          <LoopModal onClose={() => setShowModal(false)} onCreated={l => setLoops(ls => [l, ...ls])} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {histLoop && (
          <motion.div
            className="lm-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setHistLoop(null)}
          >
            <motion.div
              className="lm lm--sm"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.22 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="lm-hd">
                <div className="lm-hd-l">
                  <div className="lm-ico"><History size={14} /></div>
                  <div><h2>Histórico</h2><p>{histLoop.name}</p></div>
                </div>
                <button className="lm-x" onClick={() => setHistLoop(null)}><X size={15} /></button>
              </div>
              <div className="lm-hist">
                {histPosts.length === 0
                  ? <p className="lm-hist-empty">Nenhum post registrado ainda.</p>
                  : histPosts.map(p => (
                    <div key={p._id} className="lm-hist-row">
                      <span className={`lm-hist-tag ${p.status}`}>{p.status}</span>
                      <span className="lm-hist-f">{p.media}</span>
                      <span className="lm-hist-d">{new Date(p.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteModal && (
          <motion.div
            className="lm-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDeleteModal(null)}
          >
            <motion.div
              className="lm lm--sm"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: 400, padding: 0, overflow: 'hidden' }}
            >
              <div style={{ padding: '28px 28px 8px', textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: 'oklch(0.4 0.18 15 / 0.15)', border: '1px solid oklch(0.5 0.18 15 / 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
                  <Trash2 size={24} style={{ color: 'oklch(0.65 0.2 15)' }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Excluir loop?</h3>
                <p style={{ fontSize: 13, color: 'var(--text3)', margin: '0 0 4px' }}>Você está prestes a excluir</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px' }}>"{deleteModal.name}"</p>
                <p style={{ fontSize: 12, color: 'oklch(0.7 0.18 15 / 0.9)', background: 'oklch(0.4 0.18 15 / 0.1)', borderRadius: 8, padding: '8px 12px', margin: '0 0 24px', border: '1px solid oklch(0.5 0.18 15 / 0.2)', lineHeight: 1.5 }}>
                  Esta ação não pode ser desfeita. O histórico de posts e as configurações serão perdidos.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, padding: '0 24px 24px' }}>
                <button
                  onClick={() => setDeleteModal(null)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid oklch(1 0 0 / 0.12)', background: 'oklch(1 0 0 / 0.05)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: '.15s' }}
                >Cancelar</button>
                <button
                  onClick={confirmDelete}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid oklch(0.5 0.2 15 / 0.5)', background: 'oklch(0.5 0.22 15)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: '.15s' }}
                >Excluir loop</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

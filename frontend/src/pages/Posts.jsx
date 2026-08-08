import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import AccountPicker from '../components/AccountPicker';

/* ── Custom legend dropdown ── */
function LegendDropdown({ legends, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = legends.find(l => l._id === value);

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'oklch(0.10 0.03 235 / 0.8)',
          border: `1px solid ${open ? 'var(--cyan)' : 'oklch(1 0 0 / 0.09)'}`,
          borderRadius: open ? '9px 9px 0 0' : 9,
          padding: '9px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left',
          color: selected ? 'var(--text)' : 'var(--text3)',
          transition: 'border-color .15s',
          boxShadow: open ? '0 0 0 3px oklch(0.82 0.19 196 / 0.08)' : 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selected ? selected.title : 'Selecione uma legenda salva...'}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
          style={{ flexShrink: 0, marginLeft: 8, transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--text3)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: 'oklch(0.14 0.04 235 / 0.98)', border: '1px solid oklch(1 0 0 / 0.1)',
          borderTop: 'none', borderRadius: '0 0 10px 10px',
          boxShadow: '0 16px 40px oklch(0 0 0 / 0.55)', maxHeight: 220, overflowY: 'auto',
          backdropFilter: 'blur(16px)',
        }}>
          {[{ _id: '', title: 'Selecione uma legenda salva...' }, ...legends].map((l, i) => (
            <div
              key={l._id || 'empty'}
              onClick={() => { onChange(l._id); setOpen(false); }}
              style={{
                padding: '9px 12px', fontSize: 13, cursor: 'pointer',
                color: l._id === '' ? 'var(--text3)' : l._id === value ? 'var(--cyan)' : 'var(--text)',
                background: l._id !== '' && l._id === value ? 'oklch(0.82 0.19 196 / 0.08)' : 'transparent',
                borderBottom: i < legends.length ? '1px solid oklch(1 0 0 / 0.05)' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'background .1s',
                fontStyle: l._id === '' ? 'italic' : 'normal',
              }}
              onMouseEnter={e => { if (l._id !== value) e.currentTarget.style.background = 'oklch(1 0 0 / 0.05)'; }}
              onMouseLeave={e => { if (l._id !== value) e.currentTarget.style.background = l._id === value ? 'oklch(0.82 0.19 196 / 0.08)' : 'transparent'; }}
            >
              {l.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/* ── Card de mídia com thumbnail real (canvas para vídeo, objectURL para imagem) ── */
function MediaCard({ file, index, onRemove }) {
  const [thumb, setThumb] = useState(null);
  const isVideo = file.type?.startsWith('video/');

  useEffect(() => {
    let objectUrl;
    if (!isVideo) {
      objectUrl = URL.createObjectURL(file);
      setThumb(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = objectUrl;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) * 0.05);
    };
    video.onseeked = () => {
      try {
        const W = 270, H = 480;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const vr = video.videoWidth / video.videoHeight;
        const cr = W / H;
        let sw, sh, sx, sy;
        if (vr > cr) { sh = video.videoHeight; sw = sh * cr; sx = (video.videoWidth - sw) / 2; sy = 0; }
        else { sw = video.videoWidth; sh = sw / cr; sx = 0; sy = (video.videoHeight - sh) / 2; }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
        setThumb(canvas.toDataURL('image/jpeg', 0.75));
      } catch { /* canvas tainted ou erro */ }
      URL.revokeObjectURL(objectUrl);
    };
    video.onerror = () => URL.revokeObjectURL(objectUrl);
    return () => { video.src = ''; URL.revokeObjectURL(objectUrl); };
  }, []);

  return (
    <div style={{
      position: 'relative', borderRadius: 9, overflow: 'hidden',
      background: 'oklch(0.12 0.04 235)', border: '1px solid oklch(1 0 0 / 0.08)',
      aspectRatio: '9/16',
    }}>
      <button
        type="button"
        onClick={() => onRemove(index)}
        style={{
          position: 'absolute', top: 5, right: 5, zIndex: 2,
          background: 'rgba(239,68,68,.85)', border: 'none', color: '#fff',
          borderRadius: 5, width: 20, height: 20, cursor: 'pointer', fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      {thumb ? (
        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: isVideo ? '#818cf8' : '#60a5fa', opacity: .55,
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {isVideo
              ? <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>
              : <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>}
          </svg>
        </div>
      )}

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent, oklch(0 0 0 / 0.78))',
        padding: '22px 6px 5px', pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
          #{index + 1}
        </div>
        <div style={{ fontSize: 9, color: 'oklch(1 0 0 / 0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {file.name}
        </div>
      </div>
    </div>
  );
}

export default function Posts() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [postType, setPostType] = useState('reel');
  const [accounts, setAccounts] = useState([]);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState([]);
  const [cover, setCover] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [intervalMins, setIntervalMins] = useState(0);
  const [simultaneousLimit, setSimultaneousLimit] = useState(1);
  const [processMode, setProcessMode] = useState('limpeza_leve');
  const [toast, setToast] = useState(null);
  const [legends, setLegends] = useState([]);
  const [selectedLegend, setSelectedLegend] = useState('');
  const [location, setLocation] = useState('');
  const [retryingId, setRetryingId] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [postPage, setPostPage] = useState(1);
  const [postPagination, setPostPagination] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted]   = useState(false);
  const [ctaComment, setCtaComment]       = useState('');
  const [engageComment, setEngageComment] = useState('');

  const selectedCount  = selectedAccounts.length;
  const totalEstimated = media.length * selectedCount;

  function showToast(type, title, message) {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  }

  async function load(targetPage = postPage) {
    try {
      const [postsRes, accountsRes, legendsRes] = await Promise.all([
        api.get(`/posts?page=${targetPage}&limit=20`),
        api.get('/accounts?limit=200'),
        api.get('/legends'),
      ]);
      setPosts(postsRes.data.posts || []);
      setPostPagination(postsRes.data.pagination || null);
      setAccounts(accountsRes.data.accounts || []);
      setLegends(Array.isArray(legendsRes.data) ? legendsRes.data : []);
    } catch { /* silencioso — estado anterior mantido */ }
  }

  function goToPostPage(p) { setPostPage(p); load(p); }
  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  async function retryPost(id) {
    try { setRetryingId(id); await api.post(`/posts/${id}/retry`); showToast('success', 'Reprocessando', 'Post adicionado à fila novamente.'); load(); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar.'); }
    finally { setRetryingId(null); }
  }

  async function retryAllErrors() {
    try {
      setRetryingAll(true);
      const res = await api.post('/posts/retry-errors');
      const total = res.data.total || 0;
      showToast('success', 'Reprocessando', total > 0 ? `${total} posts adicionados à fila.` : 'Nenhum post com erro.');
      load();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar.'); }
    finally { setRetryingAll(false); }
  }

  async function useRandomLegend() {
    try { const res = await api.get('/legends/random'); setCaption(res.data.text); showToast('success', 'Legenda carregada', 'Legenda aleatória aplicada.'); }
    catch { showToast('warning', 'Sem legendas', 'Nenhuma legenda encontrada.'); }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'));
    if (files.length) setMedia(prev => [...prev, ...files]);
  }

  async function createPost(e) {
    e.preventDefault();
    if (!media.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma mídia');
    if (!selectedAccounts.length) return showToast('warning', 'Atenção', 'Selecione uma conta');
    const form = new FormData();
    media.forEach(file => form.append('media', file));
    if (cover) form.append('cover', cover);
    form.append('caption', caption);
    if (location) form.append('location', location);
    form.append('postType', postType);
    form.append('accounts', JSON.stringify(selectedAccounts));
    form.append('intervalMinutes', intervalMins);
    form.append('simultaneousLimit', simultaneousLimit);
    form.append('processMode', processMode);
    if (ctaComment.trim())    form.append('ctaComment', ctaComment);
    if (engageComment.trim()) form.append('engageComment', engageComment);
    if (scheduledAt) form.append('scheduledAt', new Date(scheduledAt).toISOString());
    setPosting(true);
    try {
      await api.post('/posts', form);
      setCaption(''); setMedia([]); setCover(null);
      setLocation(''); setSelectedAccounts([]); setScheduledAt('');
      setIntervalMins(0); setSelectedLegend(''); setCtaComment(''); setEngageComment('');
      showToast('success', scheduledAt ? 'Posts agendados!' : 'Posts enviados!', `${totalEstimated} publicações adicionadas à fila.`);
      setPosted(true);
      setTimeout(() => setPosted(false), 2500);
      load();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao criar posts.');
    } finally {
      setPosting(false);
    }
  }

  function statusBadgeClass(status) {
    if (status === 'concluido') return 'badge-green';
    if (status === 'erro') return 'badge-red';
    if (status === 'processando') return 'badge-indigo';
    if (status === 'agendado') return 'badge-amber';
    if (status === 'parcial') return 'badge-amber';
    return 'badge-gray';
  }

  const processModes = [
    { id: 'sem_limpeza',  label: 'Sem Limpeza',  tag: 'SAFE',  desc: 'Posta o vídeo original, sem alterar nada',                          color: '#10b981' },
    { id: 'limpeza_leve', label: 'Limpeza Leve', tag: 'RECOM', desc: 'Remove metadados e gera hash diferente',                            color: '#3b82f6' },
    { id: 'ultra_clean',  label: 'Ultra Clean',  tag: 'ULTRA', desc: 'Remove todos metadados + re-encoda o vídeo',                        color: '#8b5cf6' },
    { id: 'humanizador',  label: 'Humanizador',  tag: 'MAX',   desc: 'Micro-crop + cor + pitch áudio + CRF aleatório — fingerprint único', color: '#f59e0b' },
  ];

  /* ── Icon ── */
  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
    </svg>
  );

  /* ── Header actions ── */
  const pageActions = (
    <>
      <button className="btn-ghost" style={{ fontSize: '.8rem', padding: '7px 14px', borderRadius: 8 }} type="button" onClick={retryAllErrors} disabled={retryingAll}>
        ↻ {retryingAll ? 'Reprocessando...' : 'Reprocessar vencidos'}
      </button>
      <button className="btn-primary" style={{ fontSize: '.83rem', padding: '7px 16px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, minWidth: 120, justifyContent: 'center', opacity: posting ? 0.8 : 1 }} type="button"
        disabled={posting}
        onClick={() => document.getElementById('postform').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))}>
        {posting ? (
          <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Publicando...</>
        ) : posted ? (
          <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>Publicado!</>
        ) : (
          scheduledAt ? 'Agendar' : 'Publicar agora'
        )}
      </button>
    </>
  );

  /* ── Premium card style ── */
  const cardStyle = {
    background: 'oklch(0.16 0.05 235 / 0.85)',
    border: '1px solid oklch(1 0 0 / 0.07)',
    borderRadius: 14,
    backdropFilter: 'blur(12px)',
    overflow: 'hidden',
  };
  const cardHdStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid oklch(1 0 0 / 0.07)',
  };
  const cardH3Style = { fontSize: '.88rem', fontWeight: 700, color: 'var(--text)', margin: 0 };
  const cardBodyStyle = { padding: '14px 16px' };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageShell
        icon={pageIcon}
        title="Painel de Publicação"
        subtitle="Publicações em tempo real · múltiplas contas"
        accent="purple"
        actions={pageActions}
      >
        {/* Form grid */}
        <form id="postform" onSubmit={createPost} className="layout-form-2col" style={{ marginBottom: 20 }}>

          {/* ── LEFT COLUMN ── */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >

            {/* Upload */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Mídia</h3>
                <span style={{ fontSize: '.72rem', fontFamily: 'var(--font-mono)', background: 'oklch(0.82 0.19 196 / 0.1)', color: 'var(--cyan)', border: '1px solid oklch(0.82 0.19 196 / 0.2)', borderRadius: 100, padding: '2px 10px' }}>
                  {media.length} arquivo(s)
                </span>
              </div>
              <div style={cardBodyStyle}>
                {/* Type tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'oklch(0.10 0.03 235 / 0.8)', border: '1px solid oklch(1 0 0 / 0.08)', borderRadius: 9, padding: 3 }}>
                  {['reel', 'post', 'story'].map(t => (
                    <button key={t} type="button"
                      onClick={() => setPostType(t)}
                      style={{
                        flex: 1, padding: '7px 4px', borderRadius: 7, fontSize: '.78rem', fontWeight: postType === t ? 700 : 500,
                        cursor: 'pointer', border: 'none', transition: '.15s',
                        background: postType === t ? 'oklch(0.60 0.22 295)' : 'transparent',
                        color: postType === t ? '#fff' : 'var(--text3)',
                        boxShadow: postType === t ? '0 2px 8px oklch(0.60 0.22 295 / 0.3)' : 'none',
                      }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                <label
                  className={`upload-zone${dragOver ? ' drag-over' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                    onChange={e => setMedia(Array.from(e.target.files || []))} />
                  <div style={{ marginBottom: 8 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <strong>Arraste ou envie seus vídeos</strong>
                  <span>MP4, MOV, JPG, PNG — sem limite de quantidade</span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>Selecionar arquivos</button>
                </label>

                {media.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(100px,1fr))', gap: 8, marginTop: 12 }}>
                    {media.map((file, i) => (
                      <MediaCard
                        key={`${file.name}-${i}`}
                        file={file}
                        index={i}
                        onRemove={idx => setMedia(m => m.filter((_, j) => j !== idx))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Cover */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Capa do Reel</h3>
                <span style={{ fontSize: '.73rem', color: 'var(--text3)' }}>Opcional — aplica a todos</span>
              </div>
              <div style={cardBodyStyle}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', background: 'oklch(0.10 0.03 235 / 0.6)', borderRadius: 10, border: '1px dashed oklch(1 0 0 / 0.1)', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => setCover(e.target.files?.[0] || null)} />
                  <div style={{ color: cover ? '#60a5fa' : 'var(--text3)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: cover ? '#60a5fa' : 'var(--text2)' }}>{cover ? cover.name : 'Faça upload de uma imagem 1080×1920'}</div>
                    {cover && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Clique para trocar</div>}
                  </div>
                </label>
              </div>
            </div>

            {/* Caption */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Legenda</h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/legends')}>Gerenciar →</button>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{caption.length}/2200</span>
                </div>
              </div>
              <div style={cardBodyStyle}>
                {legends.length > 0 && (
                  <LegendDropdown
                    legends={legends}
                    value={selectedLegend}
                    onChange={id => {
                      setSelectedLegend(id);
                      const l = legends.find(l => l._id === id);
                      if (l) setCaption(l.text);
                      else if (!id) setCaption('');
                    }}
                  />
                )}
                <textarea className="txta"
                  placeholder="Escreva a legenda do seu post. Use #hashtags e {variáveis}."
                  value={caption} maxLength={2200} onChange={e => setCaption(e.target.value)} rows={4} />
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  Variáveis: {'{data}'} {'{hora}'} {'{username}'} {'{nome}'} {'{cidade}'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={useRandomLegend}>Aleatória</button>
                </div>
                <div style={{ marginTop: 12, borderTop: '1px solid oklch(1 0 0 / 0.07)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Localização (opcional)
                  </div>
                  <input className="inp" type="text" placeholder="Belo Horizonte, Brasil" value={location} onChange={e => setLocation(e.target.value)} list="brazil-cities" />
                  <datalist id="brazil-cities">
                    {['São Paulo','Rio de Janeiro','Belo Horizonte','Brasília','Salvador','Fortaleza','Curitiba','Manaus','Recife','Porto Alegre'].map(c => (
                      <option key={c} value={`${c}, Brasil`} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            {/* Engage Comment */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Pergunta de engajamento</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: engageComment ? 'var(--cyan)' : 'var(--text3)' }}>
                  <input
                    type="checkbox"
                    checked={!!engageComment}
                    onChange={e => setEngageComment(e.target.checked ? 'O que acharam? 👇 Comenta aí!' : '')}
                  />
                  {engageComment ? 'Ativo' : 'Inativo'}
                </label>
              </div>
              {!!engageComment && (
                <div style={cardBodyStyle}>
                  <textarea className="txta" rows={2}
                    placeholder="Ex: Gostaram? Comenta aí! 👇"
                    value={engageComment}
                    onChange={e => setEngageComment(e.target.value)} />
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    Postado ~60 min após publicar · estimula comentários pro algoritmo
                  </div>
                </div>
              )}
            </div>

            {/* CTA Comment */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Comentário fixado automático</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: ctaComment ? 'var(--cyan)' : 'var(--text3)' }}>
                  <input
                    type="checkbox"
                    checked={!!ctaComment}
                    onChange={e => setCtaComment(e.target.checked ? '👇 Acesse meu bot gratuito no Telegram!\n🤖 {link}' : '')}
                  />
                  {ctaComment ? 'Ativo' : 'Inativo'}
                </label>
              </div>
              {!!ctaComment && (
                <div style={cardBodyStyle}>
                  <textarea className="txta" rows={3}
                    placeholder="Ex: 👇 Acesse meu bot no Telegram! {link}"
                    value={ctaComment}
                    onChange={e => setCtaComment(e.target.value)} />
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    Postado ~2 min após publicar · Use {'{link}'} {'{username}'} {'{nome}'}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── RIGHT COLUMN ── */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.06 }}
          >

            {/* Simultaneous publications */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Publicações simultâneas</h3>
                <span style={{ fontSize: '.72rem', fontFamily: 'var(--font-mono)', background: 'oklch(0.82 0.19 196 / 0.1)', color: 'var(--cyan)', border: '1px solid oklch(0.82 0.19 196 / 0.2)', borderRadius: 100, padding: '2px 10px' }}>
                  {simultaneousLimit === 1 ? 'Sequencial' : `Lotes de ${simultaneousLimit}`}
                </span>
              </div>
              <div style={cardBodyStyle}>
                <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
                  Quantos reels são enviados juntos em cada lote para todas as contas
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>LOTE</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: '#60a5fa', letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>{simultaneousLimit}</span>
                  <span style={{ fontSize: 14, color: 'var(--text3)' }}>/{Math.max(media.length, 1)} reels</span>
                </div>
                <input type="range" min="1" max={Math.max(media.length, 1)} value={Math.min(simultaneousLimit, Math.max(media.length, 1))}
                  onChange={e => setSimultaneousLimit(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  <span>1</span><span>{Math.max(media.length, 1)}</span>
                </div>
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(59,130,246,0.06)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.15)', fontSize: 11, color: '#93c5fd', lineHeight: 1.5 }}>
                  {simultaneousLimit === 1
                    ? 'Sequencial — 1 reel por vez. Todas as contas recebem cada reel em paralelo, depois aguarda o intervalo.'
                    : `Lotes de ${simultaneousLimit} — reels 1–${simultaneousLimit} vão juntos para todas as contas em paralelo, depois aguarda o intervalo.`
                  }
                </div>
              </div>
            </div>

            {/* Interval */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Intervalo entre posts</h3>
                <span style={{ fontSize: '.83rem', color: '#60a5fa', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{intervalMins} min</span>
              </div>
              <div style={cardBodyStyle}>
                <input type="range" min="0" max="120" step="1" value={intervalMins}
                  onChange={e => setIntervalMins(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer', marginBottom: 6 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                  <span>Sem intervalo</span><span>120 min</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 5 }}>Início (deixe vazio = agora + 1 min)</label>
                  <input className="inp" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Processing mode */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Modo de processamento</h3>
                <span style={{ fontSize: '.73rem', color: 'var(--text3)' }}>Limpeza aplicada</span>
              </div>
              <div style={cardBodyStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {processModes.map(m => (
                    <div key={m.id} onClick={() => setProcessMode(m.id)}
                      style={{
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: '1px solid',
                        background: processMode === m.id ? `${m.color}14` : 'oklch(0.10 0.03 235 / 0.5)',
                        borderColor: processMode === m.id ? `${m.color}44` : 'oklch(1 0 0 / 0.07)',
                        transition: 'all .15s',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: processMode === m.id ? m.color : 'var(--text)' }}>{m.label}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${m.color}22`, color: m.color, fontFamily: 'var(--font-mono)' }}>{m.tag}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{m.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Accounts */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Contas</h3>
              </div>
              <div style={cardBodyStyle}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
                  Selecione onde publicar — cada conta posta 1 vez por mídia
                </div>

                <AccountPicker
                  accounts={accounts}
                  selected={selectedAccounts}
                  onChange={setSelectedAccounts}
                />

                {/* Summary */}
                <div className="g3" style={{ gap: 6, marginTop: 12 }}>
                  {[['Mídias', media.length, '#60a5fa'], ['Contas', selectedCount, '#a78bfa'], ['Total', totalEstimated, 'var(--cyan)']].map(([l, v, c]) => (
                    <div key={l} style={{ textAlign: 'center', background: 'oklch(0.10 0.03 235 / 0.8)', borderRadius: 8, padding: '8px 4px', border: '1px solid oklch(1 0 0 / 0.07)' }}>
                      <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -1, color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{l}</div>
                    </div>
                  ))}
                </div>

                <button className="btn-primary" type="submit" disabled={posting}
                  style={{
                    width: '100%', justifyContent: 'center', padding: '12px', marginTop: 12,
                    fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
                    transition: 'all .2s',
                    background: posted
                      ? 'linear-gradient(135deg,#10b981,#059669)'
                      : undefined,
                    opacity: posting ? 0.85 : 1,
                  }}>
                  {posting ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                      Publicando...
                    </>
                  ) : posted ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
                      Publicado!
                    </>
                  ) : (
                    scheduledAt ? 'Agendar postagens' : 'Publicar agora'
                  )}
                </button>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            </div>
          </motion.div>
        </form>

        {/* Posts list */}
        {posts.length > 0 && (
          <div style={{ ...cardStyle, marginTop: 4 }}>
            <div style={cardHdStyle}>
              <h3 style={cardH3Style}>Posts registrados</h3>
              <span style={{ fontSize: '.73rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{postPagination?.total || posts.length} no total</span>
            </div>
            <div className="queue-list">
              {posts.map(post => (
                <div className="queue-row" key={post._id}>
                  <div className="queue-icon" style={{ background: post.postType === 'reel' ? 'var(--indigo-dim)' : 'var(--cyan-dim)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {post.postType === 'reel'
                        ? <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>
                        : <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>
                      }
                    </svg>
                  </div>
                  <div className="queue-info">
                    <strong>{post.postType === 'reel' ? 'Reel' : 'Post'}</strong>
                    <span>{post.accounts?.map(a => `@${a.username}`).join(', ') || 'Sem conta'}</span>
                    {post.error && <em style={{ fontSize: 11, color: '#f87171', display: 'block', marginTop: 1 }}>{post.error}</em>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className={`badge ${statusBadgeClass(post.status)}`}>{post.status}</span>
                    <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                      {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('pt-BR') : new Date(post.createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  {['erro', 'parcial', 'cancelado'].includes(post.status) && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => retryPost(post._id)} disabled={retryingId === post._id}>
                      {retryingId === post._id ? '...' : '↺ Retry'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {postPagination && postPagination.pages > 1 && (
              <div className="pagination">
                <button className="btn btn-ghost btn-sm" disabled={postPage <= 1} onClick={() => goToPostPage(postPage - 1)}>← Anterior</button>
                <span>Página {postPagination.page} de {postPagination.pages} · {postPagination.total} posts</span>
                <button className="btn btn-ghost btn-sm" disabled={postPage >= postPagination.pages} onClick={() => goToPostPage(postPage + 1)}>Próxima →</button>
              </div>
            )}
          </div>
        )}
      </PageShell>
    </>
  );
}

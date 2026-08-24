import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Send, X, ChevronDown, Flame, ExternalLink, CheckSquare, Square, Layers3, ImagePlus } from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

/* ── helpers ── */
const fmt  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;   // local file — serve directly
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`; // CDN URL — proxy
};

const METRICS  = ['Views','Alcance','Likes','Coments','Saves','Shares'];
const PERIODS  = ['7d','30d','90d','1a'];
const TYPES    = ['Tudo','Reels','Carrossel','Foto'];
const CLEAN_MODES = [
  { value: 'limpeza_leve', label: 'Light (recomenda)' },
  { value: 'ultra_clean',  label: 'Ultra Clean' },
  { value: 'humanizador',  label: 'Humanizador (MAX)' },
  { value: 'sem_limpeza',  label: 'Sem limpeza' },
];

const RANK_COLORS = ['var(--mf-mod-publicar)','var(--mf-info-500)','var(--mf-mod-contas)','var(--mf-success-500)','var(--mf-warning-500)','var(--mf-danger-500)'];

function metricKey(m) {
  return { Views:'views', Alcance:'alcance', Likes:'likes', Coments:'coments', Saves:'saves', Shares:'shares' }[m] || 'views';
}
function insightViews(ins) {
  return ins.videoViews || ins.impressions || 0;
}
function insightVal(ins, m) {
  return { Views: insightViews(ins), Alcance: ins.reach, Likes: ins.likeCount, Coments: ins.commentsCount, Saves: ins.savedCount, Shares: ins.shareCount }[m] || 0;
}
function mediaLabel(type) {
  if (!type) return 'POST';
  if (type === 'VIDEO') return 'REEL';
  if (type === 'CAROUSEL_ALBUM') return 'CARROSSEL';
  return 'FOTO';
}

/* ── PostCard ── */
function PostCard({ ins, rank, onRepublish, selectMode, isSelected, onToggle }) {
  const [err, setErr] = useState(false);
  const src = !err ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : null;
  const color = RANK_COLORS[(rank - 1) % RANK_COLORS.length];
  const fmtDate = d => {
    if (!d) return '';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')} DE ${dt.toLocaleString('pt-BR',{month:'short'}).toUpperCase()}. ${String(dt.getFullYear()).slice(2)}`;
  };

  const views = insightViews(ins);
  const metrics = [
    { label:'VIEWS',   val: views            },
    { label:'ALCANCE', val: ins.reach        },
    { label:'LIKES',   val: ins.likeCount    },
    { label:'COMENTS', val: ins.commentsCount},
    { label:'SAVES',   val: ins.savedCount   },
    { label:'SHARES',  val: ins.shareCount   },
  ];

  const handleClick = () => {
    if (selectMode) onToggle(ins._id);
  };

  return (
    <div
      onClick={selectMode ? handleClick : undefined}
      style={{
        background:'var(--mf-surface-1)', border:`1px solid ${isSelected ? 'color-mix(in oklch, var(--mf-mod-contas) 60%, transparent)' : 'color-mix(in oklch, var(--mf-border-strong) 50%, transparent)'}`,
        borderRadius:14, overflow:'hidden', display:'flex', flexDirection:'column',
        cursor: selectMode ? 'pointer' : 'default',
        boxShadow: isSelected ? '0 0 0 2px color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : 'none',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      {/* Thumbnail */}
      <div style={{ position:'relative', aspectRatio:'9/16', background:'var(--mf-surface-1)', flexShrink:0 }}>
        {src
          ? <img src={src} alt="" onError={() => setErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#1e3a5f' }}><Flame size={40} /></div>
        }
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,rgba(0,0,0,.35) 0%,transparent 40%,rgba(0,0,0,.65) 100%)' }} />
        <div style={{ position:'absolute', top:8, left:8, background:'rgba(0,0,0,.65)', color:'var(--mf-text)', fontSize:9, fontWeight:700, letterSpacing:'.08em', padding:'2px 6px', borderRadius:4 }}>
          {mediaLabel(ins.mediaType)}
        </div>

        {/* Select checkbox OR rank badge */}
        {selectMode
          ? <div style={{ position:'absolute', top:8, right:8, background: isSelected ? 'var(--mf-mod, var(--mf-accent-500))' : 'rgba(0,0,0,.6)', color: isSelected ? '#060d1e' : 'var(--mf-text-2)', width:26, height:26, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', border:`2px solid ${isSelected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border-strong)'}`, transition:'all .15s' }}>
              {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
            </div>
          : <div style={{ position:'absolute', top:8, right:8, background:color, color:'var(--mf-text)', fontSize:10, fontWeight:800, width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 0 14px ${color}77` }}>
              #{rank}
            </div>
        }

        <div style={{ position:'absolute', bottom:8, left:8, right:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:11, color:'var(--mf-surface-3)', fontWeight:600 }}>@{ins.username}</span>
          {ins.permalink && !selectMode && (
            <a href={ins.permalink} target="_blank" rel="noopener noreferrer" style={{ color:'var(--mf-surface-3)', display:'flex' }}>
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:10, flex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'var(--mf-text-3)' }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--mf-mod, var(--mf-accent-500))', display:'inline-block', flexShrink:0 }} />
          {fmtDate(ins.postedAt)}
          <span style={{ marginLeft:'auto', fontSize:9, color:'var(--mf-border-strong)' }}>👁 {fmtK(views)}</span>
        </div>

        {ins.caption && (
          <p style={{ fontSize:11, color:'var(--mf-text-2)', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden', margin:0 }}>
            {ins.caption}
          </p>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(min(55px,100%), 1fr))', gap:6 }}>
          {metrics.map(({ label, val }) => (
            <div key={label} style={{ background:'var(--mf-surface-1)', borderRadius:8, padding:'6px 8px', textAlign:'center' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--mf-text)' }}>{fmtK(val)}</div>
              <div style={{ fontSize:9,  fontWeight:600, color:'#4a6a8a', letterSpacing:'.06em' }}>{label}</div>
            </div>
          ))}
        </div>

        {!selectMode && (
          <button
            onClick={() => onRepublish(ins)}
            style={{
              marginTop:'auto', width:'100%', padding:'10px', borderRadius:8, border:'none', cursor:'pointer',
              background:'linear-gradient(135deg,color-mix(in oklch, var(--mf-mod-contas) 18%, transparent),color-mix(in oklch, var(--mf-primary-500) 18%, transparent))',
              color:'var(--mf-mod, var(--mf-accent-500))', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              borderTop:'1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)',
            }}
          >
            <Send size={13} /> Republicar em outras contas
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Single RepublishModal ── */
function RepublishModal({ ins, onClose, accounts }) {
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [postType, setPostType]   = useState(ins.mediaType === 'IMAGE' ? 'post' : 'reel');
  const [cleanMode, setCleanMode] = useState('limpeza_leve');
  const [interval, setInterval]   = useState('3');
  const [scheduled, setScheduled] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);

  // caption
  const [captionMode, setCaptionMode]     = useState('original');
  const [customCaption, setCustomCaption] = useState('');
  const [savedLegendId, setSavedLegendId] = useState('');
  const [legends, setLegends]             = useState([]);

  // cover
  const [coverFile, setCoverFile]       = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const coverInputRef = useRef(null);

  const [imgErr, setImgErr] = useState(false);
  const thumbSrc = !imgErr ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : null;

  useEffect(() => {
    api.get('/legends').then(r => setLegends(r.data || [])).catch(() => {});
  }, []);

  const toggle    = id => setSelectedAccounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAll = () => setSelectedAccounts(accounts.map(a => a._id));
  const clearAll  = () => setSelectedAccounts([]);

  const onCoverChange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!selectedAccounts.length) { setError('Selecione ao menos uma conta'); return; }
    setLoading(true); setError('');
    try {
      const effectiveCaption = captionMode === 'custom'
        ? customCaption
        : captionMode === 'saved'
          ? (legends.find(l => l._id === savedLegendId)?.text || '')
          : (ins.caption || '');

      let coverUrl = ins.thumbnailUrl;
      if (coverFile && postType === 'reel') {
        const fd = new FormData();
        fd.append('media', coverFile);
        const r = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        coverUrl = r.data.media?.[0]?.url || ins.thumbnailUrl;
      }

      await api.post('/insights/republish', {
        igMediaId: ins.igMediaId, mediaUrl: ins.mediaUrl,
        thumbnailUrl: coverUrl,
        mediaType: ins.mediaType, caption: effectiveCaption, accounts: selectedAccounts,
        postType, processMode: cleanMode, intervalMinutes: Number(interval) || 3,
        scheduledAt: scheduled || undefined,
      });
      setDone(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const btnStyle = active => ({
    flex:1, padding:'7px 0', borderRadius:6, border:`1px solid ${active ? 'color-mix(in oklch, var(--mf-mod-contas) 50%, transparent)' : 'color-mix(in oklch, var(--mf-border-strong) 40%, transparent)'}`,
    background: active ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-surface-1)',
    color: active ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)', fontSize:11, fontWeight:600, cursor:'pointer',
  });

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)', padding:16 }}>
      <div style={{ background:'rgba(8,20,44,.97)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 60%, transparent)', borderRadius:16, width:'100%', maxWidth:780, maxHeight:'90vh', overflow:'auto', boxShadow:'0 24px 80px rgba(0,0,0,.6)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 22px', borderBottom:'1px solid color-mix(in oklch, var(--mf-border-strong) 35%, transparent)' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight:700, fontSize:16, color:'var(--mf-text)' }}>
              <Send size={16} style={{ color:'var(--mf-mod, var(--mf-accent-500))' }} /> Republicar post
            </div>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'var(--mf-text-3)' }}>
              Baixamos a mídia original e republicamos nas contas que você escolher.
            </p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--mf-text-3)', padding:4 }}><X size={18} /></button>
        </div>
        <div className="modal-sidebar">
          <div style={{ padding:'20px 18px', borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)' }}>
            <div style={{ aspectRatio:'9/16', borderRadius:10, overflow:'hidden', background:'var(--mf-surface-1)', marginBottom:12 }}>
              {thumbSrc
                ? <img src={thumbSrc} alt="" onError={() => setImgErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#1e3a5f' }}><Flame size={32} /></div>
              }
            </div>
            <div style={{ fontSize:12, color:'var(--mf-text-2)', marginBottom:4 }}>De <strong style={{ color:'var(--mf-mod, var(--mf-accent-500))' }}>@{ins.username}</strong></div>
            <div style={{ display:'inline-block', padding:'2px 8px', background:'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)', borderRadius:5, fontSize:10, fontWeight:700 }}>
              {mediaLabel(ins.mediaType)}
            </div>
          </div>
          <div style={{ padding:'20px 22px', display:'flex', flexDirection:'column', gap:16 }}>
            <AccountSelector accounts={accounts} selectedAccounts={selectedAccounts} onToggle={toggle} onSelectAll={selectAll} onClearAll={clearAll} sourceId={ins.accountId} />

            {/* Legenda */}
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Legenda</label>
              <div style={{ display:'flex', gap:6, marginBottom:8 }}>
                <button style={btnStyle(captionMode==='original')} onClick={() => setCaptionMode('original')}>Original</button>
                <button style={btnStyle(captionMode==='custom')}   onClick={() => setCaptionMode('custom')}>Nova legenda</button>
                <button style={btnStyle(captionMode==='saved')}    onClick={() => setCaptionMode('saved')}>Legenda salva</button>
              </div>
              {captionMode === 'original' && (
                <div style={{ padding:'8px 12px', background:'var(--mf-surface-1)', borderRadius:8, border:'1px solid color-mix(in oklch, var(--mf-border-strong) 30%, transparent)', fontSize:12, color:'var(--mf-text-3)', lineHeight:1.5, maxHeight:80, overflow:'auto' }}>
                  {ins.caption || <em>Sem legenda</em>}
                </div>
              )}
              {captionMode === 'custom' && (
                <>
                  <textarea value={customCaption} onChange={e => setCustomCaption(e.target.value)} maxLength={2200} rows={4}
                    placeholder="Digite a nova legenda..."
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color:'var(--mf-text)', fontSize:12, padding:'10px 12px', resize:'vertical', outline:'none', lineHeight:1.5, boxSizing:'border-box' }} />
                  <div style={{ textAlign:'right', fontSize:10, color:'var(--mf-border-strong)', marginTop:2 }}>{customCaption.length}/2200</div>
                </>
              )}
              {captionMode === 'saved' && (
                <div style={{ position:'relative' }}>
                  <select value={savedLegendId} onChange={e => setSavedLegendId(e.target.value)}
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color: savedLegendId ? 'var(--mf-text)' : 'var(--mf-text-3)', fontSize:12, padding:'8px 28px 8px 10px', outline:'none', appearance:'none', cursor:'pointer' }}>
                    <option value="">Selecione uma legenda salva...</option>
                    {legends.map(l => <option key={l._id} value={l._id}>{l.name || l.text?.slice(0,50)}</option>)}
                  </select>
                  <ChevronDown size={12} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
                </div>
              )}
            </div>

            {/* Capa (só para reels) */}
            {postType === 'reel' && (
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Capa do reel</label>
                <input ref={coverInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={onCoverChange} />
                {coverPreview
                  ? <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <img src={coverPreview} alt="capa" style={{ width:54, height:96, objectFit:'cover', borderRadius:6, border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' }} />
                      <div>
                        <div style={{ fontSize:11, color:'var(--mf-mod, var(--mf-accent-500))', marginBottom:4 }}>Capa selecionada</div>
                        <button onClick={() => { setCoverFile(null); setCoverPreview(''); }} style={{ fontSize:11, color:'var(--mf-danger-500)', background:'none', border:'none', cursor:'pointer', padding:0 }}>Remover</button>
                      </div>
                    </div>
                  : <button onClick={() => coverInputRef.current?.click()}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:7, border:'1px dashed color-mix(in oklch, var(--mf-border-strong) 60%, transparent)', background:'var(--mf-surface-1)', color:'var(--mf-text-3)', fontSize:12, cursor:'pointer' }}>
                      <ImagePlus size={14} /> Escolher imagem de capa
                    </button>
                }
              </div>
            )}

            <PostSettings postType={postType} setPostType={setPostType} cleanMode={cleanMode} setCleanMode={setCleanMode} interval={interval} setInterval={setInterval} />
            <ScheduleField scheduled={scheduled} setScheduled={setScheduled} />
            {error && <ErrorBox msg={error} />}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, padding:'16px 22px', borderTop:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)' }}>
          <button onClick={onClose} style={{ padding:'9px 20px', borderRadius:8, border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background:'transparent', color:'var(--mf-text-2)', fontSize:13, cursor:'pointer' }}>Cancelar</button>
          <button onClick={submit} disabled={loading || done}
            style={{ padding:'9px 22px', borderRadius:8, border:'none', cursor: loading||done?'not-allowed':'pointer', background: done?'color-mix(in oklch, var(--mf-success-500) 20%, transparent)':'linear-gradient(135deg,#0ea5e9,var(--mf-primary-500))', color: done?'var(--mf-success-500)':'var(--mf-text)', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:8, opacity: loading?.7:1 }}>
            {done ? '✓ Enviado!' : loading ? <><RefreshCw size={14} style={{ animation:'spin 1s linear infinite' }}/> Enviando...</> : <><Send size={14}/> Republicar ({selectedAccounts.length})</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── BulkRepublishModal (multi-post) ── */
function BulkRepublishModal({ insArray, onClose, accounts }) {
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [postType, setPostType]   = useState('reel');
  const [cleanMode, setCleanMode] = useState('limpeza_leve');
  const [interval, setInterval]   = useState('3');
  const [scheduled, setScheduled] = useState('');
  const [progress, setProgress]   = useState(null);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);

  // caption
  const [captionMode, setCaptionMode]     = useState('original'); // 'original'|'custom'|'saved'
  const [customCaption, setCustomCaption] = useState('');
  const [savedLegendId, setSavedLegendId] = useState('');
  const [legends, setLegends]             = useState([]);

  // cover
  const [coverFile, setCoverFile]       = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const coverInputRef = useRef(null);

  useEffect(() => {
    api.get('/legends').then(r => setLegends(r.data || [])).catch(() => {});
  }, []);

  const toggle    = id => setSelectedAccounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAll = () => setSelectedAccounts(accounts.map(a => a._id));
  const clearAll  = () => setSelectedAccounts([]);

  const onCoverChange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!selectedAccounts.length) { setError('Selecione ao menos uma conta'); return; }
    setError('');
    setProgress({ done: 0, total: insArray.length });

    // null = use each post's original caption
    const effectiveCaption = captionMode === 'custom'
      ? customCaption
      : captionMode === 'saved'
        ? (legends.find(l => l._id === savedLegendId)?.text || '')
        : null;

    // upload cover once, reuse URL for all posts
    let coverUrl = '';
    if (coverFile && postType === 'reel') {
      try {
        const fd = new FormData();
        fd.append('media', coverFile);
        const r = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        coverUrl = r.data.media?.[0]?.url || '';
      } catch (e) {
        setError('Erro ao enviar capa: ' + (e.response?.data?.error || e.message));
        setProgress(null);
        return;
      }
    }

    let successCount = 0;
    for (let i = 0; i < insArray.length; i++) {
      const ins = insArray[i];
      try {
        await api.post('/insights/republish', {
          igMediaId: ins.igMediaId, mediaUrl: ins.mediaUrl,
          thumbnailUrl: coverUrl || ins.thumbnailUrl,
          mediaType: ins.mediaType,
          caption: effectiveCaption !== null ? effectiveCaption : (ins.caption || ''),
          accounts: selectedAccounts, postType,
          processMode: cleanMode, intervalMinutes: Number(interval) || 3,
          scheduledAt: scheduled || undefined,
        });
        successCount++;
        setProgress({ done: i + 1, total: insArray.length });
      } catch (err) {
        setProgress(p => ({ ...p, done: i + 1, error: `Post ${i+1}: ${err.response?.data?.error || err.message}` }));
      }
    }
    if (successCount > 0) { setDone(true); setTimeout(onClose, 1800); }
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.75)', backdropFilter:'blur(6px)', padding:16 }}>
      <div style={{ background:'rgba(8,20,44,.97)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 60%, transparent)', borderRadius:16, width:'100%', maxWidth:860, maxHeight:'92vh', overflow:'auto', boxShadow:'0 24px 80px rgba(0,0,0,.6)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 22px', borderBottom:'1px solid color-mix(in oklch, var(--mf-border-strong) 35%, transparent)' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight:700, fontSize:16, color:'var(--mf-text)' }}>
              <Layers3 size={16} style={{ color:'var(--mf-mod, var(--mf-accent-500))' }} /> Republicar {insArray.length} posts
            </div>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'var(--mf-text-3)' }}>
              Escolha as contas, legenda e configurações.
            </p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--mf-text-3)', padding:4 }}><X size={18} /></button>
        </div>

        <div className="modal-half">
          {/* Left: thumbnail grid */}
          <div style={{ padding:'18px 18px', borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)', maxHeight:520, overflowY:'auto' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--mf-text-3)', marginBottom:10, letterSpacing:'.06em' }}>POSTS SELECIONADOS ({insArray.length})</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(min(90px,100%), 1fr))', gap:8 }}>
              {insArray.map((ins, i) => {
                const [imgErr, setImgErr] = useState(false);
                const src = !imgErr ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : null;
                const color = RANK_COLORS[i % RANK_COLORS.length];
                return (
                  <div key={ins._id} style={{ position:'relative', aspectRatio:'9/16', borderRadius:8, overflow:'hidden', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)' }}>
                    {src
                      ? <img src={src} alt="" onError={() => setImgErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#1e3a5f' }}><Flame size={20} /></div>
                    }
                    <div style={{ position:'absolute', top:4, right:4, background:color, color:'var(--mf-text)', fontSize:9, fontWeight:800, width:18, height:18, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {i+1}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: settings */}
          <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:16, maxHeight:520, overflowY:'auto' }}>
            <AccountSelector accounts={accounts} selectedAccounts={selectedAccounts} onToggle={toggle} onSelectAll={selectAll} onClearAll={clearAll} />
            <PostSettings postType={postType} setPostType={setPostType} cleanMode={cleanMode} setCleanMode={setCleanMode} interval={interval} setInterval={setInterval} />

            {/* Caption mode */}
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Legenda</label>
              <div style={{ display:'flex', gap:4, marginBottom:8 }}>
                {[['original','Original'],['custom','Nova legenda'],['saved','Legenda salva']].map(([m,l]) => (
                  <button key={m} onClick={() => setCaptionMode(m)}
                    style={{ flex:1, fontSize:11, padding:'5px 4px', borderRadius:6, border: captionMode===m ? '1px solid var(--mf-mod, var(--mf-accent-500))' : '1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background: captionMode===m ? 'rgba(34,215,255,.1)' : 'transparent', color: captionMode===m ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)', cursor:'pointer', fontWeight: captionMode===m ? 700 : 400 }}>{l}</button>
                ))}
              </div>
              {captionMode === 'original' && (
                <div style={{ fontSize:11, color:'var(--mf-text-3)' }}>Cada post mantém sua legenda original.</div>
              )}
              {captionMode === 'custom' && (
                <>
                  <textarea value={customCaption} onChange={e => setCustomCaption(e.target.value)} maxLength={2200} rows={3}
                    placeholder="Digite a legenda para todos os posts..."
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color:'var(--mf-text)', fontSize:12, padding:'10px 12px', resize:'vertical', outline:'none', lineHeight:1.5, boxSizing:'border-box' }} />
                  <div style={{ textAlign:'right', fontSize:10, color:'var(--mf-border-strong)', marginTop:2 }}>{customCaption.length}/2200</div>
                </>
              )}
              {captionMode === 'saved' && (
                <div style={{ position:'relative' }}>
                  <select value={savedLegendId} onChange={e => setSavedLegendId(e.target.value)}
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color: savedLegendId ? 'var(--mf-text)' : 'var(--mf-text-3)', fontSize:12, padding:'8px 28px 8px 10px', outline:'none', appearance:'none', cursor:'pointer', boxSizing:'border-box' }}>
                    <option value="">— Escolha uma legenda —</option>
                    {legends.map(l => <option key={l._id} value={l._id}>{l.title}{l.category ? ` (${l.category})` : ''}</option>)}
                  </select>
                  <ChevronDown size={12} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
                </div>
              )}
            </div>

            {/* Cover image (reels only) */}
            {postType === 'reel' && (
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Capa do reel (opcional)</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <button onClick={() => coverInputRef.current?.click()}
                    style={{ padding:'7px 14px', borderRadius:8, border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background:'var(--mf-surface-1)', color:'var(--mf-text-2)', fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                    <ImagePlus size={13} /> {coverFile ? 'Trocar capa' : 'Adicionar capa'}
                  </button>
                  {coverPreview && (
                    <img src={coverPreview} alt="capa" style={{ width:30, height:44, objectFit:'cover', borderRadius:4, border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', flexShrink:0 }} />
                  )}
                  {coverFile && (
                    <button onClick={() => { setCoverFile(null); setCoverPreview(''); if (coverInputRef.current) coverInputRef.current.value = ''; }}
                      style={{ fontSize:11, color:'var(--mf-danger-500)', background:'none', border:'none', cursor:'pointer', padding:0 }}>✕</button>
                  )}
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" onChange={onCoverChange} style={{ display:'none' }} />
                <div style={{ fontSize:10, color:'var(--mf-border-strong)', marginTop:3 }}>
                  {coverFile ? coverFile.name : 'Todos os posts usarão esta capa.'}
                </div>
              </div>
            )}

            <ScheduleField scheduled={scheduled} setScheduled={setScheduled} />

            {/* Progress */}
            {progress && (
              <div style={{ background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius:8, padding:'10px 14px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--mf-text-2)', marginBottom:6 }}>
                  <span>Progresso</span>
                  <span style={{ color:'var(--mf-mod, var(--mf-accent-500))', fontWeight:700 }}>{progress.done}/{progress.total}</span>
                </div>
                <div style={{ height:4, background:'color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(progress.done/progress.total)*100}%`, background:'linear-gradient(90deg,#0ea5e9,var(--mf-primary-500))', transition:'width .3s', borderRadius:2 }} />
                </div>
                {progress.error && <div style={{ fontSize:11, color:'var(--mf-danger-500)', marginTop:6 }}>{progress.error}</div>}
              </div>
            )}

            {error && <ErrorBox msg={error} />}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, padding:'16px 22px', borderTop:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)' }}>
          <button onClick={onClose} style={{ padding:'9px 20px', borderRadius:8, border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background:'transparent', color:'var(--mf-text-2)', fontSize:13, cursor:'pointer' }}>Cancelar</button>
          <button onClick={submit} disabled={!!progress || done}
            style={{ padding:'9px 22px', borderRadius:8, border:'none', cursor: (progress||done)?'not-allowed':'pointer', background: done?'color-mix(in oklch, var(--mf-success-500) 20%, transparent)':'linear-gradient(135deg,#0ea5e9,var(--mf-primary-500))', color: done?'var(--mf-success-500)':'var(--mf-text)', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:8, opacity: progress?.7:1 }}>
            {done
              ? '✓ Todos enviados!'
              : progress
                ? <><RefreshCw size={14} style={{ animation:'spin 1s linear infinite' }}/> Enviando {progress.done}/{progress.total}...</>
                : <><Layers3 size={14}/> Republicar {insArray.length} posts em {selectedAccounts.length} conta{selectedAccounts.length !== 1 ? 's' : ''}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shared form sub-components ── */
function AccountSelector({ accounts, selectedAccounts, onToggle, onSelectAll, onClearAll, sourceId }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'var(--mf-text-2)' }}>Contas de destino ({selectedAccounts.length}/{accounts.length})</span>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onSelectAll} style={{ fontSize:11, color:'var(--mf-mod, var(--mf-accent-500))', background:'none', border:'none', cursor:'pointer', padding:0 }}>Todas</button>
          <span style={{ color:'var(--mf-border-strong)' }}>·</span>
          <button onClick={onClearAll}  style={{ fontSize:11, color:'var(--mf-text-3)', background:'none', border:'none', cursor:'pointer', padding:0 }}>Limpar</button>
        </div>
      </div>
      <div style={{ maxHeight:140, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
        {accounts.map(acc => {
          const isCreator = acc._id === sourceId || acc.igUserId === sourceId;
          const checked   = selectedAccounts.includes(acc._id);
          return (
            <label key={acc._id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', borderRadius:8, cursor:'pointer', background: checked?'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)':'transparent', border:`1px solid ${checked?'color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)':'transparent'}` }}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(acc._id)} style={{ accentColor:'var(--mf-mod, var(--mf-accent-500))', width:15, height:15, cursor:'pointer' }} />
              {acc.avatar
                ? <img src={proxyImg(acc.avatar)} alt="" style={{ width:26, height:26, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                : <span style={{ width:26, height:26, borderRadius:'50%', background:'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{acc.username?.slice(0,2).toUpperCase()}</span>
              }
              <span style={{ fontSize:12, color:'var(--mf-text)', flex:1 }}>@{acc.username}</span>
              {isCreator && <span style={{ fontSize:9, fontWeight:700, color:'var(--mf-text-3)', letterSpacing:'.06em', background:'color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', padding:'1px 6px', borderRadius:4 }}>CREATOR</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function CaptionField({ caption, setCaption }) {
  return (
    <div>
      <label style={{ fontSize:12, fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Legenda</label>
      <textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={2200} rows={4}
        style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color:'var(--mf-text)', fontSize:12, padding:'10px 12px', resize:'vertical', outline:'none', lineHeight:1.5, boxSizing:'border-box' }} />
      <div style={{ textAlign:'right', fontSize:10, color:'var(--mf-border-strong)', marginTop:2 }}>{caption.length}/2200</div>
    </div>
  );
}

function PostSettings({ postType, setPostType, cleanMode, setCleanMode, interval, setInterval }) {
  return (
    <div className="g3" style={{ gap:12 }}>
      {[
        { label:'Tipo', value:postType, setValue:setPostType, options:[['reel','Reels'],['post','Foto'],['story','Story']] },
        { label:'Clean mode', value:cleanMode, setValue:setCleanMode, options:CLEAN_MODES.map(m=>[m.value,m.label]) },
      ].map(({ label, value, setValue, options }) => (
        <div key={label}>
          <label style={{ fontSize:11, color:'var(--mf-text-3)', fontWeight:600, display:'block', marginBottom:4 }}>{label}</label>
          <div style={{ position:'relative' }}>
            <select value={value} onChange={e => setValue(e.target.value)}
              style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color:'var(--mf-text)', fontSize:12, padding:'8px 28px 8px 10px', outline:'none', appearance:'none', cursor:'pointer' }}>
              {options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown size={12} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
          </div>
        </div>
      ))}
      <div>
        <label style={{ fontSize:11, color:'var(--mf-text-3)', fontWeight:600, display:'block', marginBottom:4 }}>Intervalo (min)</label>
        <input type="number" min={1} value={interval} onChange={e => setInterval(e.target.value)}
          style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color:'var(--mf-text)', fontSize:12, padding:'8px 10px', outline:'none', boxSizing:'border-box' }} />
      </div>
    </div>
  );
}

function ScheduleField({ scheduled, setScheduled }) {
  return (
    <div>
      <label style={{ fontSize:11, color:'var(--mf-text-3)', fontWeight:600, display:'block', marginBottom:4 }}>📅 Agendar (opcional)</label>
      <input type="datetime-local" value={scheduled} onChange={e => setScheduled(e.target.value)}
        style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius:8, color: scheduled?'var(--mf-text)':'var(--mf-border-strong)', fontSize:12, padding:'8px 10px', outline:'none', boxSizing:'border-box' }} />
      <div style={{ fontSize:10, color:'var(--mf-border-strong)', marginTop:3 }}>Vazio = publica agora respeitando o intervalo entre contas.</div>
    </div>
  );
}

function ErrorBox({ msg }) {
  return <div style={{ fontSize:12, color:'var(--mf-danger-500)', background:'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', borderRadius:8, padding:'8px 12px' }}>{msg}</div>;
}

/* ── Main page ── */
export default function TopPosts() {
  const [insights, setInsights]   = useState([]);
  const [totals, setTotals]       = useState({});
  const [lastSync, setLastSync]   = useState(null);
  const [accounts, setAccounts]         = useState([]);
  const [loopAccountIds, setLoopAccountIds] = useState([]); // IDs das contas em loops ativos

  const [metric, setMetric]       = useState('Views');
  const [period, setPeriod]       = useState('30d');
  const [type, setType]           = useState('Tudo');
  const [accountId, setAccountId] = useState('');

  const [syncing, setSyncing]             = useState(false);
  const [nextSyncIn, setNextSyncIn]       = useState(null); // seconds until next auto-sync
  const [republishIns, setRepublishIns]   = useState(null);
  const [bulkRepublish, setBulkRepublish] = useState(null);

  // Multi-select state
  const [selectMode, setSelectMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const loadRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const params = {
        metric:    metricKey(metric),
        period,
        mediaType: type === 'Tudo' ? 'all' : type.toLowerCase(),
        limit:     50,
      };
      if (accountId) {
        params.accountId = accountId;
      } else if (loopAccountIds.length) {
        params.accountIds = loopAccountIds.join(',');
      }
      const res = await api.get('/insights', { params });
      setInsights(res.data.insights || []);
      setTotals(res.data.totals     || {});
      setLastSync(res.data.lastSync);
    } catch {}
  }, [metric, period, type, accountId, loopAccountIds]);

  loadRef.current = load;

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Busca loops para saber quais contas estão na automação
    Promise.all([
      api.get('/accounts?limit=200'),
      api.get('/loops?limit=200'),
    ]).then(([accRes, loopRes]) => {
      const allAccounts = accRes.data.accounts || [];
      const loops = Array.isArray(loopRes.data) ? loopRes.data : (loopRes.data.loops || []);
      const activeIds = new Set(loops.flatMap(l => (l.accounts || []).map(a => String(a._id || a))));
      const activeAccounts = allAccounts.filter(a =>
        activeIds.has(String(a._id)) && a.healthStatus !== 'banida'
      );
      const activeNonBannedIds = activeAccounts.map(a => String(a._id));
      const allNonBannedIds = allAccounts.filter(a => a.healthStatus !== 'banida').map(a => String(a._id));
      setAccounts(activeAccounts.length ? activeAccounts : allAccounts.filter(a => a.healthStatus !== 'banida'));
      setLoopAccountIds(activeNonBannedIds.length ? activeNonBannedIds : allNonBannedIds);
    }).catch(() => {
      api.get('/accounts?limit=200').then(r => {
        const all = r.data.accounts || [];
        setAccounts(all.filter(a => a.healthStatus !== 'banida'));
        setLoopAccountIds(all.filter(a => a.healthStatus !== 'banida').map(a => String(a._id)));
      }).catch(() => {});
    });
  }, []);
  // Reload from DB every 15 s
  useEffect(() => {
    const id = setInterval(() => loadRef.current?.(), 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-sync from Instagram API every 30 min + countdown display
  useEffect(() => {
    const INTERVAL = 30 * 60; // seconds
    let remaining = INTERVAL;

    const tick = setInterval(() => {
      remaining -= 1;
      setNextSyncIn(remaining);
      if (remaining <= 0) {
        remaining = INTERVAL;
        setNextSyncIn(INTERVAL);
        setSyncing(true);
        api.post('/insights/sync')
          .then(() => loadRef.current?.())
          .catch(() => {})
          .finally(() => setSyncing(false));
      }
    }, 1000);

    setNextSyncIn(INTERVAL);
    return () => clearInterval(tick);
  }, []);

  useServerEvents(['insights', 'posts'], () => loadRef.current?.());

  const handleSync = async () => {
    setSyncing(true);
    try { await api.post('/insights/sync'); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    await load();
    setSyncing(false);
  };

  const toggleSelectMode = () => {
    setSelectMode(v => !v);
    setSelectedIds(new Set());
  };

  const toggleId = id => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectedInsights = useMemo(
    () => insights.filter(ins => selectedIds.has(ins._id)),
    [insights, selectedIds]
  );

  const isLive = lastSync && (Date.now() - new Date(lastSync).getTime()) < 5 * 60 * 1000;
  const fmtLastSync = lastSync ? new Date(lastSync).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : null;

  const totalMetrics = [
    { label:'Views',   val: totals.views },
    { label:'Alcance', val: totals.alcance },
    { label:'Likes',   val: totals.likes },
    { label:'Coments', val: totals.coments },
    { label:'Saves',   val: totals.saves },
    { label:'Shares',  val: totals.shares },
  ];

  return (
    <div style={{ minHeight:'100vh', background:'transparent', padding:'0 0 80px' }}>
      {/* Header */}
      <div className="tp-inner-pad" style={{ marginBottom:24 }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--mf-mod, var(--mf-accent-500))', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
          <Flame size={13} /> TOP POSTS <span style={{ color:'var(--mf-border-strong)' }}>•</span> INSIGHTS OFICIAIS
        </div>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <h1 style={{ margin:0, fontSize:26, fontWeight:800, color:'var(--mf-text)', letterSpacing:'-.02em' }}>Posts com mais visualizações</h1>
            <p style={{ margin:'6px 0 0', fontSize:13, color:'var(--mf-text-3)' }}>Dados vindos direto da API oficial do Instagram — atualiza a cada 30 min.</p>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button
              onClick={toggleSelectMode}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 18px', borderRadius:10, border:`1px solid ${selectMode?'color-mix(in oklch, var(--mf-mod-contas) 50%, transparent)':'color-mix(in oklch, var(--mf-border-strong) 40%, transparent)'}`, background: selectMode?'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)':'color-mix(in oklch, var(--mf-border-strong) 10%, transparent)', color: selectMode?'var(--mf-mod, var(--mf-accent-500))':'var(--mf-text-2)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              <CheckSquare size={15} /> {selectMode ? 'Cancelar seleção' : 'Selecionar posts'}
            </button>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {nextSyncIn !== null && !syncing && (
                <span style={{ fontSize:11, color:'var(--mf-border-strong)', whiteSpace:'nowrap' }}>
                  auto em {Math.floor(nextSyncIn/60)}:{String(nextSyncIn%60).padStart(2,'0')}
                </span>
              )}
              <button onClick={handleSync} disabled={syncing}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 18px', borderRadius:10, border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)', background:'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', fontSize:13, fontWeight:600, cursor: syncing?'not-allowed':'pointer', opacity: syncing?.7:1, whiteSpace:'nowrap' }}>
                <RefreshCw size={15} style={{ animation: syncing?'spin 1s linear infinite':'none' }} /> {syncing ? 'Sincronizando…' : 'Sync'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="tp-hpad" style={{ marginBottom:12, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
        <div style={{ display:'flex', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius:9, overflow:'hidden' }}>
          {METRICS.map(m => (
            <button key={m} onClick={() => setMetric(m)}
              style={{ padding:'7px 14px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer', letterSpacing:'.04em',
                background: metric===m?'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)':'transparent', color: metric===m?'var(--mf-mod, var(--mf-accent-500))':'var(--mf-text-3)',
                borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)', outline:'none' }}>
              {m}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius:9, overflow:'hidden' }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ padding:'7px 12px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer',
                background: period===p?'color-mix(in oklch, var(--mf-primary-500) 25%, transparent)':'transparent', color: period===p?'var(--mf-primary-300)':'var(--mf-text-3)',
                borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)', outline:'none' }}>
              {p}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius:9, overflow:'hidden' }}>
          {TYPES.map(t => (
            <button key={t} onClick={() => setType(t)}
              style={{ padding:'7px 12px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer',
                background: type===t?'color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)':'transparent', color: type===t?'#c084fc':'var(--mf-text-3)',
                borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)', outline:'none' }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ position:'relative', marginLeft:'auto' }}>
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            style={{ background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius:9, color: accountId?'var(--mf-text)':'var(--mf-text-3)', fontSize:11, padding:'7px 28px 7px 12px', outline:'none', appearance:'none', cursor:'pointer', minWidth:140 }}>
            <option value="">Todas as contas</option>
            {accounts.map(a => <option key={a._id} value={a._id}>@{a.username}</option>)}
          </select>
          <ChevronDown size={11} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
        </div>
      </div>

      {/* Status bar */}
      <div className="tp-hpad" style={{ marginBottom:20, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background: isLive?'#2bdc94':'var(--mf-warning-500)', boxShadow:`0 0 8px ${isLive?'#2bdc94':'var(--mf-warning-500)'}`, display:'inline-block' }} />
          <span style={{ color: isLive?'#2bdc94':'var(--mf-warning-500)' }}>{isLive ? 'AO VIVO' : fmtLastSync ? `Sync ${fmtLastSync}` : 'AGUARDANDO SYNC'}</span>
        </div>
        <div style={{ display:'flex', gap:14, fontSize:12, color:'var(--mf-text-3)', flexWrap:'wrap' }}>
          {totalMetrics.map(({ label, val }) => (
            <span key={label}>{label} <strong style={{ color: metric===label?'var(--mf-mod, var(--mf-accent-500))':'var(--mf-text-2)' }}>{fmt(val)}</strong></span>
          ))}
        </div>
        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--mf-border-strong)' }}>{insights.length} posts</span>
      </div>

      {/* Grid */}
      {insights.length === 0 ? (
        <div style={{ padding:'60px 28px', textAlign:'center' }}>
          <div style={{ fontSize:14, color:'var(--mf-text-3)', marginBottom:8 }}>Nenhum post encontrado para o período selecionado.</div>
          <div style={{ fontSize:12, color:'var(--mf-border-strong)' }}>Clique em "Sincronizar" para importar dados das contas conectadas via API.</div>
        </div>
      ) : (
        <div className="tp-hpad" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:16 }}>
          {insights.map((ins, i) => (
            <PostCard
              key={ins._id}
              ins={ins}
              rank={i+1}
              onRepublish={setRepublishIns}
              selectMode={selectMode}
              isSelected={selectedIds.has(ins._id)}
              onToggle={toggleId}
            />
          ))}
        </div>
      )}

      {/* Sticky selection bar */}
      {selectMode && selectedIds.size > 0 && (
        <div style={{
          position:'fixed', bottom:'calc(24px + env(safe-area-inset-bottom, 0px))', left:'50%', transform:'translateX(-50%)',
          background:'rgba(8,20,44,.97)', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 40%, transparent)',
          borderRadius:14, padding:'14px 20px', display:'flex', alignItems:'center', gap:12,
          boxShadow:'0 8px 40px rgba(0,0,0,.5)', backdropFilter:'blur(12px)', zIndex:500,
          maxWidth:'calc(100vw - 32px)', width:'max-content',
        }}>
          <span style={{ fontSize:13, color:'var(--mf-text)', fontWeight:600 }}>
            <strong style={{ color:'var(--mf-mod, var(--mf-accent-500))' }}>{selectedIds.size}</strong> post{selectedIds.size !== 1 ? 's' : ''} selecionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ fontSize:12, color:'var(--mf-text-3)', background:'none', border:'none', cursor:'pointer', padding:0 }}>
            Desmarcar tudo
          </button>
          <button
            onClick={() => setBulkRepublish(selectedInsights)}
            style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, padding:'10px 20px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#0ea5e9,var(--mf-primary-500))', color:'var(--mf-text)', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            <Layers3 size={14} /> Republicar {selectedIds.size} posts
          </button>
        </div>
      )}

      {/* Single republish modal */}
      {republishIns && (
        <RepublishModal ins={republishIns} accounts={accounts} onClose={() => setRepublishIns(null)} />
      )}

      {/* Bulk republish modal */}
      {bulkRepublish && (
        <BulkRepublishModal insArray={bulkRepublish} accounts={accounts} onClose={() => { setBulkRepublish(null); setSelectMode(false); setSelectedIds(new Set()); }} />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--mf-border-strong) 50%, transparent); border-radius: 3px; }
      `}</style>
    </div>
  );
}

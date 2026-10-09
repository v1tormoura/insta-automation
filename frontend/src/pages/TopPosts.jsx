import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Send, X, ChevronDown, Flame, ExternalLink, Layers3, ImagePlus } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { EsqueletoGrade } from '../components/Estados';

/* ── helpers ── */
const fmt  = v => Number(v || 0).toLocaleString('pt-BR');

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;   // local file — serve directly
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`; // CDN URL — proxy
};

const RANK_COLORS = ['var(--mf-mod-publicar)','var(--mf-info-500)','var(--mf-mod-contas)','var(--mf-success-500)','var(--mf-warning-500)','var(--mf-danger-500)'];

function insightViews(ins) {
  return ins.videoViews || ins.impressions || 0;
}
function mediaLabel(type) {
  if (!type) return 'POST';
  if (type === 'VIDEO') return 'REEL';
  if (type === 'CAROUSEL_ALBUM') return 'CARROSSEL';
  return 'FOTO';
}

/* ── PostCard ── */

function RepublishModal({ ins, onClose, accounts }) {
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [postType, setPostType]   = useState(ins.mediaType === 'IMAGE' ? 'post' : 'reel');
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
  const selectAll = () => setSelectedAccounts(accounts.map(a => a.id));
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
          ? (legends.find(l => l.id === savedLegendId)?.text || '')
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
        postType, intervalMinutes: Number(interval) || 3,
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
    flex:1, padding:'8px 0', borderRadius: 'var(--mf-r-sm)', border:`1px solid ${active ? 'color-mix(in oklch, var(--mf-mod-contas) 50%, transparent)' : 'color-mix(in oklch, var(--mf-border-strong) 40%, transparent)'}`,
    background: active ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-surface-1)',
    color: active ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', fontWeight:600, cursor:'pointer',
  });

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)', padding:16 }}>
      <div style={{ background:'rgba(8,20,44,.97)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 60%, transparent)', borderRadius: 'var(--mf-r-lg)', width:'100%', maxWidth:780, maxHeight:'90vh', overflow:'auto', boxShadow:'0 24px 80px rgba(0,0,0,.6)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 24px', borderBottom:'1px solid color-mix(in oklch, var(--mf-border-strong) 35%, transparent)' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)' }}>
              <Send size={16} style={{ color:'var(--mf-mod, var(--mf-accent-500))' }} /> Republicar post
            </div>
            <p style={{ margin:'4px 0 0', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)' }}>
              Baixamos a mídia original e republicamos nas contas que você escolher.
            </p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--mf-text-3)', padding:4 }}><X size={18} /></button>
        </div>
        <div className="modal-sidebar">
          <div style={{ padding:'16px 16px', borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)' }}>
            <div style={{ aspectRatio:'9/16', borderRadius: 'var(--mf-r-md)', overflow:'hidden', background:'var(--mf-surface-1)', marginBottom:12 }}>
              {thumbSrc
                ? <img src={thumbSrc} alt="" onError={() => setImgErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#1e3a5f' }}><Flame size={32} /></div>
              }
            </div>
            <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', marginBottom:4 }}>De <strong style={{ color:'var(--mf-mod, var(--mf-accent-500))' }}>@{ins.username}</strong></div>
            <div style={{ display:'inline-block', padding:'2px 8px', background:'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)', borderRadius: 'var(--mf-r-xs)', fontSize: 'var(--mf-t-nano)', fontWeight:700 }}>
              {mediaLabel(ins.mediaType)}
            </div>
          </div>
          <div style={{ padding:'16px 24px', display:'flex', flexDirection:'column', gap:16 }}>
            <AccountSelector accounts={accounts} selectedAccounts={selectedAccounts} onToggle={toggle} onSelectAll={selectAll} onClearAll={clearAll} sourceId={ins.accountId} />

            {/* Legenda */}
            <div>
              <label style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Legenda</label>
              <div style={{ display:'flex', gap:6, marginBottom:8 }}>
                <button style={btnStyle(captionMode==='original')} onClick={() => setCaptionMode('original')}>Original</button>
                <button style={btnStyle(captionMode==='custom')}   onClick={() => setCaptionMode('custom')}>Nova legenda</button>
                <button style={btnStyle(captionMode==='saved')}    onClick={() => setCaptionMode('saved')}>Legenda salva</button>
              </div>
              {captionMode === 'original' && (
                <div style={{ padding:'8px 12px', background:'var(--mf-surface-1)', borderRadius: 'var(--mf-r-sm)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 30%, transparent)', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', lineHeight:1.5, maxHeight:80, overflow:'auto' }}>
                  {ins.caption || <em>Sem legenda</em>}
                </div>
              )}
              {captionMode === 'custom' && (
                <>
                  <textarea value={customCaption} onChange={e => setCustomCaption(e.target.value)} maxLength={2200} rows={4}
                    placeholder="Digite a nova legenda..."
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)', padding:'8px 12px', resize:'vertical', outline:'none', lineHeight:1.5, boxSizing:'border-box' }} />
                  <div style={{ textAlign:'right', fontSize: 'var(--mf-t-nano)', color:'var(--mf-border-strong)', marginTop:2 }}>{customCaption.length}/2200</div>
                </>
              )}
              {captionMode === 'saved' && (
                <div style={{ position:'relative' }}>
                  <select value={savedLegendId} onChange={e => setSavedLegendId(e.target.value)}
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color: savedLegendId ? 'var(--mf-text)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', padding:'8px 24px 8px 8px', outline:'none', appearance:'none', cursor:'pointer' }}>
                    <option value="">Selecione uma legenda salva...</option>
                    {legends.map(l => <option key={l.id} value={l.id}>{l.name || l.text?.slice(0,50)}</option>)}
                  </select>
                  <ChevronDown size={12} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
                </div>
              )}
            </div>

            {/* Capa (só para reels) */}
            {postType === 'reel' && (
              <div>
                <label style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Capa do reel</label>
                <input ref={coverInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={onCoverChange} />
                {coverPreview
                  ? <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <img src={coverPreview} alt="capa" style={{ width:54, height:96, objectFit:'cover', borderRadius: 'var(--mf-r-sm)', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' }} />
                      <div>
                        <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-mod, var(--mf-accent-500))', marginBottom:4 }}>Capa selecionada</div>
                        <button onClick={() => { setCoverFile(null); setCoverPreview(''); }} style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)', background:'none', border:'none', cursor:'pointer', padding:0 }}>Remover</button>
                      </div>
                    </div>
                  : <button onClick={() => coverInputRef.current?.click()}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', borderRadius: 'var(--mf-r-sm)', border:'1px dashed color-mix(in oklch, var(--mf-border-strong) 60%, transparent)', background:'var(--mf-surface-1)', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', cursor:'pointer' }}>
                      <ImagePlus size={14} /> Escolher imagem de capa
                    </button>
                }
              </div>
            )}

            <PostSettings postType={postType} setPostType={setPostType} interval={interval} setInterval={setInterval} />
            <ScheduleField scheduled={scheduled} setScheduled={setScheduled} />
            {error && <ErrorBox msg={error} />}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, padding:'16px 24px', borderTop:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', borderRadius: 'var(--mf-r-sm)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background:'transparent', color:'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', cursor:'pointer' }}>Cancelar</button>
          <button onClick={submit} disabled={loading || done}
            style={{ padding:'8px 24px', borderRadius: 'var(--mf-r-sm)', border:'none', cursor: loading||done?'not-allowed':'pointer', background: done?'color-mix(in oklch, var(--mf-success-500) 20%, transparent)':'linear-gradient(135deg,var(--mf-primary-500),var(--mf-primary-500))', color: done?'var(--mf-success-500)':'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight:700, display:'flex', alignItems:'center', gap:8, opacity: loading?.7:1 }}>
            {done ? '✓ Enviado!' : loading ? <><RefreshCw size={14} style={{ animation:'spin 1s linear infinite' }}/> Enviando...</> : <><Send size={14}/> Republicar ({selectedAccounts.length})</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── BulkRepublishModal (multi-post) ── */
/* Miniatura de um post escolhido para republicar. Componente próprio porque
   guarda estado (a imagem que falhou) — hook dentro de `map` quebraria ao
   mudar a quantidade de posts. */
function MiniaturaSelecionada({ ins, i }) {
  const [imgErr, setImgErr] = useState(false);
  const src = !imgErr ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : null;
  const color = RANK_COLORS[i % RANK_COLORS.length];
  return (
    <div style={{ position:'relative', aspectRatio:'9/16', borderRadius: 'var(--mf-r-sm)', overflow:'hidden', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)' }}>
      {src
        ? <img src={src} alt="" onError={() => setImgErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#1e3a5f' }}><Flame size={20} /></div>
      }
      <div style={{ position:'absolute', top:4, right:4, background:color, color:'var(--mf-primary-fg)', fontSize: 'var(--mf-t-nano)', fontWeight:800, width:18, height:18, borderRadius: 'var(--mf-r-full)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {i+1}
      </div>
    </div>
  );
}

function BulkRepublishModal({ insArray, onClose, accounts }) {
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [postType, setPostType]   = useState('reel');
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
  const selectAll = () => setSelectedAccounts(accounts.map(a => a.id));
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
        ? (legends.find(l => l.id === savedLegendId)?.text || '')
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
          intervalMinutes: Number(interval) || 3,
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
      <div style={{ background:'rgba(8,20,44,.97)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 60%, transparent)', borderRadius: 'var(--mf-r-lg)', width:'100%', maxWidth:860, maxHeight:'92vh', overflow:'auto', boxShadow:'0 24px 80px rgba(0,0,0,.6)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 24px', borderBottom:'1px solid color-mix(in oklch, var(--mf-border-strong) 35%, transparent)' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)' }}>
              <Layers3 size={16} style={{ color:'var(--mf-mod, var(--mf-accent-500))' }} /> Republicar {insArray.length} posts
            </div>
            <p style={{ margin:'4px 0 0', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)' }}>
              Escolha as contas, legenda e configurações.
            </p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--mf-text-3)', padding:4 }}><X size={18} /></button>
        </div>

        <div className="modal-half">
          {/* Left: thumbnail grid */}
          <div style={{ padding:'16px 16px', borderRight:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)', maxHeight:520, overflowY:'auto' }}>
            <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight:600, color:'var(--mf-text-3)', marginBottom:10, letterSpacing:'.06em' }}>POSTS SELECIONADOS ({insArray.length})</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(min(90px,100%), 1fr))', gap:8 }}>
              {insArray.map((ins, i) => <MiniaturaSelecionada key={ins.id} ins={ins} i={i} />)}
            </div>
          </div>

          {/* Right: settings */}
          <div style={{ padding:'16px 24px', display:'flex', flexDirection:'column', gap:16, maxHeight:520, overflowY:'auto' }}>
            <AccountSelector accounts={accounts} selectedAccounts={selectedAccounts} onToggle={toggle} onSelectAll={selectAll} onClearAll={clearAll} />
            <PostSettings postType={postType} setPostType={setPostType} interval={interval} setInterval={setInterval} />

            {/* Caption mode */}
            <div>
              <label style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Legenda</label>
              <div style={{ display:'flex', gap:4, marginBottom:8 }}>
                {[['original','Original'],['custom','Nova legenda'],['saved','Legenda salva']].map(([m,l]) => (
                  <button key={m} onClick={() => setCaptionMode(m)}
                    style={{ flex:1, fontSize: 'var(--mf-t-micro)', padding:'4px 4px', borderRadius: 'var(--mf-r-sm)', border: captionMode===m ? '1px solid var(--mf-mod, var(--mf-accent-500))' : '1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background: captionMode===m ? 'rgba(34,215,255,.1)' : 'transparent', color: captionMode===m ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)', cursor:'pointer', fontWeight: captionMode===m ? 700 : 400 }}>{l}</button>
                ))}
              </div>
              {captionMode === 'original' && (
                <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>Cada post mantém sua legenda original.</div>
              )}
              {captionMode === 'custom' && (
                <>
                  <textarea value={customCaption} onChange={e => setCustomCaption(e.target.value)} maxLength={2200} rows={3}
                    placeholder="Digite a legenda para todos os posts..."
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)', padding:'8px 12px', resize:'vertical', outline:'none', lineHeight:1.5, boxSizing:'border-box' }} />
                  <div style={{ textAlign:'right', fontSize: 'var(--mf-t-nano)', color:'var(--mf-border-strong)', marginTop:2 }}>{customCaption.length}/2200</div>
                </>
              )}
              {captionMode === 'saved' && (
                <div style={{ position:'relative' }}>
                  <select value={savedLegendId} onChange={e => setSavedLegendId(e.target.value)}
                    style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color: savedLegendId ? 'var(--mf-text)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', padding:'8px 24px 8px 8px', outline:'none', appearance:'none', cursor:'pointer', boxSizing:'border-box' }}>
                    <option value="">— Escolha uma legenda —</option>
                    {legends.map(l => <option key={l.id} value={l.id}>{l.title}{l.category ? ` (${l.category})` : ''}</option>)}
                  </select>
                  <ChevronDown size={12} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
                </div>
              )}
            </div>

            {/* Cover image (reels only) */}
            {postType === 'reel' && (
              <div>
                <label style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text-2)', display:'block', marginBottom:6 }}>Capa do reel (opcional)</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <button onClick={() => coverInputRef.current?.click()}
                    style={{ padding:'8px 12px', borderRadius: 'var(--mf-r-sm)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background:'var(--mf-surface-1)', color:'var(--mf-text-2)', fontSize: 'var(--mf-t-xs)', cursor:'pointer', display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                    <ImagePlus size={13} /> {coverFile ? 'Trocar capa' : 'Adicionar capa'}
                  </button>
                  {coverPreview && (
                    <img src={coverPreview} alt="capa" style={{ width:30, height:44, objectFit:'cover', borderRadius: 'var(--mf-r-xs)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', flexShrink:0 }} />
                  )}
                  {coverFile && (
                    <button onClick={() => { setCoverFile(null); setCoverPreview(''); if (coverInputRef.current) coverInputRef.current.value = ''; }}
                      style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)', background:'none', border:'none', cursor:'pointer', padding:0 }}>✕</button>
                  )}
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" onChange={onCoverChange} style={{ display:'none' }} />
                <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-border-strong)', marginTop:3 }}>
                  {coverFile ? coverFile.name : 'Todos os posts usarão esta capa.'}
                </div>
              </div>
            )}

            <ScheduleField scheduled={scheduled} setScheduled={setScheduled} />

            {/* Progress */}
            {progress && (
              <div style={{ background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', marginBottom:6 }}>
                  <span>Progresso</span>
                  <span style={{ color:'var(--mf-mod, var(--mf-accent-500))', fontWeight:700 }}>{progress.done}/{progress.total}</span>
                </div>
                <div style={{ height:4, background:'color-mix(in oklch, var(--mf-border-strong) 40%, transparent)', borderRadius: 'var(--mf-r-xs)', overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(progress.done/progress.total)*100}%`, background:'linear-gradient(90deg,var(--mf-primary-500),var(--mf-primary-500))', transition:'width .3s', borderRadius: 'var(--mf-r-xs)' }} />
                </div>
                {progress.error && <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)', marginTop:6 }}>{progress.error}</div>}
              </div>
            )}

            {error && <ErrorBox msg={error} />}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, padding:'16px 24px', borderTop:'1px solid color-mix(in oklch, var(--mf-border-strong) 25%, transparent)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', borderRadius: 'var(--mf-r-sm)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', background:'transparent', color:'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', cursor:'pointer' }}>Cancelar</button>
          <button onClick={submit} disabled={!!progress || done}
            style={{ padding:'8px 24px', borderRadius: 'var(--mf-r-sm)', border:'none', cursor: (progress||done)?'not-allowed':'pointer', background: done?'color-mix(in oklch, var(--mf-success-500) 20%, transparent)':'linear-gradient(135deg,var(--mf-primary-500),var(--mf-primary-500))', color: done?'var(--mf-success-500)':'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight:700, display:'flex', alignItems:'center', gap:8, opacity: progress?.7:1 }}>
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
        <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text-2)' }}>Contas de destino ({selectedAccounts.length}/{accounts.length})</span>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onSelectAll} style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-mod, var(--mf-accent-500))', background:'none', border:'none', cursor:'pointer', padding:0 }}>Todas</button>
          <span style={{ color:'var(--mf-border-strong)' }}>·</span>
          <button onClick={onClearAll}  style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', background:'none', border:'none', cursor:'pointer', padding:0 }}>Limpar</button>
        </div>
      </div>
      <div style={{ maxHeight:140, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
        {accounts.map(acc => {
          const isCreator = acc.id === sourceId || acc.igUserId === sourceId;
          const checked   = selectedAccounts.includes(acc.id);
          return (
            <label key={acc.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', background: checked?'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)':'transparent', border:`1px solid ${checked?'color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)':'transparent'}` }}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(acc.id)} style={{ accentColor:'var(--mf-mod, var(--mf-accent-500))', width:15, height:15, cursor:'pointer' }} />
              {acc.avatar
                ? <img src={proxyImg(acc.avatar)} alt="" style={{ width:26, height:26, borderRadius: 'var(--mf-r-full)', objectFit:'cover', flexShrink:0 }} />
                : <span style={{ width:26, height:26, borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-nano)', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{acc.username?.slice(0,2).toUpperCase()}</span>
              }
              <span style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text)', flex:1 }}>@{acc.username}</span>
              {isCreator && <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', letterSpacing:'.06em', background:'color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', padding:'2px 4px', borderRadius: 'var(--mf-r-xs)' }}>CREATOR</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}


function PostSettings({ postType, setPostType, interval, setInterval }) {
  return (
    <div className="g3" style={{ gap:12 }}>
      {[
        { label:'Tipo', value:postType, setValue:setPostType, options:[['reel','Reels'],['post','Foto'],['story','Story']] },
      ].map(({ label, value, setValue, options }) => (
        <div key={label}>
          <label style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontWeight:600, display:'block', marginBottom:4 }}>{label}</label>
          <div style={{ position:'relative' }}>
            <select value={value} onChange={e => setValue(e.target.value)}
              style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)', padding:'8px 24px 8px 8px', outline:'none', appearance:'none', cursor:'pointer' }}>
              {options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown size={12} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--mf-text-3)', pointerEvents:'none' }} />
          </div>
        </div>
      ))}
      <div>
        <label style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontWeight:600, display:'block', marginBottom:4 }}>Intervalo (min)</label>
        <input type="number" min={1} value={interval} onChange={e => setInterval(e.target.value)}
          style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)', padding:'8px 8px', outline:'none', boxSizing:'border-box' }} />
      </div>
    </div>
  );
}

function ScheduleField({ scheduled, setScheduled }) {
  return (
    <div>
      <label style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontWeight:600, display:'block', marginBottom:4 }}>📅 Agendar (opcional)</label>
      <input type="datetime-local" value={scheduled} onChange={e => setScheduled(e.target.value)}
        style={{ width:'100%', background:'var(--mf-surface-1)', border:'1px solid color-mix(in oklch, var(--mf-border-strong) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', color: scheduled?'var(--mf-text)':'var(--mf-border-strong)', fontSize: 'var(--mf-t-xs)', padding:'8px 8px', outline:'none', boxSizing:'border-box' }} />
      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-border-strong)', marginTop:3 }}>Vazio = publica agora respeitando o intervalo entre contas.</div>
    </div>
  );
}

function ErrorBox({ msg }) {
  return <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-danger-500)', background:'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px' }}>{msg}</div>;
}

/* ── Página ─────────────────────────────────────────────────────────────────
   Os cartões somam o PERÍODO inteiro (o servidor agrega todos os posts do
   período); a tabela lista os 50 melhores pela coluna escolhida. */

const PERIODOS = [['7d', 'últimos 7 dias'], ['30d', 'últimos 30 dias'], ['90d', 'últimos 90 dias'], ['1a', 'último ano']];
const TIPOS = [['all', 'Tudo'], ['reel', 'Reels'], ['carrossel', 'Carrossel'], ['foto', 'Fotos']];
const COLUNAS = [
  ['views', 'Views', ins => insightViews(ins)],
  ['likes', 'Curtidas', ins => ins.likeCount],
  ['coments', 'Comentários', ins => ins.commentsCount],
];
const tipoLegivel = t => ({ VIDEO: 'Reel', CAROUSEL_ALBUM: 'Carrossel', IMAGE: 'Foto' }[t] || 'Post');
const dataCurta = d => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

function Miniatura({ ins }) {
  const [erro, setErro] = useState(false);
  const src = !erro ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : '';
  return (
    <div style={{ width: 38, height: 38, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--mf-surface-2)', display: 'grid', placeItems: 'center' }}>
      {src ? <img src={src} alt="" loading="lazy" onError={() => setErro(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <Flame size={15} style={{ color: 'var(--mf-text-3)' }} />}
    </div>
  );
}

/* No celular a tabela vira lista: seis colunas não cabem em 390px. */
function useEstreito(px = 720) {
  const consulta = `(max-width: ${px}px)`;
  const [estreito, setEstreito] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudou = () => setEstreito(m.matches);
    m.addEventListener('change', mudou);
    return () => m.removeEventListener('change', mudou);
  }, [consulta]);
  return estreito;
}

export default function TopPosts() {
  const estreito = useEstreito();
  const [insights, setInsights] = useState([]);
  const [totals, setTotals] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const [carregou, setCarregou] = useState(false);
  const [accounts, setAccounts] = useState([]);

  const [period, setPeriod] = useState('30d');
  const [tipo, setTipo] = useState('all');
  const [accountId, setAccountId] = useState('');
  const [ordem, setOrdem] = useState('views');

  const [syncing, setSyncing] = useState(false);
  const [republishIns, setRepublishIns] = useState(null);
  const [bulkRepublish, setBulkRepublish] = useState(null);
  const [selecionar, setSelecionar] = useState(false);
  const [selecionados, setSelecionados] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/insights', {
        params: { metric: ordem, period, mediaType: tipo, limit: 50, ...(accountId ? { accountId } : {}) },
      });
      setInsights(data.insights || []);
      setTotals(data.totals || {});
      setLastSync(data.lastSync);
    } catch { /* a tela mostra o estado vazio */ }
    finally { setCarregou(true); }
  }, [ordem, period, tipo, accountId]);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; load(); }, [load]);
  useEffect(() => {
    api.get('/accounts?limit=200')
      .then(r => setAccounts((r.data.accounts || []).filter(a => a.healthStatus !== 'banida')))
      .catch(() => {});
    const t = setInterval(() => loadRef.current?.(), 60_000);
    return () => clearInterval(t);
  }, []);
  useServerEvents(['insights', 'posts'], () => loadRef.current?.());

  async function sincronizar() {
    setSyncing(true);
    try { await api.post('/insights/sync'); } catch { /* segue com o que já tem */ }
    await new Promise(r => setTimeout(r, 1500));
    await load();
    setSyncing(false);
  }

  const marcar = id => setSelecionados(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sairDaSelecao = () => { setSelecionar(false); setSelecionados(new Set()); };
  const periodoTexto = PERIODOS.find(p => p[0] === period)?.[1] || '';
  const atualizado = lastSync ? new Date(lastSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

  const cartoes = [
    ['Views totais', totals.views, 'das mídias medidas'],
    ['Curtidas totais', totals.likes, 'dados da API oficial'],
    ['Comentários', totals.coments, 'dados da API oficial'],
    ['Posts analisados', totals.posts, `publicados nos ${periodoTexto}`],
  ];
  const th = { padding: '10px 12px', fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '10px 12px', borderTop: '1px solid var(--mf-border)', verticalAlign: 'middle' };
  const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--mf-t-sm)' };

  return (
    <PageShell icon={<Flame size={18} />} title="Top posts" accent="cyan"
      subtitle="Acompanhe os posts com melhor desempenho e replique o que dá certo. Métricas pela API oficial da Meta, relidas a cada 30 minutos."
      actions={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select className="inp" aria-label="Período" value={period} onChange={e => setPeriod(e.target.value)} style={{ width: 'auto', padding: '6px 10px' }}>
            {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <button type="button" className="btn-ghost" onClick={sincronizar} disabled={syncing} title={atualizado ? `Última leitura: ${atualizado}` : 'Ler as métricas agora'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} style={syncing ? { animation: 'spin .8s linear infinite' } : undefined} /> {syncing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      )}>

      <div data-top-cartoes style={{ display: 'grid', gap: 'var(--mf-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 'var(--mf-4)' }}>
        {cartoes.map(([rotulo, valor, sub]) => (
          <div key={rotulo} className="mf-card" style={{ padding: 'var(--mf-4)' }}>
            <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)' }}>{rotulo}</div>
            <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 800, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{carregou ? fmt(valor) : '—'}</div>
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{sub}</div>
          </div>
        ))}
      </div>

      <section className="mf-card" data-top-tabela style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 'var(--mf-3) var(--mf-4)' }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 750, color: 'var(--mf-text)', flex: 1, minWidth: 160 }}>Os melhores posts</div>
          <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Tipo">
            {TIPOS.map(([v, t]) => (
              <button key={v} type="button" onClick={() => setTipo(v)} aria-pressed={tipo === v}
                style={{ padding: '5px 10px', borderRadius: 'var(--mf-r-full)', cursor: 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight: 650,
                  border: `1px solid ${tipo === v ? 'var(--mf-primary-500)' : 'var(--mf-border)'}`,
                  background: tipo === v ? 'color-mix(in oklch, var(--mf-primary-500) 12%, transparent)' : 'transparent',
                  color: tipo === v ? 'var(--mf-text)' : 'var(--mf-text-2)' }}>{t}</button>
            ))}
          </div>
          <select className="inp" aria-label="Conta" value={accountId} onChange={e => setAccountId(e.target.value)} style={{ width: 'auto', padding: '5px 10px', fontSize: 'var(--mf-t-xs)' }}>
            <option value="">Todas as contas</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}
          </select>
          {estreito && (
            <select className="inp" aria-label="Ordenar por" value={ordem} onChange={e => setOrdem(e.target.value)} style={{ width: 'auto', padding: '5px 10px', fontSize: 'var(--mf-t-xs)' }}>
              {COLUNAS.map(([chave, rotulo]) => <option key={chave} value={chave}>Ordenar: {rotulo}</option>)}
            </select>
          )}
          {insights.length > 0 && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => (selecionar ? sairDaSelecao() : setSelecionar(true))}>
              {selecionar ? 'Cancelar seleção' : 'Selecionar'}
            </button>
          )}
        </div>

        {estreito ? (
          <div data-top-lista>
            {insights.map((ins, i) => (
              <div key={ins.id} data-top-linha style={{ display: 'flex', gap: 10, padding: '10px var(--mf-4)', borderTop: '1px solid var(--mf-border)',
                background: selecionados.has(ins.id) ? 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)' : undefined }}>
                {selecionar && <input type="checkbox" checked={selecionados.has(ins.id)} onChange={() => marcar(ins.id)} aria-label={`Selecionar post ${i + 1}`} />}
                <span style={{ width: 18, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', paddingTop: 10, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <Miniatura ins={ins} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: 'var(--mf-text)' }}>
                    {(ins.caption || '').split('\n')[0] || <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>(sem legenda)</span>}
                  </div>
                  <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                    @{ins.username} · {tipoLegivel(ins.mediaType)} · {dataCurta(ins.postedAt)}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 'var(--mf-t-xs)', fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap' }}>
                    {COLUNAS.map(([chave, rotulo, valor]) => (
                      <span key={chave} style={{ color: ordem === chave ? 'var(--mf-text)' : 'var(--mf-text-2)', fontWeight: ordem === chave ? 800 : 500 }}>
                        {fmt(valor(ins))} <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>{rotulo.toLowerCase()}</span>
                      </span>
                    ))}
                    {ins.permalink && <a href={ins.permalink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>abrir <ExternalLink size={10} style={{ verticalAlign: -1 }} /></a>}
                  </div>
                </div>
                <button type="button" className="btn-ghost btn-sm" aria-label="Republicar" onClick={() => setRepublishIns(ins)} style={{ alignSelf: 'center', display: 'inline-grid', placeItems: 'center', padding: 6 }}>
                  <Send size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {selecionar && <th style={{ ...th, width: 36 }} />}
                <th style={{ ...th, width: 44 }}>#</th>
                <th style={th}>Post</th>
                <th style={th}>Conta</th>
                {COLUNAS.map(([chave, rotulo]) => (
                  <th key={chave} style={{ ...th, textAlign: 'right' }}>
                    <button type="button" onClick={() => setOrdem(chave)} title={`Ordenar por ${rotulo.toLowerCase()}`}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
                        color: ordem === chave ? 'var(--mf-text)' : 'var(--mf-text-3)' }}>
                      {rotulo}{ordem === chave ? ' ↓' : ''}
                    </button>
                  </th>
                ))}
                <th style={{ ...th, width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {insights.map((ins, i) => (
                <tr key={ins.id} data-top-linha style={{ background: selecionados.has(ins.id) ? 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)' : undefined }}>
                  {selecionar && (
                    <td style={td}><input type="checkbox" checked={selecionados.has(ins.id)} onChange={() => marcar(ins.id)} aria-label={`Selecionar post ${i + 1}`} /></td>
                  )}
                  <td style={{ ...td, color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Miniatura ins={ins} />
                      <div style={{ minWidth: 0, maxWidth: 420 }}>
                        <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: 'var(--mf-text)' }}>
                          {(ins.caption || '').split('\n')[0] || <span style={{ color: 'var(--mf-text-3)', fontWeight: 500 }}>(sem legenda)</span>}
                        </div>
                        <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                          {tipoLegivel(ins.mediaType)} · {dataCurta(ins.postedAt)}
                          {ins.permalink && (<> · <a href={ins.permalink} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', whiteSpace: 'nowrap' }}>abrir no Instagram <ExternalLink size={10} style={{ verticalAlign: -1 }} /></a></>)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>@{ins.username}</td>
                  {COLUNAS.map(([chave, , valor]) => (
                    <td key={chave} style={{ ...num, fontWeight: ordem === chave ? 800 : 500, color: ordem === chave ? 'var(--mf-text)' : 'var(--mf-text-2)' }}>{fmt(valor(ins))}</td>
                  ))}
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" className="btn-ghost btn-sm" title="Republicar em outras contas" aria-label="Republicar" onClick={() => setRepublishIns(ins)}
                      style={{ display: 'inline-grid', placeItems: 'center', padding: 6 }}>
                      <Send size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {carregou && !insights.length && (
          <div style={{ padding: 'var(--mf-5)', textAlign: 'center', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)' }}>
            Nenhum post publicado nos {periodoTexto}{accountId ? ' nesta conta' : ''}. Clique em Atualizar para ler as métricas agora.
          </div>
        )}
        {!carregou && <div style={{ padding: 'var(--mf-4)' }}><EsqueletoGrade /></div>}
        {atualizado && (
          <div style={{ padding: '8px var(--mf-4)', borderTop: '1px solid var(--mf-border)', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
            Última leitura das métricas: {atualizado}
          </div>
        )}
      </section>

      {selecionar && selecionados.size > 0 && (
        <div style={{ position: 'sticky', bottom: 16, marginTop: 'var(--mf-3)', display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="btn-primary" onClick={() => setBulkRepublish(insights.filter(x => selecionados.has(x.id)))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Layers3 size={14} /> Republicar {selecionados.size} selecionado(s)
          </button>
        </div>
      )}

      {republishIns && (
        <RepublishModal ins={republishIns} accounts={accounts} onClose={() => setRepublishIns(null)} />
      )}
      {bulkRepublish && (
        <BulkRepublishModal insArray={bulkRepublish} accounts={accounts} onClose={() => { setBulkRepublish(null); sairDaSelecao(); }} />
      )}
    </PageShell>
  );
}

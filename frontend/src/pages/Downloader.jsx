import { useState } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import PageShell from '../components/PageShell';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function tok() { return localStorage.getItem('instaflow_token') || ''; }
function auth() { return { headers: { Authorization: `Bearer ${tok()}` } }; }
function proxyImg(url) { return url ? `${API}/image-proxy?url=${encodeURIComponent(url)}` : ''; }

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

async function dlFile(url, filename) {
  const res = await fetch(`${API}/downloader/file?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${tok()}` },
  });
  if (!res.ok) throw new Error('Falha no download');
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
}

const cardStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };
const inputStyle = { flex:1, minWidth:200, padding:'8px 12px', background:'color-mix(in oklch, var(--mf-bg) 80%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-text)', fontSize: 'var(--mf-t-sm)', outline:'none' };

const IC_DL = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export default function Downloader() {
  const [username,    setUsername]    = useState('');
  const [profile,     setProfile]     = useState(null);
  const [media,       setMedia]       = useState([]);
  const [hasMore,     setHasMore]     = useState(false);
  const [cursor,      setCursor]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');
  const [selected,    setSelected]    = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [dlProg,      setDlProg]      = useState({ done: 0, total: 0 });

  async function handleSearch() {
    if (!username.trim()) return;
    setLoading(true); setError(''); setProfile(null); setMedia([]); setSelected(new Set()); setHasMore(false); setCursor(null);
    try {
      const clean = username.replace('@', '').trim();
      const r = await axios.get(`${API}/downloader/profile`, { ...auth(), params: { username: clean } });
      setProfile(r.data.profile);
      setMedia(r.data.media || []);
      setHasMore(r.data.has_more || false);
      setCursor(r.data.next_cursor || null);
    } catch (e) { setError(e.response?.data?.error || 'Erro ao buscar perfil'); }
    finally { setLoading(false); }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const clean = username.replace('@', '').trim();
      const r = await axios.get(`${API}/downloader/profile`, { ...auth(), params: { username: clean, cursor } });
      setMedia(p => [...p, ...(r.data.media || [])]);
      setHasMore(r.data.has_more || false);
      setCursor(r.data.next_cursor || null);
    } catch (e) { setError(e.response?.data?.error || 'Erro ao carregar mais'); }
    finally { setLoadingMore(false); }
  }

  function toggleSel(id) { setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { if (selected.size === media.length) setSelected(new Set()); else setSelected(new Set(media.map(m => m.id))); }

  async function downloadItem(item, stopProp) {
    if (stopProp) stopProp.stopPropagation();
    const user = profile?.username || 'ig';
    if (item.type === 'carousel' && item.items?.length) {
      for (let i = 0; i < item.items.length; i++) {
        const ci = item.items[i];
        const ext = ci.type === 'video' ? 'mp4' : 'jpg';
        await dlFile(ci.url, `${user}_${item.pk}_${i + 1}.${ext}`);
        if (i < item.items.length - 1) await new Promise(r => setTimeout(r, 200));
      }
      return;
    }
    const ext = item.type === 'video' ? 'mp4' : 'jpg';
    await dlFile(item.url, `${user}_${item.pk}.${ext}`);
  }

  async function downloadSelected() {
    const list = media.filter(m => selected.has(m.id));
    if (!list.length) return;
    setDownloading(true); setDlProg({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      try { await downloadItem(list[i]); } catch {}
      await new Promise(r => setTimeout(r, 350));
      setDlProg({ done: i + 1, total: list.length });
    }
    setDownloading(false);
  }

  const allSel = media.length > 0 && selected.size === media.length;

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );

  const pageActions = selected.size > 0 ? (
    <button className="btn-primary" style={{ display:'flex', alignItems:'center', gap:6, height:34, padding:'0 16px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)' }}
      onClick={downloadSelected} disabled={downloading}>
      {IC_DL}
      {downloading ? `${dlProg.done}/${dlProg.total}` : `Baixar ${selected.size} selecionados`}
    </button>
  ) : null;

  return (
    <PageShell icon={pageIcon} title="Baixar Perfil" subtitle="Baixe todas as mídias de qualquer perfil público sem perder qualidade." accent="cyan" actions={pageActions}>

      {/* Search */}
      <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:.22 }} style={{ ...cardStyle, padding:'16px 16px', marginBottom:14 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="@username ou username"
            style={inputStyle}
          />
          <button className="btn-primary" style={{ height:38, padding:'0 16px', borderRadius: 'var(--mf-r-sm)', opacity:(loading || !username.trim()) ? .5 : 1 }}
            onClick={handleSearch} disabled={loading || !username.trim()}>
            {loading ? '⏳ Buscando…' : '🔍 Buscar'}
          </button>
        </div>
        {error && (
          <div style={{ marginTop:10, padding:'8px 12px', background:'color-mix(in oklch, var(--mf-danger-500) 9%, transparent)', border:'1px solid oklch(0.38 0.12 15 / 0.35)', borderRadius: 'var(--mf-r-sm)', color:'var(--mf-danger-500)', fontSize: 'var(--mf-t-xs)' }}>
            {error}
          </div>
        )}
      </motion.div>

      {/* Profile card */}
      {profile && (
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:.22 }}
          style={{ ...cardStyle, padding:'16px 16px', marginBottom:14, display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ width:64, height:64, borderRadius: 'var(--mf-r-full)', overflow:'hidden', border:'2px solid var(--mf-mod, var(--mf-accent-500))', flexShrink:0, background:'var(--mf-bg)' }}>
            <img
              src={proxyImg(profile.profile_pic_url)}
              alt={profile.username}
              style={{ width:'100%', height:'100%', objectFit:'cover' }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          </div>
          <div style={{ flex:1, minWidth:160 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <span style={{ fontWeight:800, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)' }}>@{profile.username}</span>
              {profile.is_verified && <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', background:'oklch(0.50 0.17 245 / 0.2)', color:'var(--mf-info-500)', border:'1px solid oklch(0.50 0.17 245 / 0.3)' }}>✓ verificado</span>}
            </div>
            {profile.full_name && <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', marginBottom:6 }}>{profile.full_name}</div>}
            <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
              {[['seguidores', profile.follower_count], ['seguindo', profile.following_count], ['posts', profile.media_count]].map(([lbl, val]) => (
                <span key={lbl} style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)' }}>
                  <strong style={{ color:'var(--mf-text)', fontVariantNumeric:'tabular-nums' }}>{fmtNum(val)}</strong> {lbl}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0, flexWrap:'wrap' }}>
            <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>{media.length} carregados</span>
            <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)', color: allSel ? 'var(--mf-danger-500)' : undefined }} onClick={toggleAll}>
              {allSel ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          </div>
        </motion.div>
      )}

      {/* Media grid */}
      {media.length > 0 && (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))', gap:6, marginBottom:14 }}>
            {media.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:i*.015, duration:.18 }}>
                <MediaTile item={item} sel={selected.has(item.id)} onToggle={() => toggleSel(item.id)} onDownload={e => downloadItem(item, e)} />
              </motion.div>
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign:'center', marginBottom:20 }}>
              <button className="btn-ghost" style={{ padding:'8px 24px', fontSize: 'var(--mf-t-sm)', borderRadius: 'var(--mf-r-md)' }} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}

      {!loading && profile && media.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 16px', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:12 }}>📭</div>
          <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Nenhuma mídia encontrada</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Este perfil não tem mídias públicas disponíveis.</div>
        </div>
      )}

      {!profile && !loading && (
        <div style={{ textAlign:'center', padding:'60px 16px', background:'color-mix(in oklch, var(--mf-surface-1) 40%, transparent)', border:'1px dashed var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:12 }}>⬇️</div>
          <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Baixe mídias de qualquer perfil</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Digite um username acima e clique em Buscar.</div>
        </div>
      )}

    </PageShell>
  );
}

function MediaTile({ item, sel, onToggle, onDownload }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onToggle} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position:'relative', aspectRatio:'1', borderRadius: 'var(--mf-r-md)', overflow:'hidden', cursor:'pointer', border:`2px solid ${sel ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent'}`, transition:'border-color .12s', background:'var(--mf-bg)' }}>
      {item.thumb && (
        <img src={`${API}/image-proxy?url=${encodeURIComponent(item.thumb)}`} alt="" loading="lazy"
          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
          onError={e => { e.target.style.display = 'none'; }} />
      )}
      {item.type !== 'image' && (
        <div style={{ position:'absolute', top:5, right:5, background:'oklch(0 0 0 / 0.72)', backdropFilter:'blur(4px)', borderRadius: 'var(--mf-r-xs)', padding:'2px 4px', fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text)' }}>
          {item.type === 'video' ? '▶ vídeo' : `⊕ ${item.count}`}
        </div>
      )}
      <div style={{ position:'absolute', inset:0, background: hover ? 'oklch(0 0 0 / 0.42)' : 'oklch(0 0 0 / 0)', display:'flex', alignItems:'flex-end', justifyContent:'flex-end', padding:6, transition:'background .12s' }}>
        {hover && (
          <button onClick={onDownload} title="Baixar"
            style={{ background:'var(--mf-surface-3)', border:'none', borderRadius: 'var(--mf-r-sm)', padding:'4px 8px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        )}
      </div>
      {sel && (
        <div style={{ position:'absolute', top:5, left:5, width:22, height:22, borderRadius: 'var(--mf-r-full)', background:'var(--mf-mod, var(--mf-accent-500))', display:'flex', alignItems:'center', justifyContent:'center', color:'#000', fontSize: 'var(--mf-t-micro)', fontWeight:900 }}>✓</div>
      )}
    </div>
  );
}

import { useState } from 'react';
import api from '../services/api';

const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
};

export default function ViralHunter() {
  const [items,       setItems]       = useState([]);
  const [query,       setQuery]       = useState('');
  const [period,      setPeriod]      = useState('7d');
  const [loading,     setLoading]     = useState(false);
  const [searched,    setSearched]    = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [done,        setDone]        = useState({});

  async function search(e) {
    e?.preventDefault();
    setLoading(true);
    setSearched(true);
    try {
      const r = await api.get('/viral/search', { params: { q: query, period, limit: 12 } });
      setItems(r.data.items || []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(item) {
    if (downloading || done[item.igMediaId]) return;
    setDownloading(item.igMediaId);
    try {
      const r = await api.post('/viral/download', {
        igMediaId: item.igMediaId,
        permalink: item.permalink,
      });
      setDone(d => ({ ...d, [item.igMediaId]: r.data.url }));
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao baixar. A URL do vídeo pode estar expirada.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Caçador de Virais</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Encontre e baixe os posts mais virais dos seus insights — qualidade original via API
        </p>
      </div>

      {/* Search */}
      <form onSubmit={search} className="card card-p" style={{ marginBottom: 18 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200, position:'relative' }}>
            <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14, pointerEvents:'none' }}>🔍</span>
            <input className="input" style={{ paddingLeft:36 }} placeholder="Nicho, @usuário ou palavra-chave na legenda..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="tabs" style={{ flexShrink:0 }}>
            {['7d','30d'].map(p => (
              <button key={p} type="button" className={`tab${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
          <button type="submit" className="btn btn-cyan" style={{ flexShrink:0 }} disabled={loading}>
            {loading ? '⏳ Buscando...' : '🔍 Buscar virais'}
          </button>
        </div>
      </form>

      {/* Results */}
      {!searched && (
        <div className="empty-state">
          <div className="empty-icon">🏹</div>
          <div className="empty-title">Pronto para caçar</div>
          <div className="empty-sub">Busque por nicho ou @usuário para encontrar os posts mais virais dos seus insights sincronizados.</div>
        </div>
      )}

      {searched && !loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">Nenhum resultado</div>
          <div className="empty-sub">Sem Reels virais para esse filtro. Tente um período maior ou sincronize mais insights.</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="g4" style={{ gap:12 }}>
          {items.map((v, idx) => {
            const isLoading = downloading === v.igMediaId;
            const isDone    = !!done[v.igMediaId];
            const thumb     = proxyImg(v.thumbnailUrl);
            const age       = v.postedAt ? Math.round((Date.now() - new Date(v.postedAt)) / 86400000) : null;

            return (
              <div key={v.igMediaId} className="card" style={{ overflow:'hidden' }}>
                {/* Thumb */}
                <div style={{ height:120, background:'linear-gradient(135deg,var(--bg3),var(--bg4))', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
                  {thumb
                    ? <img src={thumb} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none'; }} />
                    : <span style={{ fontSize:40 }}>🎬</span>
                  }
                  <div style={{ position:'absolute', top:8, right:8 }}>
                    <span className="badge badge-green" style={{ fontSize:9 }}>#{idx+1}</span>
                  </div>
                  {isDone && (
                    <div style={{ position:'absolute', inset:0, background:'rgba(16,185,129,.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <div style={{ width:40, height:40, borderRadius:'50%', background:'rgba(16,185,129,.9)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>✓</div>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding:'12px 14px' }}>
                  <div style={{ fontWeight:700, fontSize:13, marginBottom:2 }}>@{v.username}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10 }}>{age !== null ? `Postado há ${age}d` : ''}</div>

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px 8px', marginBottom:12, fontSize:12 }}>
                    <div><span style={{ color:'var(--text3)' }}>👁 </span><strong>{fmtK(v.videoViews)}</strong></div>
                    <div><span style={{ color:'var(--text3)' }}>❤️ </span><strong>{fmtK(v.likeCount)}</strong></div>
                    <div><span style={{ color:'var(--text3)' }}>🔖 </span><strong>{fmtK(v.savedCount)}</strong></div>
                    <div><span style={{ color:'var(--text3)' }}>↗ </span><strong>{fmtK(v.shareCount)}</strong></div>
                  </div>

                  <div style={{ display:'flex', gap:6 }}>
                    <button
                      className={`btn btn-sm ${isDone ? 'btn-ghost' : 'btn-primary'}`}
                      style={{ flex:1, justifyContent:'center' }}
                      onClick={() => handleDownload(v)}
                      disabled={isLoading || isDone}
                    >
                      {isLoading ? '⏳ Baixando...' : isDone ? '✓ Baixado' : '⬇ Baixar'}
                    </button>
                    {v.permalink && (
                      <a href={v.permalink} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Ver no Instagram">↗</a>
                    )}
                    {isDone && done[v.igMediaId] && (
                      <a href={`${API_BASE}${done[v.igMediaId]}`} download className="btn btn-ghost btn-sm" title="Baixar arquivo">💾</a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer info */}
      <div className="card card-p" style={{ marginTop:14, display:'flex', alignItems:'flex-start', gap:14 }}>
        <div style={{ fontSize:22, flexShrink:0 }}>🔒</div>
        <div>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:3 }}>Download via API — qualidade 100%</div>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
            Os vídeos são baixados direto da CDN do Instagram via API Graph, preservando resolução e qualidade originais.
            A busca usa os insights já sincronizados das suas contas.
          </div>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';

const PERIODS = ['7d','30d'];
const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const NICHE_COLORS = [
  'oklch(0.68 0.18 270)',
  'oklch(0.72 0.19 196)',
  'oklch(0.70 0.22 330)',
  'oklch(0.68 0.22 280)',
  'oklch(0.78 0.17 60)',
  'oklch(0.72 0.18 150)',
  'oklch(0.72 0.20 35)',
];

export default function TrendingAudio() {
  const [items,   setItems]   = useState([]);
  const [period,  setPeriod]  = useState('7d');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [copied,  setCopied]  = useState(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/analytics/trending-audio?period=${period}&limit=12`)
      .then(r => setItems(r.data.items || []))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [period]);

  function copy(id) { setCopied(id); setTimeout(() => setCopied(null), 1800); }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:3, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:3 }}>
      {PERIODS.map(p => (
        <button key={p} onClick={() => setPeriod(p)} style={{
          height:26, padding:'0 14px', borderRadius:7, fontSize:'.75rem', fontWeight:600,
          border:'none', cursor:'pointer', transition:'.15s',
          background: period === p ? 'oklch(0.70 0.22 330)' : 'transparent',
          color: period === p ? '#fff' : 'var(--text3)',
        }}>{p}</button>
      ))}
    </div>
  );

  const cardStyle = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <PageShell icon={pageIcon} title="Áudio Trending" subtitle="Reels com melhor desempenho do período — rankeados por visualizações" accent="pink" actions={pageActions}>

      {loading && (
        <div style={{ ...cardStyle, textAlign:'center', color:'var(--text3)', padding:40 }}>Carregando reels em alta...</div>
      )}

      {error && (
        <div style={{ ...cardStyle, color:'#f87171', textAlign:'center', padding:32 }}>{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 20px', background:'oklch(0.16 0.05 235 / 0.5)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🎵</div>
          <div style={{ fontWeight:700, fontSize:15, color:'var(--text)', marginBottom:6 }}>Sem Reels sincronizados</div>
          <div style={{ fontSize:13, color:'var(--text3)' }}>Sincronize os insights das contas para ver os melhores Reels.</div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:12 }}>
          {items.map((item, idx) => {
            const color = NICHE_COLORS[idx % NICHE_COLORS.length];
            const age = item.postedAt ? Math.round((Date.now() - new Date(item.postedAt)) / 86400000) : null;
            return (
              <motion.div
                key={item.igMediaId}
                initial={{ opacity:0, y:8 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay: idx * 0.03, duration:.2 }}
                style={{ ...cardStyle, position:'relative' }}
              >
                <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${color},transparent)` }} />

                <div style={{ padding:'16px 14px 14px' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:44, height:44, borderRadius:11, background:`${color}1a`, border:`1px solid ${color}38`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>🎬</div>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', lineHeight:1.3 }}>@{item.username}</div>
                        <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{age !== null ? `${age}d atrás` : ''}</div>
                      </div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:99, background: idx < 3 ? 'oklch(0.72 0.19 196 / 0.2)' : 'oklch(0.18 0.02 240 / 0.6)', color: idx < 3 ? 'var(--cyan)' : 'var(--text3)', border:`1px solid ${idx < 3 ? 'oklch(0.72 0.19 196 / 0.35)' : 'oklch(1 0 0 / 0.06)'}`, flexShrink:0, marginLeft:6 }}>#{idx + 1}</span>
                  </div>

                  {item.caption && (
                    <div style={{ fontSize:11, color:'var(--text2)', marginBottom:12, lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {item.caption}
                    </div>
                  )}

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
                    <div style={{ background:'oklch(0.12 0.04 235 / 0.6)', borderRadius:9, padding:'8px 10px', textAlign:'center' }}>
                      <div style={{ fontWeight:700, fontSize:15, color:'var(--text)', fontVariantNumeric:'tabular-nums' }}>{fmtK(item.videoViews)}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>Views</div>
                    </div>
                    <div style={{ background:'oklch(0.72 0.18 150 / 0.08)', border:'1px solid oklch(0.72 0.18 150 / 0.18)', borderRadius:9, padding:'8px 10px', textAlign:'center' }}>
                      <div style={{ fontWeight:700, fontSize:15, color:'var(--green)', fontVariantNumeric:'tabular-nums' }}>{fmtK(item.likeCount)}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>Likes</div>
                    </div>
                  </div>

                  <div style={{ display:'flex', gap:6 }}>
                    {item.permalink ? (
                      <a href={item.permalink} target="_blank" rel="noreferrer" className="btn-primary" style={{ flex:1, justifyContent:'center', display:'flex', alignItems:'center', fontSize:12, borderRadius:8, padding:'7px 0', textDecoration:'none' }}>🔗 Ver no Instagram</a>
                    ) : (
                      <button className="btn-ghost" style={{ flex:1, borderRadius:8, padding:'7px 0', fontSize:12, opacity:.5 }} disabled>Sem link</button>
                    )}
                    <button className="btn-ghost" style={{ borderRadius:8, padding:'7px 10px', fontSize:14 }} onClick={() => { if (item.permalink) { navigator.clipboard.writeText(item.permalink); copy(item.igMediaId); } }}>
                      {copied === item.igMediaId ? '✓' : '⎘'}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

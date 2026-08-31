import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

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
    <div style={{ display:'flex', gap:3, background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:3 }}>
      {PERIODS.map(p => (
        <button key={p} onClick={() => setPeriod(p)} style={{
          height:26, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight:600,
          border:'none', cursor:'pointer', transition:'.15s',
          background: period === p ? 'oklch(0.70 0.22 330)' : 'transparent',
          color: period === p ? 'var(--mf-text)' : 'var(--mf-text-3)',
        }}>{p}</button>
      ))}
    </div>
  );

  const cardStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <PageShell icon={pageIcon} title="Áudio Trending" subtitle="Reels com melhor desempenho do período — rankeados por visualizações" accent="pink" actions={pageActions}>

      {loading && (
        <EsqueletoLista itens={4} />
      )}

      {error && (
        <div style={{ ...cardStyle, color:'var(--mf-danger-500)', textAlign:'center', padding:32 }}>{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 16px', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:12 }}>🎵</div>
          <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Sem Reels sincronizados</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Sincronize os insights das contas para ver os melhores Reels.</div>
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

                <div style={{ padding:'16px 12px 12px' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:44, height:44, borderRadius: 'var(--mf-r-md)', background:`${color}1a`, border:`1px solid ${color}38`, display:'flex', alignItems:'center', justifyContent:'center', fontSize: 'var(--mf-t-h1)', flexShrink:0 }}>🎬</div>
                      <div>
                        <div style={{ fontWeight:700, fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)', lineHeight:1.3 }}>@{item.username}</div>
                        <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:2 }}>{age !== null ? `${age}d atrás` : ''}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:800, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', background: idx < 3 ? 'oklch(0.72 0.19 196 / 0.2)' : 'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)', color: idx < 3 ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)', border:`1px solid ${idx < 3 ? 'oklch(0.72 0.19 196 / 0.35)' : 'var(--mf-border)'}`, flexShrink:0, marginLeft:6 }}>#{idx + 1}</span>
                  </div>

                  {item.caption && (
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-2)', marginBottom:12, lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {item.caption}
                    </div>
                  )}

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
                    <div style={{ background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'8px 8px', textAlign:'center' }}>
                      <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', fontVariantNumeric:'tabular-nums' }}>{fmtK(item.videoViews)}</div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2 }}>Views</div>
                    </div>
                    <div style={{ background:'oklch(0.72 0.18 150 / 0.08)', border:'1px solid oklch(0.72 0.18 150 / 0.18)', borderRadius: 'var(--mf-r-md)', padding:'8px 8px', textAlign:'center' }}>
                      <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-success-500)', fontVariantNumeric:'tabular-nums' }}>{fmtK(item.likeCount)}</div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2 }}>Likes</div>
                    </div>
                  </div>

                  <div style={{ display:'flex', gap:6 }}>
                    {item.permalink ? (
                      <a href={item.permalink} target="_blank" rel="noreferrer" className="btn-primary" style={{ flex:1, justifyContent:'center', display:'flex', alignItems:'center', fontSize: 'var(--mf-t-xs)', borderRadius: 'var(--mf-r-sm)', padding:'8px 0', textDecoration:'none' }}>🔗 Ver no Instagram</a>
                    ) : (
                      <button className="btn-ghost" style={{ flex:1, borderRadius: 'var(--mf-r-sm)', padding:'8px 0', fontSize: 'var(--mf-t-xs)', opacity:.5 }} disabled>Sem link</button>
                    )}
                    <button className="btn-ghost" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 8px', fontSize: 'var(--mf-t-body)' }} onClick={() => { if (item.permalink) { navigator.clipboard.writeText(item.permalink); copy(item.igMediaId); } }}>
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

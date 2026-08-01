import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

const METRICS = [
  { key: 'views',           label: 'Visualizações' },
  { key: 'engagementScore', label: 'Engajamento'   },
  { key: 'likes',           label: 'Curtidas'      },
  { key: 'saves',           label: 'Salvamentos'   },
  { key: 'alcance',         label: 'Alcance'       },
  { key: 'shares',          label: 'Comp.'         },
];

const PERIODS = [
  { key: '7d',  label: '7 dias'  },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function metricVal(post, metric) {
  if (metric === 'views')   return post.videoViews;
  if (metric === 'alcance') return post.reach;
  if (metric === 'likes')   return post.likeCount;
  if (metric === 'saves')   return post.savedCount;
  if (metric === 'shares')  return post.shareCount;
  if (metric === 'coments') return post.commentsCount;
  return post.engagementScore;
}

export default function Ranking() {
  const [metric, setMetric]   = useState('views');
  const [period, setPeriod]   = useState('30d');
  const [posts, setPosts]     = useState([]);
  const [totals, setTotals]   = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);

  function showToast(type, title, message) {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => { load(); }, [metric, period]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/insights?metric=${metric}&period=${period}&limit=30`);
      setPosts(data.insights || []);
      setTotals(data.totals || {});
    } catch {
      showToast('error', 'Erro', 'Não foi possível carregar o ranking.');
    } finally {
      setLoading(false);
    }
  }

  const maxVal = posts.length ? metricVal(posts[0], metric) || 1 : 1;
  const metricLabel = METRICS.find(m => m.key === metric)?.label || '';

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      {/* Period pills */}
      <div style={{ display:'flex', gap:3, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:3 }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            height:26, padding:'0 10px', borderRadius:7, fontSize:'.75rem', fontWeight:600,
            border:'none', cursor:'pointer', transition:'.15s',
            background: period === p.key ? 'var(--cyan)' : 'transparent',
            color: period === p.key ? '#040e1c' : 'var(--text3)',
          }}>{p.label}</button>
        ))}
      </div>
    </div>
  );

  const cardStyle = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell
        icon={pageIcon}
        title="Ranking de Posts"
        subtitle="Os posts mais performáticos do período selecionado"
        accent="purple"
        actions={pageActions}
      >
        {/* Metric filter */}
        <div style={{ ...cardStyle, marginBottom:14, padding:'10px 14px' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)', marginRight:4 }}>Métrica:</span>
            {METRICS.map(m => (
              <button key={m.key} onClick={() => setMetric(m.key)} style={{
                height:28, padding:'0 12px', borderRadius:7, fontSize:'.75rem', fontWeight:600,
                border:'none', cursor:'pointer', transition:'.15s',
                background: metric === m.key ? 'rgba(139,92,246,.15)' : 'transparent',
                color: metric === m.key ? '#a78bfa' : 'var(--text3)',
                outline: metric === m.key ? '1px solid rgba(139,92,246,.35)' : '1px solid transparent',
              }}>{m.label}</button>
            ))}
          </div>
        </div>

        {/* Ranking list */}
        <div style={cardStyle}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
            <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Top Posts — {metricLabel}</h3>
            <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)', background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:100, padding:'2px 8px' }}>{posts.length} posts</span>
          </div>

          {loading ? (
            <div style={{ textAlign:'center', padding:48, color:'var(--text3)' }}>Carregando ranking...</div>
          ) : posts.length === 0 ? (
            <div style={{ textAlign:'center', padding:48 }}>
              <div style={{ fontSize:32, marginBottom:10 }}>📊</div>
              <p style={{ color:'var(--text3)', fontSize:13 }}>Nenhum post encontrado para este período.</p>
              <p style={{ color:'var(--text3)', fontSize:11, marginTop:4 }}>
                Sincronize seus insights em <a href="/top-posts" style={{ color:'var(--cyan)' }}>Top Posts</a> primeiro.
              </p>
            </div>
          ) : posts.map((post, i) => {
            const val = metricVal(post, metric);
            const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
            const isTop = i < 3;
            return (
              <motion.div
                key={post._id}
                initial={{ opacity:0, y:6 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay: i * 0.025, duration: 0.2 }}
                style={{
                  display:'grid', gridTemplateColumns:'48px 60px 1fr 80px',
                  alignItems:'center', gap:12, padding:'10px 16px',
                  borderBottom: i < posts.length - 1 ? '1px solid oklch(1 0 0 / 0.06)' : 'none',
                  transition:'background .12s', cursor:'default',
                }}
                whileHover={{ backgroundColor:'rgba(0,212,255,.03)' }}
              >
                {/* Rank */}
                <div style={{ textAlign:'center' }}>
                  {isTop
                    ? <span style={{ fontSize:22 }}>{MEDALS[i]}</span>
                    : <span style={{ fontSize:13, fontWeight:800, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>#{i + 1}</span>
                  }
                </div>

                {/* Thumbnail */}
                <div style={{ width:52, height:52, borderRadius:7, overflow:'hidden', background:'oklch(0.10 0.03 235 / 0.5)', flexShrink:0 }}>
                  {post.thumbnail
                    ? <img src={post.thumbnail} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                    : <div style={{ width:'100%', height:'100%', display:'grid', placeItems:'center', fontSize:20 }}>
                        {post.mediaType === 'VIDEO' ? '🎬' : '🖼️'}
                      </div>
                  }
                </div>

                {/* Info + bar */}
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--text)', marginBottom:5 }}>
                    @{post.username || post.accountId}
                    <span style={{ marginLeft:8, fontSize:9, fontWeight:600, padding:'1px 6px', borderRadius:99, background:'oklch(0.10 0.03 235 / 0.6)', color:'var(--text3)' }}>
                      {post.mediaType === 'VIDEO' ? 'Reel' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Foto'}
                    </span>
                  </div>
                  <div style={{ height:4, borderRadius:99, background:'oklch(0.10 0.03 235 / 0.6)', overflow:'hidden', marginBottom:4 }}>
                    <motion.div
                      initial={{ width:0 }}
                      animate={{ width:`${pct}%` }}
                      transition={{ duration:.5, delay:.1 + i * 0.02 }}
                      style={{ height:'100%', borderRadius:99, background: isTop ? 'linear-gradient(90deg, #a78bfa, var(--cyan))' : 'rgba(139,92,246,.4)' }}
                    />
                  </div>
                  <div style={{ fontSize:10, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {post.caption ? String(post.caption).slice(0, 55) + (post.caption.length > 55 ? '…' : '') : '(sem legenda)'}
                  </div>
                </div>

                {/* Value */}
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:18, fontWeight:800, color: isTop ? 'var(--cyan)' : 'var(--text)', fontVariantNumeric:'tabular-nums' }}>
                    {fmtNum(val)}
                  </div>
                  <div style={{ fontSize:9, color:'var(--text3)', marginTop:1, fontFamily:'var(--font-mono)' }}>{metricLabel}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </PageShell>
    </>
  );
}

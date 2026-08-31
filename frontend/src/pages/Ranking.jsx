import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

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
      <div style={{ display:'flex', gap:3, background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:3 }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            height:26, padding:'0 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight:600,
            border:'none', cursor:'pointer', transition:'.15s',
            background: period === p.key ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent',
            color: period === p.key ? 'var(--mf-bg)' : 'var(--mf-text-3)',
          }}>{p.label}</button>
        ))}
      </div>
    </div>
  );

  const cardStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };

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
        <div style={{ ...cardStyle, marginBottom:14, padding:'8px 12px' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', marginRight:4 }}>Métrica:</span>
            {METRICS.map(m => (
              <button key={m.key} onClick={() => setMetric(m.key)} style={{
                height:28, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight:600,
                border:'none', cursor:'pointer', transition:'.15s',
                background: metric === m.key ? 'color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)' : 'transparent',
                color: metric === m.key ? 'var(--mf-mod-publicar)' : 'var(--mf-text-3)',
                outline: metric === m.key ? '1px solid color-mix(in oklch, var(--mf-mod-publicar) 35%, transparent)' : '1px solid transparent',
              }}>{m.label}</button>
            ))}
          </div>
        </div>

        {/* Ranking list */}
        <div style={cardStyle}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Top Posts — {metricLabel}</h3>
            <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-full)', padding:'2px 8px' }}>{posts.length} posts</span>
          </div>

          {loading ? (
            <EsqueletoLista itens={5} />
          ) : posts.length === 0 ? (
            <div style={{ textAlign:'center', padding:48 }}>
              <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:10 }}>📊</div>
              <p style={{ color:'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>Nenhum post encontrado para este período.</p>
              <p style={{ color:'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', marginTop:4 }}>
                Sincronize seus insights em <a href="/top-posts" style={{ color:'var(--mf-mod, var(--mf-accent-500))' }}>Top Posts</a> primeiro.
              </p>
            </div>
          ) : posts.map((post, i) => {
            const val = metricVal(post, metric);
            const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
            const isTop = i < 3;
            return (
              <motion.div
                key={post._id}
                className="ranking-row"
                initial={{ opacity:0, y:6 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay: i * 0.025, duration: 0.2 }}
                style={{
                  borderBottom: i < posts.length - 1 ? '1px solid var(--mf-border)' : 'none',
                  transition:'background .12s', cursor:'default',
                }}
                whileHover={{ backgroundColor:'color-mix(in oklch, var(--mf-mod-contas) 3%, transparent)' }}
              >
                {/* Rank */}
                <div style={{ textAlign:'center' }}>
                  {isTop
                    ? <span style={{ fontSize: 'var(--mf-t-h1)' }}>{MEDALS[i]}</span>
                    : <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight:800, color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>#{i + 1}</span>
                  }
                </div>

                {/* Thumbnail */}
                <div style={{ width:52, height:52, borderRadius: 'var(--mf-r-sm)', overflow:'hidden', background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)', flexShrink:0 }}>
                  {post.thumbnail
                    ? <img src={post.thumbnail} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                    : <div style={{ width:'100%', height:'100%', display:'grid', placeItems:'center', fontSize: 'var(--mf-t-h1)' }}>
                        {post.mediaType === 'VIDEO' ? '🎬' : '🖼️'}
                      </div>
                  }
                </div>

                {/* Info + bar */}
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text)', marginBottom:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    @{post.username || post.accountId}
                    <span style={{ marginLeft:8, fontSize: 'var(--mf-t-nano)', fontWeight:600, padding:'2px 4px', borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', color:'var(--mf-text-3)' }}>
                      {post.mediaType === 'VIDEO' ? 'Reel' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Foto'}
                    </span>
                  </div>
                  <div style={{ height:4, borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', overflow:'hidden', marginBottom:4 }}>
                    <motion.div
                      initial={{ width:0 }}
                      animate={{ width:`${pct}%` }}
                      transition={{ duration:.5, delay:.1 + i * 0.02 }}
                      style={{ height:'100%', borderRadius: 'var(--mf-r-full)', background: isTop ? 'linear-gradient(90deg, var(--mf-mod-publicar), var(--mf-mod, var(--mf-accent-500)))' : 'color-mix(in oklch, var(--mf-mod-publicar) 40%, transparent)' }}
                    />
                  </div>
                  <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {post.caption ? String(post.caption).slice(0, 55) + (post.caption.length > 55 ? '…' : '') : '(sem legenda)'}
                  </div>
                </div>

                {/* Value */}
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight:800, color: isTop ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text)', fontVariantNumeric:'tabular-nums' }}>
                    {fmtNum(val)}
                  </div>
                  <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:1, fontFamily:'var(--mf-mono)' }}>{metricLabel}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </PageShell>
    </>
  );
}

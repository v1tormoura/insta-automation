import { useState, useEffect } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

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

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Visão Geral</div>
          <h1>Ranking de Posts</h1>
          <p>Os posts mais performáticos do período selecionado.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="card" style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{
              height: 30, padding: '0 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              border: '1px solid', cursor: 'pointer', transition: '.15s',
              background: period === p.key ? 'var(--cyan)' : 'transparent',
              color: period === p.key ? '#040e1c' : 'var(--text2)',
              borderColor: period === p.key ? 'var(--cyan)' : 'var(--border)',
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setMetric(m.key)} style={{
              height: 30, padding: '0 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              border: '1px solid', cursor: 'pointer', transition: '.15s',
              background: metric === m.key ? 'rgba(0,212,255,.1)' : 'transparent',
              color: metric === m.key ? 'var(--cyan)' : 'var(--text3)',
              borderColor: metric === m.key ? 'rgba(0,212,255,.4)' : 'var(--border)',
            }}>{m.label}</button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="card">
        <div className="card-header">
          <span>Top Posts — {metricLabel}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{posts.length} posts</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text3)' }}>Carregando ranking...</div>
          ) : posts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>Nenhum post encontrado para este período.</p>
              <p style={{ color: 'var(--text3)', fontSize: 11, marginTop: 4 }}>
                Sincronize seus insights em <a href="/top-posts" style={{ color: 'var(--cyan)' }}>Top Posts</a> primeiro.
              </p>
            </div>
          ) : posts.map((post, i) => {
            const val = metricVal(post, metric);
            const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
            const isTop = i < 3;
            return (
              <div key={post._id} style={{
                display: 'grid',
                gridTemplateColumns: '48px 60px 1fr 80px',
                alignItems: 'center',
                gap: 12,
                padding: '10px 18px',
                borderBottom: i < posts.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background .12s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,255,.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Posição */}
                <div style={{ textAlign: 'center' }}>
                  {isTop
                    ? <span style={{ fontSize: 22 }}>{MEDALS[i]}</span>
                    : <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text3)' }}>#{i + 1}</span>
                  }
                </div>

                {/* Thumbnail */}
                <div style={{ width: 52, height: 52, borderRadius: 7, overflow: 'hidden', background: 'var(--bg3)', flexShrink: 0 }}>
                  {post.thumbnail
                    ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 20 }}>
                        {post.mediaType === 'VIDEO' ? '🎬' : '🖼️'}
                      </div>
                  }
                </div>

                {/* Info + barra */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                    @{post.username || post.accountId}
                    <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text3)' }}>
                      {post.mediaType === 'VIDEO' ? 'Reel' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Foto'}
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 99, background: 'var(--bg3)', overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{
                      height: '100%', borderRadius: 99, transition: 'width .5s',
                      background: isTop ? 'linear-gradient(90deg, var(--cyan), #00b8d9)' : 'rgba(0,212,255,.35)',
                      width: `${pct}%`,
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.caption ? String(post.caption).slice(0, 55) + (post.caption.length > 55 ? '…' : '') : '(sem legenda)'}
                  </div>
                </div>

                {/* Valor */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: isTop ? 'var(--cyan)' : 'var(--text)' }}>
                    {fmtNum(val)}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>{metricLabel}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

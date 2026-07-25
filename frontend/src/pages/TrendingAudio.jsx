import { useEffect, useState } from 'react';
import api from '../services/api';

const PERIODS = ['7d','30d'];
const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const NICHE_COLORS = ['var(--indigo)','var(--cyan)','var(--pink)','var(--purple)','var(--amber)','var(--green)','var(--orange)'];

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

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Áudio Trending</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Reels com melhor desempenho do período — rankeados por visualizações
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div className="tabs">
          {PERIODS.map(p => (
            <button key={p} className={`tab${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center', marginLeft: 4 }}>
          Dados reais dos seus insights sincronizados
        </span>
      </div>

      {loading && (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text2)', padding: 40 }}>
          Carregando reels em alta...
        </div>
      )}

      {error && (
        <div className="card card-p" style={{ color: 'var(--red)', textAlign: 'center', padding: 32 }}>
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🎵</div>
          <div className="empty-title">Sem Reels sincronizados</div>
          <div className="empty-sub">Sincronize os insights das contas para ver os melhores Reels.</div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="g3">
          {items.map((item, idx) => {
            const color = NICHE_COLORS[idx % NICHE_COLORS.length];
            const age = item.postedAt ? Math.round((Date.now() - new Date(item.postedAt)) / 86400000) : null;
            return (
              <div key={item.igMediaId} className="card card-p" style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${color},transparent)`, borderRadius: 'var(--radius) var(--radius) 0 0' }} />

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 11, background: `color-mix(in srgb,${color} 18%,transparent)`, border: `1px solid color-mix(in srgb,${color} 35%,transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎬</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>@{item.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{age !== null ? `${age}d atrás` : ''}</div>
                    </div>
                  </div>
                  <span className={`badge ${idx < 3 ? 'badge-blue' : 'badge-gray'}`} style={{ flexShrink: 0, marginLeft: 6 }}>#{idx + 1}</span>
                </div>

                {item.caption && (
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {item.caption}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 9, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{fmtK(item.videoViews)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Views</div>
                  </div>
                  <div style={{ background: 'rgba(16,185,129,.07)', border: '1px solid rgba(16,185,129,.18)', borderRadius: 9, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--green)' }}>{fmtK(item.likeCount)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Likes</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {item.permalink ? (
                    <a href={item.permalink} target="_blank" rel="noreferrer" className="btn btn-cyan btn-sm" style={{ flex: 1, justifyContent: 'center' }}>🔗 Ver no Instagram</a>
                  ) : (
                    <button className="btn btn-cyan btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled>Sem link</button>
                  )}
                  <button className="btn btn-ghost btn-sm" title="Copiar link" onClick={() => { if (item.permalink) { navigator.clipboard.writeText(item.permalink); copy(item.igMediaId); } }}>
                    {copied === item.igMediaId ? '✓' : '⎘'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

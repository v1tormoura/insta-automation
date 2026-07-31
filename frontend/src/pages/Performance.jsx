import { useState, useEffect } from 'react';
import api from '../services/api';

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function Performance() {
  const [period, setPeriod]   = useState('30d');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [period]);

  async function load() {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/insights?period=${period}&limit=200`);
      const insights = d.insights || [];

      // Agrupar por conta
      const byAccount = {};
      insights.forEach(p => {
        const key = p.username || String(p.accountId);
        if (!byAccount[key]) byAccount[key] = { username: key, views: 0, likes: 0, saves: 0, posts: 0 };
        byAccount[key].views += p.videoViews || 0;
        byAccount[key].likes += p.likeCount  || 0;
        byAccount[key].saves += p.savedCount || 0;
        byAccount[key].posts++;
      });

      // Agrupar por tipo
      const byType = { VIDEO: 0, IMAGE: 0, CAROUSEL_ALBUM: 0 };
      insights.forEach(p => { if (p.mediaType in byType) byType[p.mediaType]++; });

      const avgEng = insights.length
        ? (insights.reduce((s, p) => s + (p.engagementScore || 0), 0) / insights.length).toFixed(1)
        : 0;

      setData({
        totals: d.totals || {},
        total: d.total || 0,
        byAccount: Object.values(byAccount).sort((a, b) => b.views - a.views).slice(0, 6),
        byType,
        avgEng,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const t = data?.totals || {};
  const totalTyped = data ? Object.values(data.byType).reduce((a, b) => a + b, 0) : 0;

  const kpis = [
    { label: 'Visualizações', val: fmtNum(t.views),   color: 'var(--cyan)', icon: '👁️'  },
    { label: 'Curtidas',      val: fmtNum(t.likes),   color: '#f43f5e',     icon: '❤️'  },
    { label: 'Salvamentos',   val: fmtNum(t.saves),   color: '#fbbf24',     icon: '🔖'  },
    { label: 'Alcance',       val: fmtNum(t.alcance), color: '#22c55e',     icon: '📡'  },
    { label: 'Comentários',   val: fmtNum(t.coments), color: '#a78bfa',     icon: '💬'  },
    { label: 'Total Posts',   val: data?.total || 0,  color: 'var(--cyan)', icon: '📹'  },
  ];

  const types = [
    { key: 'VIDEO',          label: 'Reels',     color: 'var(--cyan)', icon: '🎬' },
    { key: 'IMAGE',          label: 'Fotos',     color: '#a78bfa',     icon: '🖼️' },
    { key: 'CAROUSEL_ALBUM', label: 'Carrossel', color: '#fbbf24',     icon: '🗂️' },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Conteúdo</div>
          <h1>Performance</h1>
          <p>Visão consolidada dos insights de todos os seus posts.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['7d','7 dias'],['30d','30 dias'],['90d','90 dias']].map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)} style={{
              height: 34, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: '1px solid', cursor: 'pointer', transition: '.15s',
              background: period === k ? 'var(--cyan)' : 'transparent',
              color: period === k ? '#040e1c' : 'var(--text2)',
              borderColor: period === k ? 'var(--cyan)' : 'var(--border)',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>Carregando insights...</div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>Erro ao carregar dados.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="g4" style={{ marginBottom: 14 }}>
            {kpis.map(k => (
              <div key={k.label} className="stat-card">
                <div className="stat-icon">{k.icon}</div>
                <div>
                  <div className="stat-value" style={{ color: k.color }}>{k.val}</div>
                  <div className="stat-label">{k.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="layout-2col">
            {/* Top contas */}
            <div className="card">
              <div className="card-header">
                <span>Top Contas</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>por visualizações</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {data.byAccount.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>Sem dados.</div>
                ) : data.byAccount.map((acc, i) => (
                  <div key={acc.username} style={{
                    display: 'grid', gridTemplateColumns: '36px 1fr auto',
                    alignItems: 'center', gap: 12,
                    padding: '11px 18px',
                    borderBottom: i < data.byAccount.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
                      fontSize: 11, fontWeight: 800,
                      background: i === 0 ? 'rgba(0,212,255,.12)' : 'var(--bg3)',
                      color: i === 0 ? 'var(--cyan)' : 'var(--text3)',
                    }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>@{acc.username}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{acc.posts} posts · {fmtNum(acc.likes)} curtidas</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--cyan)' }}>{fmtNum(acc.views)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tipo de conteúdo */}
            <div className="card">
              <div className="card-header">
                <span>Tipo de Conteúdo</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{totalTyped} posts analisados</span>
              </div>
              <div className="card-body">
                {types.map(tp => {
                  const count = data.byType[tp.key] || 0;
                  const pct = totalTyped > 0 ? ((count / totalTyped) * 100).toFixed(0) : 0;
                  return (
                    <div key={tp.key} style={{ marginBottom: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{tp.icon} {tp.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{count} ({pct}%)</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 99, background: 'var(--bg3)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 99, background: tp.color, width: `${pct}%`, transition: 'width .5s' }} />
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop: 24, padding: '14px', borderRadius: 10, background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Engajamento médio</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--cyan)' }}>{data.avgEng}</div>
                  </div>
                  <div style={{ fontSize: 28 }}>📈</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

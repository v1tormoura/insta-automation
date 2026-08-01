import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';

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

      const byAccount = {};
      insights.forEach(p => {
        const key = p.username || String(p.accountId);
        if (!byAccount[key]) byAccount[key] = { username: key, views: 0, likes: 0, saves: 0, posts: 0 };
        byAccount[key].views += p.videoViews || 0;
        byAccount[key].likes += p.likeCount  || 0;
        byAccount[key].saves += p.savedCount || 0;
        byAccount[key].posts++;
      });

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
    { label: 'Visualizações', val: fmtNum(t.views),   color: 'var(--cyan)', border: 'rgba(0,212,255,.2)',   bg: 'rgba(0,212,255,.08)'   },
    { label: 'Curtidas',      val: fmtNum(t.likes),   color: '#f43f5e',     border: 'rgba(244,63,94,.2)',    bg: 'rgba(244,63,94,.08)'   },
    { label: 'Salvamentos',   val: fmtNum(t.saves),   color: '#fbbf24',     border: 'rgba(251,191,36,.2)',   bg: 'rgba(251,191,36,.08)'  },
    { label: 'Alcance',       val: fmtNum(t.alcance), color: '#22c55e',     border: 'rgba(34,197,94,.2)',    bg: 'rgba(34,197,94,.08)'   },
    { label: 'Comentários',   val: fmtNum(t.coments), color: '#a78bfa',     border: 'rgba(167,139,250,.2)',  bg: 'rgba(167,139,250,.08)' },
    { label: 'Total Posts',   val: data?.total || 0,  color: 'var(--cyan)', border: 'rgba(0,212,255,.2)',   bg: 'rgba(0,212,255,.08)'   },
  ];

  const types = [
    { key: 'VIDEO',          label: 'Reels',     color: 'var(--cyan)', icon: '🎬' },
    { key: 'IMAGE',          label: 'Fotos',     color: '#a78bfa',     icon: '🖼️' },
    { key: 'CAROUSEL_ALBUM', label: 'Carrossel', color: '#fbbf24',     icon: '🗂️' },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:3, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:3 }}>
      {[['7d','7 dias'],['30d','30 dias'],['90d','90 dias']].map(([k, l]) => (
        <button key={k} onClick={() => setPeriod(k)} style={{
          height: 28, padding: '0 12px', borderRadius: 7, fontSize: '.78rem', fontWeight: 600,
          border: 'none', cursor: 'pointer', transition: '.15s',
          background: period === k ? 'var(--cyan)' : 'transparent',
          color: period === k ? '#040e1c' : 'var(--text3)',
        }}>{l}</button>
      ))}
    </div>
  );

  const cardStyle = { background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 14, overflow: 'hidden', backdropFilter: 'blur(12px)' };

  return (
    <PageShell
      icon={pageIcon}
      title="Performance"
      subtitle="Visão consolidada dos insights de todos os seus posts"
      accent="cyan"
      actions={pageActions}
    >
      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--text3)' }}>Carregando insights...</div>
      ) : !data ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--text3)' }}>Erro ao carregar dados.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="g4" style={{ marginBottom: 14 }}>
            {kpis.map((k, i) => (
              <motion.div
                key={k.label}
                initial={{ opacity:0, y:10 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay: i * 0.04, duration: 0.22 }}
                style={{ padding:'16px 18px', borderRadius:14, background:k.bg, border:`1px solid ${k.border}`, backdropFilter:'blur(12px)', display:'flex', flexDirection:'column', gap:6 }}
              >
                <div style={{ fontSize:24, fontWeight:800, color:k.color, letterSpacing:-1, fontVariantNumeric:'tabular-nums' }}>{k.val}</div>
                <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.06em' }}>{k.label}</div>
              </motion.div>
            ))}
          </div>

          <div className="layout-2col">
            {/* Top contas */}
            <motion.div initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.25 }} style={cardStyle}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
                <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Top Contas</h3>
                <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>por visualizações</span>
              </div>
              <div>
                {data.byAccount.length === 0 ? (
                  <div style={{ padding:24, textAlign:'center', fontSize:12, color:'var(--text3)' }}>Sem dados.</div>
                ) : data.byAccount.map((acc, i) => (
                  <div key={acc.username} style={{
                    display:'grid', gridTemplateColumns:'36px 1fr auto',
                    alignItems:'center', gap:12, padding:'11px 16px',
                    borderBottom: i < data.byAccount.length - 1 ? '1px solid oklch(1 0 0 / 0.06)' : 'none',
                  }}>
                    <div style={{
                      width:30, height:30, borderRadius:'50%', display:'grid', placeItems:'center',
                      fontSize:11, fontWeight:800, fontFamily:'var(--font-mono)',
                      background: i === 0 ? 'rgba(0,212,255,.12)' : 'oklch(0.10 0.03 235 / 0.5)',
                      color: i === 0 ? 'var(--cyan)' : 'var(--text3)',
                    }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>@{acc.username}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{acc.posts} posts · {fmtNum(acc.likes)} curtidas</div>
                    </div>
                    <div style={{ fontSize:14, fontWeight:800, color:'var(--cyan)', fontFamily:'var(--font-mono)' }}>{fmtNum(acc.views)}</div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Tipo de conteúdo */}
            <motion.div initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.25 }} style={cardStyle}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
                <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Tipo de Conteúdo</h3>
                <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>{totalTyped} posts</span>
              </div>
              <div style={{ padding:'16px 18px' }}>
                {types.map(tp => {
                  const count = data.byType[tp.key] || 0;
                  const pct = totalTyped > 0 ? ((count / totalTyped) * 100).toFixed(0) : 0;
                  return (
                    <div key={tp.key} style={{ marginBottom:18 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                        <span style={{ fontSize:12, color:'var(--text2)' }}>{tp.icon} {tp.label}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:'var(--text)', fontFamily:'var(--font-mono)' }}>{count} ({pct}%)</span>
                      </div>
                      <div style={{ height:6, borderRadius:99, background:'oklch(0.10 0.03 235 / 0.6)', overflow:'hidden' }}>
                        <motion.div
                          initial={{ width:0 }}
                          animate={{ width:`${pct}%` }}
                          transition={{ duration:.5, delay:.15 }}
                          style={{ height:'100%', borderRadius:99, background:tp.color }}
                        />
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop:20, padding:'14px 16px', borderRadius:10, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>Engajamento médio</div>
                    <div style={{ fontSize:22, fontWeight:900, color:'var(--cyan)', fontVariantNumeric:'tabular-nums' }}>{data.avgEng}</div>
                  </div>
                  <div style={{ width:42, height:42, borderRadius:12, background:'rgba(0,212,255,.08)', display:'grid', placeItems:'center', fontSize:20 }}>📈</div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </PageShell>
  );
}

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageShell from '../components/PageShell';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function engRate(views, likes, saves) {
  if (!views) return null;
  return ((likes + saves) / views * 100).toFixed(1);
}

const avatarSrc = av => av
  ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`)
  : null;

export default function Performance() {
  const [period,  setPeriod]  = useState('30d');
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg,  setErrMsg]  = useState('');
  const navigate = useNavigate();
  const accCacheRef = useRef({});

  useEffect(() => { load(); }, [period]);

  async function load() {
    setLoading(true);
    try {
      // Fetch insights + accounts cache (accounts fetched once)
      const requests = [api.get(`/insights?period=${period}&limit=200`)];
      const needAccounts = Object.keys(accCacheRef.current).length === 0;
      if (needAccounts) requests.push(api.get('/accounts'));

      const results = await Promise.all(requests);
      const d = results[0].data;

      if (needAccounts) {
        const aMap = {};
        const accs = results[1].data?.accounts || (Array.isArray(results[1].data) ? results[1].data : []);
        accs.forEach(a => { aMap[a.username] = a; });
        accCacheRef.current = aMap;
      }
      const aMap = accCacheRef.current;

      const insights = d.insights || [];

      const BAD = ['banida','banido','restrita','token_invalido','sessao_expirada','desconectada'];
      const byAccount = {};
      insights.forEach(p => {
        const key = p.username || String(p.accountId);
        const acct = aMap[key];
        if (acct && BAD.includes(acct.healthStatus)) return; // skip contas fora de serviço
        if (!byAccount[key]) byAccount[key] = {
          username: key,
          views: 0, likes: 0, saves: 0, posts: 0,
          avatar: acct?.avatar || null,
          _id: acct?._id || null,
        };
        byAccount[key].views += p.videoViews  || 0;
        byAccount[key].likes += p.likeCount   || 0;
        byAccount[key].saves += p.savedCount  || 0;
        byAccount[key].posts++;
      });

      const byType = { VIDEO: 0, IMAGE: 0, CAROUSEL_ALBUM: 0 };
      insights.forEach(p => { if (p.mediaType in byType) byType[p.mediaType]++; });

      const avgEng = insights.length
        ? (insights.reduce((s, p) => s + (p.engagementScore || 0), 0) / insights.length).toFixed(1)
        : 0;

      setData({
        totals:    d.totals || {},
        total:     d.total  || 0,
        byAccount: Object.values(byAccount).sort((a, b) => b.views - a.views).slice(0, 8),
        byType,
        avgEng,
      });
    } catch (e) {
      console.error(e);
      setErrMsg(e?.response?.data?.error || e?.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  const t = data?.totals || {};
  const totalTyped = data ? Object.values(data.byType).reduce((a, b) => a + b, 0) : 0;

  const kpis = [
    { label:'Visualizações', val:fmtNum(t.views),    color:'var(--cyan)', border:'rgba(0,212,255,.2)',  bg:'rgba(0,212,255,.07)',   icon:'👁' },
    { label:'Curtidas',      val:fmtNum(t.likes),    color:'#f43f5e',     border:'rgba(244,63,94,.2)',  bg:'rgba(244,63,94,.07)',   icon:'❤️' },
    { label:'Salvamentos',   val:fmtNum(t.saves),    color:'#fbbf24',     border:'rgba(251,191,36,.2)', bg:'rgba(251,191,36,.07)',  icon:'🔖' },
    { label:'Alcance',       val:fmtNum(t.alcance),  color:'#22c55e',     border:'rgba(34,197,94,.2)',  bg:'rgba(34,197,94,.07)',   icon:'📡' },
    { label:'Comentários',   val:fmtNum(t.comments), color:'#a78bfa',     border:'rgba(167,139,250,.2)',bg:'rgba(167,139,250,.07)', icon:'💬' },
    { label:'Total Posts',   val:data?.total || 0,   color:'var(--cyan)', border:'rgba(0,212,255,.2)',  bg:'rgba(0,212,255,.07)',   icon:'📄' },
  ];

  const types = [
    { key:'VIDEO',          label:'Reels',     color:'var(--cyan)', icon:'🎬' },
    { key:'IMAGE',          label:'Fotos',     color:'#a78bfa',     icon:'🖼️' },
    { key:'CAROUSEL_ALBUM', label:'Carrossel', color:'#fbbf24',     icon:'🗂️' },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:3, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:3 }}>
      {[['7d','7 dias'],['30d','30 dias'],['90d','90 dias']].map(([k,l]) => (
        <button key={k} onClick={() => setPeriod(k)} style={{
          height:28, padding:'0 12px', borderRadius:7, fontSize:'.78rem', fontWeight:600,
          border:'none', cursor:'pointer', transition:'.15s',
          background: period === k ? 'var(--cyan)' : 'transparent',
          color:      period === k ? '#040e1c'     : 'var(--text3)',
        }}>{l}</button>
      ))}
    </div>
  );

  const cardStyle = {
    background:'oklch(0.16 0.05 235 / 0.85)',
    border:'1px solid oklch(1 0 0 / 0.07)',
    borderRadius:14, overflow:'hidden',
    backdropFilter:'blur(12px)',
  };

  return (
    <PageShell
      icon={pageIcon}
      title="Performance"
      subtitle="Visão consolidada dos insights de todos os seus posts e contas"
      accent="cyan"
      actions={pageActions}
    >
      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--text3)' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ animation:'spin 1s linear infinite', display:'block', margin:'0 auto 12px' }}>
            <path d="M21 12a9 9 0 11-6.219-8.56"/>
          </svg>
          Carregando insights...
        </div>
      ) : !data ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--text3)' }}>
          <div style={{ fontSize:28, marginBottom:10 }}>⚠️</div>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>Erro ao carregar dados</div>
          {errMsg && <div style={{ fontSize:11, color:'#f87171', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.18)', borderRadius:8, padding:'8px 14px', marginBottom:14, maxWidth:420, margin:'0 auto 14px', wordBreak:'break-word' }}>{errMsg}</div>}
          <button onClick={load} style={{ padding:'8px 20px', borderRadius:9, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', cursor:'pointer', fontSize:13, fontWeight:600 }}>↺ Tentar novamente</button>
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="g4" style={{ marginBottom:16 }}>
            {kpis.map((k, i) => (
              <motion.div
                key={k.label}
                initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}
                transition={{ delay:i*.04, duration:.22 }}
                style={{ padding:'16px 18px', borderRadius:14, background:k.bg, border:`1px solid ${k.border}`, backdropFilter:'blur(12px)', display:'flex', flexDirection:'column', gap:5 }}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ fontSize:24, fontWeight:800, color:k.color, letterSpacing:-1, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{k.val}</div>
                  <span style={{ fontSize:16 }}>{k.icon}</span>
                </div>
                <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.06em' }}>{k.label}</div>
              </motion.div>
            ))}
          </div>

          <div className="layout-2col">
            {/* ── Top Contas ── */}
            <motion.div initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.25 }} style={cardStyle}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
                <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Top Contas</h3>
                <span style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>por visualizações · clique para ver</span>
              </div>

              {data.byAccount.length === 0 ? (
                <div style={{ padding:'28px 20px', textAlign:'center' }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>📊</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)', marginBottom:6 }}>Nenhum insight sincronizado</div>
                  <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6 }}>
                    Vá no <strong>Dashboard</strong> e clique em <strong>SYNC</strong> para importar as métricas dos seus posts via Meta Graph API.
                  </div>
                </div>
              ) : (
                <div>
                  {data.byAccount.map((acc, i) => {
                    const src = avatarSrc(acc.avatar);
                    const eng = engRate(acc.views, acc.likes, acc.saves);
                    const avgViewsPerPost = acc.posts ? Math.round(acc.views / acc.posts) : 0;

                    return (
                      <div
                        key={acc.username}
                        onClick={() => navigate('/accounts')}
                        title={`Ver conta @${acc.username}`}
                        style={{
                          display:'flex', alignItems:'center', gap:12,
                          padding:'12px 16px',
                          borderBottom: i < data.byAccount.length - 1 ? '1px solid oklch(1 0 0 / 0.06)' : 'none',
                          cursor:'pointer', transition:'background .15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'oklch(0.12 0.04 235 / 0.4)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        {/* Avatar com rank */}
                        <div style={{ position:'relative', flexShrink:0 }}>
                          <div style={{
                            width:42, height:42, borderRadius:'50%', overflow:'hidden',
                            border:`2px solid ${i === 0 ? 'var(--cyan)' : i === 1 ? 'rgba(167,139,250,.5)' : 'oklch(1 0 0 / 0.1)'}`,
                            background:'oklch(0.10 0.03 235 / 0.6)',
                          }}>
                            {src
                              ? <img src={src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none'; }} />
                              : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:16, color: i === 0 ? 'var(--cyan)' : 'var(--text3)' }}>
                                  {acc.username?.[0]?.toUpperCase()}
                                </div>
                            }
                          </div>
                          {/* Rank badge */}
                          <div style={{
                            position:'absolute', bottom:-2, right:-4,
                            width:17, height:17, borderRadius:'50%',
                            background: i === 0 ? 'var(--cyan)' : i === 1 ? '#a78bfa' : 'oklch(0.20 0.05 235)',
                            border:'2px solid oklch(0.16 0.05 235)',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:8, fontWeight:900,
                            color: i < 2 ? '#040e1c' : 'var(--text3)',
                            fontFamily:'var(--font-mono)',
                          }}>
                            {i + 1}
                          </div>
                        </div>

                        {/* Info */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            @{acc.username}
                          </div>
                          <div style={{ display:'flex', gap:8, marginTop:3, flexWrap:'wrap' }}>
                            <span style={{ fontSize:10, color:'var(--text3)' }}>
                              <span style={{ color:'var(--cyan)', fontWeight:700, fontFamily:'var(--font-mono)' }}>{fmtNum(acc.views)}</span> views
                            </span>
                            <span style={{ fontSize:10, color:'var(--text3)' }}>
                              <span style={{ color:'#f43f5e', fontWeight:700, fontFamily:'var(--font-mono)' }}>{fmtNum(acc.likes)}</span> curtidas
                            </span>
                            <span style={{ fontSize:10, color:'var(--text3)' }}>
                              <span style={{ color:'#fbbf24', fontWeight:700, fontFamily:'var(--font-mono)' }}>{fmtNum(acc.saves)}</span> salvos
                            </span>
                            <span style={{ fontSize:10, color:'var(--text3)' }}>{acc.posts} posts</span>
                          </div>
                        </div>

                        {/* Right: engagement */}
                        <div style={{ flexShrink:0, textAlign:'right' }}>
                          <div style={{ fontSize:13, fontWeight:800, color:'var(--cyan)', fontFamily:'var(--font-mono)', fontVariantNumeric:'tabular-nums' }}>
                            {fmtNum(acc.views)}
                          </div>
                          {eng && (
                            <div style={{ fontSize:9, color:'#22c55e', fontWeight:700, marginTop:1 }}>
                              {eng}% eng.
                            </div>
                          )}
                          {avgViewsPerPost > 0 && (
                            <div style={{ fontSize:9, color:'var(--text3)', marginTop:1 }}>
                              ≈{fmtNum(avgViewsPerPost)}/post
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>

            {/* ── Tipo de conteúdo + Engajamento ── */}
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <motion.div initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.25 }} style={cardStyle}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
                  <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Tipo de Conteúdo</h3>
                  <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>{totalTyped} posts</span>
                </div>
                <div style={{ padding:'16px 18px' }}>
                  {types.map(tp => {
                    const count = data.byType[tp.key] || 0;
                    const pct   = totalTyped > 0 ? ((count / totalTyped) * 100).toFixed(0) : 0;
                    return (
                      <div key={tp.key} style={{ marginBottom:16 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                          <span style={{ fontSize:12, color:'var(--text2)' }}>{tp.icon} {tp.label}</span>
                          <span style={{ fontSize:12, fontWeight:700, color:'var(--text)', fontFamily:'var(--font-mono)' }}>{count} <span style={{ color:'var(--text3)', fontWeight:400 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ height:5, borderRadius:99, background:'oklch(0.10 0.03 235 / 0.6)', overflow:'hidden' }}>
                          <motion.div
                            initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:.5, delay:.15 }}
                            style={{ height:'100%', borderRadius:99, background:tp.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              {/* Engagement summary */}
              <motion.div initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.25, delay:.06 }}
                style={{ ...cardStyle, padding:'16px 18px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:12 }}>Métricas de engajamento</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    { label:'Eng. médio', value:data.avgEng, color:'var(--cyan)', icon:'📈' },
                    { label:'Posts analisados', value:data.total, color:'#a78bfa', icon:'📄' },
                    {
                      label:'Taxa curtidas',
                      value: t.views > 0 ? `${(t.likes / t.views * 100).toFixed(1)}%` : '—',
                      color:'#f43f5e', icon:'❤️',
                    },
                    {
                      label:'Taxa salvamentos',
                      value: t.views > 0 ? `${(t.saves / t.views * 100).toFixed(1)}%` : '—',
                      color:'#fbbf24', icon:'🔖',
                    },
                  ].map(m => (
                    <div key={m.label} style={{ background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:10, padding:'10px 12px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
                        <span style={{ fontSize:12 }}>{m.icon}</span>
                        <span style={{ fontSize:9, color:'var(--text3)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize:18, fontWeight:800, color:m.color, fontVariantNumeric:'tabular-nums' }}>{fmtNum(m.value)}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

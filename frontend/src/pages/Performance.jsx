import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoMetricas, EsqueletoTabela, Bloco } from '../components/Estados';

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
    { label:'Visualizações', val:fmtNum(t.views),    color:'var(--mf-mod, var(--mf-accent-500))', border:'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)',  bg:'color-mix(in oklch, var(--mf-mod-contas) 7%, transparent)',   icon:'👁' },
    { label:'Curtidas',      val:fmtNum(t.likes),    color:'var(--mf-danger-500)',     border:'color-mix(in oklch, var(--mf-danger-500) 20%, transparent)',  bg:'color-mix(in oklch, var(--mf-danger-500) 7%, transparent)',   icon:'❤️' },
    { label:'Salvamentos',   val:fmtNum(t.saves),    color:'var(--mf-warning-500)',     border:'color-mix(in oklch, var(--mf-warning-500) 20%, transparent)', bg:'color-mix(in oklch, var(--mf-warning-500) 7%, transparent)',  icon:'🔖' },
    { label:'Alcance',       val:fmtNum(t.alcance),  color:'var(--mf-success-500)',     border:'color-mix(in oklch, var(--mf-success-500) 20%, transparent)',  bg:'color-mix(in oklch, var(--mf-success-500) 7%, transparent)',   icon:'📡' },
    { label:'Comentários',   val:fmtNum(t.comments), color:'var(--mf-mod-publicar)',     border:'color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)',bg:'color-mix(in oklch, var(--mf-mod-publicar) 7%, transparent)', icon:'💬' },
    { label:'Total Posts',   val:data?.total || 0,   color:'var(--mf-mod, var(--mf-accent-500))', border:'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)',  bg:'color-mix(in oklch, var(--mf-mod-contas) 7%, transparent)',   icon:'📄' },
  ];

  const types = [
    { key:'VIDEO',          label:'Reels',     color:'var(--mf-mod, var(--mf-accent-500))', icon:'🎬' },
    { key:'IMAGE',          label:'Fotos',     color:'var(--mf-mod-publicar)',     icon:'🖼️' },
    { key:'CAROUSEL_ALBUM', label:'Carrossel', color:'var(--mf-warning-500)',     icon:'🗂️' },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:3, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:3 }}>
      {[['7d','7 dias'],['30d','30 dias'],['90d','90 dias']].map(([k,l]) => (
        <button key={k} onClick={() => setPeriod(k)} style={{
          height:28, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight:600,
          border:'none', cursor:'pointer', transition:'.15s',
          background: period === k ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent',
          color:      period === k ? 'var(--mf-bg)'     : 'var(--mf-text-3)',
        }}>{l}</button>
      ))}
    </div>
  );

  const cardStyle = {
    background:'oklch(0.16 0.05 235 / 0.85)',
    border:'1px solid var(--mf-border)',
    borderRadius: 'var(--mf-r-lg)', overflow:'hidden',
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
        /* Insights é uma tela de métricas: o esqueleto reproduz a fileira de
           números e o gráfico, para o layout não saltar quando o dado chega. */
        <div style={{ display:'flex', flexDirection:'column', gap:'var(--mf-4)' }}>
          <EsqueletoMetricas quantas={4} />
          <Bloco style={{ height:180, borderRadius:'var(--mf-r-lg)' }} />
          <EsqueletoTabela linhas={5} colunas={4} />
        </div>
      ) : !data ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--mf-text-3)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:10 }}>⚠️</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-text-2)', marginBottom:8 }}>Erro ao carregar dados</div>
          {errMsg && <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)', background:'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 18%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 14px', marginBottom:14, maxWidth:420, margin:'0 auto 14px', wordBreak:'break-word' }}>{errMsg}</div>}
          <button onClick={load} style={{ padding:'8px 20px', borderRadius: 'var(--mf-r-md)', border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--mf-text-2)', cursor:'pointer', fontSize: 'var(--mf-t-sm)', fontWeight:600 }}>↺ Tentar novamente</button>
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
                style={{ padding:'16px 18px', borderRadius: 'var(--mf-r-lg)', background:k.bg, border:`1px solid ${k.border}`, backdropFilter:'blur(12px)', display:'flex', flexDirection:'column', gap:5 }}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ fontSize: 'var(--mf-t-display)', fontWeight:800, color:k.color, letterSpacing:-1, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{k.val}</div>
                  <span style={{ fontSize: 'var(--mf-t-h2)' }}>{k.icon}</span>
                </div>
                <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.06em' }}>{k.label}</div>
              </motion.div>
            ))}
          </div>

          <div className="layout-2col">
            {/* ── Top Contas ── */}
            <motion.div initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.25 }} style={cardStyle}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid var(--mf-border)' }}>
                <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Top Contas</h3>
                <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>por visualizações · clique para ver</span>
              </div>

              {data.byAccount.length === 0 ? (
                <div style={{ padding:'28px 20px', textAlign:'center' }}>
                  <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:8 }}>📊</div>
                  <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:600, color:'var(--mf-text-2)', marginBottom:6 }}>Nenhum insight sincronizado</div>
                  <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', lineHeight:1.6 }}>
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
                          borderBottom: i < data.byAccount.length - 1 ? '1px solid var(--mf-border)' : 'none',
                          cursor:'pointer', transition:'background .15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'oklch(0.12 0.04 235 / 0.4)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        {/* Avatar com rank */}
                        <div style={{ position:'relative', flexShrink:0 }}>
                          <div style={{
                            width:42, height:42, borderRadius: 'var(--mf-r-full)', overflow:'hidden',
                            border:`2px solid ${i === 0 ? 'var(--mf-mod, var(--mf-accent-500))' : i === 1 ? 'color-mix(in oklch, var(--mf-mod-publicar) 50%, transparent)' : 'var(--mf-border)'}`,
                            background:'oklch(0.10 0.03 235 / 0.6)',
                          }}>
                            {src
                              ? <img src={src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none'; }} />
                              : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize: 'var(--mf-t-h2)', color: i === 0 ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)' }}>
                                  {acc.username?.[0]?.toUpperCase()}
                                </div>
                            }
                          </div>
                          {/* Rank badge */}
                          <div style={{
                            position:'absolute', bottom:-2, right:-4,
                            width:17, height:17, borderRadius: 'var(--mf-r-full)',
                            background: i === 0 ? 'var(--mf-mod, var(--mf-accent-500))' : i === 1 ? 'var(--mf-mod-publicar)' : 'oklch(0.20 0.05 235)',
                            border:'2px solid oklch(0.16 0.05 235)',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize: 'var(--mf-t-nano)', fontWeight:900,
                            color: i < 2 ? 'var(--mf-bg)' : 'var(--mf-text-3)',
                            fontFamily:'var(--mf-mono)',
                          }}>
                            {i + 1}
                          </div>
                        </div>

                        {/* Info */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            @{acc.username}
                          </div>
                          <div style={{ display:'flex', gap:8, marginTop:3, flexWrap:'wrap' }}>
                            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
                              <span style={{ color:'var(--mf-mod, var(--mf-accent-500))', fontWeight:700, fontFamily:'var(--mf-mono)' }}>{fmtNum(acc.views)}</span> views
                            </span>
                            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
                              <span style={{ color:'var(--mf-danger-500)', fontWeight:700, fontFamily:'var(--mf-mono)' }}>{fmtNum(acc.likes)}</span> curtidas
                            </span>
                            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
                              <span style={{ color:'var(--mf-warning-500)', fontWeight:700, fontFamily:'var(--mf-mono)' }}>{fmtNum(acc.saves)}</span> salvos
                            </span>
                            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>{acc.posts} posts</span>
                          </div>
                        </div>

                        {/* Right: engagement */}
                        <div style={{ flexShrink:0, textAlign:'right' }}>
                          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:800, color:'var(--mf-mod, var(--mf-accent-500))', fontFamily:'var(--mf-mono)', fontVariantNumeric:'tabular-nums' }}>
                            {fmtNum(acc.views)}
                          </div>
                          {eng && (
                            <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-success-500)', fontWeight:700, marginTop:1 }}>
                              {eng}% eng.
                            </div>
                          )}
                          {avgViewsPerPost > 0 && (
                            <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:1 }}>
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
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid var(--mf-border)' }}>
                  <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Tipo de Conteúdo</h3>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>{totalTyped} posts</span>
                </div>
                <div style={{ padding:'16px 18px' }}>
                  {types.map(tp => {
                    const count = data.byType[tp.key] || 0;
                    const pct   = totalTyped > 0 ? ((count / totalTyped) * 100).toFixed(0) : 0;
                    return (
                      <div key={tp.key} style={{ marginBottom:16 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                          <span style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)' }}>{tp.icon} {tp.label}</span>
                          <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight:700, color:'var(--mf-text)', fontFamily:'var(--mf-mono)' }}>{count} <span style={{ color:'var(--mf-text-3)', fontWeight:400 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ height:5, borderRadius: 'var(--mf-r-full)', background:'oklch(0.10 0.03 235 / 0.6)', overflow:'hidden' }}>
                          <motion.div
                            initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:.5, delay:.15 }}
                            style={{ height:'100%', borderRadius: 'var(--mf-r-full)', background:tp.color }}
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
                <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:12 }}>Métricas de engajamento</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    { label:'Eng. médio', value:data.avgEng, color:'var(--mf-mod, var(--mf-accent-500))', icon:'📈' },
                    { label:'Posts analisados', value:data.total, color:'var(--mf-mod-publicar)', icon:'📄' },
                    {
                      label:'Taxa curtidas',
                      value: t.views > 0 ? `${(t.likes / t.views * 100).toFixed(1)}%` : '—',
                      color:'var(--mf-danger-500)', icon:'❤️',
                    },
                    {
                      label:'Taxa salvamentos',
                      value: t.views > 0 ? `${(t.saves / t.views * 100).toFixed(1)}%` : '—',
                      color:'var(--mf-warning-500)', icon:'🔖',
                    },
                  ].map(m => (
                    <div key={m.label} style={{ background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:'10px 12px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
                        <span style={{ fontSize: 'var(--mf-t-xs)' }}>{m.icon}</span>
                        <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight:800, color:m.color, fontVariantNumeric:'tabular-nums' }}>{fmtNum(m.value)}</div>
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

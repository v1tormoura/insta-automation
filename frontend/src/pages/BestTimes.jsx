import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';

const PERIODS = [['7d','7 dias'], ['30d','30 dias'], ['90d','90 dias']];
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const fmtK = v => { const n = Number(v || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
const avatarSrc = av => av
  ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`)
  : null;

export default function BestTimes() {
  const [data,       setData]       = useState(null);
  const [period,     setPeriod]     = useState('30d');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');

  function fetchData(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    api.get(`/analytics/best-times?period=${period}`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => { fetchData(); }, [period]);

  const globalPeak = data?.globalPeak ?? null;
  const accounts   = data?.accounts || [];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      <button onClick={() => fetchData(true)} className="btn-ghost" disabled={refreshing || loading} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, fontSize:'.83rem' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/>
        </svg>
        Atualizar
      </button>
      <div style={{ display:'flex', gap:3, background:'oklch(0.10 0.03 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:3 }}>
        {PERIODS.map(([p, l]) => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            height:26, padding:'0 12px', borderRadius:7, fontSize:'.75rem', fontWeight:600,
            border:'none', cursor:'pointer', transition:'.15s',
            background: period === p ? 'var(--cyan)' : 'transparent',
            color: period === p ? '#040e1c' : 'var(--text3)',
          }}>{l}</button>
        ))}
      </div>
    </div>
  );

  const cardStyle = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <PageShell icon={pageIcon} title="Melhores Horários" subtitle="Horário ideal de postagem por conta com base no engajamento histórico real da API" accent="cyan" actions={pageActions}>

      {loading && (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--text3)' }}>
          <div style={{ marginBottom:12, color:'var(--text3)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <p style={{ fontSize:13 }}>Calculando melhores horários...</p>
        </div>
      )}

      {error && (
        <div style={{ background:'oklch(0.22 0.06 15 / 0.4)', border:'1px solid oklch(0.38 0.12 15 / 0.35)', borderRadius:12, padding:'14px 18px', color:'#f87171', fontSize:13 }}>
          {error}
        </div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 20px', background:'oklch(0.16 0.05 235 / 0.5)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14 }}>
          <div style={{ fontSize:32, marginBottom:12, color:'var(--text3)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <div style={{ fontWeight:700, fontSize:15, color:'var(--text)', marginBottom:6 }}>Sem dados suficientes</div>
          <div style={{ fontSize:13, color:'var(--text3)' }}>Sincronize insights das contas para ver os melhores horários.</div>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <>
          {/* KPI bar */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:16 }}>
            {[
              { label:'Pico global',       value: globalPeak !== null ? `${String(globalPeak).padStart(2,'0')}h` : '—', color:'var(--cyan)' },
              { label:'Contas analisadas', value: String(accounts.length), color:'oklch(0.68 0.18 270)' },
              { label:'Período',           value: PERIODS.find(([p]) => p === period)?.[1] ?? period, color:'var(--text2)' },
              { label:'Fonte dos dados',   value: 'API oficial', color:'#22c55e' },
            ].map((s, i) => (
              <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*.04 }}
                style={{ ...cardStyle, padding:'14px 16px' }}>
                <div style={{ fontWeight:800, fontSize:20, color:s.color, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:'.05em', marginTop:4, textTransform:'uppercase' }}>{s.label}</div>
              </motion.div>
            ))}
          </div>

          {/* Per-account cards */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {accounts.map((a, ai) => {
              const maxV    = Math.max(...a.hours.map(h => h.avgEngagement), 1);
              const src     = avatarSrc(a.avatar);
              const totalPosts = a.hours.reduce((s, h) => s + h.count, 0);
              const peakEng    = a.hours[a.peakHour]?.avgEngagement || 0;
              const isPeakNow  = new Date().getHours() === a.peakHour;

              return (
                <motion.div key={String(a.accountId)} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:ai*.05 + .1 }}
                  style={{ ...cardStyle, borderRadius:16 }}>
                  {/* Card header */}
                  <div style={{ padding:'18px 20px 14px', display:'flex', gap:16, alignItems:'flex-start' }}>
                    {/* Avatar */}
                    <div style={{ flexShrink:0, width:52, height:52, borderRadius:'50%', overflow:'hidden', border:'2px solid oklch(1 0 0 / 0.07)', background:'oklch(0.12 0.04 235)' }}>
                      {src
                        ? <img src={src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                        : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:18, color:'var(--cyan)' }}>{a.username?.[0]?.toUpperCase()}</div>
                      }
                    </div>

                    {/* Account info */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:800, fontSize:15, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{a.username}</div>
                      {a.name && a.name !== a.username && (
                        <div style={{ fontSize:11, color:'var(--text2)', fontWeight:500, marginTop:1 }}>{a.name}</div>
                      )}
                      <div style={{ display:'flex', gap:12, marginTop:8, flexWrap:'wrap' }}>
                        {a.followers != null && (
                          <div><span style={{ fontWeight:700, fontSize:13, color:'var(--text)' }}>{fmtK(a.followers)}</span><span style={{ fontSize:10, color:'var(--text3)', marginLeft:4, textTransform:'uppercase', letterSpacing:'.04em' }}>Seguidores</span></div>
                        )}
                        <div><span style={{ fontWeight:700, fontSize:13, color:'var(--text)' }}>{totalPosts}</span><span style={{ fontSize:10, color:'var(--text3)', marginLeft:4, textTransform:'uppercase', letterSpacing:'.04em' }}>Posts analisados</span></div>
                      </div>
                    </div>

                    {/* Peak callout */}
                    <div style={{ flexShrink:0, textAlign:'center', background:'oklch(0.72 0.19 196 / 0.08)', border:'1px solid oklch(0.72 0.19 196 / 0.2)', borderRadius:12, padding:'10px 16px' }}>
                      <div style={{ fontSize:11, color:'var(--text3)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:4 }}>Melhor horário</div>
                      <div style={{ fontSize:26, fontWeight:900, color:'var(--cyan)', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{String(a.peakHour).padStart(2,'0')}:00</div>
                      {isPeakNow && <div style={{ fontSize:10, color:'#22c55e', fontWeight:700, marginTop:4 }}>● AGORA</div>}
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>eng. {peakEng}</div>
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div style={{ padding:'0 20px 16px' }}>
                    <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:72, background:'oklch(0.12 0.04 235 / 0.6)', borderRadius:10, padding:'10px 10px 0' }}>
                      {a.hours.map(h => {
                        const height  = Math.max(2, Math.round((h.avgEngagement / maxV) * 52));
                        const isPeak  = h.hour === a.peakHour;
                        const isHigh  = h.avgEngagement > maxV * 0.65;
                        const isMed   = h.avgEngagement > maxV * 0.35;
                        return (
                          <div
                            key={h.hour}
                            title={`${String(h.hour).padStart(2,'0')}:00 — engajamento médio: ${h.avgEngagement} (${h.count} posts)`}
                            style={{
                              flex:1, height,
                              borderRadius:'3px 3px 0 0',
                              background: isPeak ? 'var(--cyan)' : isHigh ? 'oklch(0.72 0.19 196 / 0.5)' : isMed ? 'oklch(0.72 0.19 196 / 0.22)' : 'oklch(0.72 0.19 196 / 0.09)',
                              boxShadow: isPeak ? '0 0 10px oklch(0.72 0.19 196 / 0.5)' : 'none',
                              opacity: h.count === 0 ? 0.25 : 1,
                              cursor:'default',
                            }}
                          />
                        );
                      })}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:9, color:'var(--text3)', padding:'0 2px' }}>
                      {['00h','03h','06h','09h','12h','15h','18h','21h','23h'].map(h => <span key={h}>{h}</span>)}
                    </div>
                  </div>

                  {/* Best hours */}
                  <div style={{ borderTop:'1px solid oklch(1 0 0 / 0.07)', padding:'10px 20px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    <span style={{ fontSize:10, color:'var(--text3)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginRight:4 }}>Top horários:</span>
                    {[...a.hours]
                      .filter(h => h.count > 0)
                      .sort((x, y) => y.avgEngagement - x.avgEngagement)
                      .slice(0, 5)
                      .map(h => (
                        <span key={h.hour} style={{
                          fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:20,
                          background: h.hour === a.peakHour ? 'oklch(0.72 0.19 196 / 0.15)' : 'oklch(0.12 0.04 235 / 0.6)',
                          color: h.hour === a.peakHour ? 'var(--cyan)' : 'var(--text2)',
                          border: `1px solid ${h.hour === a.peakHour ? 'oklch(0.72 0.19 196 / 0.3)' : 'oklch(1 0 0 / 0.07)'}`,
                        }}>
                          {String(h.hour).padStart(2,'0')}h
                        </span>
                      ))
                    }
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </PageShell>
  );
}

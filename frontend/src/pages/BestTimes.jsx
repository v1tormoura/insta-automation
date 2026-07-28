import { useEffect, useState } from 'react';
import api from '../services/api';

const PERIODS = ['7d', '30d', '90d'];
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const fmtK = v => { const n = Number(v || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
const avatarSrc = av => av
  ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`)
  : null;

export default function BestTimes() {
  const [data,    setData]    = useState(null);
  const [period,  setPeriod]  = useState('30d');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/analytics/best-times?period=${period}`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [period]);

  const globalPeak = data?.globalPeak ?? null;
  const accounts   = data?.accounts || [];

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 6 }}>Viralizar</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.5 }}>Melhores Horários</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text2)', fontSize: 13, lineHeight: 1.5 }}>
              Horário ideal de postagem por conta com base no engajamento histórico real da API
            </p>
          </div>
          <div className="tabs" style={{ flexShrink: 0 }}>
            {PERIODS.map(p => (
              <button key={p} className={`tab${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)' }}>
          <div style={{ marginBottom: 12 }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div>
          <p style={{ fontSize: 13 }}>Calculando melhores horários...</p>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 12, padding: '14px 18px', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div>
          <div className="empty-title">Sem dados suficientes</div>
          <div className="empty-sub">Sincronize insights das contas para ver os melhores horários.</div>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <>
          {/* KPI bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 24 }}>
            {[
              { label: 'Pico global',        value: globalPeak !== null ? `${String(globalPeak).padStart(2,'0')}h` : '—', color: 'var(--cyan)',  icon: null },
              { label: 'Contas analisadas',  value: String(accounts.length),   color: 'var(--indigo)', icon: null },
              { label: 'Período',            value: period,                     color: 'var(--text2)',  icon: null },
              { label: 'Fonte dos dados',    value: 'API oficial',              color: '#22c55e',       icon: null },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 20, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.05em', marginTop: 3, textTransform: 'uppercase' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Per-account cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {accounts.map(a => {
              const maxV    = Math.max(...a.hours.map(h => h.avgEngagement), 1);
              const src     = avatarSrc(a.avatar);
              const totalPosts = a.hours.reduce((s, h) => s + h.count, 0);
              const peakEng    = a.hours[a.peakHour]?.avgEngagement || 0;
              const isPeakNow  = new Date().getHours() === a.peakHour;

              return (
                <div key={String(a.accountId)} style={{
                  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16,
                  overflow: 'hidden',
                }}>
                  {/* Card header */}
                  <div style={{ padding: '18px 20px 14px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    {/* Avatar */}
                    <div style={{ flexShrink: 0 }}>
                      <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--border)', background: 'var(--bg3)' }}>
                        {src
                          ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { e.target.style.display = 'none'; }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 20, color: 'var(--cyan)' }}>
                              {a.username?.[0]?.toUpperCase()}
                            </div>
                        }
                      </div>
                    </div>

                    {/* Account info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{a.username}
                      </div>
                      {a.name && a.name !== a.username && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500, marginTop: 1 }}>{a.name}</div>
                      )}
                      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                        {a.followers != null && (
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{fmtK(a.followers)}</span>
                            <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>Seguidores</span>
                          </div>
                        )}
                        <div>
                          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{totalPosts}</span>
                          <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>Posts analisados</span>
                        </div>
                      </div>
                    </div>

                    {/* Peak callout */}
                    <div style={{
                      flexShrink: 0, textAlign: 'center', background: 'rgba(0,212,255,.08)',
                      border: '1px solid rgba(0,212,255,.2)', borderRadius: 12, padding: '10px 16px',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Melhor horário</div>
                      <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--cyan)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                        {String(a.peakHour).padStart(2, '0')}:00
                      </div>
                      {isPeakNow && (
                        <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, marginTop: 4 }}>● AGORA</div>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>eng. {peakEng}</div>
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div style={{ padding: '0 20px 16px' }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 72, background: 'var(--bg3)', borderRadius: 10, padding: '10px 10px 0' }}>
                      {a.hours.map(h => {
                        const height = Math.max(2, Math.round((h.avgEngagement / maxV) * 52));
                        const isPeak = h.hour === a.peakHour;
                        const isHigh = h.avgEngagement > maxV * 0.65;
                        const isMed  = h.avgEngagement > maxV * 0.35;
                        return (
                          <div
                            key={h.hour}
                            title={`${String(h.hour).padStart(2,'0')}:00 — engajamento médio: ${h.avgEngagement} (${h.count} posts)`}
                            style={{
                              flex: 1, height,
                              borderRadius: '3px 3px 0 0',
                              background: isPeak
                                ? 'var(--cyan)'
                                : isHigh ? 'rgba(0,212,255,.5)'
                                : isMed  ? 'rgba(0,212,255,.22)'
                                : 'rgba(0,180,255,.09)',
                              boxShadow: isPeak ? '0 0 10px rgba(0,212,255,.5)' : 'none',
                              opacity: h.count === 0 ? 0.25 : 1,
                              cursor: 'default',
                            }}
                          />
                        );
                      })}
                    </div>
                    {/* Hour labels */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--text3)', padding: '0 2px' }}>
                      {['00h','03h','06h','09h','12h','15h','18h','21h','23h'].map(h => <span key={h}>{h}</span>)}
                    </div>
                  </div>

                  {/* Best hours detail row */}
                  <div style={{ borderTop: '1px solid var(--border)', padding: '10px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 4 }}>Top horários:</span>
                    {[...a.hours]
                      .filter(h => h.count > 0)
                      .sort((x, y) => y.avgEngagement - x.avgEngagement)
                      .slice(0, 5)
                      .map(h => (
                        <span key={h.hour} style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                          background: h.hour === a.peakHour ? 'rgba(0,212,255,.15)' : 'var(--bg3)',
                          color: h.hour === a.peakHour ? 'var(--cyan)' : 'var(--text2)',
                          border: h.hour === a.peakHour ? '1px solid rgba(0,212,255,.3)' : '1px solid var(--border)',
                        }}>
                          {String(h.hour).padStart(2,'0')}h
                        </span>
                      ))
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

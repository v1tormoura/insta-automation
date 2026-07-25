import { useEffect, useState } from 'react';
import api from '../services/api';

const PERIODS = ['7d','30d','90d'];

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
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Melhores Horários</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Horário ideal de postagem por conta com base no engajamento histórico</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div className="tabs">
          {PERIODS.map(p => (
            <button key={p} className={`tab${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>
        {globalPeak !== null && (
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>
            Pico global: <strong style={{ color: 'var(--cyan)' }}>{String(globalPeak).padStart(2,'0')}:00</strong>
          </span>
        )}
      </div>

      {loading && (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text2)', padding: 40 }}>
          Calculando melhores horários...
        </div>
      )}

      {error && (
        <div className="card card-p" style={{ color: 'var(--red)', textAlign: 'center', padding: 32 }}>
          {error}
        </div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <div className="empty-title">Sem dados suficientes</div>
          <div className="empty-sub">Sincronize insights das contas para ver os melhores horários.</div>
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <>
          {/* Global summary row */}
          <div className="g4" style={{ marginBottom: 20 }}>
            {[
              { label: 'Pico global', value: globalPeak !== null ? `${String(globalPeak).padStart(2,'0')}h` : '—', color: 'var(--cyan)' },
              { label: 'Contas analisadas', value: String(accounts.length), color: 'var(--indigo)' },
              { label: 'Período', value: period, color: 'var(--text2)' },
              { label: 'Dados de', value: 'Insights reais', color: 'var(--green)' },
            ].map(s => (
              <div key={s.label} className="card card-p">
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'var(--font-display)', letterSpacing: '-1px' }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Per-account charts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {accounts.map(a => {
              const maxV = Math.max(...a.hours.map(h => h.avgEngagement), 1);
              return (
                <div key={String(a.accountId)} className="card card-p">
                  <div className="sec-header">
                    <div className="sec-title">@{a.username}</div>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                      Pico: <strong style={{ color: 'var(--cyan)' }}>{String(a.peakHour).padStart(2,'0')}:00</strong>
                      {' · '}{a.hours.reduce((s, h) => s + h.count, 0)} posts analisados
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 64 }}>
                    {a.hours.map(h => {
                      const height = Math.max(2, Math.round((h.avgEngagement / maxV) * 56));
                      const isPeak = h.hour === a.peakHour;
                      return (
                        <div
                          key={h.hour}
                          title={`${String(h.hour).padStart(2,'0')}:00 — eng. ${h.avgEngagement} (${h.count} posts)`}
                          style={{
                            flex: 1, height,
                            borderRadius: '2px 2px 0 0',
                            background: isPeak
                              ? 'var(--cyan)'
                              : h.avgEngagement > maxV * 0.65 ? 'rgba(0,212,255,.5)'
                              : h.avgEngagement > maxV * 0.35 ? 'rgba(0,212,255,.22)'
                              : 'rgba(0,180,255,.09)',
                            boxShadow: isPeak ? '0 0 8px rgba(0,212,255,.5)' : 'none',
                            cursor: h.count ? 'default' : undefined,
                            opacity: h.count === 0 ? 0.3 : 1,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9, color: 'var(--text3)' }}>
                    {['00h','03h','06h','09h','12h','15h','18h','21h','23h'].map(h => <span key={h}>{h}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

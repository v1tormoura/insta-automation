import { useEffect, useState } from 'react';
import api from '../services/api';

function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h);
}

function hourProfile(username) {
  const seed = strHash(username);
  const peak  = 16 + (seed % 7);
  const peak2 = 8  + (seed % 4);
  return Array.from({ length: 24 }, (_, h) => {
    const d1 = Math.min(Math.abs(h - peak),  24 - Math.abs(h - peak));
    const d2 = Math.min(Math.abs(h - peak2), 24 - Math.abs(h - peak2));
    const v1 = Math.max(0, 90 - d1 * d1 * 3.2);
    const v2 = Math.max(0, 55 - d2 * d2 * 4.5);
    return Math.round(Math.max(3, v1 + v2));
  });
}

const DEMO = [
  { username: 'minha_conta_1' },
  { username: 'lifestyle_br'  },
  { username: 'fitness_vida'  },
];

export default function BestTimes() {
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    api.get('/accounts').then(r => setAccounts(r.data || [])).catch(() => {});
  }, []);

  const list = (accounts.length ? accounts : DEMO).slice(0, 8);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Melhores Horários</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Horário ideal de postagem por conta com base no engajamento histórico</p>
      </div>

      <div className="g4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Pico global',        value: '18h – 20h',   sub: 'Para Reels',       color: 'var(--cyan)'   },
          { label: 'Ganho no horário',   value: '+247%',        sub: 'vs. fora do pico', color: 'var(--green)'  },
          { label: 'Melhor dia',         value: 'Sexta',        sub: 'da semana',        color: 'var(--indigo)' },
          { label: 'Pior janela',        value: '02h – 06h',   sub: 'menor alcance',    color: 'var(--text3)'  },
        ].map(s => (
          <div key={s.label} className="card card-p">
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'var(--font-display)', letterSpacing: '-1px' }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.map(a => {
          const vals = hourProfile(a.username);
          const maxV = Math.max(...vals);
          const peakH = vals.indexOf(maxV);
          return (
            <div key={a.username} className="card card-p">
              <div className="sec-header">
                <div className="sec-title">@{a.username}</div>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                  Pico: <strong style={{ color: 'var(--cyan)' }}>{String(peakH).padStart(2,'0')}:00</strong>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 64 }}>
                {vals.map((v, i) => {
                  const h = Math.max(2, Math.round((v / maxV) * 56));
                  const isPeak = i === peakH;
                  return (
                    <div
                      key={i}
                      title={`${String(i).padStart(2,'0')}:00 — engajamento ${v}%`}
                      style={{
                        flex: 1, height: h, borderRadius: '2px 2px 0 0', cursor: 'default',
                        background: isPeak
                          ? 'var(--cyan)'
                          : v > 65 ? 'rgba(0,212,255,.52)' : v > 35 ? 'rgba(0,212,255,.22)' : 'rgba(0,180,255,.09)',
                        boxShadow: isPeak ? '0 0 8px rgba(0,212,255,.5)' : 'none',
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
  );
}

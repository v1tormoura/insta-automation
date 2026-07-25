import { useState } from 'react';

const PAST = [
  { name: 'Cover Natal vs Ano Novo',   winner: 'A', uplift: '+31%', date: '10 Jul' },
  { name: 'Produto em destaque capa',  winner: 'B', uplift: '+18%', date: '2 Jul'  },
  { name: 'Texto vs Sem texto',        winner: 'A', uplift: '+42%', date: '24 Jun' },
];

const VARIANTS = [
  { label: 'Variante A', icon: '🌴', views: 12400, likes: 1830, ctr: 14.8, color: 'var(--cyan)'   },
  { label: 'Variante B', icon: '🌊', views:  9200, likes: 1140, ctr: 12.4, color: 'var(--indigo)' },
];

export default function ABTest() {
  const [duration, setDuration] = useState('48');
  const [caption, setCaption]   = useState('');

  const maxCtr = Math.max(...VARIANTS.map(v => v.ctr));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>A/B Teste de Capa</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Compare duas capas de Reel para descobrir qual converte mais visualizações</p>
      </div>

      <div className="layout-2col">

        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Active test */}
          <div className="card card-p">
            <div className="sec-header">
              <div className="sec-title">Teste ativo</div>
              <span className="badge badge-green">● Em andamento</span>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Cover Verão #1 vs #2</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>@lifestyle_br · Iniciado 22 Jul · 72h de duração</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 5 }}>
                <span>Progresso</span><span>65%</span>
              </div>
              <div className="progress-track prog-h8">
                <div className="progress-fill" style={{ width: '65%', background: 'linear-gradient(90deg,var(--blue2),var(--cyan))' }} />
              </div>
            </div>

            <div className="g2" style={{ gap: 10, marginBottom: 14 }}>
              {VARIANTS.map(v => (
                <div key={v.label} style={{ background: 'rgba(255,255,255,.025)', border: `1px solid color-mix(in srgb,${v.color} 30%,transparent)`, borderRadius: 11, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 9, background: `color-mix(in srgb,${v.color} 18%,transparent)`, border: `1px solid color-mix(in srgb,${v.color} 40%,transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{v.icon}</div>
                    <span style={{ fontWeight: 700, color: v.color, fontSize: 13 }}>{v.label}</span>
                    {v.ctr === maxCtr && <span className="badge badge-green" style={{ marginLeft: 'auto', fontSize: 9 }}>Liderando</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{(v.views/1000).toFixed(1)}K</div>
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>Views</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{(v.likes/1000).toFixed(1)}K</div>
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>Likes</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>{v.ctr}%</div>
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>CTR</div>
                    </div>
                  </div>
                  <div className="progress-track prog-h5">
                    <div className="progress-fill" style={{ width: `${(v.ctr/maxCtr)*100}%`, background: v.color }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm">⏹ Encerrar</button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>📊 Relatório completo</button>
            </div>
          </div>

          {/* History */}
          <div className="card card-p">
            <div className="sec-header"><div className="sec-title">Testes anteriores</div></div>
            {PAST.map(t => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>✓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{t.date} · Variante {t.winner} venceu</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)', flexShrink: 0 }}>{t.uplift}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div className="card card-p" style={{ alignSelf: 'start' }}>
          <div className="sec-header" style={{ marginBottom: 16 }}><div className="sec-title">Novo teste</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="input-wrap">
              <label className="input-label">Conta</label>
              <select className="input"><option value="">Selecionar conta...</option></select>
            </div>
            <div className="input-wrap">
              <label className="input-label">Capa — Variante A</label>
              <div style={{ border: '2px dashed var(--border2)', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, transition: 'border-color .2s' }} onMouseEnter={e=>e.currentTarget.style.borderColor='var(--cyan)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}>
                📁 Clique para enviar imagem A
              </div>
            </div>
            <div className="input-wrap">
              <label className="input-label">Capa — Variante B</label>
              <div style={{ border: '2px dashed var(--border2)', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, transition: 'border-color .2s' }} onMouseEnter={e=>e.currentTarget.style.borderColor='var(--indigo)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}>
                📁 Clique para enviar imagem B
              </div>
            </div>
            <div className="input-wrap">
              <label className="input-label">Duração</label>
              <select className="input" value={duration} onChange={e => setDuration(e.target.value)}>
                <option value="24">24 horas</option>
                <option value="48">48 horas</option>
                <option value="72">72 horas</option>
                <option value="168">7 dias</option>
              </select>
            </div>
            <div className="input-wrap">
              <label className="input-label">Legenda</label>
              <textarea className="input" rows={3} placeholder="Legenda usada para ambas as variantes..." value={caption} onChange={e => setCaption(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>🧪 Iniciar A/B Teste</button>
          </div>
        </div>
      </div>
    </>
  );
}

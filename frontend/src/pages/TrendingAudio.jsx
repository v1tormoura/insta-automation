import { useState } from 'react';

const AUDIOS = [
  { id:1, title:'Funk do Verão 2025',      artist:'DJ Maloka',       uses:'2.4M', growth:'+182%/h', genre:'Funk',      label:'🔥 Viral',    color:'var(--indigo)' },
  { id:2, title:'Original Sound – Trends', artist:'@trendcreator',   uses:'847K', growth:'+94%/h',  genre:'Trend',     label:'📈 Subindo',  color:'var(--cyan)'   },
  { id:3, title:'Pagode do Coração',       artist:'Grupo Sensação',  uses:'1.2M', growth:'+67%/h',  genre:'Pagode',    label:'❤️ Popular', color:'var(--pink)'   },
  { id:4, title:'Trap Brasileiro Mix',     artist:'Prod. TrapBR',    uses:'534K', growth:'+51%/h',  genre:'Trap',      label:'🎵 Música',   color:'var(--purple)' },
  { id:5, title:'Risada Challenge',        artist:'@humorista',      uses:'3.1M', growth:'+203%/h', genre:'Trend',     label:'🔥 Viral',    color:'var(--amber)'  },
  { id:6, title:'Forró Eletrônico',        artist:'DJ Nordestino',   uses:'412K', growth:'+38%/h',  genre:'Forró',     label:'📈 Subindo',  color:'var(--green)'  },
  { id:7, title:'Sertanejo Universitário', artist:'Dupla do Rio',    uses:'678K', growth:'+45%/h',  genre:'Sertanejo', label:'❤️ Popular', color:'var(--orange)' },
  { id:8, title:'Phonk Dark Wave',         artist:'PHONKWAVE',       uses:'289K', growth:'+29%/h',  genre:'Phonk',     label:'🎵 Música',   color:'var(--indigo)' },
];

const TABS = ['Todos','Trends','Música','Funk','Sertanejo'];

export default function TrendingAudio() {
  const [tab, setTab]       = useState('Todos');
  const [copied, setCopied] = useState(null);

  const list = AUDIOS.filter(a => {
    if (tab === 'Todos')     return true;
    if (tab === 'Trends')    return a.genre === 'Trend';
    if (tab === 'Música')    return !['Trend','Funk','Sertanejo'].includes(a.genre);
    return a.genre === tab;
  });

  function copy(id) {
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Áudio Trending</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Áudios em alta no seu nicho — rankeados por crescimento de uso nas últimas 24h</p>
      </div>

      <div className="tabs" style={{ marginBottom: 18 }}>
        {TABS.map(t => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div className="g3">
        {list.map((a, idx) => (
          <div key={a.id} className="card card-p" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${a.color},transparent)`, borderRadius: 'var(--radius) var(--radius) 0 0' }} />

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: 11, background: `color-mix(in srgb,${a.color} 18%,transparent)`, border: `1px solid color-mix(in srgb,${a.color} 35%,transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎵</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{a.artist}</div>
                </div>
              </div>
              <span className={`badge ${idx < 3 ? 'badge-blue' : 'badge-gray'}`} style={{ flexShrink: 0, marginLeft: 6 }}>#{idx + 1}</span>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <span className="badge badge-purple">{a.genre}</span>
              <span className="badge badge-gray">{a.label}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 9, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{a.uses}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Usos totais</div>
              </div>
              <div style={{ background: 'rgba(16,185,129,.07)', border: '1px solid rgba(16,185,129,.18)', borderRadius: 9, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--green)' }}>{a.growth}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Crescimento</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-cyan btn-sm" style={{ flex: 1, justifyContent: 'center' }}>🎵 Usar áudio</button>
              <button className="btn btn-ghost btn-sm" title="Copiar link" onClick={() => copy(a.id)}>
                {copied === a.id ? '✓' : '⎘'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

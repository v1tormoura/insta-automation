import { useState } from 'react';

const VIRALS = [
  { id:1, user:'@comida_viral',     icon:'🍕', views:'4.2M', likes:'312K', saves:'89K', shares:'45K', niche:'Culinária',   age:'2 dias',  growth:'+890%'  },
  { id:2, user:'@fitness_br',       icon:'💪', views:'2.8M', likes:'201K', saves:'67K', shares:'28K', niche:'Fitness',     age:'1 dia',   growth:'+650%'  },
  { id:3, user:'@moda_luxo',        icon:'👗', views:'1.9M', likes:'178K', saves:'54K', shares:'19K', niche:'Moda',        age:'3 dias',  growth:'+420%'  },
  { id:4, user:'@tecnologia_news',  icon:'📱', views:'3.1M', likes:'240K', saves:'71K', shares:'38K', niche:'Tecnologia',  age:'12h',     growth:'+1200%' },
  { id:5, user:'@viagem_brasil',    icon:'✈️', views:'987K', likes:'89K',  saves:'43K', shares:'12K', niche:'Viagem',     age:'4 dias',  growth:'+310%'  },
  { id:6, user:'@humor_diario',     icon:'😂', views:'5.7M', likes:'489K', saves:'122K',shares:'98K', niche:'Humor',       age:'18h',     growth:'+2100%' },
  { id:7, user:'@pet_fofo',         icon:'🐾', views:'2.2M', likes:'198K', saves:'81K', shares:'34K', niche:'Pets',        age:'2 dias',  growth:'+540%'  },
  { id:8, user:'@beleza_dicas',     icon:'💄', views:'1.4M', likes:'132K', saves:'61K', shares:'21K', niche:'Beleza',      age:'5 dias',  growth:'+280%'  },
];

const NICHES = ['Culinária','Fitness','Moda','Tecnologia','Viagem','Humor','Pets','Beleza'];

export default function ViralHunter() {
  const [query,       setQuery]       = useState('');
  const [niche,       setNiche]       = useState('');
  const [downloading, setDownloading] = useState(null);
  const [done,        setDone]        = useState([]);

  const list = VIRALS.filter(v =>
    (!niche || v.niche === niche) &&
    (!query || v.user.includes(query.toLowerCase()) || v.niche.toLowerCase().includes(query.toLowerCase()))
  );

  function handleDownload(id) {
    setDownloading(id);
    setTimeout(() => { setDownloading(null); setDone(d => [...d, id]); }, 2000);
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Caçador de Virais</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>
          Encontre e baixe posts virais do seu nicho via API — qualidade original, sem perda alguma
        </p>
      </div>

      {/* Search */}
      <div className="card card-p" style={{ marginBottom: 18 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200, position:'relative' }}>
            <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14, pointerEvents:'none' }}>🔍</span>
            <input className="input" style={{ paddingLeft:36 }} placeholder="Nicho, hashtag ou @usuário..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <select className="input" style={{ width:170, flex:'none' }} value={niche} onChange={e => setNiche(e.target.value)}>
            <option value="">Todos os nichos</option>
            {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="btn btn-cyan" style={{ flexShrink:0 }}>🔍 Buscar virais</button>
        </div>
      </div>

      {/* Grid */}
      <div className="g4" style={{ gap:12 }}>
        {list.map(v => {
          const isDone    = done.includes(v.id);
          const isLoading = downloading === v.id;
          return (
            <div key={v.id} className="card" style={{ overflow:'hidden' }}>
              {/* Thumbnail */}
              <div style={{ height:120, background:'linear-gradient(135deg,var(--bg3),var(--bg4))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:48, position:'relative' }}>
                {v.icon}
                <div style={{ position:'absolute', top:8, right:8 }}>
                  <span className="badge badge-green" style={{ fontSize:9 }}>{v.growth}</span>
                </div>
                <div style={{ position:'absolute', bottom:8, left:8 }}>
                  <span className="badge badge-purple" style={{ fontSize:9 }}>{v.niche}</span>
                </div>
                {isDone && (
                  <div style={{ position:'absolute', inset:0, background:'rgba(16,185,129,.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ width:40, height:40, borderRadius:'50%', background:'rgba(16,185,129,.9)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>✓</div>
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ padding:'12px 14px' }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:2 }}>{v.user}</div>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10 }}>Postado há {v.age}</div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px 8px', marginBottom:12, fontSize:12 }}>
                  <div><span style={{ color:'var(--text3)' }}>👁 </span><strong>{v.views}</strong></div>
                  <div><span style={{ color:'var(--text3)' }}>❤️ </span><strong>{v.likes}</strong></div>
                  <div><span style={{ color:'var(--text3)' }}>🔖 </span><strong>{v.saves}</strong></div>
                  <div><span style={{ color:'var(--text3)' }}>↗ </span><strong>{v.shares}</strong></div>
                </div>

                <button
                  className={`btn btn-sm ${isDone ? 'btn-ghost' : 'btn-primary'}`}
                  style={{ width:'100%', justifyContent:'center' }}
                  onClick={() => !isDone && !isLoading && handleDownload(v.id)}
                  disabled={isLoading}
                >
                  {isLoading ? '⏳ Baixando...' : isDone ? '✓ Baixado' : '⬇ Baixar original'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info footer */}
      <div className="card card-p" style={{ marginTop:14, display:'flex', alignItems:'flex-start', gap:14 }}>
        <div style={{ fontSize:22, flexShrink:0 }}>🔒</div>
        <div>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:3 }}>Download via API oficial — qualidade 100%</div>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
            Os arquivos são baixados diretamente da CDN do Instagram via API Graph, preservando resolução e qualidade originais.
            Nenhuma recompressão é aplicada. Os vídeos chegam exatamente como foram publicados.
          </div>
        </div>
      </div>
    </>
  );
}

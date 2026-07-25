import { useState } from 'react';

const INIT_RULES = [
  { id:1, name:'Top Posts Semanais', active:true,  cond:'Views > 50K na semana',   action:'Repostar em 3 contas', next:'Dom 20:00',    runs:12, color:'var(--cyan)'   },
  { id:2, name:'Virais do Nicho',    active:true,  cond:'Engajamento > 8%',          action:'Repostar no mesmo dia', next:'Diário 18:00', runs:34, color:'var(--green)'  },
  { id:3, name:'Tops do Mês',        active:false, cond:'Top 5 por saves no mês',    action:'Agendar domingo 19:00', next:'—',            runs:4,  color:'var(--indigo)' },
  { id:4, name:'Reshare Mensal',     active:false, cond:'Views > 100K acumulado',   action:'Repostar 30 dias depois', next:'—',           runs:8,  color:'var(--purple)' },
];

const QUEUE = [
  { id:1, title:'Receita viral da semana', account:'@comida_fit',   sched:'Hoje 18:00',     type:'REEL',      views:'82K'  },
  { id:2, title:'Look do dia #ootd',       account:'@moda_br',      sched:'Hoje 20:00',     type:'REEL',      views:'54K'  },
  { id:3, title:'Treino rápido 10 min',    account:'@fitness_vida', sched:'Amanhã 07:00',   type:'REEL',      views:'127K' },
  { id:4, title:'Produto destaque mês',    account:'@loja_trendy',  sched:'Amanhã 12:00',   type:'CARROSSEL', views:'43K'  },
];

export default function SmartRepost() {
  const [rules,    setRules]    = useState(INIT_RULES);
  const [queue,    setQueue]    = useState(QUEUE);
  const [creating, setCreating] = useState(false);
  const [newRule,  setNewRule]  = useState({ name:'', cond:'views50k', action:'now' });

  function toggle(id) { setRules(r => r.map(x => x.id === id ? { ...x, active: !x.active } : x)); }
  function removeQueue(id) { setQueue(q => q.filter(x => x.id !== id)); }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>Viralizar</div>
        <h1>Repost Inteligente</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Regras automáticas para republicar seus melhores conteúdos no momento certo</p>
      </div>

      <div className="layout-2col">

        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Rules */}
          <div className="card card-p">
            <div className="sec-header">
              <div className="sec-title">Regras</div>
              <button className="btn btn-cyan btn-sm" onClick={() => setCreating(v => !v)}>+ Nova</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rules.map(r => (
                <div key={r.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background: r.active ? 'rgba(255,255,255,.03)' : 'transparent', border:`1px solid ${r.active ? r.color+'33' : 'var(--border)'}`, borderRadius:10, transition:'.2s' }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background: r.active ? r.color : 'var(--text3)', boxShadow: r.active ? `0 0 7px ${r.color}` : 'none', flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:13 }}>{r.name}</div>
                    <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>Se: {r.cond}</div>
                    <div style={{ fontSize:11, color:'var(--text3)', marginTop:1 }}>→ {r.action}</div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0, marginRight:8 }}>
                    <div style={{ fontSize:11, color:'var(--text2)' }}>{r.next}</div>
                    <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{r.runs} execuções</div>
                  </div>
                  <div className={`toggle${r.active ? ' on' : ''}`} onClick={() => toggle(r.id)} style={{ flexShrink:0 }} />
                </div>
              ))}
            </div>

            {creating && (
              <div style={{ marginTop:16, padding:'14px', background:'rgba(255,255,255,.025)', borderRadius:10, border:'1px solid var(--border2)', display:'flex', flexDirection:'column', gap:10 }}>
                <div className="input-wrap">
                  <label className="input-label">Nome da regra</label>
                  <input className="input" placeholder="Ex: Top Virais Semanais" value={newRule.name} onChange={e => setNewRule(r=>({...r,name:e.target.value}))} />
                </div>
                <div className="input-wrap">
                  <label className="input-label">Condição</label>
                  <select className="input" value={newRule.cond} onChange={e => setNewRule(r=>({...r,cond:e.target.value}))}>
                    <option value="views50k">Views &gt; 50K</option>
                    <option value="eng5">Engajamento &gt; 5%</option>
                    <option value="saves1k">Saves &gt; 1K</option>
                    <option value="top3">Top 3 do mês</option>
                  </select>
                </div>
                <div className="input-wrap">
                  <label className="input-label">Ação</label>
                  <select className="input" value={newRule.action} onChange={e => setNewRule(r=>({...r,action:e.target.value}))}>
                    <option value="now">Repostar imediatamente</option>
                    <option value="7d">Agendar 7 dias depois</option>
                    <option value="30d">Agendar 30 dias depois</option>
                  </select>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)} style={{ flex:1, justifyContent:'center' }}>Cancelar</button>
                  <button className="btn btn-primary btn-sm" style={{ flex:1, justifyContent:'center' }}>Criar regra</button>
                </div>
              </div>
            )}
          </div>

          {/* Queue */}
          <div className="card card-p">
            <div className="sec-header">
              <div className="sec-title">Fila de reposts</div>
              <span style={{ fontSize:12, color:'var(--text2)' }}>{queue.length} agendados</span>
            </div>
            {queue.length === 0 && (
              <div className="empty-state"><div className="empty-icon">📭</div><div className="empty-title">Fila vazia</div></div>
            )}
            {queue.map(item => (
              <div key={item.id} className="queue-item">
                <div className="queue-thumb" style={{ background:'rgba(30,111,255,.12)', fontSize:20 }}>🎬</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="queue-name">{item.title}</div>
                  <div className="queue-meta">{item.account} · {item.type} · {item.views} views</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div className="queue-time">{item.sched}</div>
                  <button className="btn btn-ghost btn-sm" style={{ marginTop:4, padding:'2px 8px', fontSize:10 }} onClick={() => removeQueue(item.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: stats */}
        <div className="card card-p" style={{ alignSelf: 'start' }}>
          <div className="sec-header" style={{ marginBottom:14 }}><div className="sec-title">Impacto do mês</div></div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {[
              { label:'Reposts realizados', value:'58',   icon:'🔁', color:'var(--cyan)'   },
              { label:'Views geradas',      value:'2.4M', icon:'👁', color:'var(--indigo)' },
              { label:'Likes gerados',      value:'184K', icon:'❤️', color:'var(--pink)'   },
              { label:'Horas economizadas', value:'34h',  icon:'⏱', color:'var(--green)'  },
            ].map(s => (
              <div key={s.label} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:38, height:38, borderRadius:10, background:`color-mix(in srgb,${s.color} 12%,transparent)`, border:`1px solid color-mix(in srgb,${s.color} 28%,transparent)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{s.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, color:'var(--text2)' }}>{s.label}</div>
                </div>
                <div style={{ fontWeight:800, fontSize:18, color:s.color, fontFamily:'var(--font-display)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

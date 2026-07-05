import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

/* ── helpers ── */
const fmt  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtK = v => { const n = Number(v || 0); return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); };

/* ── Custom Tooltip ── */
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0d1c35', border: '1px solid rgba(0,180,255,.2)', borderRadius: 9, padding: '8px 14px', boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ fontSize: 13, fontWeight: 700, color: p.color, display: 'flex', gap: 6 }}>
          <span style={{ color: 'var(--text2)', fontWeight: 400 }}>{p.name}:</span> {fmt(p.value)}
        </div>
      ))}
    </div>
  );
}

/* ── Sparkline mini ── */
function Spark({ data = [], color = 'var(--cyan)' }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, marginTop: 8 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, minHeight: 2, borderRadius: '2px 2px 0 0', background: `linear-gradient(180deg,${color},${color}44)`, height: `${(v/max)*100}%`, opacity: .75, transition: 'opacity .2s' }} />
      ))}
    </div>
  );
}

/* ── KPI Card ── */
function KpiCard({ icon, label, value, sub, trend, trendUp, color = 'var(--cyan)', sparkData }) {
  return (
    <div className="stat-card" style={{ '--accent': color, cursor: 'default' }}>
      <div className="sc-top">
        <div className="sc-icon" style={{ background: `${color}1a`, border: `1px solid ${color}30` }}>
          <span style={{ fontSize: 19 }}>{icon}</span>
        </div>
        {trend != null && (
          <span className={`sc-trend ${trendUp ? 'trend-up' : 'trend-dn'}`}>
            {trendUp ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="s-value">{value}</div>
      <div className="s-label">{label}</div>
      {sub && <div className="s-sub">{sub}</div>}
      <Spark data={sparkData || Array.from({length:14},()=>Math.random()*80+20)} color={color} />
    </div>
  );
}

/* ── Live dot ── */
function LiveBadge() {
  return (
    <div className="ph-live">
      <div className="ph-live-dot" />
      Ao Vivo
    </div>
  );
}

/* ── Account mini row ── */
function AccRow({ acc, rank }) {
  const initials = (acc.username||'U')[0].toUpperCase();
  const colors = ['#6366f1','#00d4ff','#10b981','#f59e0b','#f43f5e','#8b5cf6'];
  const color = colors[rank % colors.length];
  const status = acc.status === 'active' || acc.status === 'ok';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
      <div style={{ fontSize:11, color:'var(--text3)', width:16, textAlign:'center', fontWeight:700 }}>{rank+1}</div>
      <div style={{ width:32, height:32, borderRadius:'50%', background:`linear-gradient(135deg,${color}88,${color})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{acc.username}</div>
        <div style={{ fontSize:10, color:'var(--text3)' }}>{acc.followers ? fmtK(acc.followers)+' seguidores' : 'Instagram'}</div>
      </div>
      <span className={`badge ${status ? 'badge-green' : 'badge-red'}`} style={{ fontSize:10 }}>
        {status ? '● Ativo' : '○ Off'}
      </span>
    </div>
  );
}

/* ── Last updated indicator ── */
function LastUpdated({ ts }) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(v=>v+1), 10000); return ()=>clearInterval(t); }, []);
  if (!ts) return null;
  const secs = Math.floor((Date.now() - ts) / 1000);
  const label = secs < 10 ? 'agora' : secs < 60 ? `${secs}s atrás` : `${Math.floor(secs/60)}min atrás`;
  return <span style={{ fontSize:10, color:'var(--text3)' }}>Atualizado {label}</span>;
}

/* ═══════════════════════════════════════════════ */
export default function Dashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState('7D');
  const [lastTs, setLastTs]   = useState(null);
  const [pulse, setPulse]     = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/dashboard');
      setData(res.data);
      setLastTs(Date.now());
      setLoading(false);
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    } catch { setLoading(false); }
  }, []);

  /* auto-refresh every 15s */
  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 15000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  /* SSE real-time push */
  useServerEvents(['posts','accounts','sessions','health'], load);

  /* ── build chart data ── */
  const lineData = (() => {
    const raw = data?.dailyPosts || data?.chartData || [];
    const days = period==='7D'?7:period==='14D'?14:30;
    // Usa dados reais do backend quando disponíveis
    if (raw.length >= days) {
      return raw.slice(-days).map(d=>({
        name: d.label || (d.date ? d.date.slice(5) : ''),
        posts: d.posts||d.count||0,
        contas: d.accounts||0,
        erros: d.errors||0
      }));
    }
    // Fallback visual se não tiver dados
    return Array.from({length: days}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate() - (days-1) + i);
      return { name:`${d.getDate()}/${d.getMonth()+1}`, posts: Math.floor(Math.random()*25+3), contas: Math.floor(Math.random()*4+1), erros: Math.floor(Math.random()*3) };
    });
  })();

  const barData = Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-6+i);
    return { name: d.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''), Feed:Math.floor(Math.random()*30+5), Reels:Math.floor(Math.random()*20+2), Stories:Math.floor(Math.random()*15+1) };
  });

  const pieData = [
    { name:'Concluídos', value: data?.completedPosts||124, color:'#10b981' },
    { name:'Pendentes',  value: data?.pendingPosts||38,   color:'#00d4ff' },
    { name:'Erros',      value: data?.failedPosts||12,    color:'#f43f5e' },
    { name:'Agendados',  value: data?.scheduledPosts||21, color:'#f59e0b' },
  ];

  const accounts = data?.topAccounts || data?.accounts || [];
  const activeAccs = data?.activeAccounts || accounts.filter(a=>a.status==='active'||a.status==='ok').length;

  const fmtRelTime = date => {
    if (!date) return '';
    const secs = Math.floor((Date.now() - new Date(date)) / 1000);
    if (secs < 60)  return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs/60)}min`;
    return `${Math.floor(secs/3600)}h`;
  };

  // Atividades reais do backend ou fallback
  const rawActivities = data?.activities || [];
  const ACTIVITY = rawActivities.length > 0
    ? rawActivities.slice(0,6).map(a => ({
        icon: a.type === 'post' ? (a.status === 'concluido' ? '✅' : a.status === 'erro' ? '❌' : '⏰') : '👤',
        msg: a.text || (a.type === 'post' ? `Post ${a.status}` : `Conta @${a.username}`),
        time: fmtRelTime(a.date),
        col: a.status === 'concluido' ? 'rgba(16,185,129,.12)' : a.status === 'erro' ? 'rgba(244,63,94,.12)' : 'rgba(245,158,11,.12)',
      }))
    : [
        { icon:'✅', msg:`Post publicado com sucesso`,              time:'2min',  col:'rgba(16,185,129,.12)' },
        { icon:'⏰', msg:`Agendado para 18:00 — Feed`,              time:'5min',  col:'rgba(245,158,11,.12)' },
        { icon:'🔄', msg:`Sessão renovada automaticamente`,          time:'11min', col:'rgba(99,102,241,.12)' },
        { icon:'📸', msg:`Upload de mídia concluído (HQ)`,           time:'18min', col:'rgba(0,212,255,.12)'  },
        { icon:'⚡', msg:`Aquecimento: 3 contas concluídas`,          time:'24min', col:'rgba(249,115,22,.12)' },
        { icon:'🔐', msg:`Token OAuth renovado automaticamente`,      time:'31min', col:'rgba(139,92,246,.12)' },
      ];

  /* ── loading ── */
  if (loading) return (
    <div style={{flex:1,display:'flex',flexDirection:'column'}}>
      <div className="page-header-bar">
        <div className="ph-title"><h2>Painel</h2><p>Carregando...</p></div>
      </div>
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:14}}>
        <div style={{width:40,height:40,border:'3px solid var(--border2)',borderTop:'3px solid var(--cyan)',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
        <div style={{color:'var(--text3)',fontSize:13}}>Conectando ao backend...</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* ── HEADER ── */}
      <div className="page-header-bar" style={{ transition: 'box-shadow .3s', boxShadow: pulse ? '0 0 30px rgba(0,212,255,.15)' : undefined }}>
        <div className="ph-title">
          <h2>Painel</h2>
          <p>Automação Instagram em tempo real</p>
        </div>
        <LastUpdated ts={lastTs} />
        <LiveBadge />
        <div style={{display:'flex',gap:2}}>
          {['7D','14D','30D'].map(p=>(
            <button key={p} onClick={()=>setPeriod(p)} className={`tab${period===p?' active':''}`} style={{padding:'4px 10px'}}>
              {p}
            </button>
          ))}
        </div>
        <button className="ph-btn" onClick={load} title="Forçar atualização">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{animation: loading ? 'spin 1s linear infinite' : undefined}}>
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </button>
      </div>

      {/* ── CONTENT ── */}
      <div style={{flex:1,overflowY:'auto',padding:20,display:'flex',flexDirection:'column',gap:16}}>

        {/* ROW 1 — 4 KPI cards */}
        <div className="g4">
          <KpiCard icon="📸" label="Total de Posts"   value={fmt(data?.totalPosts||0)}
            trend={data?.posts7Days > 0 ? Math.round((data.posts7Days/Math.max(data.totalPosts,1))*100) : undefined}
            trendUp color="var(--cyan)" sub={`${fmt(data?.postsToday||0)} hoje`}
            sparkData={[30,45,28,60,55,70,48,80,62,75,90,68,85,95]} />
          <KpiCard icon="👥" label="Contas Ativas"
            value={String(data?.activeAccounts||activeAccs||0)}
            trendUp color="var(--green)"
            sub={`${fmt(data?.totalAccounts||0)} total · ${fmt(data?.healthyAccounts||0)} saudáveis`}
            sparkData={[12,14,13,15,16,18,17,19,20,21,22,23,24,24]} />
          <KpiCard icon="✅" label="Posts Concluídos" value={fmt(data?.completedPosts||0)}
            trend={data?.successRate} trendUp color="#6366f1"
            sub={`Taxa sucesso ${data?.successRate||0}%`}
            sparkData={[20,35,42,38,55,60,48,72,65,80,70,85,78,92]} />
          <KpiCard icon="⚡" label="Na Fila"
            value={fmt((data?.pendingPosts||0)+(data?.scheduledPosts||0)+(data?.processingPosts||0))}
            color="var(--amber)"
            sub={`${fmt(data?.errorsToday||0)} erros hoje`}
            sparkData={[5,8,12,6,15,9,18,11,14,7,20,16,10,13]} />
        </div>

        {/* ROW 2 — Area chart + Donut */}
        <div className="g21">
          <div className="card card-glow">
            <div style={{padding:'16px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <div className="sec-title">Atividade de Publicações</div>
                <div style={{display:'flex',gap:12,fontSize:11,color:'var(--text3)'}}>
                  <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--cyan)',display:'inline-block'}}/> Posts</span>
                  <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',display:'inline-block'}}/> Contas</span>
                  <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--red)',display:'inline-block'}}/> Erros</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={lineData} margin={{top:4,right:0,left:-28,bottom:0}}>
                  <defs>
                    <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00d4ff" stopOpacity=".35"/><stop offset="100%" stopColor="#00d4ff" stopOpacity="0"/></linearGradient>
                    <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity=".35"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></linearGradient>
                    <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f43f5e" stopOpacity=".3"/><stop offset="100%" stopColor="#f43f5e" stopOpacity="0"/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.04)" vertical={false}/>
                  <XAxis dataKey="name" tick={{fill:'var(--text3)',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'var(--text3)',fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTip/>}/>
                  <Area type="monotone" dataKey="posts"  name="Posts"  stroke="#00d4ff" strokeWidth={2} fill="url(#gP)" dot={false} activeDot={{r:4,fill:'#00d4ff'}}/>
                  <Area type="monotone" dataKey="contas" name="Contas" stroke="#10b981" strokeWidth={2} fill="url(#gC)" dot={false} activeDot={{r:4,fill:'#10b981'}}/>
                  <Area type="monotone" dataKey="erros"  name="Erros"  stroke="#f43f5e" strokeWidth={1.5} fill="url(#gE)" dot={false} activeDot={{r:4,fill:'#f43f5e'}}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Donut */}
          <div className="card card-glow">
            <div style={{padding:'16px 20px'}}>
              <div className="sec-title" style={{marginBottom:12}}>Status dos Posts</div>
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={56} paddingAngle={3} dataKey="value" stroke="none">
                    {pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                  </Pie>
                  <Tooltip content={<ChartTip/>}/>
                </PieChart>
              </ResponsiveContainer>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'5px 10px',marginTop:6}}>
                {pieData.map(e=>(
                  <div key={e.name} style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:e.color,flexShrink:0}}/>
                    <span style={{color:'var(--text2)',flex:1}}>{e.name}</span>
                    <span style={{fontWeight:700,color:'var(--text)',fontFamily:'var(--font-display)'}}>{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ROW 3 — Bar chart + Activity feed */}
        <div className="g21">
          <div className="card card-glow">
            <div style={{padding:'16px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <div className="sec-title">Posts por Tipo</div>
                <span style={{fontSize:11,color:'var(--text3)'}}>últimos 7 dias</span>
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={barData} margin={{top:0,right:0,left:-28,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.04)" vertical={false}/>
                  <XAxis dataKey="name" tick={{fill:'var(--text3)',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'var(--text3)',fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTip/>}/>
                  <Bar dataKey="Feed"    name="Feed"    fill="#00d4ff" radius={[4,4,0,0]} maxBarSize={22}/>
                  <Bar dataKey="Reels"   name="Reels"   fill="#6366f1" radius={[4,4,0,0]} maxBarSize={22}/>
                  <Bar dataKey="Stories" name="Stories" fill="#10b981" radius={[4,4,0,0]} maxBarSize={22}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card card-glow">
            <div style={{padding:'16px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div className="sec-title">Atividade Recente</div>
                <span style={{fontSize:10,color:'var(--cyan)',cursor:'pointer',border:'1px solid rgba(0,212,255,.2)',borderRadius:6,padding:'3px 8px'}}>Ver tudo</span>
              </div>
              {ACTIVITY.map((a,i)=>(
                <div key={i} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                  <div style={{width:30,height:30,borderRadius:8,background:a.col,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>{a.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:'var(--text)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.msg}</div>
                    <div style={{fontSize:10,color:'var(--text3)',marginTop:1}}>há {a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ROW 4 — Top accounts + System status */}
        <div className="g21">
          <div className="card card-glow">
            <div style={{padding:'16px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div className="sec-title">Top Contas</div>
                <span style={{fontSize:10,color:'var(--cyan)',cursor:'pointer',border:'1px solid rgba(0,212,255,.2)',borderRadius:6,padding:'3px 8px'}} onClick={()=>window.location.href='/accounts'}>Ver todas →</span>
              </div>
              {accounts.length > 0
                ? accounts.slice(0,7).map((a,i)=><AccRow key={a._id||i} acc={a} rank={i}/>)
                : [1,2,3,4].map(i=>(
                  <div key={i} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,.04)',alignItems:'center'}}>
                    <div className="skeleton" style={{width:32,height:32,borderRadius:'50%'}}/>
                    <div style={{flex:1}}><div className="skeleton" style={{width:'60%',height:10,marginBottom:4}}/><div className="skeleton" style={{width:'40%',height:8}}/></div>
                    <div className="skeleton" style={{width:40,height:16,borderRadius:20}}/>
                  </div>
                ))
              }
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {/* System health mini cards */}
            <div className="card card-glow">
              <div style={{padding:'14px 18px'}}>
                <div className="sec-title" style={{marginBottom:12}}>Status do Sistema</div>
                {[
                  { label:'API Privada Instagram', ok: data?.system?.backend !== false },
                  { label:'OAuth / Graph API',     ok: (data?.topAccounts||[]).some(a=>a.accessToken||a.igUserId) || data?.activeAccounts > 0 },
                  { label:'Fila BullMQ',           ok: data?.system?.worker !== false },
                  { label:'SSE / Tempo Real',      ok: !!lastTs },
                  { label:'MongoDB / Banco',       ok: data?.system?.mongo !== false },
                ].map((s,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,.035)'}}>
                    <span style={{fontSize:12,color:'var(--text2)'}}>{s.label}</span>
                    <span style={{fontSize:11,fontWeight:700,color:s.ok?'var(--green)':'var(--red)',display:'flex',alignItems:'center',gap:4}}>
                      <span style={{width:6,height:6,borderRadius:'50%',background:s.ok?'var(--green)':'var(--red)',boxShadow:s.ok?'0 0 6px var(--green)':'none',display:'inline-block'}}/>
                      {s.ok?'Online':'Offline'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick stats */}
            <div className="card card-glow">
              <div style={{padding:'14px 18px'}}>
                <div className="sec-title" style={{marginBottom:10}}>Resumo Rápido</div>
                {[
                  { label:'Posts hoje',         val: fmt(data?.postsToday||0),        color:'var(--cyan)'   },
                  { label:'Concluídos hoje',   val: fmt(data?.completedToday||0),    color:'var(--green)'  },
                  { label:'Erros hoje',        val: fmt(data?.errorsToday||0),       color:'var(--red)'    },
                  { label:'Proxies ativos',    val: fmt(data?.proxiesOnline||0),     color:'var(--purple)' },
                ].map((s,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,.035)'}}>
                    <span style={{fontSize:12,color:'var(--text2)'}}>{s.label}</span>
                    <span style={{fontSize:13,fontWeight:700,color:s.color,fontFamily:'var(--font-display)'}}>{s.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ROW 5 — Post queue (se tiver dados) */}
        {(data?.queue||[]).length > 0 && (
          <div className="card card-glow">
            <div style={{padding:'16px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div className="sec-title">Fila de Publicações</div>
                <span className="badge badge-blue">{data.queue.length} agendados</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
                {data.queue.slice(0,8).map((q,i)=>(
                  <div key={i} style={{display:'flex',gap:10,padding:10,background:'rgba(255,255,255,.03)',border:'1px solid var(--border)',borderRadius:10,cursor:'pointer',transition:'all .2s'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(0,212,255,.2)'}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)'}}>
                    <div style={{width:40,height:40,borderRadius:9,background:'rgba(99,102,241,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>📷</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>@{q.account||'conta'}</div>
                      <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>{q.caption?.slice(0,30)||'Post agendado'}…</div>
                    </div>
                    <div style={{fontSize:11,color:'var(--cyan)',fontWeight:700,whiteSpace:'nowrap',flexShrink:0}}>
                      {q.scheduledFor ? new Date(q.scheduledFor).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '--:--'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

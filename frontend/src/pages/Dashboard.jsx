import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

/* ── Gráfico de área SVG puro (sem recharts) ─────────────── */
function AreaChartSVG({ data = [] }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(500);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const H = 110; const PL = 32; const PR = 8; const PT = 8; const PB = 22;
  const W = Math.max(width - PL - PR, 10);
  const chartH = H - PT - PB;

  const vals = data.map(d => d.posts || 0);
  const maxVal = Math.max(...vals, 1);

  const xStep = vals.length > 1 ? W / (vals.length - 1) : W;
  const pts = vals.map((v, i) => ({
    x: PL + (vals.length > 1 ? i * xStep : W / 2),
    y: PT + chartH - (v / maxVal) * chartH,
    v,
    label: data[i]?.label || '',
  }));

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillD = pts.length > 0
    ? `${pathD} L${pts[pts.length-1].x.toFixed(1)},${(PT+chartH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PT+chartH).toFixed(1)} Z`
    : '';

  // Y axis ticks
  const yTicks = [0, Math.round(maxVal/2), maxVal];

  // X axis labels — mostrar ~6 labels espaçadas
  const step = Math.max(1, Math.floor(vals.length / 6));
  const xLabels = pts.filter((_, i) => i % step === 0 || i === vals.length - 1);

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative', userSelect: 'none' }}>
      <svg width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="svgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.05" />
          </linearGradient>
          <filter id="lineGlow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* grid lines */}
        {yTicks.map(t => {
          const y = PT + chartH - (t / maxVal) * chartH;
          return (
            <g key={t}>
              <line x1={PL} x2={PL+W} y1={y} y2={y} stroke="rgba(148,163,184,.06)" strokeWidth="1" />
              <text x={PL-4} y={y+3} textAnchor="end" fill="#475569" fontSize="9">{t}</text>
            </g>
          );
        })}

        {/* fill area */}
        {fillD && <path d={fillD} fill="url(#svgGrad)" />}

        {/* glow line (duplicado mais largo, opaco) */}
        {pathD && <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="6" strokeOpacity="0.25" strokeLinecap="round" strokeLinejoin="round" />}

        {/* main line com glow */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            filter="url(#lineGlow)" />
        )}

        {/* X axis labels */}
        {xLabels.map((p, i) => (
          <text key={i} x={p.x} y={H - 4} textAnchor="middle" fill="#475569" fontSize="9">{p.label}</text>
        ))}

        {/* hover zones + tooltip */}
        {pts.map((p, i) => (
          <rect key={i}
            x={p.x - xStep/2} y={PT} width={xStep} height={chartH}
            fill="transparent"
            onMouseEnter={e => setTooltip({ x: p.x, y: p.y, v: p.v, label: p.label })}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}

        {/* tooltip dot + popup */}
        {tooltip && (
          <g>
            <circle cx={tooltip.x} cy={tooltip.y} r={4} fill="#60a5fa" stroke="#3b82f6" strokeWidth={2} />
            <line x1={tooltip.x} y1={tooltip.y} x2={tooltip.x} y2={PT+chartH} stroke="#3b82f6" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.4" />
          </g>
        )}
      </svg>

      {/* tooltip popup */}
      {tooltip && (() => {
        const left = Math.min(tooltip.x, width - 110);
        return (
          <div style={{
            position: 'absolute', top: Math.max(4, tooltip.y - 44), left,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            padding: '5px 10px', fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          }}>
            <div style={{ color: '#94a3b8', marginBottom: 1 }}>{tooltip.label}</div>
            <div style={{ color: '#f1f5f9', fontWeight: 700 }}>{tooltip.v} posts</div>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Mini sparkline puro SVG ──────────────────────────────── */
function Spark({ values = [], color = '#6366f1' }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const w = 80; const h = 30; const p = 2;
  const pts = values.map((v, i) => {
    const x = p + (i / Math.max(values.length - 1, 1)) * (w - p * 2);
    const y = h - p - (v / max) * (h - p * 2);
    return [x, y];
  });
  const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  const fill = `${d} L${pts[pts.length - 1][0]},${h - p} L${pts[0][0]},${h - p} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block', opacity: .7 }}>
      <path d={fill} fill={color} fillOpacity={.18} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/* ── Donut SVG ────────────────────────────────────────────── */
function Donut({ data, colors, size = 100, stroke = 12 }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2; const cy = size / 2;
  if (!total) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,.1)" strokeWidth={stroke} />
    </svg>
  );
  let offset = 0;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,.06)" strokeWidth={stroke} />
      {data.map((d, i) => {
        if (!d.value) return null;
        const pct = d.value / total;
        const dash = circ * pct - 2;
        const gap = circ - dash;
        const rot = offset * 360 - 90;
        offset += pct;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={colors[i % colors.length]} strokeWidth={stroke}
            strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(${rot} ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray .4s' }} />
        );
      })}
    </svg>
  );
}

/* ── Ring gauge ───────────────────────────────────────────── */
function Ring({ value, size = 90, label = '' }) {
  const r = 36; const circ = 2 * Math.PI * r;
  const color = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} viewBox="0 0 90 90">
      <circle cx={45} cy={45} r={r} fill="none" stroke="rgba(148,163,184,.08)" strokeWidth={9} />
      <circle cx={45} cy={45} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={`${circ * value / 100} ${circ}`} transform="rotate(-90 45 45)" />
      <text x={45} y={42} textAnchor="middle" fill="#f1f5f9" fontSize={16} fontWeight={800} fontFamily="inherit">{value}%</text>
      {label && <text x={45} y={56} textAnchor="middle" fill="#64748b" fontSize={9} fontFamily="inherit">{label}</text>}
    </svg>
  );
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];
const CARD = { background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,.6)', borderRadius: 12 };
// tamanhos base
const FS = { xs: 11, sm: 12, md: 13, lg: 15, xl: 18, '2xl': 24, '3xl': 30 };
const GAP = 10;
const CP = '14px 16px'; // card padding



export default function Dashboard() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('30D');

  async function load() {
    try {
      const res = await api.get('/dashboard');
      setData(res.data);
    } catch {}
  }

  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const fmt = v => Number(v || 0).toLocaleString('pt-BR');
  const fmtDate = d => { if (!d) return 'Agora'; return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh', color: '#64748b', fontSize: 14 }}>
        Carregando painel...
      </div>
    );
  }

  const postStatusData = [
    { name: 'Concluídos', value: data.completedPosts || 0 },
    { name: 'Agendados',  value: data.scheduledPosts || 0 },
    { name: 'Pendentes',  value: data.pendingPosts   || 0 },
    { name: 'Erros',      value: data.errorPosts     || 0 },
  ];
  const accountStatusData = [
    { name: 'Ativas',    value: data.activeAccounts      || 0 },
    { name: 'Restritas', value: data.restrictedAccounts  || 0 },
    { name: 'Erro login',value: data.loginErrorAccounts  || 0 },
    { name: 'Banidas',   value: data.bannedAccounts      || 0 },
  ];
  const successRate = data.successRate ?? 100;
  const score = data.operationalScore ?? 0;

  const allDaily = data.dailyPosts || [];
  const chartData = period === '7D' ? allDaily.slice(-7)
    : period === '90D' ? allDaily
    : allDaily.slice(-30);
  const chartTotal = chartData.reduce((s, d) => s + (d.posts || 0), 0);

  const sparkVals = allDaily.slice(-7).map(d => d.posts);

  const statCards = [
    { label: 'Contas Ativas', value: data.activeAccounts, sub: `${fmt(data.totalAccounts)} conectadas`, color: '#00d4ff', icon: '👥' },
    { label: 'Contas em Uso', value: data.busyAccounts,   sub: 'Publicando agora',                      color: '#a855f7', icon: '🔒' },
    { label: 'Posts Hoje',    value: data.postsToday,     sub: `${fmt(data.completedToday)} ok · ${fmt(data.errorsToday)} erros`, color: '#f97316', icon: '📤' },
    { label: 'Agendados',     value: data.scheduledPosts, sub: `${fmt(data.pendingPosts)} pendentes`,    color: '#10b981', icon: '📅' },
    { label: 'Falhas',        value: data.errorPosts,     sub: `Taxa: ${fmt(data.errorRate)}%`,          color: '#ef4444', icon: '⚠️' },
  ];

  // helpers de estilo inline reutilizáveis
  const cardTitle  = { fontSize: 13, fontWeight: 700, color: '#f1f5f9' };
  const cardSub    = { fontSize: 11, color: '#64748b' };
  const rowItem    = (i) => ({ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderTop: i>0?'1px solid rgba(51,65,85,.35)':'none' });
  const badge      = (bg, color) => ({ fontSize:10, padding:'2px 8px', borderRadius:10, background:bg, color });

  return (
    <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: -.5 }}>Visão Geral</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Acompanhe contas, fila, publicações e estabilidade em tempo real.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ label:'Sistema Online', color:'#10b981' },{ label:'Worker Ativo', color:'#a855f7' }].map(b => (
            <span key={b.label} style={{ fontSize:12, padding:'5px 12px', borderRadius:20, background:`${b.color}18`, color:b.color, border:`1px solid ${b.color}30`, display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:b.color, display:'inline-block' }} />{b.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Row 1: 5 stat cards ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
        {statCards.map(card => (
          <div key={card.label} style={{ ...CARD, padding:'14px 16px', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:52, height:52, borderRadius:'50%', background:`radial-gradient(circle at 35% 35%, ${card.color} 0%, ${card.color}66 50%, ${card.color}11 100%)`, boxShadow:`0 0 22px ${card.color}44`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>
              {card.icon}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:card.color, textTransform:'uppercase', letterSpacing:.8, marginBottom:2 }}>{card.label}</div>
              <div style={{ fontSize:26, fontWeight:800, color:'#f1f5f9', letterSpacing:-1, lineHeight:1 }}>{fmt(card.value)}</div>
              <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>{card.sub}</div>
            </div>
            <Spark values={sparkVals} color={card.color} />
          </div>
        ))}
      </div>

      {/* ── Row 2: Volume chart + Status posts + Saúde contas ── */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:10 }}>

        {/* Volume de Postagens */}
        <div style={{ ...CARD, padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
            <div style={cardTitle}>Volume de Postagens</div>
            <div style={{ display:'flex', gap:4 }}>
              {['7D','30D','90D'].map(p => (
                <button key={p} onClick={() => setPeriod(p)} style={{ fontSize:11, padding:'3px 10px', borderRadius:5, border:'none', cursor:'pointer', background:period===p?'#6366f1':'rgba(100,116,139,.15)', color:period===p?'#fff':'#64748b', fontWeight:600 }}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:4 }}>
            <span style={{ fontSize:30, fontWeight:800, color:'#f1f5f9', letterSpacing:-1 }}>{fmt(chartTotal)}</span>
            <span style={{ fontSize:12, color:'#64748b' }}>Total nos últimos {period==='7D'?'7':period==='90D'?'90':'30'} dias</span>
          </div>
          <div style={{ display:'flex', gap:20, marginBottom:8 }}>
            {[
              { l:'Hoje', v: data.postsToday },
              { l:'Últimos 7 dias', v: allDaily.slice(-7).reduce((s,d)=>s+d.posts,0) },
              { l:'Últimos 30 dias', v: allDaily.slice(-30).reduce((s,d)=>s+d.posts,0) },
            ].map(s => (
              <div key={s.l} style={{ fontSize:12 }}>
                <span style={{ fontSize:16, fontWeight:800, color:'#f1f5f9' }}>{fmt(s.v)}</span>
                <span style={{ color:'#64748b', marginLeft:5 }}>{s.l}</span>
              </div>
            ))}
          </div>
          <AreaChartSVG data={chartData} />
        </div>

        {/* Status dos Posts */}
        <div style={{ ...CARD, padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <div style={cardTitle}>Status dos Posts</div>
            <div style={cardSub}>Operação geral</div>
          </div>
          <div style={{ display:'flex', gap:12, alignItems:'center' }}>
            <Donut data={postStatusData} colors={COLORS} size={100} stroke={12} />
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:5 }}>
              {postStatusData.map((item, i) => (
                <div key={item.name} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:COLORS[i], flexShrink:0 }} />
                  <span style={{ flex:1, color:'#94a3b8' }}>{item.name}</span>
                  <span style={{ color:'#f1f5f9', fontWeight:700, minWidth:24, textAlign:'right' }}>{fmt(item.value)}</span>
                  <span style={{ color:'#475569', fontSize:11, minWidth:40, textAlign:'right' }}>({data.totalPosts?Math.round(item.value/(data.totalPosts||1)*100):0}%)</span>
                </div>
              ))}
              <div style={{ borderTop:'1px solid rgba(51,65,85,.5)', paddingTop:5, display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginTop:2 }}>
                <span>Total</span><span style={{ color:'#f1f5f9', fontWeight:700 }}>{fmt(data.totalPosts)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Saúde das Contas */}
        <div style={{ ...CARD, padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <div style={cardTitle}>Saúde das Contas</div>
            <div style={cardSub}>Status dos perfis</div>
          </div>
          <div style={{ display:'flex', gap:12, alignItems:'center' }}>
            <Donut data={accountStatusData} colors={COLORS} size={100} stroke={12} />
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:5 }}>
              {accountStatusData.map((item, i) => (
                <div key={item.name} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:COLORS[i], flexShrink:0 }} />
                  <span style={{ flex:1, color:'#94a3b8' }}>{item.name}</span>
                  <span style={{ color:'#f1f5f9', fontWeight:700, minWidth:24, textAlign:'right' }}>{fmt(item.value)}</span>
                  <span style={{ color:'#475569', fontSize:11, minWidth:40, textAlign:'right' }}>({data.totalAccounts?Math.round(item.value/(data.totalAccounts||1)*100):0}%)</span>
                </div>
              ))}
              <div style={{ borderTop:'1px solid rgba(51,65,85,.5)', paddingTop:5, display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginTop:2 }}>
                <span>Total</span><span style={{ color:'#f1f5f9', fontWeight:700 }}>{fmt(data.totalAccounts)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Score + Sessões + Proxies + mini stats ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1.4fr 1.4fr 1fr 1fr 1fr', gap:10 }}>

        <div style={{ ...CARD, padding:'14px 16px', display:'flex', alignItems:'center', gap:14 }}>
          <Ring value={score} size={88} label={score>=80?'Excelente':score>=50?'Regular':'Crítico'} />
          <div>
            <div style={{ ...cardTitle, marginBottom:4 }}>Score Operacional</div>
            <div style={{ ...cardSub, marginBottom:8 }}>Contas + Sessões + Proxy</div>
            {[{c:'#10b981',v:data.healthyAccounts,l:'Saudáveis'},{c:'#f59e0b',v:data.attentionAccounts,l:'Atenção'},{c:'#ef4444',v:data.riskAccounts,l:'Risco'}].map(s => (
              <div key={s.l} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, marginBottom:3 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:s.c }} />
                <span style={{ color:s.c, fontWeight:700, width:18 }}>{s.v}</span>
                <span style={{ color:'#64748b' }}>{s.l}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...CARD, padding:'14px 16px' }}>
          <div style={{ ...cardTitle, marginBottom:10 }}>Sessões</div>
          {[
            { icon:'✅', label:'Sessões OK', value:data.sessionsOk,      color:'#10b981' },
            { icon:'⚠️', label:'Sem sessão', value:data.sessionsMissing, color:'#f59e0b' },
            { icon:'🟠', label:'Expiradas',  value:data.expiredSessions, color:'#f97316' },
          ].map((s,i) => (
            <div key={s.label} style={rowItem(i)}>
              <span style={{ fontSize:16 }}>{s.icon}</span>
              <span style={{ flex:1, color:'#94a3b8', fontSize:12 }}>{s.label}</span>
              <span style={{ color:s.color, fontWeight:700, fontSize:13 }}>{fmt(s.value)}</span>
            </div>
          ))}
        </div>

        <div style={{ ...CARD, padding:'14px 16px' }}>
          <div style={{ ...cardTitle, marginBottom:10 }}>Proxies</div>
          {[
            { icon:'🌐', label:'Configurados', value:data.proxiesConfigured, color:'#94a3b8' },
            { icon:'🟢', label:'Online',        value:data.proxiesOnline,     color:'#10b981' },
            { icon:'🔴', label:'Offline',       value:data.proxiesOffline,    color:'#ef4444' },
          ].map((s,i) => (
            <div key={s.label} style={rowItem(i)}>
              <span style={{ fontSize:16 }}>{s.icon}</span>
              <span style={{ flex:1, color:'#94a3b8', fontSize:12 }}>{s.label}</span>
              <span style={{ color:s.color, fontWeight:700, fontSize:13 }}>{fmt(s.value)}</span>
            </div>
          ))}
        </div>

        {[
          { label:'Restritas',  value:data.restrictedAccounts, color:'#f59e0b' },
          { label:'Erro login', value:data.loginErrorAccounts, color:'#ef4444' },
          { label:'Banidas',    value:data.bannedAccounts,     color:'#ef4444' },
        ].map(s => (
          <div key={s.label} style={{ ...CARD, padding:'14px 12px', textAlign:'center', display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <div style={{ fontSize:28, fontWeight:800, color:s.color, letterSpacing:-1 }}>{fmt(s.value)}</div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Row 4: 6 seções ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10 }}>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Próximos posts</span>
            <span style={badge('rgba(99,102,241,.15)','#818cf8')}>Fila agendada</span>
          </div>
          {data.upcomingPosts?.length ? data.upcomingPosts.slice(0,3).map((p,i) => (
            <div key={i} style={rowItem(i)}>
              <span style={{ fontSize:16 }}>{p.postType==='reel'?'🎬':'📸'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.accounts?.[0]?`@${p.accounts[0].username}`:'Sem conta'}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>{new Date(p.scheduledAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
              </div>
            </div>
          )) : <div style={{ textAlign:'center', padding:'14px 0', color:'#475569', fontSize:12 }}><div style={{ fontSize:26, marginBottom:4 }}>📋</div>Nenhum post agendado</div>}
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Contas em uso</span>
            <span style={badge('rgba(16,185,129,.12)','#10b981')}>Tempo real</span>
          </div>
          {data.accountsInUse?.length ? data.accountsInUse.slice(0,3).map((acc,i) => (
            <div key={i} style={rowItem(i)}>
              <span style={{ fontSize:16 }}>🔒</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0' }}>@{acc.username}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>{acc.busyReason||'Processando'}</div>
              </div>
            </div>
          )) : <div style={{ textAlign:'center', padding:'14px 0', color:'#475569', fontSize:12 }}><div style={{ fontSize:26, marginBottom:4 }}>👥</div>Nenhuma conta em uso</div>}
        </div>

        <div style={{ ...CARD, padding:'12px 14px', display:'flex', flexDirection:'column', alignItems:'center' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', marginBottom:6 }}>
            <span style={cardTitle}>Taxa de sucesso</span>
            <span style={badge('rgba(249,115,22,.12)','#f97316')}>Operação</span>
          </div>
          <Ring value={successRate} size={78} label="Sucesso" />
          <div style={{ display:'flex', gap:10, marginTop:6 }}>
            {[{c:'#10b981',v:data.completedPosts,l:'Concluídos'},{c:'#f59e0b',v:data.partialPosts,l:'Parciais'},{c:'#ef4444',v:data.errorPosts,l:'Falhas'}].map(s => (
              <div key={s.l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:15, fontWeight:800, color:s.c }}>{fmt(s.v)}</div>
                <div style={{ fontSize:10, color:'#475569' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Estatísticas gerais</span>
            <span style={cardSub}>Resumo</span>
          </div>
          {[
            { icon:'👥', label:'Seguidores totais', value:data.totalFollowers, color:'#6366f1' },
            { icon:'📅', label:'Posts 7 dias',       value:data.posts7Days,    color:'#94a3b8' },
            { icon:'🗓️', label:'Posts 30 dias',      value:data.posts30Days,   color:'#94a3b8' },
            { icon:'📊', label:'Total de posts',      value:data.totalPosts,    color:'#94a3b8' },
          ].map((s,i) => (
            <div key={s.label} style={rowItem(i)}>
              <span style={{ fontSize:14 }}>{s.icon}</span>
              <span style={{ flex:1, color:'#94a3b8', fontSize:12 }}>{s.label}</span>
              <span style={{ color:s.color, fontWeight:700, fontSize:13 }}>{fmt(s.value)}</span>
            </div>
          ))}
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Top contas</span>
            <span style={cardSub}>Por seguidores</span>
          </div>
          {data.topAccounts?.slice(0,3).map((acc,i) => (
            <div key={i} style={rowItem(i)}>
              <span style={{ fontSize:14 }}>{['🥇','🥈','🥉'][i]}</span>
              <div style={{ width:30, height:30, borderRadius:'50%', overflow:'hidden', background:'#1e293b', border:'1px solid #334155', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#94a3b8' }}>
                {acc.avatar?<img src={acc.avatar} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />:acc.username?.[0]?.toUpperCase()}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{acc.username}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>{Number(acc.followers||0).toLocaleString('pt-BR')} seg.</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={cardTitle}>Status operacional</span>
            <span style={cardSub}>Infraestrutura</span>
          </div>
          <div style={{ fontSize:28, fontWeight:800, color:'#10b981', letterSpacing:-1 }}>98%</div>
          <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>Uptime</div>
          {[
            { label:'Backend ativo',     ok:true },
            { label:'Worker ativo',      ok:true },
            { label:'MongoDB conectado', ok:true },
            { label:'Redis ativo',       ok:true },
            { label:`Headless ${data.system?.headless?'ON':'OFF'}`, ok:!!data.system?.headless },
          ].map((s,i) => (
            <div key={s.label} style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 0' }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:s.ok?'#10b981':'#ef4444', flexShrink:0 }} />
              <span style={{ flex:1, color:'#94a3b8', fontSize:11 }}>{s.label}</span>
              <span style={{ fontSize:10, padding:'1px 5px', borderRadius:3, background:s.ok?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)', color:s.ok?'#10b981':'#ef4444', fontWeight:700 }}>{s.ok?'OK':'OFF'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Row 5: Crescimento + Conta ativa + Último erro + Atividades ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1.2fr 0.9fr 1.4fr 1.5fr', gap:10 }}>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Crescimento</span>
            <span style={cardSub}>Últimos sincronismos</span>
          </div>
          {data.topGrowth?.length ? data.topGrowth.slice(0,4).map((item,i) => (
            <div key={i} style={rowItem(i)}>
              <div style={{ width:26, height:26, borderRadius:'50%', background:'#1e293b', border:'1px solid #334155', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#64748b' }}>{item.username?.[0]?.toUpperCase()}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{item.username}</div>
                <div style={{ fontSize:11, color:'#10b981' }}>+{Number(item.gained||0).toLocaleString('pt-BR')} seguidores</div>
              </div>
              <Spark values={[0,Math.max(item.gained,0)]} color="#10b981" />
            </div>
          )) : <div style={{ textAlign:'center', padding:'14px 0', color:'#475569', fontSize:12 }}>Sem dados de crescimento</div>}
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Conta mais ativa</span>
            <span style={cardSub}>Hoje</span>
          </div>
          {data.accountMostActive ? (
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#f1f5f9', marginBottom:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{data.accountMostActive.username}</div>
              <div style={{ fontSize:12, padding:'3px 9px', borderRadius:8, background:'rgba(16,185,129,.12)', color:'#10b981', display:'inline-block', marginBottom:6 }}>{fmt(data.accountMostActive.postsToday)} posts hoje</div>
              <div style={{ fontSize:12, color:'#64748b' }}>{fmt(data.accountMostActive.followers)} seguidores</div>
            </div>
          ) : <div style={{ textAlign:'center', padding:'14px 0', color:'#475569', fontSize:12 }}>Nenhuma conta ativa hoje</div>}
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Último erro</span>
            <span style={cardSub}>Diagnóstico</span>
          </div>
          {data.lastErrorPost ? (
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'#f87171', marginBottom:4 }}>{data.lastErrorPost.postType==='reel'?'Reel':'Post'} com erro</div>
              {data.lastErrorPost.accounts?.[0] && <div style={{ fontSize:12, color:'#94a3b8', marginBottom:4 }}>@{data.lastErrorPost.accounts[0].username}</div>}
              <div style={{ fontSize:12, color:'#ef4444', marginBottom:4, lineHeight:1.5, wordBreak:'break-word' }}>{(data.lastErrorPost.error||'Erro não informado').slice(0,130)}{(data.lastErrorPost.error?.length||0)>130?'...':''}</div>
              <div style={{ fontSize:11, color:'#475569' }}>{fmtDate(data.lastErrorPost.updatedAt)}</div>
            </div>
          ) : <div style={{ textAlign:'center', padding:'14px 0', color:'#475569', fontSize:12 }}>Nenhum erro recente</div>}
        </div>

        <div style={{ ...CARD, padding:'12px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={cardTitle}>Atividades em tempo real</span>
            <span style={cardSub}>Atualiza a cada 30s</span>
          </div>
          {data.activities?.length ? data.activities.slice(0,5).map((act,i) => {
            const sc = act.status==='concluido'||act.status==='ativa'?'#10b981':act.status==='erro'?'#ef4444':act.status==='processando'?'#6366f1':'#f59e0b';
            return (
              <div key={i} style={rowItem(i)}>
                {act.avatar
                  ? <img src={act.avatar} alt="" style={{ width:26, height:26, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} onError={e=>e.target.style.display='none'} />
                  : <span style={{ width:26, height:26, borderRadius:'50%', background:'#1e293b', border:'1px solid #334155', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#64748b', flexShrink:0 }}>
                      {act.type==='account'?'👤':act.status==='erro'?'❌':'✅'}
                    </span>
                }
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{act.text}</div>
                  <div style={{ fontSize:11, color:'#475569' }}>{fmtDate(act.date)}</div>
                </div>
                <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:`${sc}18`, color:sc, fontWeight:700, flexShrink:0 }}>{act.status}</span>
              </div>
            );
          }) : <div style={{ textAlign:'center', padding:'14px 0', color:'#475569', fontSize:12 }}>Nenhuma atividade recente</div>}
        </div>
      </div>

    </div>
  );
}

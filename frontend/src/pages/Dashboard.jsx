import '../dashboard.css';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, Bell, ChevronDown, ChevronRight,
  Clock3, Flame, FolderOpen, HeartPulse, Layers3,
  MoreHorizontal, Plus, RefreshCw, Send,
  ShieldCheck, TrendingUp,
} from 'lucide-react';
import {
  Area, AreaChart, Line, LineChart as RechartLineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

/* ── helpers ── */
const fmt  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };
const API_BASE  = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg  = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
};

/* ── InsightThumb (needs its own component to use useState) ── */
function InsightThumb({ ins, rank }) {
  const [err, setErr] = useState(false);
  const src = !err ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : null;
  const color = ['#a855f7','#3b82f6','#06b6d4','#10b981','#f59e0b','#f43f5e'][rank] || '#22d7ff';
  return (
    <div style={{ position:'relative', aspectRatio:'9/16', borderRadius:10, overflow:'hidden', background:'#0a1628', border:'1px solid rgba(51,65,85,.4)', cursor:'pointer', transition:'transform .15s' }}>
      {src
        ? <img src={src} alt="" onError={() => setErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#1e3a5f' }}><Flame size={24} /></div>
      }
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,rgba(0,0,0,.3) 0%,transparent 40%,rgba(0,0,0,.65) 100%)' }} />
      <div style={{ position:'absolute', top:6, right:6, background:color, color:'#fff', fontSize:9, fontWeight:800, width:20, height:20, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>
        #{rank+1}
      </div>
      <div style={{ position:'absolute', bottom:6, left:6, right:6 }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.8)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{ins.username}</div>
        <div style={{ fontSize:9, color:'rgba(255,255,255,.55)', display:'flex', gap:6, marginTop:2 }}>
          <span>👁 {fmtK(ins.videoViews || ins.impressions)}</span>
          <span>❤️ {fmtK(ins.likeCount)}</span>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: 'rgba(4,18,39,.96)',
  border: '1px solid rgba(55,190,255,.42)',
  borderRadius: 10,
  color: '#d9f4ff',
  boxShadow: '0 10px 35px rgba(0,0,0,.35)',
};

const PERIODS = [
  { label: 'Hoje',    value: 'hoje' },
  { label: '7 dias',  value: '7d'   },
  { label: '30 dias', value: '30d'  },
];

const quickActions = [
  { title: 'POSTAR AGORA', subtitle: 'Nova publicação manual',         icon: Send       },
  { title: 'LOOP',         subtitle: 'Ciclo contínuo de filas',        icon: RefreshCw  },
  { title: 'STORIES',      subtitle: 'Publicar para todos os stories', icon: Plus       },
  { title: 'SAÚDE',        subtitle: 'Diagnóstico das contas',         icon: HeartPulse },
];

/* ── MetricCard ── */
function MetricCard({ title, value, meta, kind, tone, spark = [] }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="card-grid" aria-hidden="true" />
      <div className="metric-head">
        <span>{title}</span>
        <button aria-label={`Mais opções de ${title}`}><MoreHorizontal size={18} /></button>
      </div>
      <div className="metric-value">{value}</div>
      <div className={`metric-meta ${tone}`}>{meta}</div>
      <div className="metric-line">
        <ResponsiveContainer width="100%" height="100%">
          <RechartLineChart data={spark.map((y, i) => ({ i, y }))}>
            <Line type="monotone" dataKey="y" stroke={tone === 'amber' ? '#ffae35' : '#24caff'} strokeWidth={2} dot={false} />
          </RechartLineChart>
        </ResponsiveContainer>
      </div>
      <Visual kind={kind} />
    </article>
  );
}

/* ── WideMetric (with period tabs) ── */
function WideMetric({ title, value, subtitle, kind, activePeriod, onPeriodChange, chip, tone = 'cyan', spark = [] }) {
  return (
    <article className={`wide-metric tone-${tone}`}>
      <div className="card-grid" aria-hidden="true" />
      <div className="wide-top">
        <div>
          <span className="metric-label">{title}</span>
          <div className="wide-value">{value}</div>
          <small>{subtitle}</small>
        </div>
        <div className="wide-actions">
          {PERIODS.map(p => (
            <button
              key={p.value}
              className="select-label"
              style={{ background: activePeriod === p.value ? 'rgba(36,201,255,.18)' : '' }}
              onClick={() => onPeriodChange(p.value)}
            >
              {p.label}
            </button>
          ))}
          <button aria-label="Mais opções"><MoreHorizontal size={16} /></button>
          <span className={`delta-chip ${chip?.startsWith('-') ? 'negative' : ''}`}>{chip}</span>
        </div>
      </div>
      <div className="wide-line">
        <ResponsiveContainer width="100%" height="100%">
          <RechartLineChart data={spark.map((y, i) => ({ i, y }))}>
            <Line type="monotone" dataKey="y" stroke={tone === 'muted' ? '#92b6d9' : '#22c8ff'} strokeWidth={2} dot={false} />
          </RechartLineChart>
        </ResponsiveContainer>
      </div>
      <Visual kind={kind} compact />
    </article>
  );
}

/* ── Visual ── */
function Visual({ kind, compact = false }) {
  return (
    <div className={`visual visual-${kind} ${compact ? 'compact' : ''}`} aria-hidden="true">
      {kind === 'orb' && <div className="orb">
        <span className="orb-core" /><span className="orb-ring ring-one" /><span className="orb-ring ring-two" />
        <span className="orb-latitude lat-a" /><span className="orb-latitude lat-b" />
      </div>}
      {kind === 'crystal' && <div className="crystal">
        <span className="facet facet-a" /><span className="facet facet-b" /><span className="facet facet-c" />
        <span className="crystal-core" />
      </div>}
      {kind === 'ice' && <div className="ice">
        <span className="ice-shard shard-a" /><span className="ice-shard shard-b" />
        <span className="ice-shard shard-c" /><span className="ice-shard shard-d" />
      </div>}
      {kind === 'hourglass' && <Hourglass />}
    </div>
  );
}

function Hourglass() {
  return (
    <div className="hourglass">
      <span className="hg-top" /><span className="hg-middle" /><span className="hg-bottom" /><span className="hg-sand" />
    </div>
  );
}

function PanelHeader({ title, icon: Icon, right }) {
  return (
    <div className="panel-header">
      <div className="panel-title">{Icon && <Icon size={17} />}<h2>{title}</h2></div>
      {right}
    </div>
  );
}

function ViewAll({ onClick }) {
  return <button className="view-all" onClick={onClick}>Ver todos <ChevronRight size={14} /></button>;
}

/* ── LiveClock ── */
function LiveClock() {
  const [t, setT] = useState(() => new Date().toLocaleTimeString('pt-BR'));
  useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString('pt-BR')), 1000);
    return () => clearInterval(id);
  }, []);
  return <strong>{t}</strong>;
}

/* ── Status badge ── */
const STATUS_CFG = {
  connected:     { label: 'CONNECTED',     bg: 'rgba(52,211,153,.18)',  color: '#34d399', border: 'rgba(52,211,153,.3)'  },
  token_expired: { label: 'TOKEN_EXPIRED', bg: 'rgba(251,191,36,.18)',  color: '#fbbf24', border: 'rgba(251,191,36,.3)'  },
  banida:        { label: 'BANIDA',        bg: 'rgba(239,68,68,.18)',   color: '#ef4444', border: 'rgba(239,68,68,.3)'   },
  restrita:      { label: 'RESTRITA',      bg: 'rgba(249,115,22,.18)',  color: '#f97316', border: 'rgba(249,115,22,.3)'  },
  ativa:         { label: 'ATIVA',         bg: 'rgba(96,165,250,.18)',  color: '#60a5fa', border: 'rgba(96,165,250,.3)'  },
};
function StatusBadge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.ativa;
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700, letterSpacing:'0.06em', background:c.bg, color:c.color, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {c.label}
    </span>
  );
}

/* ── Avatar chip ── */
function AvatarChip({ username, avatar, size = 32 }) {
  const [err, setErr] = useState(false);
  const src = avatar && !err ? proxyImg(avatar) : null;
  if (src) {
    return <img src={src} alt={username} onError={() => setErr(true)} style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />;
  }
  return (
    <span style={{ width:size, height:size, borderRadius:'50%', background:'rgba(36,201,255,.2)', color:'#22d7ff', fontSize:Math.floor(size/2.5), fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      {(username||'?').slice(0,2).toUpperCase()}
    </span>
  );
}

/* ── PostagensTable ── */
function PostagensTable({ stats }) {
  const [col, setCol] = useState('hoje');

  const sorted = useMemo(() => [...stats].sort((a, b) => {
    const va = col === 'hoje' ? a.postsToday : col === '7d' ? a.posts7d : a.posts30d;
    const vb = col === 'hoje' ? b.postsToday : col === '7d' ? b.posts7d : b.posts30d;
    return vb - va;
  }), [stats, col]);

  const totals = useMemo(() => stats.reduce((acc, s) => ({
    hoje: acc.hoje + s.postsToday, '7d': acc['7d'] + s.posts7d, '30d': acc['30d'] + s.posts30d,
  }), { hoje:0, '7d':0, '30d':0 }), [stats]);

  const thS = { fontSize:11, color:'#5a7a99', fontWeight:600, letterSpacing:'0.08em', padding:'8px 12px', textAlign:'right', borderBottom:'1px solid rgba(51,65,85,.35)', cursor:'pointer', whiteSpace:'nowrap' };

  return (
    <div className="panel" style={{ gridColumn:'1/-1' }}>
      <PanelHeader
        title="POSTAGENS POR CONTA"
        icon={Send}
        right={
          <div style={{ display:'flex', gap:4 }}>
            {PERIODS.map(p => (
              <button key={p.value} className="select-label"
                style={{ background: col === p.value ? 'rgba(36,201,255,.18)' : '' }}
                onClick={() => setCol(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      <div style={{ marginBottom:12, fontSize:12, color:'#5a7a99' }}>
        {stats.length} conta(s) &middot; totais:&nbsp;
        <strong style={{ color:'#22d7ff' }}>{fmt(totals.hoje)}</strong> hoje &middot;&nbsp;
        <strong style={{ color:'#22d7ff' }}>{fmt(totals['7d'])}</strong> em 7d &middot;&nbsp;
        <strong style={{ color:'#22d7ff' }}>{fmt(totals['30d'])}</strong> em 30d
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign:'left' }}>CONTA</th>
              {[{ label:'HOJE', value:'hoje' }, { label:'7 DIAS', value:'7d' }, { label:'30 DIAS', value:'30d' }].map(p => (
                <th key={p.value} style={{ ...thS, color: col === p.value ? '#22d7ff' : '#5a7a99' }} onClick={() => setCol(p.value)}>{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={4} style={{ padding:'20px 12px', color:'#5a7a99', fontSize:12 }}>Nenhuma postagem no período.</td></tr>
            ) : sorted.map(acc => (
              <tr key={acc._id} style={{ borderBottom:'1px solid rgba(51,65,85,.15)' }}>
                <td style={{ padding:'10px 12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <AvatarChip username={acc.username} avatar={acc.avatar} />
                    <div>
                      <div style={{ fontWeight:600, fontSize:13, color:'#d9f4ff' }}>@{acc.username}</div>
                      <div style={{ fontSize:11, color:'#5a7a99' }}>{fmtK(acc.followers)} seguidores</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:700, fontSize:14, color: col==='hoje' ? '#22d7ff' : '#d9f4ff' }}>{fmt(acc.postsToday)}</td>
                <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:700, fontSize:14, color: col==='7d'   ? '#22d7ff' : '#d9f4ff' }}>{fmt(acc.posts7d)}</td>
                <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:700, fontSize:14, color: col==='30d'  ? '#22d7ff' : '#d9f4ff' }}>{fmt(acc.posts30d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── PerformanceTable ── */
function PerformanceTable({ stats }) {
  const agg = useMemo(() => stats.reduce((acc, a) => ({
    followers: acc.followers + a.followers,
    published: acc.published + a.posts30d,
    failures:  acc.failures  + a.failures30d,
    growth:    acc.growth    + (a.growth30d || 0),
  }), { followers:0, published:0, failures:0, growth:0 }), [stats]);

  const successRate = (agg.published + agg.failures) > 0
    ? Math.round(agg.published / (agg.published + agg.failures) * 100) : 0;

  const fmtDate = d => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}, ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  };

  const thS = { fontSize:11, color:'#5a7a99', fontWeight:600, letterSpacing:'0.07em', padding:'8px 10px', textAlign:'right', borderBottom:'1px solid rgba(51,65,85,.35)', whiteSpace:'nowrap' };

  return (
    <div className="panel" style={{ gridColumn:'1/-1' }}>
      <PanelHeader
        title="PERFORMANCE POR CONTA"
        icon={TrendingUp}
        right={
          <div style={{ display:'flex', alignItems:'center', gap:14, fontSize:11, flexWrap:'wrap' }}>
            <span style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:'#2bdc94', boxShadow:'0 0 6px #2bdc94', display:'inline-block' }} />
              <strong style={{ color:'#2bdc94' }}>LIVE</strong>
            </span>
            <span style={{ color:'#5a7a99' }}>Seguidores <strong style={{ color:'#22d7ff' }}>{fmtK(agg.followers)}</strong></span>
            <span style={{ color:'#5a7a99' }}>Publicados <strong style={{ color:'#22d7ff' }}>{fmt(agg.published)}</strong></span>
            <span style={{ color:'#5a7a99' }}>Falhas <strong style={{ color:'#ff5f5f' }}>{fmt(agg.failures)}</strong></span>
            <span style={{ color:'#5a7a99' }}>Sucesso <strong style={{ color:'#2bdc94' }}>{successRate}%</strong></span>
            <span style={{ color:'#5a7a99' }}>Crescimento 30d <strong style={{ color: agg.growth >= 0 ? '#2bdc94' : '#ff5f5f' }}>{agg.growth >= 0 ? '+' : ''}{fmt(agg.growth)}</strong></span>
          </div>
        }
      />
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign:'left', width:36 }}>#</th>
              <th style={{ ...thS, textAlign:'left' }}>CONTA</th>
              <th style={thS}>STATUS</th>
              <th style={thS}>SEGUIDORES</th>
              <th style={thS}>CRESCIMENTO 30D</th>
              <th style={thS}>PUBLICADOS</th>
              <th style={thS}>FALHAS</th>
              <th style={thS}>SUCESSO</th>
              <th style={thS}>MÍDIA</th>
              <th style={thS}>ÚLTIMA SYNC</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 ? (
              <tr><td colSpan={10} style={{ padding:'20px 10px', color:'#5a7a99', fontSize:12 }}>Nenhuma conta encontrada.</td></tr>
            ) : stats.map((acc, idx) => {
              const growth = acc.growth30d || 0;
              return (
                <tr key={acc._id} style={{ borderBottom:'1px solid rgba(51,65,85,.15)' }}>
                  <td style={{ padding:'10px 10px', fontSize:12, color:'#5a7a99', fontWeight:600 }}>{String(idx+1).padStart(2,'0')}</td>
                  <td style={{ padding:'10px 10px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <AvatarChip username={acc.username} avatar={acc.avatar} size={28} />
                      <div>
                        <div style={{ fontWeight:600, fontSize:12, color:'#d9f4ff', whiteSpace:'nowrap' }}>@{acc.username}</div>
                        <div style={{ fontSize:10, color:'#5a7a99' }}>{acc.following} seguindo</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'10px 10px', textAlign:'right' }}><StatusBadge status={acc.status} /></td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, color:'#d9f4ff', fontSize:13 }}>{fmtK(acc.followers)}</td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, fontSize:13, color: growth > 0 ? '#2bdc94' : growth < 0 ? '#ff5f5f' : '#5a7a99' }}>
                    {growth > 0 ? '+' : ''}{fmt(growth)}
                  </td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, color:'#22d7ff', fontSize:13 }}>{fmt(acc.posts30d)}</td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, fontSize:13, color: acc.failures30d > 10 ? '#ff5f5f' : acc.failures30d > 0 ? '#ffb034' : '#5a7a99' }}>
                    {fmt(acc.failures30d)}
                  </td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, fontSize:13, color: acc.successRate >= 80 ? '#2bdc94' : acc.successRate >= 60 ? '#ffb034' : '#ff5f5f' }}>
                    {acc.successRate}%
                  </td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, color:'#d9f4ff', fontSize:13 }}>{fmt(acc.postsCount)}</td>
                  <td style={{ padding:'10px 10px', textAlign:'right', fontSize:11, color:'#5a7a99', whiteSpace:'nowrap' }}>{fmtDate(acc.lastSync)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── helpers de notificação ── */
function buildNotif(data, event) {
  const a = data?.action || '';
  if (event === 'posts') {
    if (a === 'post_completed' || data?.status === 'concluido')
      return { type: 'success', msg: `✅ Post publicado${data.username ? ` @${data.username}` : ''}` };
    if (a === 'post_failed'    || data?.status === 'erro')
      return { type: 'error',   msg: `❌ Falha ao publicar${data.username ? ` @${data.username}` : ''}${data.error ? `: ${String(data.error).slice(0,60)}` : ''}` };
    if (a === 'post_started')
      return { type: 'info',    msg: `🚀 Publicação iniciada${data.username ? ` @${data.username}` : ''}` };
    if (data?.status) return null; // silencia updates genéricos de status
  }
  if (event === 'accounts') {
    if (a === 'oauth_connected')   return { type: 'success', msg: `🔗 ${data.username || 'Conta'} conectada via OAuth` };
    if (a === 'token_recovered')   return { type: 'success', msg: `🔑 Token renovado: @${data.username || ''}` };
    if (a === 'tokens_refreshed' && (data.refreshed || 0) > 0)
      return { type: 'success', msg: `🔑 ${data.refreshed} token(s) renovado(s)` };
    if (a === 'health_update' && data.healthStatus && data.healthStatus !== 'ativa')
      return { type: data.healthStatus === 'banida' ? 'error' : 'warn',
               msg: `⚠️ @${data.username || ''}: ${data.error || data.healthStatus}` };
  }
  if (event === 'loop') {
    if (a === 'loop_started')  return { type: 'info',    msg: '🔄 Loop de postagens iniciado' };
    if (a === 'loop_stopped')  return { type: 'info',    msg: '⏹ Loop pausado' };
    if (a === 'loop_error')    return { type: 'error',   msg: `❌ Erro no loop${data.error ? `: ${String(data.error).slice(0,60)}` : ''}` };
    if (a === 'post_sent')     return { type: 'success', msg: `✅ Loop publicou${data.username ? ` @${data.username}` : ''}` };
  }
  if (event === 'insights' && a === 'sync_done')
    return { type: 'info', msg: `📊 Insights sincronizados${data.count ? ` (${data.count} posts)` : ''}` };
  return null;
}

/* ── NotificationPanel ── */
function NotificationPanel({ notifs, unread, open, setOpen, onClear }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  const typeColor = { success:'#22c55e', error:'#f87171', warn:'#fbbf24', info:'#60a5fa' };

  return (
    <div ref={panelRef} style={{ position:'relative', display:'inline-block' }}>
      <button
        className="icon-button"
        onClick={() => setOpen(v => !v)}
        aria-label="Notificações"
        style={{ position:'relative' }}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="notification-pip" style={{ position:'absolute', top:-4, right:-4, minWidth:16, height:16, fontSize:9, fontWeight:800, background:'#f43f5e', color:'#fff', borderRadius:999, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', lineHeight:1 }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 10px)', right:0, zIndex:9999,
          width:320, maxHeight:420, overflowY:'auto',
          background:'rgba(6,13,30,.97)', border:'1px solid rgba(51,65,85,.6)',
          borderRadius:12, boxShadow:'0 16px 60px rgba(0,0,0,.6)', backdropFilter:'blur(12px)',
        }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px 10px', borderBottom:'1px solid rgba(51,65,85,.3)' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#d9f4ff', letterSpacing:'.04em' }}>NOTIFICAÇÕES</span>
            {notifs.length > 0 && (
              <button onClick={onClear} style={{ fontSize:10, color:'#5a7a99', background:'none', border:'none', cursor:'pointer', padding:0 }}>Limpar tudo</button>
            )}
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding:'28px 14px', textAlign:'center', fontSize:12, color:'#334155' }}>Nenhuma notificação ainda.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column' }}>
              {notifs.map(n => (
                <div key={n.id} style={{ padding:'10px 14px', borderBottom:'1px solid rgba(51,65,85,.15)', display:'flex', alignItems:'flex-start', gap:8 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:typeColor[n.type]||'#60a5fa', flexShrink:0, marginTop:5, boxShadow:`0 0 6px ${typeColor[n.type]||'#60a5fa'}` }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, color:'#d9f4ff', lineHeight:1.4, wordBreak:'break-word' }}>{n.msg}</div>
                    <div style={{ fontSize:10, color:'#334155', marginTop:3 }}>{n.time.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Dashboard ── */
export default function Dashboard() {
  const [data, setData]             = useState(null);
  const [accountStats, setAccountStats] = useState([]);
  const [topInsights, setTopInsights]   = useState([]);
  const [syncingIns, setSyncingIns]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast]           = useState('');
  const [period, setPeriod]         = useState(7);
  const [accountsPeriod, setAccountsPeriod] = useState('hoje');
  const [problemsPeriod, setProblemsPeriod] = useState('hoje');

  // Notificações
  const [notifications, setNotifications] = useState([]);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [unread,        setUnread]        = useState(0);

  const loadRef = useRef(null);
  const showToast = msg => { setToast(msg); clearTimeout(window.__ifToast); window.__ifToast = setTimeout(() => setToast(''), 2600); };

  const addNotif = useCallback((data, event) => {
    const n = buildNotif(data, event);
    if (!n) return;
    setNotifications(prev => [{ id: Date.now() + Math.random(), ...n, time: new Date() }, ...prev].slice(0, 60));
    setUnread(u => u + 1);
  }, []);

  const load = useCallback(async () => {
    try { const r = await api.get('/dashboard');       setData(r.data); }       catch {}
  }, []);
  const loadStats = useCallback(async () => {
    try { const r = await api.get('/dashboard/account-stats'); setAccountStats(r.data || []); } catch {}
  }, []);
  const loadInsights = useCallback(async () => {
    try { const r = await api.get('/insights', { params: { period:'30d', limit:6 } }); setTopInsights(r.data?.insights || []); } catch {}
  }, []);

  loadRef.current = load;

  useEffect(() => { load(); loadStats(); loadInsights(); }, [load, loadStats, loadInsights]);
  useEffect(() => {
    const id = setInterval(() => { loadRef.current?.(); loadStats(); loadInsights(); }, 15_000);
    return () => clearInterval(id);
  }, [loadStats, loadInsights]);

  useServerEvents(
    ['posts', 'accounts', 'sessions', 'health', 'insights', 'loop'],
    (data, event) => {
      loadRef.current?.();
      loadStats();
      loadInsights();
      addNotif(data, event);
    }
  );

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.all([load(), loadStats(), loadInsights()]).finally(() => {
      setTimeout(() => setRefreshing(false), 600);
      showToast('Dados sincronizados com sucesso.');
    });
  };

  const d = data || {};

  const sparkDaily = useMemo(() => (d.dailyPosts || []).slice(-period).map(x => x.posts || 0), [d.dailyPosts, period]);
  const forecastData = useMemo(() => {
    const past = (d.dailyPosts || []).slice(-period).map(x => ({
      day: x.label || x.date || '',
      value: x.posts || 0,
    }));
    // Adiciona postagens agendadas futuras agrupadas por dia
    const futureMap = {};
    (d.upcomingPosts || []).forEach(post => {
      if (!post.scheduledAt) return;
      const key = new Date(post.scheduledAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
      futureMap[key] = (futureMap[key] || 0) + 1;
    });
    Object.entries(futureMap).forEach(([day, value]) => past.push({ day, value, forecast: true }));
    return past;
  }, [d.dailyPosts, d.upcomingPosts, period]);

  const queueItems = [
    { label: 'Postados hoje',   value: d.postsToday      || 0, color: '#20b7ff' },
    { label: 'Erros hoje',      value: d.errorsToday     || 0, color: '#ff5f5f' },
    { label: 'Na fila',         value: d.pendingPosts    || 0, color: '#ffb034' },
    { label: 'Processando',     value: d.processingPosts || 0, color: '#43cf76' },
    { label: 'Agendados',       value: d.scheduledPosts  || 0, color: '#a86cff' },
    { label: 'Taxa de sucesso', value: `${d.successRate  || 0}%`, color: '#22d7ff' },
  ];

  const logs = useMemo(() => (d.activities || []).slice(0, 5).map(a => ({
    time:    new Date(a.date || a.createdAt || Date.now()).toLocaleTimeString('pt-BR'),
    type:    a.status === 'concluido' ? 'success' : a.status === 'erro' ? 'warning' : a.status === 'ativa' ? 'success' : 'info',
    text:    a.action || a.text || (a.type === 'post' ? 'Publicação' : 'Atividade'),
    account: a.account || a.username || '',
    caption: a.caption || '',
    kind:    a.type || 'post',
  })), [d.activities]);

  const topAccounts = useMemo(() => (d.topAccounts || []).slice(0, 4), [d.topAccounts]);

  const activities = useMemo(() => (d.activities || []).slice(0, 5).map(a => ({
    icon:    a.status === 'erro' ? AlertTriangle : a.type === 'account' ? Activity : a.postType === 'story' ? Clock3 : Send,
    text:    a.action || a.text || (a.type === 'post' ? 'Publicação' : 'Atividade'),
    account: a.account || a.username || '',
    caption: a.caption || '',
    time:    new Date(a.date || a.createdAt || Date.now()).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
    tone:    a.status === 'concluido' ? 'cyan' : a.status === 'erro' ? 'danger' : a.status === 'ativa' ? 'cyan' : 'amber',
  })), [d.activities]);

  const sysOk = d.system?.backend && d.system?.mongo;

  const accountsAddedValue = accountsPeriod === 'hoje' ? (d.accountsAddedToday || 0)
                           : accountsPeriod === '7d'   ? (d.accountsAdded7d    || 0)
                                                        : (d.accountsAdded30d   || 0);
  const problemsValue = problemsPeriod === 'hoje' ? (d.problemsToday || 0)
                      : problemsPeriod === '7d'   ? (d.problems7d    || 0)
                                                  : (d.problems30d   || 0);

  return (
    <div style={{ display: 'contents' }}>
      <div className="ambient-glow glow-one" aria-hidden="true" />
      <div className="ambient-glow glow-two" aria-hidden="true" />

      <main className="dashboard">
        {/* ── Topbar ── */}
        <header className="topbar">
          <div className="header-left">
            <div>
              <div className="eyebrow">DASHBOARD</div>
              <div className="title-line">
                <h1>Visão geral</h1>
                <span className="live-status">
                  <span style={{ background: sysOk ? '#2bdc94' : '#ff5f5f', boxShadow:`0 0 10px ${sysOk?'#2bdc94':'#ff5f5f'}` }} />
                  {sysOk ? 'Todos os sistemas operacionais' : 'Verificar sistemas'}
                </span>
              </div>
              <p>Acompanhe contas, filas e atividade do seu bot em tempo real.</p>
            </div>
          </div>
          <div className="toolbar">
            <div className="clock-chip"><Clock3 size={16} /><LiveClock /></div>
            <button className="toolbar-button" onClick={() => setPeriod(p => p===7?14:p===14?30:7)}>
              <span>Atualizar: {period}d</span><ChevronDown size={15} />
            </button>
            <NotificationPanel
              notifs={notifications}
              unread={unread}
              open={notifOpen}
              setOpen={v => { setNotifOpen(v); if (v) setUnread(0); }}
              onClear={() => { setNotifications([]); setUnread(0); setNotifOpen(false); }}
            />
            <button className={`refresh-button ${refreshing?'is-refreshing':''}`} onClick={handleRefresh}>
              <RefreshCw size={17} />Atualizar
            </button>
          </div>
        </header>

        {/* ── KPI Cards ── */}
        <section className="metric-grid" aria-label="Métricas principais">
          <MetricCard title="CONTAS ATIVAS"    value={fmt(d.activeAccounts)} meta={`${d.totalAccounts||0} total`}                   kind="orb"       tone="cyan"  spark={sparkDaily} />
          <MetricCard title="POSTAGENS HOJE"   value={fmt(d.postsToday)}     meta={`Meta: ${d.dailyPostLimit||'—'}`}                 kind="crystal"   tone="amber" spark={sparkDaily} />
          <MetricCard title="ERROS HOJE"       value={fmt(d.errorsToday)}    meta={d.errorsToday>0?`${d.errorsToday} erro(s)`:'Nenhum erro'} kind="ice" tone="cyan"  spark={sparkDaily} />
          <MetricCard title="FILA"             value={fmt((d.pendingPosts||0)+(d.processingPosts||0))} meta={`${d.processingPosts||0} processando`} kind="hourglass" tone="amber" spark={sparkDaily} />
        </section>

        {/* ── Wide metrics with period tabs ── */}
        <section className="wide-metric-row">
          <WideMetric
            title="CONTAS ADICIONADAS"
            value={fmt(accountsAddedValue)}
            subtitle={accountsPeriod==='hoje' ? 'adicionadas hoje' : accountsPeriod==='7d' ? 'nos últimos 7 dias' : 'nos últimos 30 dias'}
            kind="orb"
            activePeriod={accountsPeriod}
            onPeriodChange={setAccountsPeriod}
            chip={`+${accountsAddedValue}`}
            spark={sparkDaily}
          />
          <WideMetric
            title="CONTAS COM PROBLEMA"
            value={fmt(problemsValue)}
            subtitle={problemsPeriod==='hoje' ? 'com problema hoje' : problemsPeriod==='7d' ? 'com problema em 7d' : 'com problema total'}
            kind="ice"
            activePeriod={problemsPeriod}
            onPeriodChange={setProblemsPeriod}
            chip={`-${problemsValue}`}
            tone="muted"
            spark={sparkDaily}
          />
        </section>

        {/* ── Quick actions ── */}
        <section className="quick-grid" aria-label="Ações rápidas">
          {quickActions.map(({ title, subtitle, icon: Icon }) => (
            <button key={title} className="quick-action" onClick={() => showToast(`${title}: painel de ação aberto.`)}>
              <span className="quick-icon"><Icon size={24} /></span>
              <span className="quick-copy"><strong>{title}</strong><small>{subtitle}</small></span>
              <ChevronRight className="quick-chevron" size={20} />
            </button>
          ))}
        </section>

        {/* ── Operations grid ── */}
        <section className="operations-grid">
          <div className="panel forecast-panel">
            <PanelHeader title="PREVISÃO DE POSTAGENS" icon={FolderOpen} right={
              <div style={{ display:'flex', gap:6 }}>
                {[7,14,30].map(p => (
                  <button key={p} className="select-label" style={{ background:period===p?'rgba(36,201,255,.18)':'' }} onClick={() => setPeriod(p)}>{p}d</button>
                ))}
              </div>
            } />
            <div className="forecast-content">
              {!forecastData.some(x => x.value > 0) && (
                <>
                  <div className="forecast-graphic">
                    <div className="folder-holo"><FolderOpen size={58} strokeWidth={1.15} /></div>
                    <div className="holo-floor" />
                  </div>
                  <div className="empty-copy">
                    <h2>Nenhuma postagem no período.</h2>
                    <p>Adicione publicações às filas para visualizar a previsão de execução.</p>
                  </div>
                </>
              )}
              <div className="forecast-chart" style={{ opacity: forecastData.some(x => x.value > 0) ? 1 : 0.33 }}>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={forecastData} margin={{ top:10, right:4, left:-28, bottom:0 }}>
                    <defs>
                      <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#26c7ff" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#26c7ff" stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" tick={{ fontSize:10, fill:'#5a8aaa' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize:10, fill:'#5a8aaa' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color:'#d8efff' }} formatter={v => [v, 'Postagens']} />
                    <Area type="monotone" dataKey="value" stroke="#27c6ff" strokeWidth={2} fill="url(#fg)" dot={false} activeDot={{ r:4, fill:'#27c6ff' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="panel queue-panel">
            <PanelHeader title="RESUMO DA FILA" icon={Layers3} right={<button className="select-label">Todos<ChevronDown size={14}/></button>} />
            <div className="queue-body">
              <div className="queue-hourglass-wrap">
                <div className="queue-orbit orbit-1" /><div className="queue-orbit orbit-2" /><Hourglass />
              </div>
              <ul className="queue-list">
                {queueItems.map(item => (
                  <li key={item.label}>
                    <span className="queue-dot" style={{ backgroundColor:item.color }} />
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Postagens por Conta ── */}
        <section className="operations-grid" style={{ gridTemplateColumns:'1fr' }}>
          <PostagensTable stats={accountStats} />
        </section>

        {/* ── Performance por Conta ── */}
        <section className="operations-grid" style={{ gridTemplateColumns:'1fr' }}>
          <PerformanceTable stats={accountStats} />
        </section>

        {/* ── Top Posts widget ── */}
        <section className="operations-grid" style={{ gridTemplateColumns:'1fr' }}>
          <div className="panel" style={{ gridColumn:'1/-1' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:11, fontWeight:700, letterSpacing:'.1em', color:'#22d7ff' }}>
                  <Flame size={14} /> POSTS COM MAIS VISUALIZAÇÕES
                </div>
                <div style={{ fontSize:11, color:'#5a7a99', marginTop:3 }}>Top {topInsights.length || 6} dos últimos 30 dias · dados oficiais da API do Instagram.</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button
                  disabled={syncingIns}
                  onClick={async () => { setSyncingIns(true); try { await api.post('/insights/sync'); await new Promise(r => setTimeout(r,1200)); await loadInsights(); } catch {} finally { setSyncingIns(false); } }}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:8, border:'1px solid rgba(36,201,255,.3)', background:'rgba(36,201,255,.1)', color:'#22d7ff', fontSize:11, fontWeight:700, cursor: syncingIns ? 'not-allowed' : 'pointer', opacity: syncingIns ? .65 : 1 }}>
                  <RefreshCw size={13} style={{ animation: syncingIns ? 'spin .8s linear infinite' : 'none' }} />
                  SYNC
                </button>
                <Link to="/top-posts" style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 14px', borderRadius:8, border:'1px solid rgba(51,65,85,.4)', background:'transparent', color:'#8eb2d5', fontSize:11, fontWeight:700, textDecoration:'none' }}>
                  VER TUDO <ChevronRight size={13} />
                </Link>
              </div>
            </div>
            {topInsights.length === 0 ? (
              <div style={{ padding:'20px 0', textAlign:'center', fontSize:12, color:'#334155' }}>
                Nenhum insight sincronizado. Clique em SYNC para importar.
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(topInsights.length,6)},1fr)`, gap:10 }}>
                {topInsights.slice(0,6).map((ins, i) => (
                  <Link key={ins._id} to="/top-posts" style={{ textDecoration:'none' }}>
                    <InsightThumb ins={ins} rank={i} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Bottom grid ── */}
        <section className="bottom-grid">

          {/* LOGS RECENTES */}
          <div className="panel compact-panel logs-panel">
            <PanelHeader title="LOGS RECENTES" right={<ViewAll onClick={() => showToast('Abrindo todos os logs.')} />} />
            <ul style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:0 }}>
              {logs.length === 0 ? (
                <li style={{ color:'#566e89', fontSize:11, padding:'12px 0' }}>Nenhum log ainda.</li>
              ) : logs.map((log, i) => (
                <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'9px 0', borderBottom:'1px solid rgba(51,65,85,.12)' }}>
                  {/* status icon */}
                  <span className={`log-status ${log.type}`} style={{ flexShrink:0, marginTop:1 }}>
                    {log.type==='success' && <ShieldCheck size={14} />}
                    {log.type==='info'    && <Activity    size={14} />}
                    {log.type==='warning' && <AlertTriangle size={14} />}
                  </span>
                  {/* body */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#d9f4ff', lineHeight:1.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.text}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                      {log.account && <span style={{ fontSize:10, color:'#22d7ff', fontWeight:600 }}>@{log.account}</span>}
                      {log.caption && <span style={{ fontSize:10, color:'#5a7a99', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.caption}</span>}
                    </div>
                  </div>
                  {/* time */}
                  <time style={{ fontSize:10, color:'#334155', flexShrink:0, paddingTop:2 }}>{log.time}</time>
                </li>
              ))}
            </ul>
          </div>

          {/* CONTAS EM DESTAQUE */}
          <div className="panel compact-panel accounts-panel">
            <PanelHeader title="CONTAS EM DESTAQUE" right={<ViewAll onClick={() => showToast('Abrindo ranking completo.')} />} />
            <ul style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:0 }}>
              {topAccounts.length === 0 ? (
                <li style={{ color:'#566e89', fontSize:11 }}>Nenhuma conta conectada.</li>
              ) : topAccounts.map((acc, i) => {
                const score = acc.healthScore ?? (acc.healthStatus==='ativa'?95:acc.healthStatus==='restrita'?45:10);
                const isErr = acc.healthStatus !== 'ativa';
                const dotColor = isErr ? '#f87171' : '#2bdc94';
                return (
                  <li key={acc.username||i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:'1px solid rgba(51,65,85,.12)' }}>
                    {/* avatar with actual profile photo */}
                    <div style={{ position:'relative', flexShrink:0 }}>
                      <AvatarChip username={acc.username} avatar={acc.avatar} size={40} />
                      <span style={{ position:'absolute', bottom:0, right:0, width:10, height:10, borderRadius:'50%', background:dotColor, border:'2px solid rgba(4,18,39,.9)', boxShadow:`0 0 6px ${dotColor}` }} />
                    </div>
                    {/* info */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'#d9f4ff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{acc.username}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                        <span style={{ fontSize:10, color:isErr?'#f87171':'#2bdc94', fontWeight:600 }}>{isErr ? acc.healthStatus.replace('_',' ') : 'Online'}</span>
                        <span style={{ fontSize:10, color:'#334155' }}>·</span>
                        <span style={{ fontSize:10, color:'#5a7a99' }}>{fmtK(acc.followers)} seg.</span>
                      </div>
                    </div>
                    {/* score ring */}
                    <span className={`score-ring ${isErr?'low':''}`} style={{ '--score':`${score}%`, flexShrink:0 }}>{score}%</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ATIVIDADES RECENTES */}
          <div className="panel compact-panel activity-panel">
            <PanelHeader title="ATIVIDADES RECENTES" right={<ViewAll onClick={() => showToast('Abrindo todas as atividades.')} />} />
            <ul style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:0 }}>
              {activities.length === 0 ? (
                <li style={{ color:'#566e89', fontSize:11 }}>Nenhuma atividade ainda.</li>
              ) : activities.map((act, i) => {
                const Icon = act.icon;
                const toneColor = { cyan:'#22d7ff', danger:'#f87171', amber:'#fbbf24' }[act.tone] || '#5a7a99';
                return (
                  <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'9px 0', borderBottom:'1px solid rgba(51,65,85,.12)' }}>
                    <span className={`activity-icon ${act.tone}`} style={{ flexShrink:0, marginTop:1 }}><Icon size={14} /></span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#d9f4ff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{act.text}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                        {act.account && <span style={{ fontSize:10, color:'#22d7ff', fontWeight:600 }}>@{act.account}</span>}
                        {act.caption && <span style={{ fontSize:10, color:'#5a7a99', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{act.caption}</span>}
                      </div>
                    </div>
                    <time style={{ fontSize:10, color:'#334155', flexShrink:0, paddingTop:2 }}>{act.time}</time>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="system-footer">
          <span><ShieldCheck size={14} /> {sysOk?'Sistema operacional':'Verificar sistemas'}</span>
          <span><i style={{ background:sysOk?'#2add90':'#ff5f5f', boxShadow:`0 0 8px ${sysOk?'#2add90':'#ff5f5f'}` }} /> {sysOk?'Online':'Offline'}</span>
          <span>MongoDB <b style={{ color:d.system?.mongo?'#2add90':'#ff5f5f' }}>{d.system?.mongo?'OK':'Erro'}</b></span>
          <span>Redis <b style={{ color:d.system?.redis?'#2add90':'#ff5f5f' }}>{d.system?.redis?'OK':'Erro'}</b></span>
          <span>Worker <b style={{ color:d.system?.worker?'#2add90':'#ff5f5f' }}>{d.system?.worker?'Ativo':'Parado'}</b></span>
          <span>Contas <b>{fmt(d.totalAccounts)}</b></span>
          <span>Posts <b>{fmt(d.totalPosts)}</b></span>
          <button onClick={() => showToast('Versão 2.4.7 — InstaFlow Pulse')}>Novidades</button>
        </footer>
      </main>

      {toast && <div className="toast"><ShieldCheck size={18} /> {toast}</div>}
    </div>
  );
}

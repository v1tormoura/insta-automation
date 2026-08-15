import '../dashboard.css';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, AlertTriangle, ChevronDown, ChevronRight,
  Clock3, Flame, FolderOpen, Globe, HeartPulse, Layers3,
  MoreHorizontal, Plus, RefreshCw, Send,
  ShieldCheck, TrendingUp, WifiOff, Zap,
  Play, Pause, Repeat2, ListVideo, Eye, Timer,
} from 'lucide-react';
import {
  Area, AreaChart, Line, LineChart as RechartLineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { NumberTicker } from '../components/magicui/number-ticker';
import { BlurFade } from '../components/magicui/blur-fade';

/* ── helpers (unchanged) ── */
const fmt  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const proxyImg = url => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
};

/* ── animation presets ── */
const fadeUp  = { hidden:{ opacity:0, y:16 }, show:{ opacity:1, y:0 } };
const stagger = { show:{ transition:{ staggerChildren:.06 } } };
const spring  = { type:'spring', stiffness:260, damping:22 };
const ease    = [0.21, 0.47, 0.32, 0.98];

/* ── design tokens (inline) — oklch dark-first navy */
const card = {
  background: 'oklch(0.16 0.05 235 / 0.88)',
  border: '1px solid oklch(1 0 0 / 0.07)',
  borderRadius: 18,
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  position: 'relative',
  overflow: 'hidden',
};
const topLine = {
  content: '""',
  position: 'absolute',
  top: 0, left: 20, right: 20, height: 1,
  background: 'linear-gradient(90deg,transparent,rgba(0,212,255,.32),transparent)',
};

/* ── InsightThumb ── */
function InsightThumb({ ins, rank }) {
  const [err, setErr] = useState(false);
  const src = !err ? proxyImg(ins.thumbnailUrl || ins.mediaUrl) : null;
  const color = ['#a855f7','#3b82f6','#06b6d4','#10b981','#f59e0b','#f43f5e'][rank] || '#22d7ff';
  return (
    <motion.div whileHover={{ scale:1.03, y:-3 }} transition={spring}
      style={{ position:'relative', aspectRatio:'9/16', borderRadius:11, overflow:'hidden', background:'rgba(10,20,38,.9)', border:'1px solid rgba(255,255,255,.07)', cursor:'pointer' }}>
      {src
        ? <img src={src} alt="" onError={() => setErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,.1)' }}><Flame size={24} /></div>
      }
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,rgba(0,0,0,.3) 0%,transparent 40%,rgba(0,0,0,.7) 100%)' }} />
      <div style={{ position:'absolute', top:7, right:7, background:color, color:'#fff', fontSize:9, fontWeight:800, width:20, height:20, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 0 10px ${color}80` }}>
        #{rank+1}
      </div>
      <div style={{ position:'absolute', bottom:7, left:7, right:7 }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.85)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{ins.username}</div>
        <div style={{ fontSize:9, color:'rgba(255,255,255,.5)', display:'flex', gap:6, marginTop:2 }}>
          <span>👁 {fmtK(ins.videoViews || ins.impressions)}</span>
          <span>❤️ {fmtK(ins.likeCount)}</span>
        </div>
      </div>
    </motion.div>
  );
}

const tooltipStyle = {
  background: 'rgba(9,9,15,.97)',
  border: '1px solid rgba(0,212,255,.2)',
  borderRadius: 10,
  color: '#e2edfd',
  boxShadow: '0 10px 35px rgba(0,0,0,.5)',
  fontSize: 12,
};

const PERIODS = [
  { label: 'Hoje',    value: 'hoje' },
  { label: '7 dias',  value: '7d'   },
  { label: '30 dias', value: '30d'  },
];

const quickActions = [
  { title: 'Postar agora',  subtitle: 'Nova publicação manual',         icon: Send,      to: '/posts'     },
  { title: 'Loop',          subtitle: 'Ciclo contínuo de filas',        icon: RefreshCw, to: '/loop'      },
  { title: 'Stories',       subtitle: 'Publicar para todos os stories', icon: Plus,      to: '/stories'   },
  { title: 'Saúde',         subtitle: 'Diagnóstico das contas',         icon: HeartPulse,to: '/health'    },
];

/* ── LiveClock ── */
function LiveClock() {
  const [t, setT] = useState(() => new Date().toLocaleTimeString('pt-BR'));
  useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString('pt-BR')), 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ fontVariantNumeric:'tabular-nums' }}>{t}</span>;
}

/* ── AvatarChip ── */
function AvatarChip({ username, avatar, size = 32 }) {
  const [err, setErr] = useState(false);
  const src = avatar && !err ? proxyImg(avatar) : null;
  if (src) return <img src={src} alt={username} onError={() => setErr(true)} style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />;
  return (
    <span style={{ width:size, height:size, borderRadius:'50%', background:'linear-gradient(135deg,rgba(99,102,241,.4),rgba(139,92,246,.4))', color:'#c4b5fd', fontSize:Math.floor(size/2.5), fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      {(username||'?').slice(0,2).toUpperCase()}
    </span>
  );
}

/* ── StatusBadge ── */
const STATUS_CFG = {
  connected:     { label: 'CONNECTED',     bg:'rgba(52,211,153,.12)', color:'#34d399', border:'rgba(52,211,153,.25)'  },
  token_expired: { label: 'TOKEN_EXPIRED', bg:'rgba(251,191,36,.12)', color:'#fbbf24', border:'rgba(251,191,36,.25)'  },
  banida:        { label: 'BANIDA',        bg:'rgba(239,68,68,.12)',  color:'#ef4444', border:'rgba(239,68,68,.25)'   },
  restrita:      { label: 'RESTRITA',      bg:'rgba(249,115,22,.12)', color:'#f97316', border:'rgba(249,115,22,.25)'  },
  ativa:         { label: 'ATIVA',         bg:'rgba(96,165,250,.12)', color:'#60a5fa', border:'rgba(96,165,250,.25)'  },
};
function StatusBadge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.ativa;
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700, letterSpacing:'.06em', background:c.bg, color:c.color, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {c.label}
    </span>
  );
}

/* ── PanelHeader ── */
function PanelHeader({ title, icon: Icon, right }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.05)', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {Icon && <Icon size={14} style={{ color:'var(--cyan)', opacity:.8 }} />}
        <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--text2)', textTransform:'uppercase' }}>{title}</span>
      </div>
      {right}
    </div>
  );
}

/* ── SelectBtn ── */
function SelectBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding:'3px 9px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer',
      background: active ? 'rgba(0,212,255,.12)' : 'rgba(255,255,255,.04)',
      color: active ? 'var(--cyan)' : 'var(--text3)',
      border: `1px solid ${active ? 'rgba(0,212,255,.22)' : 'rgba(255,255,255,.07)'}`,
      transition:'all .15s',
    }}>{children}</button>
  );
}

/* ── MetricCard ── */
function MetricCard({ title, value, meta, orbType = 'cyan', spark = [], delay = 0 }) {
  const sparkColor = orbType === 'warm' ? '#ff9a35' : orbType === 'violet' ? '#a78bfa' : '#00d4ff';
  const gradId = `sg-${title.replace(/\s+/g,'').toLowerCase()}`;
  return (
    <motion.article
      variants={fadeUp} transition={{ duration:.4, ease, delay }}
      whileHover={{ y:-3, borderColor:'oklch(0.82 0.19 196 / 0.22)', boxShadow:'0 16px 44px rgba(0,0,0,.52), 0 0 0 1px oklch(0.82 0.19 196 / 0.12)' }}
      style={{ ...card, display:'flex', flexDirection:'column', minHeight:154 }}
      className="sheen"
    >
      <div style={{ position:'absolute', top:0, left:20, right:20, height:1, background:`linear-gradient(90deg,transparent,${sparkColor}55,transparent)` }} />
      <div style={{ position:'absolute', inset:0, backgroundImage:`linear-gradient(rgba(0,212,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,.03) 1px,transparent 1px)`, backgroundSize:'26px 26px', maskImage:'radial-gradient(at left top,black 20%,transparent 80%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:-18, right:-12, width:70, height:70, borderRadius:'50%', background:`radial-gradient(circle,${sparkColor}12 0%,transparent 70%)`, pointerEvents:'none' }} />
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'16px 16px 10px', position:'relative', zIndex:1, flex:1 }}>
        <div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:600, letterSpacing:'.22em', color:`${sparkColor}bb`, textTransform:'uppercase', marginBottom:6 }}>{title}</div>
          <div style={{ fontSize:36, fontWeight:800, lineHeight:1, letterSpacing:'-1.5px', color:'#fff', fontVariantNumeric:'tabular-nums' }}>
            <NumberTicker value={Number(String(value).replace(/\D/g,'')) || 0} />
          </div>
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:5 }}>{meta}</div>
        </div>
        <div className={`kpi-orb kpi-orb-${orbType}`} style={{ width:62, height:62, flexShrink:0 }} />
      </div>
      <div style={{ height:42, position:'relative', zIndex:1 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark.map((y,i) => ({ i, y }))}>
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={sparkColor} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="y" stroke={sparkColor} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.article>
  );
}

/* ── Visual ── */
function Visual({ kind, compact = false }) {
  return (
    <div className={`visual visual-${kind} ${compact?'compact':''}`} aria-hidden="true">
      {kind === 'orb' && <div className="orb"><span className="orb-core"/><span className="orb-ring ring-one"/><span className="orb-ring ring-two"/><span className="orb-latitude lat-a"/><span className="orb-latitude lat-b"/></div>}
      {kind === 'crystal' && <div className="crystal"><span className="facet facet-a"/><span className="facet facet-b"/><span className="facet facet-c"/><span className="crystal-core"/></div>}
      {kind === 'ice' && <div className="ice"><span className="ice-shard shard-a"/><span className="ice-shard shard-b"/><span className="ice-shard shard-c"/><span className="ice-shard shard-d"/></div>}
      {kind === 'hourglass' && <div className="hourglass"><span className="hg-top"/><span className="hg-middle"/><span className="hg-bottom"/><span className="hg-sand"/></div>}
    </div>
  );
}

/* ── WideMetric ── */
function WideMetric({ title, value, subtitle, kind, activePeriod, onPeriodChange, chip, tone = 'cyan', spark = [] }) {
  const lineColor = tone === 'muted' ? 'rgba(146,182,217,.6)' : 'rgba(34,200,255,.8)';
  return (
    <motion.article whileHover={{ y:-2, borderColor:'oklch(0.82 0.19 196 / 0.18)' }} transition={spring} style={{ ...card, minHeight:104, padding:'14px 16px' }} className="sheen">
      <div style={{ position:'absolute', top:0, left:20, right:20, height:1, background:'linear-gradient(90deg,transparent,rgba(0,212,255,.28),transparent)' }} />
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, position:'relative', zIndex:1 }}>
        <div>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:600, letterSpacing:'.22em', color:'rgba(0,212,255,.7)', textTransform:'uppercase', display:'block', marginBottom:4 }}>{title}</span>
          <div style={{ fontSize:28, fontWeight:750, letterSpacing:'-1px', color:'#fff' }}>{value}</div>
          <small style={{ fontSize:11, color:'var(--text3)' }}>{subtitle}</small>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
          <div style={{ display:'flex', gap:4 }}>
            {PERIODS.map(p => <SelectBtn key={p.value} active={activePeriod===p.value} onClick={() => onPeriodChange(p.value)}>{p.label}</SelectBtn>)}
            <button style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.07)', borderRadius:6, color:'var(--text3)', cursor:'pointer' }}><MoreHorizontal size={13} /></button>
          </div>
          <span style={{ fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20, background: chip?.startsWith('-') ? 'rgba(255,255,255,.05)' : 'rgba(0,212,255,.08)', color: chip?.startsWith('-') ? 'var(--text2)' : 'var(--cyan)', border: `1px solid ${chip?.startsWith('-') ? 'rgba(255,255,255,.07)' : 'rgba(0,212,255,.18)'}` }}>{chip}</span>
        </div>
      </div>
      <div style={{ height:28, marginTop:8, position:'relative', zIndex:1 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartLineChart data={spark.map((y,i) => ({ i, y }))}>
            <Line type="monotone" dataKey="y" stroke={lineColor} strokeWidth={1.8} dot={false} />
          </RechartLineChart>
        </ResponsiveContainer>
      </div>
      <Visual kind={kind} compact />
    </motion.article>
  );
}

/* ══════════════════════════════════════════════════════
   ── FILA DE POSTAGENS
   ══════════════════════════════════════════════════════ */
function QueuePanel({ d, accountStats }) {
  const naFila      = (d.pendingPosts || 0) + (d.scheduledPosts || 0);
  const processando = d.processingPosts  || 0;
  const cutoff24h   = Date.now() + 24 * 60 * 60 * 1000;
  const proximas24h = (d.upcomingPosts || []).filter(p =>
    !p.scheduledAt || new Date(p.scheduledAt) <= cutoff24h
  ).length;
  const emCooldown  = d.cooldownAccounts || 0;
  const postsHoje   = d.postsToday      || 0;
  const metaHoje    = d.dailyPostLimit  || 0;
  const progresso   = metaHoje > 0 ? Math.min(100, Math.round(postsHoje / metaHoje * 100)) : 0;
  const queueItems  = (d.upcomingPosts  || []).slice(0, 5);
  const pausedCount = accountStats.filter(a => a.autoPaused || a.pausedByLimit).length;
  const proximoItem = queueItems[0];

  const stats4 = [
    { label:'Na fila',      value:naFila,      color:'#00d4ff', bg:'rgba(0,212,255,.08)',   border:'rgba(0,212,255,.16)',   icon:Layers3   },
    { label:'Processando',  value:processando, color:'#10b981', bg:'rgba(16,185,129,.08)',  border:'rgba(16,185,129,.16)',  icon:RefreshCw },
    { label:'Próx. 24h',   value:proximas24h, color:'#a78bfa', bg:'rgba(139,92,246,.08)',  border:'rgba(139,92,246,.16)',  icon:Timer     },
    { label:'Cooldown',    value:emCooldown,  color:'#f59e0b', bg:'rgba(245,158,11,.08)',  border:'rgba(245,158,11,.16)',  icon:Clock3    },
  ];

  const fmtTime = v => {
    if (!v) return 'agora';
    const d = new Date(v);
    const diff = d - Date.now();
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return `em ${Math.round(diff/60000)}m`;
    return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  };

  const STATUS_LABEL = { pendente:'PENDENTE', processando:'PROCESSANDO', concluido:'CONCLUÍDO', agendado:'AGENDADO', parcial:'PARCIAL', erro:'ERRO' };
  const STATUS_COLOR = { pendente:'var(--amber)', processando:'var(--cyan)', concluido:'var(--green)', agendado:'var(--text2)', parcial:'#f59e0b', erro:'var(--red)' };

  return (
    <div style={{ ...card, display:'flex', flexDirection:'column' }} className="lift">
      {/* cyan ambient orb */}
      <div style={{ position:'absolute', top:-60, right:-40, width:180, height:180, borderRadius:'50%', background:'radial-gradient(circle,rgba(0,212,255,.07),transparent 70%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:0, left:20, right:20, height:1, background:'linear-gradient(90deg,transparent,oklch(0.82 0.19 196 / 0.45),transparent)' }} />

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.05)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(0,212,255,.1)', border:'1px solid rgba(0,212,255,.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Send size={13} style={{ color:'var(--cyan)' }} />
          </div>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--text2)', textTransform:'uppercase' }}>Fila de postagens</span>
        </div>
        <Link to="/scheduler" style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text3)', textDecoration:'none', padding:'3px 9px', borderRadius:6, border:'1px solid rgba(255,255,255,.07)', background:'rgba(255,255,255,.03)', transition:'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.color='var(--cyan)'; e.currentTarget.style.borderColor='rgba(0,212,255,.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='rgba(255,255,255,.07)'; }}
        >Ver agenda <ChevronRight size={12} /></Link>
      </div>

      {/* 2×2 stat grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'12px 14px 10px' }}>
        {stats4.map((s, idx) => {
          const Icon = s.icon;
          return (
            <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:idx*.06, duration:.3 }}
              style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:12, padding:'11px 13px', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', bottom:-10, right:-8, width:44, height:44, borderRadius:'50%', background:`${s.color}15`, boxShadow:`0 0 16px ${s.color}22` }} />
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <Icon size={13} style={{ color:s.color, opacity:.85 }} />
              </div>
              <div style={{ fontSize:26, fontWeight:800, color:s.color, lineHeight:1, letterSpacing:'-1px', fontVariantNumeric:'tabular-nums', textShadow:`0 0 18px ${s.color}55` }}>
                <NumberTicker value={s.value} />
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:`${s.color}99`, marginTop:4, letterSpacing:'.05em', textTransform:'uppercase' }}>{s.label}</div>
            </motion.div>
          );
        })}
      </div>

      {/* Progress bar */}
      {metaHoje > 0 && (
        <div style={{ padding:'0 14px 10px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)', letterSpacing:'.06em', textTransform:'uppercase' }}>Progresso de hoje</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)', fontVariantNumeric:'tabular-nums' }}>
              {postsHoje}/{metaHoje} · <span style={{ color:'var(--cyan)', fontWeight:700 }}>{progresso}%</span>
            </span>
          </div>
          <div style={{ height:4, background:'rgba(255,255,255,.06)', borderRadius:4, overflow:'hidden' }}>
            <motion.div initial={{ width:0 }} animate={{ width:`${progresso}%` }} transition={{ duration:.9, ease }}
              style={{ height:'100%', borderRadius:4, background:'linear-gradient(90deg,var(--cyan2),var(--cyan))', boxShadow:'0 0 10px rgba(0,212,255,.5)' }} />
          </div>
        </div>
      )}

      {/* Próximo disparo */}
      {proximoItem && (
        <div style={{ margin:'0 14px 10px', padding:'8px 12px', background:'linear-gradient(90deg,rgba(0,212,255,.05),rgba(0,212,255,.02))', border:'1px solid rgba(0,212,255,.14)', borderRadius:10, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 8px var(--green)', flexShrink:0, animation:'blink 1.8s infinite' }} />
          <span style={{ fontSize:11, color:'var(--text2)' }}>Próximo</span>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--cyan)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{(() => { const a = (proximoItem.accounts||[]).find(x => x && typeof x === 'object' && x.username); return a?.username || '—'; })()}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', marginLeft:'auto', flexShrink:0 }}>{fmtTime(proximoItem.scheduledAt)}</span>
        </div>
      )}

      {/* Queue list */}
      <div style={{ flex:1, overflow:'hidden', padding:'0 10px' }}>
        {queueItems.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:90, color:'var(--text3)', gap:8 }}>
            <Layers3 size={22} opacity={.25} />
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'.06em' }}>FILA VAZIA</span>
          </div>
        ) : (
          <div>
            {queueItems.map((item, i) => {
              const acc = (item.accounts||[]).find(a => a && typeof a === 'object' && a.username);
              return (
              <motion.div key={item._id || i} initial={{ opacity:0, x:-6 }} animate={{ opacity:1, x:0 }} transition={{ delay:i*.04 }}
                style={{ display:'flex', alignItems:'center', gap:9, padding:'7px 6px', borderRadius:8, borderBottom:'1px solid rgba(255,255,255,.03)', transition:'background .15s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(0,212,255,.03)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}
              >
                <AvatarChip username={acc?.username} avatar={acc?.avatar} size={26} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>@{acc?.username || '—'}</div>
                  <div style={{ fontSize:10, color:'var(--text3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginTop:1 }}>{item.postType || 'Reels'}</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)' }}>{fmtTime(item.scheduledAt)}</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:700, color: STATUS_COLOR[item.status] || 'var(--text3)', marginTop:2, letterSpacing:'.04em' }}>
                    {STATUS_LABEL[item.status] || String(item.status||'PENDENTE').toUpperCase()}
                  </div>
                </div>
              </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Paused alert */}
      <AnimatePresence>
        {pausedCount > 0 && (
          <motion.div initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            style={{ margin:'8px 14px 14px', padding:'8px 12px', background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.18)', borderRadius:10, display:'flex', alignItems:'center', gap:7, fontSize:11, color:'var(--amber)' }}>
            <AlertTriangle size={13} style={{ flexShrink:0 }} />
            {pausedCount} conta(s) em pausa automática.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ── LOOPS EM EXECUÇÃO
   ══════════════════════════════════════════════════════ */
function LoopsPanel({ loops }) {
  const activeLoops = useMemo(() => loops.filter(l => l.status === 'ativo'), [loops]);

  const grouped = useMemo(() => {
    const map = {};
    for (const loop of activeLoops) {
      for (const acc of (loop.accounts || [])) {
        const k = acc._id || acc;
        if (!map[k]) map[k] = { account: acc, loops: [] };
        map[k].loops.push(loop);
      }
    }
    return Object.values(map);
  }, [activeLoops]);

  const totalRemaining = useMemo(() => activeLoops.reduce((s, l) => {
    const total = l.mediaFiles?.length || 0;
    const sent  = l.postsCount || 0;
    if (total === 0) return s;
    const rem = total - (sent % total);
    return s + rem;
  }, 0), [activeLoops]);

  const fmtNext = l => {
    if (l.nextPostAt) {
      const diff = new Date(l.nextPostAt) - Date.now();
      if (diff <= 0) return 'agora';
      const m = Math.round(diff / 60000);
      return `em ${m}m`;
    }
    return `${l.intervalMinutes || '—'}m`;
  };

  return (
    <div style={{ ...card, display:'flex', flexDirection:'column', borderColor:'rgba(139,92,246,.12)' }} className="lift">
      {/* purple ambient orb */}
      <div style={{ position:'absolute', top:-60, right:-40, width:180, height:180, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.08),transparent 70%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:0, left:20, right:20, height:1, background:'linear-gradient(90deg,transparent,oklch(0.65 0.22 295 / 0.55),transparent)' }} />

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.05)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(139,92,246,.1)', border:'1px solid rgba(139,92,246,.22)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Repeat2 size={13} style={{ color:'#a78bfa' }} />
          </div>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--text2)', textTransform:'uppercase' }}>Loops em execução</span>
        </div>
        <Link to="/loop" style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text3)', textDecoration:'none', padding:'3px 9px', borderRadius:6, border:'1px solid rgba(255,255,255,.07)', background:'rgba(255,255,255,.03)', transition:'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.color='#a78bfa'; e.currentTarget.style.borderColor='rgba(139,92,246,.25)'; }}
          onMouseLeave={e => { e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='rgba(255,255,255,.07)'; }}
        >Gerenciar <ChevronRight size={12} /></Link>
      </div>

      {/* Summary hero */}
      <div style={{ padding:'14px 16px 12px', borderBottom:'1px solid rgba(255,255,255,.04)', flexShrink:0, position:'relative' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
          <div style={{ fontSize:42, fontWeight:800, letterSpacing:'-2px', lineHeight:1, background:'linear-gradient(135deg,#c4b5fd,#a78bfa,#7c3aed)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text', fontVariantNumeric:'tabular-nums' }}>
            <NumberTicker value={totalRemaining} />
          </div>
          <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.4 }}>
            reels<br/>restantes
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8 }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:'rgba(139,92,246,.1)', border:'1px solid rgba(139,92,246,.22)', borderRadius:20, padding:'3px 10px', fontSize:11, fontWeight:700, color:'#a78bfa' }}>
            <Play size={9} style={{ fill:'#a78bfa' }} />{activeLoops.length} loop(s) ativo(s)
          </span>
          {grouped.length > 0 && (
            <span style={{ fontSize:11, color:'var(--text3)' }}>{grouped.length} conta(s)</span>
          )}
        </div>
      </div>

      {/* Per-account list */}
      <div style={{ flex:1, overflow:'auto', padding:'4px 0' }}>
        {grouped.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:120, color:'var(--text3)', gap:8 }}>
            <Repeat2 size={24} opacity={.2} />
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'.06em' }}>NENHUM LOOP ATIVO</span>
          </div>
        ) : (
          grouped.slice(0, 8).map(({ account, loops: al }, gi) => {
            const loop      = al[0];
            const total     = loop.mediaFiles?.length || 0;
            const sent      = loop.postsCount || 0;
            const cyclePos  = total > 0 ? sent % total : 0;
            const remaining = total > 0 ? total - cyclePos : 0;
            const pct       = total > 0 ? Math.round(cyclePos / total * 100) : 0;
            const avatarSrc = account.avatar ? `${API_BASE}${account.avatar}` : null;
            const isDone    = remaining === 0;

            return (
              <motion.div key={account._id || gi} initial={{ opacity:0, x:6 }} animate={{ opacity:1, x:0 }} transition={{ delay:gi*.04 }}
                style={{ padding:'9px 16px', borderBottom:'1px solid rgba(255,255,255,.04)', transition:'background .15s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(139,92,246,.03)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}
              >
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:32, height:32, borderRadius:'50%', overflow:'hidden', border:`1.5px solid ${isDone?'rgba(16,185,129,.35)':'rgba(139,92,246,.3)'}`, flexShrink:0, background:'rgba(14,20,34,1)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {avatarSrc
                      ? <img src={avatarSrc} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none'; }} />
                      : <span style={{ fontSize:12, fontWeight:700, color: isDone?'var(--green)':'#a78bfa' }}>{(account.username||'?')[0].toUpperCase()}</span>
                    }
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>@{account.username}</div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:800, color: isDone?'var(--green)':'#a78bfa', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{cyclePos}/{total}</div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:2 }}>
                      <span style={{ fontSize:10, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'60%' }}>{loop.name}</span>
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color: isDone?'var(--green)':'rgba(167,139,250,.7)' }}>
                        {isDone ? 'ciclo concluído' : `${remaining} · ${fmtNext(loop)}`}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop:7, height:3, background:'rgba(255,255,255,.06)', borderRadius:3, overflow:'hidden' }}>
                  <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:.7, ease }}
                    style={{ height:'100%', borderRadius:3, background: isDone ? 'linear-gradient(90deg,var(--green),#34d399)' : 'linear-gradient(90deg,#6d28d9,#a78bfa)', boxShadow: isDone ? '0 0 8px rgba(16,185,129,.5)' : '0 0 8px rgba(139,92,246,.5)' }} />
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ── TOP CONTAS · VISUALIZAÇÕES
   ══════════════════════════════════════════════════════ */
const MEDALS = ['🥇','🥈','🥉'];

function TopViewsRanking({ d }) {
  const list     = useMemo(() => (d.avgEngagementByAccount || []).slice(0, 9), [d.avgEngagementByAccount]);
  const maxViews = useMemo(() => Math.max(...list.map(a => a.totalViews || 0), 1), [list]);
  const totalV   = useMemo(() => list.reduce((s,a) => s+(a.totalViews||0), 0), [list]);

  if (list.length === 0) return (
    <div style={{ ...card, padding:'32px', textAlign:'center', color:'var(--text3)' }}>
      <Eye size={28} style={{ marginBottom:10, opacity:.18 }} />
      <div style={{ fontSize:13 }}>Nenhum dado. Faça Sync em Top Posts.</div>
    </div>
  );

  const rankColor = i => ['#fbbf24','#94a3b8','#cd7c3a'][i] || 'rgba(255,255,255,.2)';

  return (
    <div style={{ ...card, overflow:'hidden', borderColor:'rgba(251,191,36,.1)' }} className="lift">
      {/* gold ambient */}
      <div style={{ position:'absolute', top:-50, right:-40, width:160, height:160, borderRadius:'50%', background:'radial-gradient(circle,rgba(251,191,36,.07),transparent 70%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:0, left:20, right:20, height:1, background:'linear-gradient(90deg,transparent,oklch(0.85 0.15 80 / 0.5),transparent)' }} />

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.05)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(251,191,36,.1)', border:'1px solid rgba(251,191,36,.22)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Eye size={13} style={{ color:'#fbbf24' }} />
          </div>
          <div>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--text2)', textTransform:'uppercase', display:'block' }}>Top Contas · Views</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)', letterSpacing:'.04em' }}>30 DIAS · {fmtK(totalV)} TOTAL</span>
          </div>
        </div>
        <Link to="/top-posts" style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text3)', textDecoration:'none', padding:'3px 9px', borderRadius:6, border:'1px solid rgba(255,255,255,.07)', background:'rgba(255,255,255,.03)', transition:'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.color='#fbbf24'; e.currentTarget.style.borderColor='rgba(251,191,36,.25)'; }}
          onMouseLeave={e => { e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='rgba(255,255,255,.07)'; }}
        >Top posts <ChevronRight size={12} /></Link>
      </div>

      {/* Ranking list */}
      <div>
        {list.map((acc, i) => {
          const views    = acc.totalViews || 0;
          const pct      = Math.round((views / maxViews) * 100);
          const isTop3   = i < 3;
          const isTop    = i === 0;
          const rc       = rankColor(i);
          const avatarUrl = acc.avatar
            ? (acc.avatar.startsWith('/uploads') ? `${API_BASE}${acc.avatar}` : proxyImg(acc.avatar))
            : null;

          return (
            <motion.div key={acc.accountId || i}
              whileHover={{ background: isTop ? 'rgba(251,191,36,.03)' : 'rgba(255,255,255,.02)' }}
              transition={{ duration:.15 }}
              style={{
                padding: isTop ? '11px 16px 9px' : '9px 16px 7px',
                borderBottom: i < list.length-1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                borderLeft: isTop ? '2px solid rgba(251,191,36,.5)' : isTop3 ? `2px solid ${rc}40` : '2px solid transparent',
                background: isTop ? 'linear-gradient(90deg,rgba(251,191,36,.03),transparent)' : 'transparent',
              }}
            >
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                {/* rank */}
                <div style={{ width:22, textAlign:'center', flexShrink:0 }}>
                  {isTop3
                    ? <span style={{ fontSize:14, lineHeight:1 }}>{MEDALS[i]}</span>
                    : <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, color:'rgba(255,255,255,.2)' }}>{String(i+1).padStart(2,'0')}</span>
                  }
                </div>

                {/* avatar */}
                <div style={{ width: isTop?34:28, height: isTop?34:28, borderRadius:'50%', overflow:'hidden', flexShrink:0,
                  border:`${isTop?'2px':'1.5px'} solid ${isTop?'rgba(251,191,36,.5)':'rgba(255,255,255,.12)'}`,
                  background:'rgba(10,20,38,1)', display:'flex', alignItems:'center', justifyContent:'center',
                  boxShadow: isTop ? '0 0 12px rgba(251,191,36,.3)' : 'none',
                  transition:'all .2s',
                }}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none'; }} />
                    : <span style={{ fontSize: isTop?13:11, fontWeight:700, color: isTop?'#fbbf24':'var(--cyan)' }}>{(acc.username||'?')[0].toUpperCase()}</span>
                  }
                </div>

                {/* info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize: isTop?13:12, fontWeight:700, color: isTop?'#ffe9a0':'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    @{acc.username}
                  </div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)', marginTop:2, letterSpacing:'.03em' }}>
                    {acc.totalPosts} posts · {fmtK(acc.avgViews)}/post
                  </div>
                </div>

                {/* views */}
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize: isTop?18:14, fontWeight:800, letterSpacing:'-0.5px', fontVariantNumeric:'tabular-nums',
                    color: isTop?'#fbbf24':'var(--cyan)',
                    textShadow: isTop ? '0 0 16px rgba(251,191,36,.5)' : '0 0 10px rgba(0,212,255,.3)',
                  }}>{fmtK(views)}</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)', marginTop:1 }}>views</div>
                </div>
              </div>

              {/* bar */}
              <div style={{ marginTop:6, height: isTop?3:2, background:'rgba(255,255,255,.05)', borderRadius:3, overflow:'hidden', marginLeft:22+10+(isTop?34:28)+10 }}>
                <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:.65, delay:i*.04, ease }}
                  style={{ height:'100%', borderRadius:3,
                    background: isTop ? 'linear-gradient(90deg,#f59e0b,#fbbf24,var(--cyan))' : isTop3 ? `${rc}` : 'rgba(0,212,255,.45)',
                    boxShadow: isTop ? '0 0 8px rgba(251,191,36,.5)' : 'none',
                  }} />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ── PostagensTable ── */
function PostagensTable({ stats }) {
  const [col, setCol] = useState('hoje');
  const sorted = useMemo(() => [...stats].sort((a,b) => {
    const va = col==='hoje'?a.postsToday:col==='7d'?a.posts7d:a.posts30d;
    const vb = col==='hoje'?b.postsToday:col==='7d'?b.posts7d:b.posts30d;
    return vb-va;
  }), [stats, col]);
  const totals = useMemo(() => stats.reduce((acc,s) => ({ hoje:acc.hoje+s.postsToday,'7d':acc['7d']+s.posts7d,'30d':acc['30d']+s.posts30d }), { hoje:0,'7d':0,'30d':0 }), [stats]);
  const thS = { fontSize:10, color:'var(--text3)', fontWeight:600, letterSpacing:'.08em', padding:'8px 12px', textAlign:'right', borderBottom:'1px solid rgba(255,255,255,.05)', cursor:'pointer', whiteSpace:'nowrap' };
  return (
    <div style={{ ...card }} className="lift">
      <PanelHeader title="Postagens por conta" icon={Send} right={
        <div style={{ display:'flex', gap:4 }}>
          {PERIODS.map(p => <SelectBtn key={p.value} active={col===p.value} onClick={() => setCol(p.value)}>{p.label}</SelectBtn>)}
        </div>
      } />
      <div style={{ padding:'8px 14px 6px', fontSize:11, color:'var(--text3)', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
        {stats.length} conta(s) ·&nbsp;
        <span style={{ color:'var(--cyan)', fontWeight:700 }}>{fmt(totals.hoje)}</span> hoje ·&nbsp;
        <span style={{ color:'var(--cyan)', fontWeight:700 }}>{fmt(totals['7d'])}</span> em 7d ·&nbsp;
        <span style={{ color:'var(--cyan)', fontWeight:700 }}>{fmt(totals['30d'])}</span> em 30d
      </div>
      <div className="tbl-sticky-first">
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:520 }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign:'left' }}>CONTA</th>
              {[{ label:'HOJE',value:'hoje' },{ label:'7 DIAS',value:'7d' },{ label:'30 DIAS',value:'30d' }].map(p => (
                <th key={p.value} style={{ ...thS, color:col===p.value?'var(--cyan)':'var(--text3)' }} onClick={() => setCol(p.value)}>{p.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={4} style={{ padding:'20px 12px', color:'var(--text3)', fontSize:12 }}>Nenhuma postagem no período.</td></tr>
            ) : sorted.map((acc, i) => (
              <motion.tr key={acc._id} initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:i*.03 }}
                style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(0,180,255,.025)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}
              >
                <td style={{ padding:'9px 12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                    <AvatarChip username={acc.username} avatar={acc.avatar} />
                    <div>
                      <div style={{ fontWeight:600, fontSize:13, color:'var(--text)' }}>@{acc.username}</div>
                      <div style={{ fontSize:10, color:'var(--text3)' }}>{fmtK(acc.followers)} seguidores</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:700, fontSize:14, color:col==='hoje'?'var(--cyan)':'var(--text)', fontVariantNumeric:'tabular-nums' }}>{fmt(acc.postsToday)}</td>
                <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:700, fontSize:14, color:col==='7d'?'var(--cyan)':'var(--text)', fontVariantNumeric:'tabular-nums' }}>{fmt(acc.posts7d)}</td>
                <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:700, fontSize:14, color:col==='30d'?'var(--cyan)':'var(--text)', fontVariantNumeric:'tabular-nums' }}>{fmt(acc.posts30d)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── PerformanceTable ── */
function PerformanceTable({ stats }) {
  const agg = useMemo(() => stats.reduce((acc,a) => ({ followers:acc.followers+a.followers, published:acc.published+a.posts30d, failures:acc.failures+a.failures30d, growth:acc.growth+(a.growth30d||0) }), { followers:0, published:0, failures:0, growth:0 }), [stats]);
  const successRate = (agg.published+agg.failures)>0 ? Math.round(agg.published/(agg.published+agg.failures)*100) : 0;
  const fmtDate = d => { if (!d) return '—'; const dt=new Date(d); return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}, ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`; };
  const thS = { fontSize:10, color:'var(--text3)', fontWeight:600, letterSpacing:'.07em', padding:'8px 10px', textAlign:'right', borderBottom:'1px solid rgba(255,255,255,.05)', whiteSpace:'nowrap' };
  return (
    <div style={{ ...card }} className="lift">
      <PanelHeader title="Performance por conta" icon={TrendingUp} right={
        <div style={{ display:'flex', alignItems:'center', gap:12, fontSize:11, flexWrap:'wrap' }}>
          <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:6, height:6, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', display:'inline-block' }} /><span style={{ color:'var(--green)', fontWeight:700, fontSize:10 }}>LIVE</span></span>
          <span style={{ color:'var(--text3)', fontSize:11 }}>Seg <strong style={{ color:'var(--cyan)' }}>{fmtK(agg.followers)}</strong></span>
          <span style={{ color:'var(--text3)', fontSize:11 }}>Pub <strong style={{ color:'var(--cyan)' }}>{fmt(agg.published)}</strong></span>
          <span style={{ color:'var(--text3)', fontSize:11 }}>Falhas <strong style={{ color:'var(--red)' }}>{fmt(agg.failures)}</strong></span>
          <span style={{ color:'var(--text3)', fontSize:11 }}>Sucesso <strong style={{ color:'var(--green)' }}>{successRate}%</strong></span>
        </div>
      } />
      <div className="tbl-scroll-wrap">
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:700 }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign:'left', width:36 }}>#</th>
              <th style={{ ...thS, textAlign:'left' }}>CONTA</th>
              <th style={thS}>STATUS</th>
              <th style={thS}>SEGUIDORES</th>
              <th className="col-mob-hide" style={thS}>CRESCIMENTO 30D</th>
              <th style={thS}>PUBLICADOS</th>
              <th style={thS}>FALHAS</th>
              <th style={thS}>SUCESSO</th>
              <th className="col-mob-hide" style={thS}>MÍDIAS</th>
              <th className="col-mob-hide" style={thS}>ÚLTIMA SYNC</th>
            </tr>
          </thead>
          <tbody>
            {stats.length===0 ? (
              <tr><td colSpan={10} style={{ padding:'20px 10px', color:'var(--text3)', fontSize:12 }}>Nenhuma conta encontrada.</td></tr>
            ) : stats.map((acc,idx) => {
              const growth = acc.growth30d||0;
              return (
                <motion.tr key={acc._id} initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:idx*.025 }}
                  style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(0,180,255,.025)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}
                >
                  <td style={{ padding:'9px 10px', fontSize:11, color:'var(--text3)', fontWeight:600 }}>{String(idx+1).padStart(2,'0')}</td>
                  <td style={{ padding:'9px 10px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <AvatarChip username={acc.username} avatar={acc.avatar} size={28} />
                      <div>
                        <div style={{ fontWeight:600, fontSize:12, color:'var(--text)', whiteSpace:'nowrap' }}>@{acc.username}</div>
                        <div style={{ fontSize:10, color:'var(--text3)' }}>{acc.following} seguindo</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'9px 10px', textAlign:'right' }}><StatusBadge status={acc.status} /></td>
                  <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, color:'var(--text)', fontSize:13, fontVariantNumeric:'tabular-nums' }}>{fmtK(acc.followers)}</td>
                  <td className="col-mob-hide" style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, fontSize:13, color:growth>0?'var(--green)':growth<0?'var(--red)':'var(--text3)', fontVariantNumeric:'tabular-nums' }}>{growth>0?'+':''}{fmt(growth)}</td>
                  <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, color:'var(--cyan)', fontSize:13, fontVariantNumeric:'tabular-nums' }}>{fmt(acc.posts30d)}</td>
                  <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, fontSize:13, color:acc.failures30d>10?'var(--red)':acc.failures30d>0?'var(--amber)':'var(--text3)', fontVariantNumeric:'tabular-nums' }}>{fmt(acc.failures30d)}</td>
                  <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, fontSize:13, color:acc.posts30d===0?'var(--text3)':acc.successRate>=80?'var(--green)':acc.successRate>=60?'var(--amber)':'var(--red)' }}>{acc.posts30d===0?'—':`${acc.successRate}%`}</td>
                  <td className="col-mob-hide" style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, color:'var(--text)', fontSize:13, fontVariantNumeric:'tabular-nums' }}>{fmt(acc.postsCount)}</td>
                  <td className="col-mob-hide" style={{ padding:'9px 10px', textAlign:'right', fontSize:11, color:'var(--text3)', whiteSpace:'nowrap' }}>{fmtDate(acc.lastSync)}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── SmartInsights ── */
function InsightCard({ icon, title, value, sub, detail, color }) {
  return (
    <motion.div variants={fadeUp} whileHover={{ y:-3, boxShadow:`0 16px 44px rgba(0,0,0,.52), 0 0 0 1px ${color}25` }} transition={spring}
      style={{ background:'oklch(0.16 0.05 235 / 0.75)', border:`1px solid ${color}20`, borderRadius:16, padding:'16px 18px', display:'flex', flexDirection:'column', gap:10, position:'relative', overflow:'hidden' }}
      className="sheen">
      <div style={{ position:'absolute', top:-20, right:-14, width:80, height:80, borderRadius:'50%', background:`${color}08`, pointerEvents:'none' }} />
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ width:34, height:34, borderRadius:10, background:`${color}15`, border:`1px solid ${color}28`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0, color }}>{icon}</span>
        <div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:700, color:'var(--text3)', letterSpacing:'.1em', textTransform:'uppercase' }}>{title}</div>
          <div style={{ fontSize:22, fontWeight:800, color, lineHeight:1.1, marginTop:2 }}>{value}</div>
        </div>
      </div>
      <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.55 }}>{sub}</div>
      {detail && <div style={{ fontSize:11, color:`${color}cc`, fontWeight:600, borderTop:`1px solid ${color}15`, paddingTop:8 }}>{detail}</div>}
    </motion.div>
  );
}

function SmartInsights({ accountStats, data: d }) {
  const totalAccounts  = accountStats.length;
  const healthy        = accountStats.filter(a => a.healthStatus==='ativa'||a.status==='connected').length;
  const banned         = accountStats.filter(a => a.healthStatus==='banida').length;
  const tokenFailed    = accountStats.filter(a => ['token_invalido','sessao_expirada'].includes(a.healthStatus)).length;
  const successRate    = totalAccounts > 0 ? Math.round(healthy/totalAccounts*100) : 0;
  const totalFollowers = accountStats.reduce((s,a) => s+(a.followers||0), 0);
  const growth30d      = accountStats.reduce((s,a) => s+(a.growth30d||0), 0);
  const growthPct      = totalFollowers > 0 ? ((growth30d/totalFollowers)*100).toFixed(2) : '0.00';
  const posts30d       = accountStats.reduce((s,a) => s+(a.posts30d||0), 0);
  const failures30d    = accountStats.reduce((s,a) => s+(a.failures30d||0), 0);
  const postSuccessRate= (posts30d+failures30d)>0 ? Math.round(posts30d/(posts30d+failures30d)*100) : 100;
  const bestAccount    = [...accountStats].sort((a,b) => (b.followers||0)-(a.followers||0))[0];
  const worstAccount   = banned > 0 ? accountStats.find(a => a.healthStatus==='banida') : null;

  const insights = [
    { icon:<TrendingUp size={17}/>, title:'CRESCIMENTO 30 DIAS', value:growth30d>=0?`+${fmtK(growth30d)}`:fmtK(growth30d),
      sub:`${totalAccounts} conta(s) geraram ${growth30d>=0?'+':''}${growthPct}% de crescimento no total de seguidores nos últimos 30 dias.`,
      detail:growth30d>0?`Melhor conta: @${bestAccount?.username||'—'} com ${fmtK(bestAccount?.followers)} seguidores`:totalAccounts===0?'Adicione contas para ver o crescimento.':'Nenhum crescimento registrado ainda.',
      color:growth30d>=0?'var(--cyan)':'var(--red)' },
    { icon:<HeartPulse size={17}/>, title:'SAÚDE DAS CONTAS', value:`${successRate}%`,
      sub:`${healthy} de ${totalAccounts} conta(s) saudáveis. ${banned>0?`${banned} banida(s)`:'Nenhuma banida'}. ${tokenFailed>0?`${tokenFailed} com token expirado.`:''}`.trim(),
      detail:banned>0?`Conta banida: @${worstAccount?.username||'—'}`:tokenFailed>0?`${tokenFailed} token(s) precisam ser renovados`:'Todas as contas em perfeita saúde',
      color:successRate>=80?'var(--green)':successRate>=60?'var(--amber)':'var(--red)' },
    { icon:<Zap size={17}/>, title:'TAXA DE PUBLICAÇÃO', value:`${postSuccessRate}%`,
      sub:`${posts30d} postagens concluídas e ${failures30d} falhas nos últimos 30 dias.`,
      detail:postSuccessRate<80?'Taxa abaixo do ideal — verifique os logs':failures30d>0?`${failures30d} falha(s) detectada(s)`:'Publicações perfeitas sem falhas',
      color:postSuccessRate>=90?'var(--green)':postSuccessRate>=70?'var(--amber)':'var(--red)' },
    { icon:<Layers3 size={17}/>, title:'FILA E AGENDAMENTOS', value:fmtK((d.pendingPosts||0)+(d.scheduledPosts||0)),
      sub:`${d.pendingPosts||0} na fila + ${d.scheduledPosts||0} agendadas. ${d.processingPosts>0?`${d.processingPosts} publicando agora.`:''}`.trim(),
      detail:(d.pendingPosts||0)+(d.scheduledPosts||0)===0?'Fila vazia — adicione conteúdo':(d.pendingPosts||0)>10?`Ótima fila — ${d.pendingPosts} posts prontos`:'Fila ativa com posts programados',
      color:'#a78bfa' },
  ];

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" style={{ padding:'0 0 4px' }}>
      <div style={{ fontFamily:'var(--font-mono)', display:'flex', alignItems:'center', gap:7, fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--cyan)', marginBottom:12, textTransform:'uppercase' }}>
        <TrendingUp size={13} /> Insights inteligentes
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
        {insights.map(ins => <InsightCard key={ins.title} {...ins} />)}
      </div>
    </motion.section>
  );
}

/* ══════════════════════════════════════════════════════
   ── PAINEL DE POSTAGENS EM TEMPO REAL
   ══════════════════════════════════════════════════════ */
const LIVE_TABS = [
  { key:'processing', label:'Processando', color:'#00d4ff',  emptyText:'Nenhuma publicação em andamento.' },
  { key:'queue',      label:'Fila',        color:'#a78bfa',  emptyText:'Fila vazia.' },
  { key:'errors',     label:'Erros (1h)',  color:'#f43f5e',  emptyText:'Nenhum erro na última hora.' },
  { key:'completed',  label:'Concluídos (1h)', color:'#10b981', emptyText:'Nenhuma publicação concluída na última hora.' },
];

const LIVE_STATUS_COLOR = {
  processando:'#00d4ff', pendente:'#a78bfa', agendado:'#f59e0b',
  concluido:'#10b981',   parcial:'#f59e0b',  erro:'#f43f5e',
};
const LIVE_STATUS_LABEL = {
  processando:'PROCESSANDO', pendente:'NA FILA', agendado:'AGENDADO',
  concluido:'CONCLUÍDO',     parcial:'PARCIAL',  erro:'ERRO',
};

function LivePostRow({ post, API_BASE }) {
  const acc     = (post.accounts||[])[0];
  const caption = (post.caption||'').slice(0, 55) + ((post.caption||'').length > 55 ? '…' : '');
  const sc      = LIVE_STATUS_COLOR[post.status] || '#888';
  const sl      = LIVE_STATUS_LABEL[post.status] || post.status?.toUpperCase();
  const fmtAgo  = t => {
    if (!t) return '';
    const s = Math.round((Date.now() - new Date(t)) / 1000);
    if (s < 60)  return `${s}s atrás`;
    if (s < 3600) return `${Math.round(s/60)}m atrás`;
    return `${Math.round(s/3600)}h atrás`;
  };

  return (
    <motion.div initial={{ opacity:0, x:-4 }} animate={{ opacity:1, x:0 }}
      style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:'1px solid rgba(255,255,255,.04)', transition:'background .15s' }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.025)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}
    >
      {acc && <AvatarChip username={acc.username} avatar={acc.avatar} size={28} />}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {acc ? `@${acc.username}` : '—'}
          {(post.accounts||[]).length > 1 && (
            <span style={{ marginLeft:5, fontSize:10, color:'var(--text3)' }}>+{post.accounts.length-1}</span>
          )}
        </div>
        {caption && <div style={{ fontSize:10, color:'var(--text3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginTop:1 }}>{caption}</div>}
        {post.error && <div style={{ fontSize:10, color:'#f43f5e', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginTop:1 }}>{post.error.slice(0,80)}</div>}
      </div>
      <div style={{ textAlign:'right', flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:800, color:sc, background:`${sc}14`, border:`1px solid ${sc}30`, padding:'2px 6px', borderRadius:5, letterSpacing:'.05em' }}>{sl}</span>
        <span style={{ fontSize:9, color:'var(--text3)' }}>{fmtAgo(post.updatedAt)}</span>
      </div>
    </motion.div>
  );
}

function LivePostsPanel() {
  const [tab,  setTab]  = useState('processing');
  const [data, setData] = useState({ processing:[], queue:[], errors:[], completed:[] });

  const load = useCallback(async () => {
    try { const r = await api.get('/dashboard/live-posts'); setData(r.data || {}); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 5_000); return () => clearInterval(id); }, [load]);
  useServerEvents(['posts'], load);

  const active   = LIVE_TABS.find(t => t.key === tab);
  const rows     = data[tab] || [];
  const counts   = { processing: data.processing?.length||0, queue: data.queue?.length||0, errors: data.errors?.length||0, completed: data.completed?.length||0 };

  return (
    <div style={{ ...card, display:'flex', flexDirection:'column', minHeight:340 }} className="lift">
      <div style={{ position:'absolute', top:0, left:20, right:20, height:1, background:'linear-gradient(90deg,transparent,rgba(0,212,255,.32),transparent)' }} />

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.05)', flexWrap:'wrap', gap:8, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(0,212,255,.1)', border:'1px solid rgba(0,212,255,.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <ListVideo size={13} style={{ color:'var(--cyan)' }} />
          </div>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--text2)', textTransform:'uppercase' }}>Postagens em tempo real</span>
        </div>
        {/* Dot pulse when processing */}
        {counts.processing > 0 && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, color:'var(--cyan)', fontWeight:700 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--cyan)', boxShadow:'0 0 8px var(--cyan)', animation:'blink 1.4s infinite', display:'inline-block' }} />
            {counts.processing} publicando agora
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, padding:'10px 14px 6px', flexShrink:0, overflowX:'auto' }}>
        {LIVE_TABS.map(t => {
          const isActive = tab === t.key;
          const cnt = counts[t.key];
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding:'4px 12px', borderRadius:7, fontSize:10, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
              background: isActive ? `${t.color}18` : 'rgba(255,255,255,.04)',
              color:      isActive ? t.color : 'var(--text3)',
              border:     `1px solid ${isActive ? `${t.color}35` : 'rgba(255,255,255,.07)'}`,
              transition:'all .15s',
            }}>
              {t.label}
              {cnt > 0 && (
                <span style={{ marginLeft:5, background:isActive?`${t.color}28`:'rgba(255,255,255,.08)', color:isActive?t.color:'var(--text3)', borderRadius:10, padding:'1px 6px', fontSize:9, fontWeight:800 }}>{cnt}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {rows.length === 0 ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:120, color:'var(--text3)', fontSize:12, gap:8 }}>
            <Eye size={18} opacity={.2} />{active?.emptyText}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map(p => <LivePostRow key={p._id} post={p} API_BASE={API_BASE} />)}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ── DASHBOARD
   ══════════════════════════════════════════════════════ */
export default function Dashboard() {
  const [data,          setData]          = useState(null);
  const [accountStats,  setAccountStats]  = useState([]);
  const [topInsights,   setTopInsights]   = useState([]);
  const [loops,         setLoops]         = useState([]);
  const [syncingIns,    setSyncingIns]    = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);
  const [toast,         setToast]         = useState('');
  const [period,        setPeriod]        = useState(7);
  const [accountsPeriod,setAccountsPeriod]= useState('hoje');
  const [problemsPeriod,setProblemsPeriod]= useState('hoje');
  const [proxyCount,    setProxyCount]    = useState(0);

  const loadRef  = useRef(null);
  // chartContainerRef removed — ResponsiveContainer handles sizing
  const showToast = msg => { setToast(msg); clearTimeout(window.__ifToast); window.__ifToast = setTimeout(() => setToast(''), 2600); };

  const load        = useCallback(async () => { try { const r = await api.get('/dashboard');                                                setData(r.data); }       catch { setData(d => d ?? {}); } }, []);
  const loadStats   = useCallback(async () => { try { const r = await api.get('/dashboard/account-stats');                                 setAccountStats(r.data||[]); } catch {} }, []);
  const loadInsights= useCallback(async () => { try { const r = await api.get('/insights', { params:{ period:'30d', limit:6 } });          setTopInsights(r.data?.insights||[]); } catch {} }, []);
  const loadProxies = useCallback(async () => { try { const r = await api.get('/proxies'); const list=r.data?.proxies||(Array.isArray(r.data)?r.data:[]); setProxyCount(list.length); } catch {} }, []);
  const loadLoops   = useCallback(async () => { try { const r = await api.get('/loops');                                                    setLoops(r.data||[]); }  catch {} }, []);

  loadRef.current = load;

  useEffect(() => { load(); loadStats(); loadInsights(); loadProxies(); loadLoops(); }, [load, loadStats, loadInsights, loadProxies, loadLoops]);
  useEffect(() => {
    const id = setInterval(() => { loadRef.current?.(); loadStats(); loadInsights(); loadProxies(); loadLoops(); }, 15_000);
    return () => clearInterval(id);
  }, [loadStats, loadInsights, loadProxies, loadLoops]);

  useServerEvents(['posts','accounts','sessions','health','insights','loop'], () => {
    loadRef.current?.(); loadStats(); loadInsights(); loadLoops();
  });

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.all([load(), loadStats(), loadInsights(), loadLoops()]).finally(() => {
      setTimeout(() => setRefreshing(false), 600);
      showToast('Dados sincronizados com sucesso.');
    });
  };

  const d = data || {};

  const sparkDaily   = useMemo(() => (d.dailyPosts||[]).slice(-period).map(x => x.posts||0), [d.dailyPosts, period]);
  const sparkErrors  = useMemo(() => (d.dailyErrors7d||[]).map(x => x.errors||0), [d.dailyErrors7d]);
  const forecastData = useMemo(() => {
    const past = (d.dailyPosts||[]).slice(-period).map(x => ({
      day:  x.label || x.date || '',
      iso:  (x.date || '').slice(0, 10),
      value: x.posts || 0,
      forecast: false,
    }));
    const todayISO = past.length > 0 ? past[past.length - 1].iso : new Date().toISOString().slice(0, 10);
    const futureMap = {};
    (d.upcomingPosts||[]).forEach(post => {
      let iso;
      try { iso = post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 10) : todayISO; }
      catch { iso = todayISO; }
      const count = post.accounts?.length || 1;
      futureMap[iso] = (futureMap[iso]||0) + count;
    });
    Object.entries(futureMap).forEach(([iso, value]) => {
      const existing = past.find(p => p.iso === iso);
      if (existing) { existing.value += value; existing.forecast = true; }
      else {
        const dt = new Date(iso + 'T12:00:00Z');
        past.push({ day: dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }), iso, value, forecast: true });
      }
    });
    // Separa em duas séries para colorir publicado (azul) e previsto (laranja)
    return past.map((p, i, arr) => {
      const isJunction = !p.forecast && (i === arr.length - 1 || arr[i + 1]?.forecast);
      return {
        ...p,
        published:  !p.forecast ? p.value : null,
        forecasted: p.forecast  ? p.value : (isJunction ? p.value : null),
      };
    });
  }, [d.dailyPosts, d.upcomingPosts, period]);

  const queueItems = [
    { label:'Postados hoje',   value:d.postsToday     ||0, color:'var(--cyan)'   },
    { label:'Erros hoje',      value:d.errorsToday    ||0, color:'var(--red)'    },
    { label:'Na fila',         value:d.pendingPosts   ||0, color:'var(--amber)'  },
    { label:'Processando',     value:d.processingPosts||0, color:'var(--green)'  },
    { label:'Agendados',       value:d.scheduledPosts ||0, color:'#a78bfa'       },
    { label:'Taxa de sucesso', value:`${d.successRate ||0}%`, color:'var(--cyan)'},
  ];

  const logs = useMemo(() => (d.activities||[]).slice(0,5).map(a => ({
    time:new Date(a.date||a.createdAt||Date.now()).toLocaleTimeString('pt-BR'),
    type:a.status==='concluido'?'success':a.status==='erro'?'warning':a.status==='ativa'?'success':'info',
    text:a.action||a.text||(a.type==='post'?'Publicação':'Atividade'), account:a.account||a.username||'', caption:a.caption||'', kind:a.type||'post',
  })), [d.activities]);

  const topAccounts = useMemo(() => (d.topAccounts||[]).slice(0,4), [d.topAccounts]);
  const activities  = useMemo(() => (d.activities||[]).slice(0,5).map(a => ({
    icon:a.status==='erro'?AlertTriangle:a.type==='account'?Activity:a.postType==='story'?Clock3:Send,
    text:a.action||a.text||(a.type==='post'?'Publicação':'Atividade'), account:a.account||a.username||'', caption:a.caption||'',
    time:new Date(a.date||a.createdAt||Date.now()).toLocaleTimeString('pt-BR',{ hour:'2-digit', minute:'2-digit' }),
    tone:a.status==='concluido'?'cyan':a.status==='erro'?'danger':a.status==='ativa'?'cyan':'amber',
  })), [d.activities]);

  const sysLoaded    = data !== null;
  const sysOk        = sysLoaded && d.system?.backend && d.system?.mongo;
  const sysDotColor  = !sysLoaded ? 'var(--text3)' : sysOk ? 'var(--green)' : 'var(--red)';
  const bannedCount  = useMemo(() => accountStats.filter(a => a.healthStatus==='banida').length, [accountStats]);
  const fallenCount  = useMemo(() => accountStats.filter(a => ['token_invalido','sessao_expirada'].includes(a.healthStatus)).length, [accountStats]);

  const accountsAddedValue = accountsPeriod==='hoje'?(d.accountsAddedToday||0):accountsPeriod==='7d'?(d.accountsAdded7d||0):(d.accountsAdded30d||0);
  const problemsValue      = problemsPeriod==='hoje'?(d.problemsToday||0):problemsPeriod==='7d'?(d.problems7d||0):(d.problems30d||0);

  return (
    <div style={{ display:'contents' }}>
      <div className="ambient-glow glow-one" aria-hidden="true" />
      <div className="ambient-glow glow-two" aria-hidden="true" />

      <main className="dashboard">

        {/* ── Header ── */}
        <BlurFade delay={0}>
          <header className="dash-header">
            <div className="header-left">
              <div>
                <div className="eyebrow">DASHBOARD</div>
                <div className="title-line">
                  <h1>Visão geral, <span className="text-gradient-brand">Vitor Marcelo</span></h1>
                  <span className="live-status">
                    <span style={{ background:sysDotColor, boxShadow:`0 0 10px ${sysDotColor}` }} />
                    {!sysLoaded ? 'Carregando...' : sysOk ? 'Todos os sistemas operacionais' : 'Verificar sistemas'}
                  </span>
                </div>
                <p>Contas, filas e atividade em tempo real.</p>
              </div>
            </div>
            <div className="toolbar">
              <div className="clock-chip"><Clock3 size={15} /><LiveClock /></div>
              <button className="toolbar-button" onClick={() => setPeriod(p => p===7?14:p===14?30:7)}>
                <span>{period}d</span><ChevronDown size={14} />
              </button>
              <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}
                className={`refresh-button ${refreshing?'is-refreshing':''}`} onClick={handleRefresh}>
                <RefreshCw size={16} style={{ animation:refreshing?'dash-spin .7s linear infinite':'' }} />Atualizar
              </motion.button>
            </div>
          </header>
        </BlurFade>

        {/* ── KPI Cards ── */}
        <motion.section variants={stagger} initial="hidden" animate="show" className="metric-grid">
          <MetricCard title="CONTAS ATIVAS"  value={fmt(d.activeAccounts)} meta={`${d.totalAccounts||0} total`}                            orbType="cyan"   spark={[]}         delay={0}    />
          <MetricCard title="POSTAGENS HOJE" value={fmt(d.postsToday)}     meta={`Meta: ${d.dailyPostLimit>0?fmt(d.dailyPostLimit):'—'}`}   orbType="warm"   spark={sparkDaily} delay={.06}  />
          <MetricCard title="ERROS HOJE"     value={fmt(d.errorsToday)}    meta={d.errorsToday>0?`${d.errorsToday} erro(s)`:'Nenhum erro'} orbType="violet" spark={sparkErrors} delay={.12}  />
          <MetricCard title="FILA"           value={fmt((d.pendingPosts||0)+(d.processingPosts||0)+(d.scheduledPosts||0))} meta={`${d.processingPosts||0} processando`} orbType="warm" spark={[]}         delay={.18} />
        </motion.section>

        {/* ── POSTAGENS EM TEMPO REAL ── */}
        <BlurFade delay={0.08} inView>
          <LivePostsPanel />
        </BlurFade>

        {/* ── FILA · LOOPS · TOP CONTAS ── */}
        <BlurFade delay={0.1} inView>
          <div className="dash-main-panels">
            <QueuePanel d={d} accountStats={accountStats} />
            <LoopsPanel loops={loops} />
            <TopViewsRanking d={d} />
          </div>
        </BlurFade>

        {/* ── Wide metrics ── */}
        <BlurFade delay={0} inView>
          <section className="wide-metric-row">
            <WideMetric title="CONTAS ADICIONADAS" value={fmt(accountsAddedValue)}
              subtitle={accountsPeriod==='hoje'?'adicionadas hoje':accountsPeriod==='7d'?'nos últimos 7 dias':'nos últimos 30 dias'}
              kind="orb" activePeriod={accountsPeriod} onPeriodChange={setAccountsPeriod} chip={`+${accountsAddedValue}`} spark={sparkDaily} />
            <WideMetric title="CONTAS COM PROBLEMA" value={fmt(problemsValue)}
              subtitle={problemsPeriod==='hoje'?'com problema hoje':problemsPeriod==='7d'?'com problema em 7d':'com problema total'}
              kind="ice" activePeriod={problemsPeriod} onPeriodChange={setProblemsPeriod} chip={`-${problemsValue}`} tone="muted" spark={sparkDaily} />
          </section>
        </BlurFade>

        {/* ── Quick actions ── */}
        <section className="quick-grid">
          {quickActions.map(({ title, subtitle, icon: Icon, to }, i) => (
            <motion.div key={title} variants={fadeUp} initial="hidden" animate="show" transition={{ delay:.1+i*.05, duration:.35, ease }}
              whileHover={{ y:-2, borderColor:'rgba(0,212,255,.22)', boxShadow:'0 10px 32px rgba(0,0,0,.45)' }}
            >
              <Link to={to} style={{ textDecoration:'none', display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:14, background:'oklch(0.16 0.05 235 / 0.88)', border:'1px solid oklch(1 0 0 / 0.07)', backdropFilter:'blur(14px)', cursor:'pointer', width:'100%', transition:'all .22s cubic-bezier(.4,0,.2,1)' }} className="sheen">
                <span className="quick-icon"><Icon size={22} /></span>
                <span className="quick-copy"><strong>{title}</strong><small>{subtitle}</small></span>
                <ChevronRight className="quick-chevron" size={18} />
              </Link>
            </motion.div>
          ))}
        </section>

        {/* ── Forecast + Queue summary ── */}
        <BlurFade delay={0} inView>
          <section className="operations-grid">
            <div className="panel forecast-panel" style={{ ...card, borderRadius:18 }}>
              <PanelHeader title="Previsão de postagens" icon={FolderOpen} right={
                <div style={{ display:'flex', gap:4 }}>
                  {[7,14,30].map(p => <SelectBtn key={p} active={period===p} onClick={() => setPeriod(p)}>{p}d</SelectBtn>)}
                </div>
              } />
              <div style={{ minHeight:190 }}>
                {forecastData.some(x => x.value>0) ? (
                  <>
                    <div style={{ padding:'8px 4px 4px', minHeight:160 }}>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={forecastData} margin={{ top:10, right:4, left:-28, bottom:0 }}>
                          <defs>
                            <linearGradient id="fg-chart" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%"   stopColor="#26c7ff" stopOpacity={.3} />
                              <stop offset="100%" stopColor="#26c7ff" stopOpacity={0}  />
                            </linearGradient>
                            <linearGradient id="fg-chart-amber" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%"   stopColor="#f59e0b" stopOpacity={.35} />
                              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}   />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="day" tick={{ fontSize:10, fill:'var(--text3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis allowDecimals={false} tick={{ fontSize:10, fill:'var(--text3)' }} tickLine={false} axisLine={false} />
                          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color:'var(--text)' }} formatter={(v, name) => [v, name === 'published' ? 'Publicado' : 'Previsto']} />
                          <Area type="monotone" dataKey="published"  stroke="var(--cyan)" strokeWidth={2} fill="url(#fg-chart)"       dot={false} activeDot={{ r:4, fill:'var(--cyan)' }} connectNulls={false} />
                          <Area type="monotone" dataKey="forecasted" stroke="#f59e0b"      strokeWidth={2} fill="url(#fg-chart-amber)" dot={false} activeDot={{ r:4, fill:'#f59e0b'      }} connectNulls={false} strokeDasharray="5 3" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    {forecastData.some(x => x.forecast) && (
                      <div style={{ display:'flex', gap:12, justifyContent:'flex-end', padding:'0 8px 8px', fontSize:10, color:'var(--text3)' }}>
                        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <span style={{ width:8, height:8, borderRadius:2, background:'var(--cyan)', display:'inline-block' }} />Publicado
                        </span>
                        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <span style={{ width:8, height:8, borderRadius:2, background:'#f59e0b', display:'inline-block' }} />Previsto
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:190, gap:10, padding:'16px 20px', textAlign:'center' }}>
                    <div style={{ color:'var(--cyan)', opacity:.55 }}>
                      <FolderOpen size={44} strokeWidth={1.2} />
                    </div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)' }}>Nenhuma postagem no período.</div>
                    <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.5, maxWidth:240 }}>
                      Ative um loop ou crie uma postagem para visualizar a previsão aqui.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="panel queue-panel" style={{ ...card, borderRadius:18 }}>
              <PanelHeader title="Resumo da fila" icon={Layers3} right={<SelectBtn active={false} onClick={() => {}}>Todos<ChevronDown size={12} style={{ marginLeft:2 }}/></SelectBtn>} />
              <div className="queue-body">
                <div className="queue-hourglass-wrap">
                  <div className="queue-orbit orbit-1" /><div className="queue-orbit orbit-2" />
                  <div className="hourglass"><span className="hg-top"/><span className="hg-middle"/><span className="hg-bottom"/><span className="hg-sand"/></div>
                </div>
                <ul className="queue-list">
                  {queueItems.map(item => (
                    <li key={item.label}>
                      <span className="queue-dot" style={{ backgroundColor:item.color }} />
                      <span>{item.label}</span>
                      <strong style={{ color:item.color }}>{item.value}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </BlurFade>

        {/* ── Postagens por Conta ── */}
        <BlurFade delay={0} inView>
          <PostagensTable stats={accountStats} />
        </BlurFade>

        {/* ── Performance por Conta ── */}
        <BlurFade delay={0} inView>
          <PerformanceTable stats={accountStats} />
        </BlurFade>

        {/* ── Smart Insights ── */}
        <BlurFade delay={0} inView>
          <SmartInsights accountStats={accountStats} data={d} />
        </BlurFade>

        {/* ── Top Posts widget ── */}
        <BlurFade delay={0} inView>
          <div style={{ ...card }} className="lift">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px 12px', borderBottom:'1px solid oklch(1 0 0 / 0.05)', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontFamily:'var(--font-mono)', display:'flex', alignItems:'center', gap:7, fontSize:10, fontWeight:700, letterSpacing:'.12em', color:'var(--cyan)', textTransform:'uppercase' }}>
                  <Flame size={13} /> Posts com mais visualizações
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>Top {topInsights.length||6} dos últimos 30 dias · dados da API do Instagram.</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}
                  disabled={syncingIns}
                  onClick={async () => { setSyncingIns(true); try { await api.post('/insights/sync'); await new Promise(r => setTimeout(r,1200)); await loadInsights(); } catch {} finally { setSyncingIns(false); } }}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:8, border:'1px solid rgba(0,212,255,.25)', background:'rgba(0,212,255,.08)', color:'var(--cyan)', fontSize:11, fontWeight:700, cursor:syncingIns?'not-allowed':'pointer', opacity:syncingIns?.6:1 }}>
                  <RefreshCw size={12} style={{ animation:syncingIns?'dash-spin .8s linear infinite':'none' }} />SYNC
                </motion.button>
                <Link to="/top-posts" style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 14px', borderRadius:8, border:'1px solid rgba(255,255,255,.07)', background:'rgba(255,255,255,.03)', color:'var(--text2)', fontSize:11, fontWeight:700, textDecoration:'none' }}>
                  VER TUDO <ChevronRight size={12} />
                </Link>
              </div>
            </div>
            <div style={{ padding:'14px 16px' }}>
              {topInsights.length === 0 ? (
                <div style={{ padding:'20px 0', textAlign:'center', fontSize:12, color:'var(--text3)' }}>Nenhum insight sincronizado. Clique em SYNC para importar.</div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(130px,100%),1fr))', gap:10 }}>
                  {topInsights.slice(0,6).map((ins,i) => (
                    <Link key={ins._id} to="/top-posts" style={{ textDecoration:'none' }}>
                      <InsightThumb ins={ins} rank={i} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </BlurFade>

        {/* ── Bottom grid ── */}
        <BlurFade delay={0} inView>
          <section className="bottom-grid">

            {/* LOGS */}
            <div style={{ ...card }} className="lift">
              <PanelHeader title="Logs recentes" right={
                <button className="view-all" onClick={() => showToast('Abrindo logs.')}>Ver todos <ChevronRight size={13}/></button>
              } />
              <ul style={{ listStyle:'none', margin:0, padding:'4px 14px', display:'flex', flexDirection:'column' }}>
                {logs.length===0 ? (
                  <li style={{ color:'var(--text3)', fontSize:11, padding:'16px 0' }}>Nenhum log ainda.</li>
                ) : logs.map((log,i) => (
                  <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                    <span className={`log-status ${log.type}`} style={{ flexShrink:0, marginTop:1 }}>
                      {log.type==='success'&&<ShieldCheck size={13}/>}
                      {log.type==='info'&&<Activity size={13}/>}
                      {log.type==='warning'&&<AlertTriangle size={13}/>}
                    </span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', lineHeight:1.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.text}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                        {log.account&&<span style={{ fontSize:10, color:'var(--cyan)', fontWeight:600 }}>@{log.account}</span>}
                        {log.caption&&<span style={{ fontSize:10, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.caption}</span>}
                      </div>
                    </div>
                    <time style={{ fontSize:10, color:'var(--text3)', flexShrink:0, paddingTop:2 }}>{log.time}</time>
                  </li>
                ))}
              </ul>
            </div>

            {/* CONTAS EM DESTAQUE */}
            <div style={{ ...card }} className="lift">
              <PanelHeader title="Contas em destaque" right={
                <button className="view-all" onClick={() => showToast('Abrindo ranking.')}>Ver todos <ChevronRight size={13}/></button>
              } />
              <ul style={{ listStyle:'none', margin:0, padding:'4px 14px', display:'flex', flexDirection:'column' }}>
                {topAccounts.length===0 ? (
                  <li style={{ color:'var(--text3)', fontSize:11, padding:'16px 0' }}>Nenhuma conta conectada.</li>
                ) : topAccounts.map((acc,i) => {
                  const score    = acc.healthScore??(acc.healthStatus==='ativa'?95:acc.healthStatus==='restrita'?45:10);
                  const isErr    = acc.healthStatus!=='ativa';
                  const dotColor = isErr?'var(--red)':'var(--green)';
                  return (
                    <li key={acc.username||i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                      <div style={{ position:'relative', flexShrink:0 }}>
                        <AvatarChip username={acc.username} avatar={acc.avatar} size={38} />
                        <span style={{ position:'absolute', bottom:0, right:0, width:9, height:9, borderRadius:'50%', background:dotColor, border:'2px solid rgba(9,9,15,.9)', boxShadow:`0 0 6px ${dotColor}` }} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>@{acc.username}</div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                          <span style={{ fontSize:10, color:isErr?'var(--red)':'var(--green)', fontWeight:600 }}>{isErr?acc.healthStatus.replace('_',' '):'Online'}</span>
                          <span style={{ fontSize:10, color:'var(--text3)' }}>· {fmtK(acc.followers)} seg.</span>
                        </div>
                      </div>
                      <span className={`score-ring ${isErr?'low':''}`} style={{ '--score':`${score}%`, flexShrink:0 }}>{score}%</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* SISTEMA */}
            <div style={{ ...card }} className="lift">
              <PanelHeader title="Sistema" icon={ShieldCheck} right={
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:6, background:!sysLoaded?'rgba(255,255,255,.05)':sysOk?'rgba(16,185,129,.1)':'rgba(244,63,94,.1)', color:sysDotColor, border:`1px solid ${!sysLoaded?'rgba(255,255,255,.1)':sysOk?'rgba(16,185,129,.25)':'rgba(244,63,94,.25)'}` }}>
                  {!sysLoaded?'...':sysOk?'ONLINE':'ALERTA'}
                </span>
              } />
              <ul style={{ listStyle:'none', margin:0, padding:'4px 14px', display:'flex', flexDirection:'column' }}>
                {[
                  { icon:<Zap size={14}/>,          label:'Automações ativas', value:d.activeAccounts||0, color:'var(--cyan)',  sub:`${d.totalAccounts||0} configuradas` },
                  { icon:<Globe size={14}/>,         label:'Proxies online',    value:proxyCount,           color:'var(--green)', sub:'Todas as regiões' },
                  { icon:<AlertTriangle size={14}/>, label:'Contas banidas',    value:bannedCount,          color:bannedCount>0?'var(--red)':'var(--text3)', sub:bannedCount>0?'Ação necessária':'Nenhuma banida' },
                  { icon:<WifiOff size={14}/>,       label:'Contas caídas',     value:fallenCount,          color:fallenCount>0?'var(--amber)':'var(--text3)', sub:fallenCount>0?'Reconectar necessário':'Todas online' },
                ].map(item => (
                  <li key={item.label} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                    <span style={{ width:32, height:32, borderRadius:9, background:`color-mix(in srgb,${item.color} 12%,transparent)`, border:`1px solid color-mix(in srgb,${item.color} 20%,transparent)`, display:'flex', alignItems:'center', justifyContent:'center', color:item.color, flexShrink:0 }}>
                      {item.icon}
                    </span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--text2)' }}>{item.label}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>{item.sub}</div>
                    </div>
                    <strong style={{ fontSize:20, fontWeight:800, color:item.color, letterSpacing:-0.5, fontVariantNumeric:'tabular-nums', flexShrink:0 }}>{item.value}</strong>
                  </li>
                ))}
              </ul>
            </div>

            {/* ATIVIDADES */}
            <div style={{ ...card }} className="lift">
              <PanelHeader title="Atividades recentes" right={
                <button className="view-all" onClick={() => showToast('Abrindo atividades.')}>Ver todos <ChevronRight size={13}/></button>
              } />
              <ul style={{ listStyle:'none', margin:0, padding:'4px 14px', display:'flex', flexDirection:'column' }}>
                {activities.length===0 ? (
                  <li style={{ color:'var(--text3)', fontSize:11, padding:'16px 0' }}>Nenhuma atividade ainda.</li>
                ) : activities.map((act,i) => {
                  const Icon      = act.icon;
                  const toneColor = { cyan:'var(--cyan)', danger:'var(--red)', amber:'var(--amber)' }[act.tone]||'var(--text3)';
                  return (
                    <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                      <span className={`activity-icon ${act.tone}`} style={{ flexShrink:0, marginTop:1 }}><Icon size={13} /></span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{act.text}</div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                          {act.account&&<span style={{ fontSize:10, color:'var(--cyan)', fontWeight:600 }}>@{act.account}</span>}
                          {act.caption&&<span style={{ fontSize:10, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{act.caption}</span>}
                        </div>
                      </div>
                      <time style={{ fontSize:10, color:'var(--text3)', flexShrink:0, paddingTop:2 }}>{act.time}</time>
                    </li>
                  );
                })}
              </ul>
            </div>

          </section>
        </BlurFade>

        {/* ── Footer ── */}
        <footer className="system-footer">
          <span><ShieldCheck size={13} />{!sysLoaded?'Carregando...':sysOk?'Sistema operacional':'Verificar sistemas'}</span>
          <span><i style={{ background:sysDotColor, boxShadow:`0 0 8px ${sysDotColor}` }} />{!sysLoaded?'–':sysOk?'Online':'Offline'}</span>
          <span>MongoDB <b style={{ color:d.system?.mongo?'var(--green)':'var(--red)' }}>{d.system?.mongo?'OK':'Erro'}</b></span>
          <span>Redis <b style={{ color:d.system?.redis?'var(--green)':'var(--red)' }}>{d.system?.redis?'OK':'Erro'}</b></span>
          <span>Worker <b style={{ color:d.system?.worker?'var(--green)':'var(--red)' }}>{d.system?.worker?'Ativo':'Parado'}</b></span>
          <span>Contas <b>{fmt(d.totalAccounts)}</b></span>
          <span>Posts <b>{fmt(d.totalPosts)}</b></span>
          <button onClick={() => showToast('Versão 2.4.7 — MouraFlow Pulse')}>Novidades</button>
        </footer>
      </main>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:12 }}>
            <ShieldCheck size={17} />{toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

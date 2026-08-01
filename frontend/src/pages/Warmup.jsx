import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';

const DEFAULT_COMMENTS = [
  '🔥🔥🔥', '❤️', 'Incrível!', 'Muito bom!', '👏👏', 'Perfeito!',
  'Que lindo!', '😍', 'Top demais!', '💯', 'Amei!', '👌',
  'Sensacional!', '🙌', 'Maravilhoso!', 'Show!', '💪', 'Que demais!',
];

const ACTIONS = [
  { value: 'likes',        label: 'Curtir comentários',  icon: '❤️', color: '#f43f5e', desc: 'Curte comentários nos seus posts (API Oficial)' },
  { value: 'comments',     label: 'Responder posts',     icon: '💬', color: '#3b82f6', desc: 'Responde comentários automaticamente (API Oficial)' },
  { value: 'scroll_reels', label: 'Rolar Reels',         icon: '🎬', color: '#8b5cf6', desc: 'Assiste e curte reels no feed (API Privada)' },
  { value: 'like_posts',   label: 'Curtir no Explorar',  icon: '🔍', color: '#10b981', desc: 'Curte posts no Explorar (API Privada)' },
];

const INTENSITY = [
  { v: 'leve',      label: 'Leve',      color: '#22c55e', desc: '1-3 ações/ciclo' },
  { v: 'medio',     label: 'Médio',     color: '#f59e0b', desc: '3-6 ações/ciclo' },
  { v: 'agressivo', label: 'Agressivo', color: '#ef4444', desc: '6-10 ações/ciclo' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarSrc = av => av
  ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`)
  : null;

function defaultCfg() {
  return {
    intensity: 'leve',
    actions: ['likes'],
    intervalMinutes: 30,
    maxDurationHours: 2,
    maxLikes: 6,
    maxComments: 2,
    maxFollows: 4,
    commentList: DEFAULT_COMMENTS.join('\n'),
  };
}

const LOG_ICON = { like: '❤️', comment: '💬', follow: '➕', scroll: '🎬', cycle_start: '🔥', cycle_done: '✅', error: '❌' };
const LOG_COLOR = { like: '#f43f5e', comment: '#3b82f6', follow: '#10b981', scroll: '#8b5cf6', cycle_start: '#f59e0b', cycle_done: '#22c55e', error: '#ef4444' };

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function Warmup() {
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [configs,  setConfigs]  = useState({});
  const [expanded, setExpanded] = useState(null);
  const [logs,     setLogs]     = useState([]);

  const loadLogs = useCallback(async () => {
    try {
      const r = await api.get('/warmup/logs', { params: { limit: 60 } });
      setLogs(r.data || []);
    } catch {}
  }, []);

  async function load() {
    try {
      const res = await api.get('/warmup');
      const data = res.data;
      setAccounts(data);
      const cfgs = {};
      data.forEach(a => {
        cfgs[a._id] = {
          intensity: a.warmupIntensity || 'leve',
          actions: a.warmupActions?.length ? a.warmupActions : ['likes'],
          intervalMinutes: a.warmupInterval || 30,
          maxDurationHours: a.warmupMaxDuration ?? 2,
          maxLikes: a.warmupMaxLikes || 6,
          maxComments: a.warmupMaxComments || 2,
          maxFollows: a.warmupMaxFollows || 4,
          commentList: (a.warmupComments?.length ? a.warmupComments : DEFAULT_COMMENTS).join('\n'),
        };
      });
      setConfigs(cfgs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadLogs();
    // auto-refresh logs every 30s when page is open
    const t = setInterval(loadLogs, 30000);
    return () => clearInterval(t);
  }, [loadLogs]);

  function updateCfg(id, key, value) {
    setConfigs(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  function toggleAction(id, action) {
    const cur = configs[id]?.actions || [];
    updateCfg(id, 'actions', cur.includes(action) ? cur.filter(a => a !== action) : [...cur, action]);
  }

  async function startWarmup(id) {
    const cfg = configs[id];
    if (!cfg?.actions?.length) return alert('Selecione ao menos uma ação.');
    const comments = cfg.commentList.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      await api.post(`/warmup/${id}/start`, { ...cfg, commentList: comments, maxDurationHours: cfg.maxDurationHours || 0 });
      load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  async function stopWarmup(id) {
    try {
      await api.post(`/warmup/${id}/stop`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }


  const activeCount = accounts.filter(a => a.warmupActive).length;
  const fmtNum = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };
  function healthLabel(s) {
    if (s === 'restrita')        return { label:'Restrita',       color:'#f59e0b' };
    if (s === 'banida')          return { label:'Banida',         color:'#ef4444' };
    if (s === 'token_invalido')  return { label:'Token expirado', color:'#ef4444' };
    if (s === 'sessao_expirada') return { label:'Sessão expirada',color:'#f59e0b' };
    if (s === 'desconectada')    return { label:'Desconectada',   color:'#64748b' };
    return { label:'Saudável', color:'#22c55e' };
  }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
    </svg>
  );

  const pageActions = (
    <>
      {activeCount > 0 && (
        <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:8, background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)', fontSize:11, color:'#22c55e', fontWeight:700, fontFamily:'var(--font-mono)' }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e', display:'inline-block', animation:'sched-pulse 1.5s infinite' }} />
          {activeCount} aquecendo
        </span>
      )}
      <button onClick={load} className="btn-ghost" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, fontSize:'.83rem' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/></svg>
        Atualizar
      </button>
    </>
  );

  if (loading) return (
    <PageShell icon={pageIcon} title="Aquecimento de Contas" subtitle="Simula ações orgânicas para evitar shadowban" accent="green">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:200, flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:32 }}>🔥</div>
        <p style={{ color:'var(--text3)', fontSize:13 }}>Carregando contas...</p>
      </div>
    </PageShell>
  );

  return (
    <PageShell icon={pageIcon} title="Aquecimento de Contas" subtitle="Simula curtidas, comentários e follows para evitar shadowban" accent="green" actions={pageActions}>
      <style>{`@keyframes sched-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>

      {/* Stats bar */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))', gap:10, marginBottom:20 }}>
        {[
          { label:'Total de contas',  value:accounts.length,         color:'var(--text)',  border:'rgba(0,212,255,.15)',   bg:'oklch(0.14 0.04 235 / 0.5)' },
          { label:'Aquecendo agora',  value:activeCount,              color:'#22c55e',      border:'rgba(34,197,94,.2)',    bg:'rgba(34,197,94,.06)' },
          { label:'Contas saudáveis', value:accounts.filter(a => !a.healthStatus || a.healthStatus === 'ok' || a.healthStatus === 'saudavel').length, color:'var(--cyan)', border:'rgba(0,212,255,.2)', bg:'oklch(0.14 0.04 235 / 0.5)' },
          { label:'Inativas',         value:accounts.length - activeCount, color:'var(--text3)', border:'oklch(1 0 0 / 0.08)', bg:'oklch(0.14 0.04 235 / 0.5)' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.05, duration: 0.22 }}
            style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:12, padding:'14px 16px', display:'flex', alignItems:'center', gap:12, backdropFilter:'blur(12px)' }}>
            <div>
              <div style={{ fontWeight:800, fontSize:22, color:s.color, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:'.05em', marginTop:3, fontFamily:'var(--font-mono)', textTransform:'uppercase' }}>{s.label}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)' }}>
          Nenhuma conta encontrada. Adicione contas primeiro.
        </div>
      )}

      {/* Cards grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {accounts.map(account => {
          const cfg        = configs[account._id] || defaultCfg();
          const isActive   = account.warmupActive;
          const isExpanded = expanded === account._id;
          const intCfg     = INTENSITY.find(i => i.v === cfg.intensity) || INTENSITY[0];
          const src        = avatarSrc(account.avatar);
          const hlth       = healthLabel(account.healthStatus);

          const tokenExpiry = account.tokenExpiresAt
            ? new Date(account.tokenExpiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
            : null;
          const tokenDaysLeft = account.tokenExpiresAt
            ? Math.ceil((new Date(account.tokenExpiresAt) - Date.now()) / 86400000)
            : null;

          return (
            <div key={account._id} style={{
              background: 'var(--bg2)',
              border: `1px solid ${isActive ? 'rgba(34,197,94,.4)' : 'var(--border)'}`,
              borderRadius: 16, overflow: 'hidden',
              boxShadow: isActive
                ? '0 0 0 1px rgba(34,197,94,.1), 0 6px 28px rgba(34,197,94,.09)'
                : '0 2px 8px rgba(0,0,0,.04)',
              transition: 'border-color .25s, box-shadow .25s',
            }}>
              {/* Active gradient bar */}
              {isActive && (
                <div style={{ height: 3, background: 'linear-gradient(90deg,#22c55e 0%,#16a34a 50%,#22c55e 100%)' }} />
              )}

              {/* Card body */}
              <div style={{ padding: '20px 20px 16px' }}>
                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>

                  {/* Avatar */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{
                      width: 84, height: 84, borderRadius: '50%', overflow: 'hidden',
                      border: isActive ? '3px solid #22c55e' : '3px solid var(--border)',
                      boxShadow: isActive ? '0 0 22px rgba(34,197,94,.35)' : 'none',
                      background: 'var(--bg3)', transition: 'all .25s',
                    }}>
                      {src
                        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { e.target.style.display = 'none'; }} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 30, color: 'var(--cyan)' }}>
                            {account.username?.[0]?.toUpperCase()}
                          </div>
                      }
                    </div>
                    <div style={{
                      position: 'absolute', bottom: 4, right: 4, width: 18, height: 18, borderRadius: '50%',
                      background: isActive ? '#22c55e' : '#4b5563',
                      border: '3px solid var(--bg2)',
                      boxShadow: isActive ? '0 0 10px #22c55e' : 'none',
                      transition: 'all .25s',
                    }} />
                  </div>

                  {/* Info column */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Username + name */}
                    <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: -.3 }}>
                      @{account.username}
                    </div>
                    {account.name && account.name !== account.username && (
                      <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500, marginTop: 1, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {account.name}
                      </div>
                    )}

                    {/* Badges */}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: account.name ? 0 : 8, marginBottom: 10 }}>
                      {account.accountType && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(99,102,241,.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,.25)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          {account.accountType}
                        </span>
                      )}
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: `${hlth.color}18`, color: hlth.color, border: `1px solid ${hlth.color}30` }}>
                        ● {hlth.label}
                      </span>
                      {isActive && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(34,197,94,.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,.3)' }}>
                          🔥 {intCfg.label}
                        </span>
                      )}
                    </div>

                    {/* Stats row */}
                    <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                      {[
                        { label: 'Seguidores', value: account.followers },
                        { label: 'Seguindo',   value: account.following },
                        { label: 'Posts',      value: account.postsCount },
                      ].map((s, i) => (
                        <div key={s.label} style={{ flex: 1, padding: '8px 4px', textAlign: 'center', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(s.value)}</div>
                          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 1 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Active actions + cycle */}
                    {isActive && cfg.actions?.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>AÇÕES:</span>
                        {cfg.actions.map(a => {
                          const ac = ACTIONS.find(x => x.value === a);
                          return ac ? (
                            <span key={a} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${ac.color}15`, color: ac.color, border: `1px solid ${ac.color}28` }}>
                              {ac.icon} {ac.label}
                            </span>
                          ) : null;
                        })}
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)' }}>
                          ⏱ {cfg.intervalMinutes}min/ciclo
                          {cfg.maxDurationHours > 0 && ` · para em ${cfg.maxDurationHours}h`}
                        </span>
                      </div>
                    )}

                    {/* Token expiry */}
                    {tokenExpiry && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 9, fontSize: 11, color: tokenDaysLeft != null && tokenDaysLeft < 7 ? '#f59e0b' : 'var(--text3)' }}>
                        <span>🔑</span>
                        <span>Token expira {tokenExpiry}</span>
                        {tokenDaysLeft != null && tokenDaysLeft < 30 && (
                          <span style={{ fontWeight: 700, color: tokenDaysLeft < 7 ? '#ef4444' : '#f59e0b' }}>
                            · {tokenDaysLeft < 0 ? 'EXPIRADO' : `${tokenDaysLeft}d`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flexShrink: 0, minWidth: 96 }}>
                    {isActive ? (
                      <button onClick={() => stopWarmup(account._id)} style={{
                        padding: '9px 12px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
                        background: 'rgba(239,68,68,.12)', color: '#ef4444', fontWeight: 700, fontSize: 12,
                        border: '1px solid rgba(239,68,68,.3)',
                      }}>⏹ Parar</button>
                    ) : (
                      <button onClick={() => startWarmup(account._id)} style={{
                        padding: '9px 12px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
                        background: 'linear-gradient(135deg,rgba(34,197,94,.15),rgba(22,163,74,.08))',
                        color: '#22c55e', fontWeight: 700, fontSize: 12,
                        border: '1px solid rgba(34,197,94,.4)',
                      }}>🔥 Iniciar</button>
                    )}
                    <button onClick={() => setExpanded(isExpanded ? null : account._id)} style={{
                      padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)',
                      background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    }}>
                      {isExpanded ? '▲ Fechar' : '⚙ Config'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)' }} />

              {/* Config panel */}
              {isExpanded && (
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* ── Modo API Oficial ── */}
                  <div style={{
                    borderRadius: 10, padding: '9px 13px',
                    border: '1px solid rgba(99,102,241,.25)',
                    background: 'rgba(99,102,241,.06)',
                    display: 'flex', alignItems: 'center', gap: 9,
                  }}>
                    <span style={{ fontSize: 15 }}>🔗</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8' }}>API Oficial Instagram</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                        Curte e responde comentários dos seus posts · não precisa de senha adicional
                      </div>
                    </div>
                  </div>

                  {/* Intensity */}
                  <div>
                    <div style={labelStyle}>Intensidade</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {INTENSITY.map(({ v, label, color, desc }) => (
                        <button key={v} onClick={() => updateCfg(account._id, 'intensity', v)} title={desc} style={{
                          flex: 1, padding: '8px 0', borderRadius: 8,
                          border: `1px solid ${cfg.intensity === v ? color : 'var(--border)'}`,
                          cursor: 'pointer', fontWeight: 700, fontSize: 11,
                          background: cfg.intensity === v ? `${color}20` : 'var(--bg3)',
                          color: cfg.intensity === v ? color : 'var(--text3)',
                          transition: 'all .15s',
                        }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div>
                    <div style={labelStyle}>Ações a executar</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {ACTIONS.map(a => {
                        const on = cfg.actions?.includes(a.value);
                        return (
                          <button key={a.value} onClick={() => toggleAction(account._id, a.value)} style={{
                            flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                            background: on ? `${a.color}20` : 'var(--bg3)',
                            color: on ? a.color : 'var(--text3)',
                            border: `1px solid ${on ? a.color : 'var(--border)'}`,
                            transition: 'all .15s',
                          }}>{a.icon} {a.label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Numeric limits */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {cfg.actions?.includes('likes') && (
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Max. Curtidas</div>
                        <input type="number" min={1} max={100} value={cfg.maxLikes}
                          onChange={e => updateCfg(account._id, 'maxLikes', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                    {cfg.actions?.includes('comments') && (
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Max. Comentários</div>
                        <input type="number" min={1} max={50} value={cfg.maxComments}
                          onChange={e => updateCfg(account._id, 'maxComments', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                    {cfg.actions?.includes('follows') && (
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Max. Follows</div>
                        <input type="number" min={1} max={50} value={cfg.maxFollows}
                          onChange={e => updateCfg(account._id, 'maxFollows', Number(e.target.value))}
                          style={inputStyle} />
                      </div>
                    )}
                  </div>

                  {/* Comment list */}
                  {cfg.actions?.includes('comments') && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={labelStyle}>Comentários (um por linha)</div>
                        <span style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 600 }}>
                          {cfg.commentList.split('\n').filter(s => s.trim()).length} cadastrados
                        </span>
                      </div>
                      <textarea
                        value={cfg.commentList}
                        onChange={e => updateCfg(account._id, 'commentList', e.target.value)}
                        rows={5}
                        placeholder={'🔥🔥🔥\nIncrível!\nAmei!\n💯'}
                        style={{
                          width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                          borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--bg3)', color: 'var(--text)',
                          fontSize: 12, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
                        }}
                      />
                    </div>
                  )}

                  {/* Interval */}
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>
                      Intervalo entre ciclos:&nbsp;
                      <span style={{ color: 'var(--cyan)', fontWeight: 800 }}>{cfg.intervalMinutes} min</span>
                    </div>
                    <input type="range" min={10} max={120} step={5}
                      value={cfg.intervalMinutes}
                      onChange={e => updateCfg(account._id, 'intervalMinutes', Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--cyan)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                      <span>10 min</span><span>120 min</span>
                    </div>
                  </div>

                  {/* Max duration */}
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>
                      Duração máxima:&nbsp;
                      <span style={{ color: cfg.maxDurationHours === 0 ? '#f59e0b' : 'var(--cyan)', fontWeight: 800 }}>
                        {cfg.maxDurationHours === 0 ? 'Sem limite' : `${cfg.maxDurationHours}h`}
                      </span>
                    </div>
                    <input type="range" min={0} max={12} step={1}
                      value={cfg.maxDurationHours}
                      onChange={e => updateCfg(account._id, 'maxDurationHours', Number(e.target.value))}
                      style={{ width: '100%', accentColor: cfg.maxDurationHours === 0 ? '#f59e0b' : 'var(--cyan)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                      <span>Sem limite</span><span>12h</span>
                    </div>
                    {cfg.maxDurationHours > 0 && (
                      <div style={{ marginTop: 5, fontSize: 10, color: '#22c55e' }}>
                        ⏱ Para automaticamente após {cfg.maxDurationHours}h
                      </div>
                    )}
                  </div>

                  {/* CTA */}
                  <button onClick={() => startWarmup(account._id)} style={{
                    width: '100%', padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: isActive
                      ? 'linear-gradient(135deg,#f59e0b,#d97706)'
                      : 'linear-gradient(135deg,#22c55e,#16a34a)',
                    color: '#fff', fontWeight: 700, fontSize: 13,
                    boxShadow: isActive ? '0 4px 16px rgba(245,158,11,.3)' : '0 4px 16px rgba(34,197,94,.3)',
                  }}>
                    {isActive ? '🔄 Atualizar configuração' : '🔥 Iniciar aquecimento'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status insight */}
      {accounts.length > 0 && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Live status card */}
          <div style={{
            background: activeCount > 0 ? 'rgba(34,197,94,.06)' : 'oklch(0.16 0.05 235 / 0.85)',
            border: `1px solid ${activeCount > 0 ? 'rgba(34,197,94,.3)' : 'oklch(1 0 0 / 0.07)'}`,
            borderRadius: 14, padding: '16px 20px',
            display: 'flex', alignItems: 'center', gap: 16,
            backdropFilter: 'blur(12px)',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: activeCount > 0 ? 'rgba(34,197,94,.15)' : 'oklch(0.10 0.03 235 / 0.5)',
              border: `1px solid ${activeCount > 0 ? 'rgba(34,197,94,.3)' : 'oklch(1 0 0 / 0.07)'}`,
              fontSize: 20,
            }}>
              {activeCount > 0 ? '🔥' : '💤'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: activeCount > 0 ? '#22c55e' : 'var(--text)', marginBottom: 3 }}>
                {activeCount > 0
                  ? `${activeCount} conta${activeCount > 1 ? 's' : ''} aquecendo agora`
                  : 'Nenhuma conta em aquecimento'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                {activeCount > 0
                  ? `${accounts.filter(a => a.warmupActive).map(a => `@${a.username}`).join(', ')} — simulando ações orgânicas no nicho`
                  : 'Inicie o aquecimento em uma ou mais contas para evitar shadowban e melhorar o alcance.'}
              </div>
            </div>
            {activeCount > 0 && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>ATIVO</span>
              </div>
            )}
          </div>

          {/* Tips card */}
          <div style={{ background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 14, padding: '14px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', backdropFilter: 'blur(12px)' }}>
            <div style={{ fontSize: 20, flexShrink: 0 }}>💡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: 'var(--text)' }}>Boas práticas de aquecimento</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                Use <strong>Leve</strong> para contas novas · <strong>Médio</strong> para contas estabelecidas · <strong>Agressivo</strong> apenas para contas experientes.
                Ciclo recomendado: 20–30 min entre ações. Evite ultrapassar 50 curtidas/dia em contas novas.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Activity log ── */}
      <div style={{ marginTop: 24, background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 16, overflow: 'hidden', backdropFilter: 'blur(12px)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid oklch(1 0 0 / 0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--text)' }}>Histórico de Ações</span>
            {logs.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'oklch(0.10 0.03 235 / 0.6)', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                {logs.length}
              </span>
            )}
          </div>
          <button onClick={loadLogs} className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7 }}>
            ↺ Atualizar
          </button>
        </div>

        {logs.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔥</div>
            Nenhuma ação registrada ainda.
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {logs.map((entry, i) => (
              <div key={entry._id || i} style={{
                padding: '10px 20px',
                borderBottom: i < logs.length - 1 ? '1px solid oklch(1 0 0 / 0.06)' : 'none',
                display: 'flex', alignItems: 'flex-start', gap: 12,
                background: entry.status === 'error' ? 'rgba(239,68,68,.04)' : 'transparent',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${LOG_COLOR[entry.action] || '#64748b'}15`,
                  fontSize: 14,
                }}>
                  {LOG_ICON[entry.action] || '•'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)' }}>@{entry.username}</span>
                    <span style={{ fontSize: 12, color: entry.status === 'error' ? '#f87171' : 'var(--text)', lineHeight: 1.4 }}>
                      {entry.detail}
                    </span>
                  </div>
                  {entry.targetUser && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>→ @{entry.targetUser}</div>
                  )}
                </div>
                <div style={{ flexShrink: 0, fontSize: 10, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  {timeAgo(entry.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

const labelStyle = {
  fontSize: 10, color: 'var(--text3)', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg3)', color: 'var(--text)', fontSize: 12,
};

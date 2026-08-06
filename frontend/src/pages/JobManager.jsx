import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import PageShell from '../components/PageShell';

// ── Icons SVG inline ────────────────────────────────────────────────────────
const ic = (children, w = 16) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);

const ICONS = {
  pause:    ic(<><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>),
  play:     ic(<><polygon points="5 3 19 12 5 21 5 3"/></>),
  stop:     ic(<><rect x="3" y="3" width="18" height="18" rx="2"/></>),
  trash:    ic(<><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></>),
  refresh:  ic(<><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>),
  loop:     ic(<><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>),
  post:     ic(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>),
  clock:    ic(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
  check:    ic(<><polyline points="20 6 9 17 4 12"/></>),
  x:        ic(<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>),
  warn:     ic(<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>),
  running:  ic(<><polygon points="5 3 19 12 5 21 5 3"/></>),
  media:    ic(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>),
  account:  ic(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></>),
  eye:      ic(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>),
};

// ── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  queued:           { label: 'Na Fila',      color: '#60a5fa', bg: 'rgba(96,165,250,.12)', icon: ICONS.clock     },
  running:          { label: 'Postando',     color: '#34d399', bg: 'rgba(52,211,153,.12)', icon: ICONS.running   },
  waiting_interval: { label: 'Aguardando',   color: '#fbbf24', bg: 'rgba(251,191,36,.12)', icon: ICONS.clock     },
  paused:           { label: 'Pausado',      color: '#a78bfa', bg: 'rgba(167,139,250,.12)', icon: ICONS.pause   },
  completed:        { label: 'Concluído',    color: '#22c55e', bg: 'rgba(34,197,94,.12)',  icon: ICONS.check     },
  cancelled:        { label: 'Cancelado',    color: '#94a3b8', bg: 'rgba(148,163,184,.12)',icon: ICONS.x         },
  failed:           { label: 'Falhou',       color: '#f87171', bg: 'rgba(248,113,113,.12)',icon: ICONS.warn      },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.queued;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      color: s.color, background: s.bg, border: `1px solid ${s.color}33`,
      letterSpacing: '.03em',
    }}>
      {s.icon}
      {s.label}
    </span>
  );
}

function ProgressBar({ published, total, errors }) {
  if (!total) return null;
  const pct     = Math.min(100, Math.round((published / total) * 100));
  const errPct  = Math.min(100 - pct, Math.round((errors / total) * 100));
  return (
    <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 99, height: 5, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: `${pct}%`, background: 'var(--cyan)', borderRadius: 99, transition: 'width .4s' }} />
        <div style={{ width: `${errPct}%`, background: '#f87171', transition: 'width .4s' }} />
      </div>
    </div>
  );
}

function Countdown({ nextRoundAt }) {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    function tick() {
      const diff = nextRoundAt ? Math.max(0, Math.round((new Date(nextRoundAt) - Date.now()) / 1000)) : 0;
      setSecs(diff);
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [nextRoundAt]);

  if (!nextRoundAt || secs <= 0) return null;
  const m = Math.floor(secs / 60), s = secs % 60;
  return (
    <span style={{ fontSize: 11, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
      {ICONS.clock} próxima em {m > 0 ? `${m}m ` : ''}{String(s).padStart(2, '0')}s
    </span>
  );
}

function AvatarStack({ accounts = [] }) {
  const visible = accounts.slice(0, 5);
  const rest    = accounts.length - visible.length;
  const API     = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {visible.map((a, i) => {
        const src = a.avatar?.startsWith('/uploads') ? `${API}${a.avatar}` : a.avatar || null;
        return (
          <div key={a._id} title={`@${a.username}`} style={{
            width: 22, height: 22, borderRadius: '50%',
            border: '1.5px solid var(--bg2)',
            marginLeft: i > 0 ? -6 : 0, zIndex: visible.length - i,
            background: 'var(--bg3)',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {src
              ? <img src={src} alt={a.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display='none'; }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text2)' }}>
                  {a.username?.[0]?.toUpperCase() || '?'}
                </div>
            }
          </div>
        );
      })}
      {rest > 0 && (
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg3)', border: '1.5px solid var(--border)', marginLeft: -6, fontSize: 9, fontWeight: 700, color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          +{rest}
        </div>
      )}
    </div>
  );
}

// ── Job card ────────────────────────────────────────────────────────────────
function JobCard({ job, onAction }) {
  const isLoop      = job.type === 'loop';
  const isActive    = ['queued', 'running', 'waiting_interval'].includes(job.status);
  const isCompleted = job.status === 'completed';
  const isCancelled = ['cancelled', 'failed'].includes(job.status);
  const isPaused    = job.status === 'paused';

  const totalProgress = job.postsTotal || (job.totalRounds * (job.accounts?.length || 1));
  const pct = totalProgress > 0 ? Math.round((job.postsPublished / totalProgress) * 100) : 0;

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'border-color .15s',
      borderLeft: `3px solid ${STATUS[job.status]?.color || 'var(--border)'}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: isLoop ? 'var(--cyan)' : 'var(--text3)' }}>
              {isLoop ? ICONS.loop : ICONS.post}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.name || 'Sem nome'}
            </span>
            <StatusBadge status={job.status} />
            {isLoop && (
              <span style={{ fontSize: 10, color: 'var(--cyan)', background: 'rgba(0,212,255,.08)', border: '1px solid rgba(0,212,255,.2)', borderRadius: 99, padding: '2px 7px', fontWeight: 600 }}>
                LOOP
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Criado em {new Date(job.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {job.intervalMinutes > 0 && (
              <span style={{ marginLeft: 8 }}>· intervalo {job.intervalMinutes}min</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
          {ICONS.media}
          <span>{job.mediaFiles?.length || 0} mídia(s)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
          {ICONS.account}
          <AvatarStack accounts={job.accounts || []} />
          <span>{job.accounts?.length || 0} conta(s)</span>
        </div>
        {job.totalRounds > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Rodada {Math.min(job.roundsCompleted + (isActive ? 1 : 0), job.totalRounds)}/{isLoop ? '∞' : job.totalRounds}
          </div>
        )}
        {job.postsPublished > 0 && (
          <div style={{ fontSize: 12, color: '#22c55e' }}>
            ✓ {job.postsPublished} publicado(s)
          </div>
        )}
        {job.postsErrors > 0 && (
          <div style={{ fontSize: 12, color: '#f87171' }}>
            ✗ {job.postsErrors} erro(s)
          </div>
        )}
      </div>

      {/* Progress bar */}
      {totalProgress > 0 && !isLoop && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>
            <span>Progresso</span>
            <span>{pct}%</span>
          </div>
          <ProgressBar published={job.postsPublished} total={totalProgress} errors={job.postsErrors} />
        </div>
      )}

      {/* Countdown for waiting_interval */}
      {job.status === 'waiting_interval' && job.nextRoundAt && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#fbbf24' }}>
          <Countdown nextRoundAt={job.nextRoundAt} />
        </div>
      )}

      {/* Error */}
      {job.lastError && (
        <div style={{ fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 8, padding: '6px 10px' }}>
          {job.lastError.slice(0, 120)}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
        {(isActive || isPaused) && !isPaused && (
          <button onClick={() => onAction(job._id, 'pause')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(167,139,250,.1)', color: '#a78bfa', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.pause} Pausar
          </button>
        )}
        {isPaused && (
          <button onClick={() => onAction(job._id, 'resume')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid rgba(52,211,153,.3)', background: 'rgba(52,211,153,.1)', color: '#34d399', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.play} Retomar
          </button>
        )}
        {isActive && (
          <button onClick={() => onAction(job._id, 'cancel')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid rgba(248,113,113,.3)', background: 'rgba(248,113,113,.08)', color: '#f87171', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.stop} Cancelar
          </button>
        )}
        {(isCompleted || isCancelled) && (
          <button onClick={() => onAction(job._id, 'rerun')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(96,165,250,.08)', color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.refresh} Reexecutar
          </button>
        )}
        <button onClick={() => onAction(job._id, 'delete')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', marginLeft: 'auto' }}>
          {ICONS.trash}
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function JobManager() {
  const [jobs,       setJobs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('all');   // all | active | loop | post | done
  const [confirming, setConfirming] = useState(null);    // { id, action }

  const load = useCallback(async () => {
    try {
      const res = await api.get('/jobs');
      setJobs(res.data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useServerEvents(['jobs', 'posts'], () => load());

  async function handleAction(id, action) {
    if (action === 'delete') {
      if (confirming?.id === id && confirming?.action === 'delete') {
        try { await api.delete(`/jobs/${id}`); load(); setConfirming(null); }
        catch (e) { alert(e.response?.data?.error || 'Erro'); }
      } else {
        setConfirming({ id, action: 'delete' });
        setTimeout(() => setConfirming(null), 3000);
      }
      return;
    }
    if (action === 'cancel') {
      if (confirming?.id === id && confirming?.action === 'cancel') {
        try { await api.post(`/jobs/${id}/cancel`); load(); setConfirming(null); }
        catch (e) { alert(e.response?.data?.error || 'Erro'); }
      } else {
        setConfirming({ id, action: 'cancel' });
        setTimeout(() => setConfirming(null), 3000);
      }
      return;
    }
    try {
      if (action === 'pause')  await api.post(`/jobs/${id}/pause`);
      if (action === 'resume') await api.post(`/jobs/${id}/resume`);
      if (action === 'rerun')  await api.post(`/jobs/${id}/rerun`);
      load();
    } catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }

  const filtered = jobs.filter(j => {
    if (filter === 'active') return ['queued', 'running', 'waiting_interval'].includes(j.status);
    if (filter === 'paused') return j.status === 'paused';
    if (filter === 'loop')   return j.type === 'loop';
    if (filter === 'post')   return j.type === 'post';
    if (filter === 'done')   return ['completed', 'cancelled', 'failed'].includes(j.status);
    return true;
  });

  const counts = {
    all:    jobs.length,
    active: jobs.filter(j => ['queued','running','waiting_interval'].includes(j.status)).length,
    paused: jobs.filter(j => j.status === 'paused').length,
    loop:   jobs.filter(j => j.type   === 'loop').length,
    post:   jobs.filter(j => j.type   === 'post').length,
    done:   jobs.filter(j => ['completed','cancelled','failed'].includes(j.status)).length,
  };

  const filters = [
    { key: 'all',    label: 'Todos'     },
    { key: 'active', label: 'Ativos'    },
    { key: 'paused', label: 'Pausados'  },
    { key: 'loop',   label: 'Loops'     },
    { key: 'post',   label: 'Posts'     },
    { key: 'done',   label: 'Finalizados' },
  ];

  return (
    <PageShell title="Gerenciador de Jobs" subtitle="Acompanhe e controle suas postagens em tempo real">
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: filter === f.key ? '1px solid var(--cyan)' : '1px solid var(--border)',
              background: filter === f.key ? 'rgba(0,212,255,.12)' : 'transparent',
              color: filter === f.key ? 'var(--cyan)' : 'var(--text2)',
              transition: 'all .15s',
            }}
          >
            {f.label}
            {counts[f.key] > 0 && (
              <span style={{ marginLeft: 6, background: filter === f.key ? 'rgba(0,212,255,.2)' : 'rgba(255,255,255,.06)', borderRadius: 99, padding: '1px 6px' }}>
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}

        <button
          onClick={load}
          style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}
        >
          {ICONS.refresh} Atualizar
        </button>
      </div>

      {/* Confirm banner */}
      {confirming && (
        <div style={{ background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 10 }}>
          {ICONS.warn}
          Clique novamente em <b>{confirming.action === 'delete' ? 'Excluir' : 'Cancelar'}</b> para confirmar.
          <button onClick={() => setConfirming(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 2 }}>{ICONS.x}</button>
        </div>
      )}

      {/* Job list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)', fontSize: 13 }}>
          Carregando jobs...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: .4 }}>📦</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Nenhum job encontrado</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {filter === 'all'
              ? 'Crie uma postagem ou loop para começar.'
              : `Nenhum job com filtro "${filters.find(f => f.key === filter)?.label}".`}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {filtered.map(job => (
            <JobCard
              key={job._id}
              job={job}
              onAction={(id, action) => {
                if (confirming?.id === id) handleAction(id, action);
                else handleAction(id, action);
              }}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

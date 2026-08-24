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
/* Sete estados. Antes cada um trazia cor e fundo separados — catorze valores
   mantidos em sincronia na mão — e 'postando' e 'concluído' usavam dois
   verdes quase idênticos (var(--mf-success-500) e var(--mf-success-500)) para dizer coisas opostas: um
   está em movimento, o outro terminou. Agora 'postando' fica com o verde e o
   ponto pulsando, e 'concluído' fica sóbrio: o que está acontecendo agora
   chama mais atenção que o que já passou. */
const STATUS = {
  queued:           { label: 'Na fila',    cor: 'var(--mf-info-500)',    icon: ICONS.clock   },
  running:          { label: 'Postando',   cor: 'var(--mf-success-500)', icon: ICONS.running, vivo: true },
  waiting_interval: { label: 'Aguardando', cor: 'var(--mf-warning-500)', icon: ICONS.clock   },
  paused:           { label: 'Pausado',    cor: 'var(--mf-mod-publicar)',icon: ICONS.pause   },
  completed:        { label: 'Concluído',  cor: 'var(--mf-text-2)',      icon: ICONS.check   },
  cancelled:        { label: 'Cancelado',  cor: 'var(--mf-text-3)',      icon: ICONS.x       },
  failed:           { label: 'Falhou',     cor: 'var(--mf-danger-500)',  icon: ICONS.warn    },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.queued;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      padding: '3px 9px', borderRadius: 'var(--mf-r-full)',
      fontSize: 'var(--mf-t-micro)', fontWeight: 600, color: s.cor,
      background: `color-mix(in oklch, ${s.cor} 12%, transparent)`,
      border: `1px solid color-mix(in oklch, ${s.cor} 26%, transparent)`,
      animation: s.vivo ? 'mf-pulse 1.8s var(--mf-ease-inout) infinite' : 'none',
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
    /* Duas faixas na mesma barra: publicado e com erro. O rótulo acessível
       diz os dois números, senão quem usa leitor de tela ouve só uma
       porcentagem e perde a parte que interessa — a que falhou. */
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      aria-label={`${published} de ${total} publicados${errors ? `, ${errors} com erro` : ''}`}
      style={{ background: 'var(--mf-surface-2)', borderRadius: 'var(--mf-r-full)', height: 5, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: `${pct}%`, background: 'var(--mf-mod-metricas)', transition: 'width var(--mf-slow) var(--mf-ease-out)' }} />
        <div style={{ width: `${errPct}%`, background: 'var(--mf-danger-500)', transition: 'width var(--mf-slow) var(--mf-ease-out)' }} />
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
    <span style={{ fontSize: 11, color: 'var(--mf-warning-500)', fontVariantNumeric: 'tabular-nums' }}>
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
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--mf-text-2)' }}>
                  {a.username?.[0]?.toUpperCase() || '?'}
                </div>
            }
          </div>
        );
      })}
      {rest > 0 && (
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg3)', border: '1.5px solid var(--border)', marginLeft: -6, fontSize: 9, fontWeight: 700, color: 'var(--mf-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          +{rest}
        </div>
      )}
    </div>
  );
}

// ── Formata número compacto ────────────────────────────────────────────────
function fmtN(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0','') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0','') + 'K';
  return String(n);
}

// ── Job card ────────────────────────────────────────────────────────────────
function JobCard({ job, onAction }) {
  const isLoop      = job.type === 'loop';
  const isActive    = ['queued', 'running', 'waiting_interval'].includes(job.status);
  const isCompleted = job.status === 'completed';
  const isCancelled = ['cancelled', 'failed'].includes(job.status);
  const isPaused    = job.status === 'paused';
  const API         = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const totalProgress  = job.postsTotal || (job.totalRounds * (job.accounts?.length || 1));
  const pct            = totalProgress > 0 ? Math.round((job.postsPublished / totalProgress) * 100) : 0;
  const mediaLen       = job.mediaFiles?.length || 0;
  const cyclePos       = mediaLen > 0 ? (job.roundsCompleted % mediaLen) : 0;
  const cyclePct       = mediaLen > 0 ? Math.round((cyclePos / mediaLen) * 100) : 0;

  const mainAccount    = job.accounts?.[0];
  const extraAccounts  = (job.accounts?.length || 0) - 1;

  return (
    /* A faixa à esquerda repete a cor do selo. É redundante de propósito:
       numa grade de vinte jobs o olho encontra "o que falhou" pela faixa,
       sem precisar ler selo nenhum. */
    <div className="mf-card--hover" style={{
      background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', minWidth: 0, containerType: 'inline-size',
      padding: 'var(--mf-4)', display: 'flex', flexDirection: 'column', gap: 'var(--mf-3)',
      borderLeft: `3px solid ${STATUS[job.status]?.cor || 'var(--mf-border)'}`,
    }}>
      {/* Header: nome + badges */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: isLoop ? 'var(--mf-mod-jobs)' : 'var(--mf-text-3)', display: 'flex', flexShrink: 0 }}>
              {isLoop ? ICONS.loop : ICONS.post}
            </span>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.name || 'Sem nome'}
            </span>
            <StatusBadge status={job.status} />
            {isLoop && (
              <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--mf-r-full)',
                color: 'var(--mf-mod-jobs)',
                background: 'color-mix(in oklch, var(--mf-mod-jobs) 10%, transparent)',
                border: '1px solid color-mix(in oklch, var(--mf-mod-jobs) 24%, transparent)' }}>
                Loop
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 4 }}>
            Criado em {new Date(job.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {job.intervalMinutes > 0 && <span style={{ marginLeft: 8 }}>· intervalo {job.intervalMinutes}min</span>}
          </div>
        </div>
      </div>

      {/* Conta principal */}
      {mainAccount && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-3)', minWidth: 0, background: 'var(--mf-surface-2)', borderRadius: 'var(--mf-r-md)', padding: 'var(--mf-2) var(--mf-3)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 'var(--mf-r-full)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--mf-border-strong)', background: 'var(--mf-surface-3)' }}>
            {mainAccount.avatar
              ? <img src={mainAccount.avatar.startsWith('/uploads') ? `${API}${mainAccount.avatar}` : mainAccount.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display='none'; }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--mf-text-2)' }}>{mainAccount.username?.[0]?.toUpperCase()}</div>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mainAccount.name || mainAccount.username}
              {extraAccounts > 0 && (
                <span style={{ marginLeft: 6, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontWeight: 400 }}>
                  +{extraAccounts} {extraAccounts === 1 ? 'conta' : 'contas'}
                </span>
              )}
            </div>
            <div className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>@{mainAccount.username}</div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
            {[
              { label: 'seg', value: fmtN(mainAccount.followers) },
              { label: 'seg.', value: fmtN(mainAccount.following) },
              { label: 'posts', value: fmtN(mainAccount.postsCount) },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-text)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize: 9, color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--mf-text-2)' }}>
          {ICONS.media}
          <span>{mediaLen} mídia(s)</span>
        </div>
        {job.totalRounds > 0 && (
          <div style={{ fontSize: 12, color: 'var(--mf-text-2)' }}>
            Rodada {Math.min(job.roundsCompleted + (isActive ? 1 : 0), job.totalRounds)}/{isLoop ? '∞' : job.totalRounds}
          </div>
        )}
        {job.postsPublished > 0 && (
          <div style={{ fontSize: 12, color: 'var(--mf-success-500)' }}>✓ {job.postsPublished} publicado(s)</div>
        )}
        {job.postsErrors > 0 && (
          <div style={{ fontSize: 12, color: 'var(--mf-danger-500)' }}>✗ {job.postsErrors} erro(s)</div>
        )}
      </div>

      {/* Barra de progresso — post comum: absoluta; loop: ciclo atual */}
      {!isLoop && totalProgress > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mf-text-3)', marginBottom: 3 }}>
            <span>Progresso</span><span>{pct}%</span>
          </div>
          <ProgressBar published={job.postsPublished} total={totalProgress} errors={job.postsErrors} />
        </div>
      )}
      {isLoop && mediaLen > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mf-text-3)', marginBottom: 3 }}>
            <span>Ciclo atual</span><span>{cyclePos}/{mediaLen} ({cyclePct}%)</span>
          </div>
          <ProgressBar published={cyclePos} total={mediaLen} errors={0} />
        </div>
      )}

      {/* Countdown for waiting_interval */}
      {job.status === 'waiting_interval' && job.nextRoundAt && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mf-warning-500)' }}>
          <Countdown nextRoundAt={job.nextRoundAt} />
        </div>
      )}

      {/* Error */}
      {job.lastError && (
        <div style={{ fontSize: 11, color: 'var(--mf-danger-500)', background: 'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 20%, transparent)', borderRadius: 8, padding: '6px 10px' }}>
          {job.lastError.slice(0, 120)}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
        {(isActive || isPaused) && !isPaused && (
          <button onClick={() => onAction(job._id, 'pause')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'color-mix(in oklch, var(--mf-mod-publicar) 10%, transparent)', color: 'var(--mf-mod-publicar)', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.pause} Pausar
          </button>
        )}
        {isPaused && (
          <button onClick={() => onAction(job._id, 'resume')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid color-mix(in oklch, var(--mf-success-500) 30%, transparent)', background: 'color-mix(in oklch, var(--mf-success-500) 10%, transparent)', color: 'var(--mf-success-500)', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.play} Retomar
          </button>
        )}
        {isActive && (
          <button onClick={() => onAction(job._id, 'cancel')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', background: 'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', color: 'var(--mf-danger-500)', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.stop} Cancelar
          </button>
        )}
        {(isCompleted || isCancelled) && (
          <button onClick={() => onAction(job._id, 'rerun')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'color-mix(in oklch, var(--mf-info-500) 8%, transparent)', color: 'var(--mf-info-500)', cursor: 'pointer', fontWeight: 600 }}>
            {ICONS.refresh} Reexecutar
          </button>
        )}
        <button onClick={() => onAction(job._id, 'delete')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-3)', cursor: 'pointer', marginLeft: 'auto' }}>
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
  const [error,      setError]      = useState(null);
  const [filter,     setFilter]     = useState('all');   // all | active | loop | post | done
  const [confirming, setConfirming] = useState(null);    // { id, action }

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/jobs');
      setJobs(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao carregar jobs');
      setJobs([]);
    } finally { setLoading(false); }
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

  const jobIcon = ICONS.running;

  return (
    <PageShell
      icon={jobIcon}
      title="Gerenciador de Jobs"
      subtitle="Acompanhe e controle suas postagens em tempo real"
      accent="gold"
    >
      {/* Filter tabs */}
      {/* Continuam pastilhas em vez de um segmentado porque cada uma carrega
          um contador: seis rótulos com número ao lado formariam um controle
          largo demais para caber. O que faltava era o estado — a escolha só
          existia na cor, invisível para leitor de tela. `role="group"` mais
          `aria-pressed` dizem qual filtro está ativo. */}
      <div role="group" aria-label="Filtrar jobs por estado"
        style={{ display: 'flex', gap: 'var(--mf-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--mf-4)' }}>
        {filters.map(f => {
          const ativo = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={ativo}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                height: 30, padding: '0 var(--mf-3)', borderRadius: 'var(--mf-r-full)',
                fontSize: 'var(--mf-t-xs)', fontWeight: 600, cursor: 'pointer',
                color: ativo ? 'var(--mf-mod-jobs)' : 'var(--mf-text-2)',
                background: ativo ? 'color-mix(in oklch, var(--mf-mod-jobs) 13%, transparent)' : 'var(--mf-surface-2)',
                border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-mod-jobs) 32%, transparent)' : 'var(--mf-border)'}`,
                transition: 'background var(--mf-fast) var(--mf-ease-out), border-color var(--mf-fast) var(--mf-ease-out), color var(--mf-fast) var(--mf-ease-out)',
              }}
            >
              {f.label}
              {counts[f.key] > 0 && (
                <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)', borderRadius: 'var(--mf-r-full)', padding: '1px 6px',
                  background: ativo ? 'color-mix(in oklch, var(--mf-mod-jobs) 20%, transparent)' : 'var(--mf-surface-3)' }}>
                  {counts[f.key]}
                </span>
              )}
            </button>
          );
        })}

        <button onClick={load} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
          {ICONS.refresh} Atualizar
        </button>
      </div>

      {/* Error banner */}
      {error && (
        /* `role="alert"` para o leitor de tela anunciar a falha assim que
           ela aparece — antes o texto surgia em silêncio. */
        <div role="alert" style={{ background: 'var(--mf-danger-bg)', border: '1px solid oklch(0.64 0.22 20 / 0.28)', borderRadius: 'var(--mf-r-md)',
          padding: 'var(--mf-3) var(--mf-4)', marginBottom: 'var(--mf-4)', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-danger-500)',
          display: 'flex', alignItems: 'center', gap: 'var(--mf-3)', flexWrap: 'wrap' }}>
          {ICONS.warn} <span style={{ minWidth: 0 }}>{error}</span>
          <button onClick={load} style={{ marginLeft: 'auto', flexShrink: 0, background: 'color-mix(in oklch, var(--mf-danger-500) 14%, transparent)',
            border: '1px solid oklch(0.64 0.22 20 / 0.28)', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer',
            color: 'var(--mf-danger-500)', padding: '4px 10px', fontSize: 'var(--mf-t-xs)', fontWeight: 600 }}>Tentar novamente</button>
        </div>
      )}

      {/* Confirm banner */}
      {confirming && (
        <div role="status" style={{ background: 'var(--mf-warning-bg)', border: '1px solid oklch(0.80 0.16 78 / 0.3)', borderRadius: 'var(--mf-r-md)',
          padding: 'var(--mf-3) var(--mf-4)', marginBottom: 'var(--mf-4)', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-warning-500)',
          display: 'flex', alignItems: 'center', gap: 'var(--mf-2)', flexWrap: 'wrap' }}>
          {ICONS.warn}
          Clique novamente em <b>{confirming.action === 'delete' ? 'Excluir' : 'Cancelar'}</b> para confirmar.
          <button onClick={() => setConfirming(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mf-text-3)', padding: 2 }}>{ICONS.x}</button>
        </div>
      )}

      {/* Job list */}
      {loading ? (
        /* Esqueletos com a forma dos cards que vão chegar: o layout não
           salta quando os dados entram. */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px,100%), 1fr))', gap: 'var(--mf-4)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mf-skel" style={{ height: 208, borderRadius: 'var(--mf-r-lg)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mf-empty" style={{ padding: 'var(--mf-12) var(--mf-5)' }}>
          <span className="mf-empty__ico" style={{ color: 'var(--mf-mod-jobs)' }}>{ICONS.running}</span>
          <div style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 650, color: 'var(--mf-text)' }}>Nenhum job encontrado</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)', marginTop: 6, maxWidth: '46ch', textWrap: 'pretty' }}>
            {filter === 'all'
              ? 'Crie uma postagem na página "Postar" ou ative um Loop para começar.'
              : `Nenhum job com filtro "${filters.find(f => f.key === filter)?.label}".`}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px,100%), 1fr))', gap: 'var(--mf-4)' }}>
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

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import PageShell from '../components/PageShell';
import { EsqueletoTabela } from '../components/Estados';

const STATUS_META = {
  concluido:        { label: 'Concluído',   color: 'var(--mf-success-500)', bg: 'color-mix(in oklch, var(--mf-success-500) 11%, transparent)' },
  erro:             { label: 'Erro',        color: 'var(--mf-danger-500)', bg: 'color-mix(in oklch, var(--mf-danger-500) 11%, transparent)'  },
  processando:      { label: 'Processando', color: 'var(--mf-primary-300)', bg: 'color-mix(in oklch, var(--mf-mod-publicar) 11%, transparent)' },
  agendado:         { label: 'Agendado',    color: 'var(--mf-warning-500)', bg: 'color-mix(in oklch, var(--mf-warning-500) 11%, transparent)'  },
  pendente:         { label: 'Pendente',    color: 'var(--mf-text-3)', bg: 'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)' },
  done:             { label: 'Concluído',   color: 'var(--mf-success-500)', bg: 'color-mix(in oklch, var(--mf-success-500) 11%, transparent)' },
  done_with_errors: { label: 'Com erros',   color: 'var(--mf-warning-500)', bg: 'color-mix(in oklch, var(--mf-warning-500) 11%, transparent)'  },
  running:          { label: 'Executando',  color: 'var(--mf-primary-300)', bg: 'color-mix(in oklch, var(--mf-mod-publicar) 11%, transparent)' },
  error:            { label: 'Erro',        color: 'var(--mf-danger-500)', bg: 'color-mix(in oklch, var(--mf-danger-500) 11%, transparent)'  },
};

const svgIcon = (d, w = 16) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const TYPE_ICON = {
  post:         { icon: svgIcon(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>), label: 'Post' },
  reel:         { icon: svgIcon(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>), label: 'Reel' },
  story:        { icon: svgIcon(<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>), label: 'Story' },
  profile_edit: { icon: svgIcon(<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>), label: 'Edição de perfil' },
  account:      { icon: svgIcon(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></>), label: 'Conta' },
};

const FILTERS = ['atividade', 'all', 'concluido', 'erro', 'processando', 'agendado', 'pendente'];
const FILTER_LABELS = { atividade:'Atividade', all:'Todos', concluido:'Concluído', erro:'Erro', processando:'Processando', agendado:'Agendado', pendente:'Pendente' };
const statusMap = {
  atividade:  ['concluido','done','erro','error','done_with_errors','processando','running','parcial'],
  concluido:  ['concluido','done','parcial'],
  erro:       ['erro','error','done_with_errors'],
  processando:['processando','running'],
};

function EntryCard({ entry, i }) {
  const tm = TYPE_ICON[entry.type] || TYPE_ICON.post;
  const m  = STATUS_META[entry.status] || STATUS_META.pendente;
  return (
    <motion.div
      initial={{ opacity:0, y:6 }}
      animate={{ opacity:1, y:0 }}
      transition={{ delay: Math.min(i * 0.02, .3), duration:.2 }}
      style={{
        background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)',
        border:'1px solid var(--mf-border)',
        borderLeft:`3px solid ${m.color}`,
        borderRadius: 'var(--mf-r-md)', padding:'12px 16px',
        backdropFilter:'blur(12px)',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ color:'var(--mf-text-3)', display:'flex', alignItems:'center' }}>{tm.icon}</span>
          <div>
            <strong style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)' }}>{tm.label}</strong>
            <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', display:'block', fontFamily:'var(--mf-mono)' }}>
              {['agendado','pendente'].includes(entry.status) && entry.scheduledAt
                ? `Agendado: ${new Date(entry.scheduledAt).toLocaleString('pt-BR')}`
                : entry.date ? new Date(entry.date).toLocaleString('pt-BR') : '—'
              }
            </span>
          </div>
        </div>
        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 9px', borderRadius: 'var(--mf-r-full)', background:m.bg, color:m.color, border:`1px solid ${m.color}22`, flexShrink:0 }}>
          {m.label}
        </span>
      </div>
      <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', display:'flex', flexDirection:'column', gap:3, color:'var(--mf-text-3)', minWidth:0 }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}><span>conta: </span><span style={{ color:'var(--mf-text-2)' }}>{entry.accounts}</span></span>
        {entry.media   && <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}><span>mídia: </span><span style={{ color:'var(--mf-text-2)' }}>{entry.media}</span></span>}
        {entry.caption && <span><span>legenda: </span><span style={{ color:'var(--mf-text-2)' }}>{entry.caption.slice(0,80)}{entry.caption.length > 80 ? '…' : ''}</span></span>}
        {entry.error   && <span style={{ color:'var(--mf-danger-500)' }}><span style={{ color:'var(--mf-text-3)' }}>erro: </span>{entry.error}</span>}
        {entry.results?.length > 0 && entry.results.map((r, j) => {
          const ok = r.status === 'ok';
          let errorMsg = r.error || 'falhou';
          if (!ok && /challenge|checkpoint/i.test(errorMsg)) errorMsg = 'Challenge Instagram — use Reconectar para resolver';
          return (
            <span key={j} style={{ color: ok ? 'var(--mf-success-500)' : 'var(--mf-danger-500)' }}>
              <span style={{ color:'var(--mf-text-3)' }}>resultado [{r.username}]: </span>
              {ok ? '✓ ' + (r.message || 'ok') : '✗ ' + errorMsg}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

export default function Logs() {
  const [posts,       setPosts]       = useState([]);
  const [profileJobs, setProfileJobs] = useState([]);
  const [filter,      setFilter]      = useState('atividade');
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    try {
      const [postsRes, jobsRes] = await Promise.allSettled([
        api.get('/posts'),
        api.get('/profile-edit/jobs'),
      ]);
      if (postsRes.status === 'fulfilled') {
        setPosts(postsRes.value.data.posts || postsRes.value.data || []);
      }
      if (jobsRes.status === 'fulfilled') {
        setProfileJobs(Array.isArray(jobsRes.value.data) ? jobsRes.value.data : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(() => loadRef.current?.(), 10_000); return () => clearInterval(id); }, []);
  useServerEvents(['posts', 'profile_edit', 'accounts'], load);

  const timeline = [
    ...posts.map(p => ({
      _id:       p._id,
      type:      p.postType || 'post',
      status:    p.status,
      date:      p.updatedAt || p.createdAt,
      createdAt: p.createdAt,
      scheduledAt: p.scheduledAt,
      accounts:  p.accounts?.filter(Boolean).map(a => a.username).join(', ') || '—',
      media:     p.media || '—',
      caption:   p.caption,
      error:     p.error,
    })),
    ...profileJobs.map(j => {
      const hasErrors = j.results?.some(r => r.status === 'error');
      return {
        _id:      j.jobId,
        type:     'profile_edit',
        status:   j.status === 'done' && hasErrors ? 'done_with_errors' : j.status,
        date:     j.startedAt,
        accounts: j.username || (j.results?.map(r => r.username).join(', ')) || '—',
        error:    j.error,
        results:  j.results,
      };
    }),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const filtered = filter === 'all'
    ? timeline
    : timeline.filter(e => (statusMap[filter] || [filter]).includes(e.status));

  // Agrupa entries para renderização com cabeçalhos de seção
  const isGrouped = filter === 'atividade';
  const GROUPS = [
    { key:'concluido',   label:'Concluídos',   color:'var(--mf-success-500)', statuses:['concluido','done','parcial'] },
    { key:'erro',        label:'Erros',        color:'var(--mf-danger-500)', statuses:['erro','error','done_with_errors'] },
    { key:'processando', label:'Processando',  color:'var(--mf-primary-300)', statuses:['processando','running'] },
  ];
  const grouped = isGrouped
    ? GROUPS.map(g => ({ ...g, items: filtered.filter(e => g.statuses.includes(e.status)) })).filter(g => g.items.length > 0)
    : null;

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-success-500)', padding:'5px 12px', borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-success-500) 6%, transparent)', border:'1px solid oklch(0.38 0.12 150 / 0.3)' }}>
      <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', background:'var(--mf-success-500)', display:'inline-block', boxShadow:'0 0 6px var(--mf-success-500)' }} />
      Tempo real
    </div>
  );

  const cardStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <PageShell icon={pageIcon} title="Logs do Sistema" subtitle="Histórico completo de publicações e automações." accent="cyan" actions={pageActions}>

      {/* Filter tabs */}
      <div style={{ ...cardStyle, padding:'10px 12px', marginBottom:14, display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            height:28, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)', fontWeight:600,
            border:'none', cursor:'pointer', transition:'.15s',
            background: filter === f ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent',
            color: filter === f ? 'var(--mf-bg)' : 'var(--mf-text-3)',
          }}>{FILTER_LABELS[f]}</button>
        ))}
        <span style={{ marginLeft:'auto', fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>
          {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading && (
        <EsqueletoTabela linhas={8} colunas={4} />
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {isGrouped && grouped ? (
          grouped.map(group => (
            <div key={group.key}>
              {/* Group header */}
              <div style={{ display:'flex', alignItems:'center', gap:8, margin:'8px 0 6px', paddingLeft:4 }}>
                <span style={{ width:8, height:8, borderRadius: 'var(--mf-r-full)', background:group.color, flexShrink:0, boxShadow:`0 0 6px ${group.color}` }} />
                <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700, letterSpacing:'.1em', color:group.color, textTransform:'uppercase' }}>
                  {group.label}
                </span>
                <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>({group.items.length})</span>
                <div style={{ flex:1, height:1, background:`linear-gradient(90deg,${group.color}30,transparent)` }} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {group.items.map((entry, i) => <EntryCard key={entry._id} entry={entry} i={i} />)}
              </div>
            </div>
          ))
        ) : (
          filtered.map((entry, i) => <EntryCard key={entry._id} entry={entry} i={i} />)
        )}

        {!loading && !filtered.length && (
          <div style={{ textAlign:'center', padding:'48px 20px', background:'color-mix(in oklch, var(--mf-surface-1) 50%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)' }}>
            <div style={{ marginBottom:12, color:'var(--mf-text-3)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
            </div>
            <div style={{ fontWeight:700, fontSize: 'var(--mf-t-h2)', color:'var(--mf-text)', marginBottom:6 }}>Nenhum registro ainda</div>
            <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-3)' }}>Os logs aparecem aqui assim que você publicar posts ou executar automações.</div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

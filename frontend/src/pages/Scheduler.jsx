import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

function jobsToSchedulerItems(jobs) {
  const items = [];
  const now = Date.now();
  for (const job of jobs) {
    if (!['queued', 'running', 'waiting_interval'].includes(job.status)) continue;
    if (!job.mediaFiles?.length) continue;
    const totalMedia  = job.mediaFiles.length;
    const limit       = Math.max(1, job.simultaneousLimit || 1);
    const totalRounds = Math.ceil(totalMedia / limit);
    const intervalMs  = (job.intervalMinutes || 0) * 60 * 1000;
    const baseTime = (job.status === 'waiting_interval' && job.nextRoundAt)
      ? new Date(job.nextRoundAt).getTime()
      : now;
    const startRound = job.currentRound || 0;
    const endRound   = job.type === 'loop' ? startRound + Math.min(5, totalRounds) : totalRounds;
    for (let round = startRound; round < endRound; round++) {
      const startIdx = (round % totalRounds) * limit;
      if (startIdx >= totalMedia) break;
      const scheduledAt = new Date(baseTime + (round - startRound) * intervalMs).toISOString();
      const isCurrentRound = round === startRound;
      const status = (isCurrentRound && ['queued','running'].includes(job.status)) ? 'pendente' : 'agendado';
      items.push({
        _id:      `job-${job._id}-r${round}`,
        postType: job.postType || 'reel',
        caption:  job.caption  || job.name || '',
        accounts: job.accounts || [],
        scheduledAt, status,
        _isJob: true, _jobName: job.name || '',
      });
    }
  }
  return items;
}

export default function Scheduler() {
  const [posts, setPosts] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');

  const [primeiraCarga, setPrimeiraCarga] = useState(true);

  async function load() {
    try {
      const [postsRes, jobsRes] = await Promise.all([
        api.get('/posts'),
        api.get('/jobs').catch(() => ({ data: [] })),
      ]);
      const legacyScheduled = (postsRes.data.posts || postsRes.data || [])
        .filter(p => p.status === 'agendado' || p.status === 'pendente');
      const jobItems = jobsToSchedulerItems(jobsRes.data || []);
      const combined = [...legacyScheduled, ...jobItems]
        .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
      setPosts(combined);
    /* A fila recarrega a cada dez segundos. Sem o `finally`, uma falha de rede
       deixaria a flag ligada para sempre e o esqueleto no lugar da lista. */
    } finally { setPrimeiraCarga(false); }
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  function fmtDate(d) { return new Date(d).toLocaleString('pt-BR'); }

  function countdown(date) {
    const diff = new Date(date).getTime() - Date.now();
    if (diff <= 0) return 'Executando...';
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  const filteredPosts = selectedDate ? posts.filter(p => p.scheduledAt?.startsWith(selectedDate)) : posts;
  const agendados = posts.filter(p => p.status === 'agendado').length;
  const pendentes = posts.filter(p => p.status === 'pendente').length;

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );

  const pageActions = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', borderRadius: 'var(--mf-r-sm)', background: 'color-mix(in oklch, var(--mf-success-500) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-success-500) 20%, transparent)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-success-500)', fontFamily: 'var(--mf-mono)' }}>
      <span style={{ width: 6, height: 6, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-success-500)', display: 'inline-block', animation: 'sched-pulse 1.5s infinite' }} />
      Scheduler ativo
    </span>
  );

  const statDefs = [
    { label: 'Posts na fila', value: posts.length,   color: 'var(--mf-primary-300)', bg: 'color-mix(in oklch, var(--mf-primary-500) 10%, transparent)',  border: 'color-mix(in oklch, var(--mf-primary-500) 20%, transparent)'  },
    { label: 'Agendados',    value: agendados,        color: 'var(--mf-warning-500)', bg: 'color-mix(in oklch, var(--mf-warning-500) 10%, transparent)',  border: 'color-mix(in oklch, var(--mf-warning-500) 20%, transparent)'  },
    { label: 'Executando',   value: pendentes,        color: 'var(--mf-success-500)', bg: 'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',  border: 'color-mix(in oklch, var(--mf-success-500) 20%, transparent)'  },
  ];

  return (
    <>
      <style>{`@keyframes sched-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>

      <PageShell
        icon={pageIcon}
        title="Agendador"
        subtitle="Posts programados e fila de execução em tempo real"
        accent="gold"
        actions={pageActions}
      >
        {/* Stats */}
        <div className="g3" style={{ gap: 12 }}>
          {statDefs.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.25 }}
              style={{
                textAlign: 'center', padding: '18px 10px', borderRadius: 'var(--mf-r-lg)',
                background: s.bg, border: `1px solid ${s.border}`,
                backdropFilter: 'blur(12px)',
              }}
            >
              <div style={{ fontSize: 'var(--mf-t-display)', fontWeight: 800, color: s.color, letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4, fontFamily: 'var(--mf-mono)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        <div className="layout-media-lib" style={{ gap: 14 }}>
          {/* Date filter */}
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            style={{ background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', padding: '16px', backdropFilter: 'blur(12px)' }}
          >
            <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)', marginBottom: 12 }}>Filtro por data</h3>
            <input
              className="inp"
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            {selectedDate && (
              <button className="btn-ghost" onClick={() => setSelectedDate('')} style={{ marginTop: 8, width: '100%', padding: '6px', fontSize: 'var(--mf-t-xs)', borderRadius: 'var(--mf-r-sm)' }}>
                Limpar filtro
              </button>
            )}
            <div style={{ marginTop: 16, borderTop: '1px solid var(--mf-border)', paddingTop: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--mf-t-display)', fontWeight: 800, color: 'var(--mf-mod, var(--mf-accent-500))', fontVariantNumeric: 'tabular-nums' }}>{filteredPosts.length}</div>
              <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>Resultados</div>
            </div>
          </motion.div>

          {/* Queue */}
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            style={{ background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow: 'hidden', backdropFilter: 'blur(12px)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--mf-border)' }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)', margin: 0 }}>Fila de publicação</h3>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', background: 'oklch(0.10 0.03 235 / 0.6)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-full)', padding: '2px 8px' }}>{filteredPosts.length} itens</span>
            </div>

            <div style={{ padding: 12 }}>
              {primeiraCarga && !filteredPosts.length ? (
                <EsqueletoLista itens={4} />
              ) : filteredPosts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-body)' }}>Nenhum agendamento encontrado</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filteredPosts.map((post, i) => (
                    <motion.div
                      key={post._id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                        background: 'oklch(0.12 0.04 235 / 0.6)', borderRadius: 'var(--mf-r-md)',
                        border: '1px solid var(--mf-border)',
                        borderLeft: `3px solid ${post.status === 'agendado' ? 'var(--mf-warning-500)' : 'var(--mf-success-500)'}`,
                      }}
                    >
                      <div style={{ textAlign: 'center', flexShrink: 0, width: 52 }}>
                        {post.scheduledAt ? (
                          <>
                            <div style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text)' }}>{new Date(post.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div style={{ fontSize: 'var(--mf-t-nano)', color: post.status === 'agendado' ? 'var(--mf-warning-500)' : 'var(--mf-success-500)', marginTop: 2, fontFamily: 'var(--mf-mono)' }}>{countdown(post.scheduledAt)}</div>
                          </>
                        ) : <div style={{ fontSize: 'var(--mf-t-h1)' }}>📤</div>}
                      </div>
                      <div style={{ width: 1, height: 40, background: 'var(--mf-border)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 600, marginBottom: 3, color: 'var(--mf-text)' }}>{post.caption ? post.caption.slice(0, 50) + (post.caption.length > 50 ? '...' : '') : 'Sem legenda'}</div>
                        <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', display: 'flex', gap: 12, fontFamily: 'var(--mf-mono)', flexWrap: 'wrap', rowGap: 2 }}>
                          <span>{post.postType === 'reel' ? 'Reel' : 'Post'}</span>
                          {post.scheduledAt && <span>{fmtDate(post.scheduledAt)}</span>}
                          {post.accounts?.length && <span>{post.accounts.map(a => `@${a.username}`).join(', ')}</span>}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 'var(--mf-t-micro)', fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--mf-r-full)',
                        fontFamily: 'var(--mf-mono)',
                        background: post.status === 'agendado' ? 'color-mix(in oklch, var(--mf-warning-500) 10%, transparent)' : 'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',
                        color: post.status === 'agendado' ? 'var(--mf-warning-500)' : 'var(--mf-success-500)',
                      }}>{post.status}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </PageShell>
    </>
  );
}

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import PageShell from '../components/PageShell';

export default function Scheduler() {
  const [posts, setPosts] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');

  async function load() {
    const res = await api.get('/posts');
    const all = res.data.posts || res.data || [];
    const scheduled = all.filter(p => p.status === 'agendado' || p.status === 'pendente');
    setPosts(scheduled);
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', borderRadius: 8, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', fontSize: 11, color: '#22c55e', fontFamily: 'var(--font-mono)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'sched-pulse 1.5s infinite' }} />
      Scheduler ativo
    </span>
  );

  const statDefs = [
    { label: 'Posts na fila', value: posts.length,   color: '#818cf8', bg: 'rgba(99,102,241,.1)',  border: 'rgba(99,102,241,.2)'  },
    { label: 'Agendados',    value: agendados,        color: '#fbbf24', bg: 'rgba(251,191,36,.1)',  border: 'rgba(251,191,36,.2)'  },
    { label: 'Executando',   value: pendentes,        color: '#34d399', bg: 'rgba(52,211,153,.1)',  border: 'rgba(52,211,153,.2)'  },
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
                textAlign: 'center', padding: '18px 10px', borderRadius: 14,
                background: s.bg, border: `1px solid ${s.border}`,
                backdropFilter: 'blur(12px)',
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color, letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        <div className="layout-media-lib" style={{ gap: 14 }}>
          {/* Date filter */}
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            style={{ background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 14, padding: '16px', backdropFilter: 'blur(12px)' }}
          >
            <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Filtro por data</h3>
            <input
              className="inp"
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            {selectedDate && (
              <button className="btn-ghost" onClick={() => setSelectedDate('')} style={{ marginTop: 8, width: '100%', padding: '6px', fontSize: '.78rem', borderRadius: 7 }}>
                Limpar filtro
              </button>
            )}
            <div style={{ marginTop: 16, borderTop: '1px solid oklch(1 0 0 / 0.07)', paddingTop: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--cyan)', fontVariantNumeric: 'tabular-nums' }}>{filteredPosts.length}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>Resultados</div>
            </div>
          </motion.div>

          {/* Queue */}
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            style={{ background: 'oklch(0.16 0.05 235 / 0.85)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 14, overflow: 'hidden', backdropFilter: 'blur(12px)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}>
              <h3 style={{ fontSize: '.88rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>Fila de publicação</h3>
              <span style={{ fontSize: '.72rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)', background: 'oklch(0.10 0.03 235 / 0.6)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 100, padding: '2px 8px' }}>{filteredPosts.length} itens</span>
            </div>

            <div style={{ padding: 12 }}>
              {filteredPosts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text3)', fontSize: '.85rem' }}>Nenhum agendamento encontrado</div>
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
                        background: 'oklch(0.12 0.04 235 / 0.6)', borderRadius: 10,
                        border: '1px solid oklch(1 0 0 / 0.07)',
                        borderLeft: `3px solid ${post.status === 'agendado' ? '#fbbf24' : '#34d399'}`,
                      }}
                    >
                      <div style={{ textAlign: 'center', flexShrink: 0, width: 52 }}>
                        {post.scheduledAt ? (
                          <>
                            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{new Date(post.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div style={{ fontSize: 10, color: post.status === 'agendado' ? '#fbbf24' : '#34d399', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{countdown(post.scheduledAt)}</div>
                          </>
                        ) : <div style={{ fontSize: 20 }}>📤</div>}
                      </div>
                      <div style={{ width: 1, height: 40, background: 'oklch(1 0 0 / 0.08)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, color: 'var(--text)' }}>{post.caption ? post.caption.slice(0, 50) + (post.caption.length > 50 ? '...' : '') : 'Sem legenda'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12, fontFamily: 'var(--font-mono)' }}>
                          <span>{post.postType === 'reel' ? 'Reel' : 'Post'}</span>
                          {post.scheduledAt && <span>{fmtDate(post.scheduledAt)}</span>}
                          {post.accounts?.length && <span>{post.accounts.map(a => `@${a.username}`).join(', ')}</span>}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                        fontFamily: 'var(--font-mono)',
                        background: post.status === 'agendado' ? 'rgba(251,191,36,.1)' : 'rgba(52,211,153,.1)',
                        color: post.status === 'agendado' ? '#fbbf24' : '#34d399',
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

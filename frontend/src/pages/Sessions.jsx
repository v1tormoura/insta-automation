import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoTabela } from '../components/Estados';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STATUS_MAP = {
  ok:        { bg:'color-mix(in oklch, var(--mf-success-500) 13%, transparent)', color:'var(--mf-success-500)', border:'oklch(0.38 0.12 150 / 0.35)', label:'Sessão OK'  },
  em_uso:    { bg:'color-mix(in oklch, var(--mf-mod-publicar) 13%, transparent)', color:'var(--mf-mod-publicar)', border:'color-mix(in oklch, var(--mf-primary-500) 35%, transparent)', label:'Em uso'     },
  expirada:  { bg:'color-mix(in oklch, var(--mf-warning-500) 13%, transparent)',  color:'var(--mf-warning-500)', border:'oklch(0.38 0.12 60 / 0.35)',  label:'Expirada'   },
  sem_sessao:{ bg:'color-mix(in oklch, var(--mf-warning-500) 13%, transparent)',  color:'var(--mf-warning-500)', border:'oklch(0.38 0.12 60 / 0.35)',  label:'Sem sessão' },
  erro_login:{ bg:'color-mix(in oklch, var(--mf-danger-500) 13%, transparent)',  color:'var(--mf-danger-500)', border:'oklch(0.38 0.12 15 / 0.35)',  label:'Erro login' },
};

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { bg:'color-mix(in oklch, var(--mf-surface-1) 60%, transparent)', color:'var(--mf-text-3)', border:'color-mix(in oklch, var(--mf-surface-3) 35%, transparent)', label:'Sessão OK' };
  return <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', background:s.bg, color:s.color, border:`1px solid ${s.border}`, whiteSpace:'nowrap' }}>{s.label}</span>;
}

export default function Sessions() {
  const [sessions, setSessions]   = useState([]);
  const [toast, setToast]         = useState(null);
  const [loadingId, setLoadingId] = useState(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  const [primeiraCarga, setPrimeiraCarga] = useState(true);

  async function loadSessions() {
    try { const res = await api.get('/sessions'); setSessions(res.data); }
    finally { setPrimeiraCarga(false); }
  }

  async function testSession(id) {
    try { setLoadingId(id); await api.post(`/sessions/${id}/test`); await loadSessions(); showToast('success', 'Sessão testada', 'A sessão foi sincronizada com sucesso.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar sessão.'); }
    finally { setLoadingId(null); }
  }

  async function openSession(id) {
    try { await api.post(`/sessions/${id}/open`); showToast('success', 'Abrindo conta', 'O navegador será aberto com essa sessão.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao abrir sessão.'); }
  }

  useServerEvents(['accounts'], loadSessions);
  useEffect(() => { loadSessions(); const t = setInterval(loadSessions, 30000); return () => clearInterval(t); }, []);

  const ok       = sessions.filter(s => s.sessionStatus === 'ok').length;
  const expired  = sessions.filter(s => s.sessionStatus === 'expirada').length;
  const noSess   = sessions.filter(s => s.sessionStatus === 'sem_sessao').length;
  const busy     = sessions.filter(s => s.sessionStatus === 'em_uso').length;

  const STATS = [
    { label:'Total',       value:sessions.length, color:'var(--mf-primary-600)' },
    { label:'Sessões OK',  value:ok,              color:'oklch(0.72 0.18 150)' },
    { label:'Expiradas',   value:expired,         color:'oklch(0.78 0.17 60)'  },
    { label:'Sem sessão',  value:noSess,          color:'oklch(0.78 0.17 60)'  },
    { label:'Em uso',      value:busy,            color:'var(--mf-primary-500)'  },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-success-500)', padding:'4px 12px', borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-success-500) 6%, transparent)', border:'1px solid oklch(0.38 0.12 150 / 0.3)' }}>
        <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', background:'var(--mf-success-500)', display:'inline-block', boxShadow:'0 0 6px var(--mf-success-500)' }} />
        Monitoramento ativo
      </div>
    </div>
  );

  const cardStyle = { background:'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', backdropFilter:'blur(12px)' };
  const thStyle   = { padding:'8px 12px', fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.07em', fontFamily:'var(--mf-mono)', borderBottom:'1px solid var(--mf-border)', textAlign:'left', background:'color-mix(in oklch, var(--mf-bg) 40%, transparent)' };
  const tdStyle   = { padding:'12px 12px', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', borderBottom:'1px solid var(--mf-border-subtle)', verticalAlign:'middle' };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Sessões" subtitle="Monitore sessões salvas, expiradas e contas que precisam de login." accent="purple" actions={pageActions}>

        {/* Stats */}
        <div className="resp-grid-5" style={{ marginBottom:14 }}>
          {STATS.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:.2, delay:i*.04 }}
              style={{ ...cardStyle, padding:'12px 12px', textAlign:'center', borderTop:`2px solid ${s.color}` }}>
              <div style={{ fontSize: 'var(--mf-t-display)', fontWeight:900, color:s.color, letterSpacing:'-1px', fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:3, fontFamily:'var(--mf-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Table card */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.12 }} style={cardStyle}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
            <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Contas conectadas</h3>
            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>Atualiza a cada 30s</span>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Conta</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Última sync</th>
                  <th style={thStyle}>Info</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {primeiraCarga && !sessions.length && (
                  <tr><td colSpan={6} style={{ padding: 0 }}>
                    <EsqueletoTabela linhas={5} colunas={5} />
                  </td></tr>
                )}
                {sessions.map((session, i) => (
                  <tr key={session._id} style={{ background: i % 2 === 0 ? 'transparent' : 'color-mix(in oklch, var(--mf-bg) 20%, transparent)' }}>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        {session.avatar
                          ? <img src={`${API_BASE}${session.avatar}`} alt="" style={{ width:32, height:32, borderRadius: 'var(--mf-r-sm)', objectFit:'cover' }} />
                          : <div style={{ width:32, height:32, borderRadius: 'var(--mf-r-sm)', background:'color-mix(in oklch, var(--mf-primary-500) 15%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-primary-500) 25%, transparent)', display:'grid', placeItems:'center', fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-primary-500)' }}>{session.username?.charAt(0)?.toUpperCase() || 'I'}</div>
                        }
                        <div>
                          <div style={{ fontWeight:700, color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)' }}>@{session.username}</div>
                          <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>{session.name || 'Sem nome'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}><StatusBadge status={session.sessionStatus} /></td>
                    <td style={{ ...tdStyle, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)' }}>
                      {session.lastSync ? new Date(session.lastSync).toLocaleString('pt-BR') : 'Nunca'}
                    </td>
                    <td style={{ ...tdStyle, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {session.lastError || session.busyReason || '—'}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => openSession(session._id)}>Abrir</button>
                        <button className="btn-primary" style={{ fontSize: 'var(--mf-t-micro)', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', opacity: loadingId === session._id ? .5 : 1 }}
                          onClick={() => testSession(session._id)} disabled={loadingId === session._id}>
                          {loadingId === session._id ? 'Testando...' : 'Testar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sessions.length && (
              <div style={{ textAlign:'center', padding:'32px 16px', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>Nenhuma conta encontrada.</div>
            )}
          </div>
        </motion.div>

      </PageShell>
    </>
  );
}

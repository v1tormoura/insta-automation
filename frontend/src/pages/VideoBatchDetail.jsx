import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import { getToken } from '../services/auth';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoTabela, Bloco } from '../components/Estados';

const CARD = {
  background: 'oklch(0.16 0.05 235 / 0.85)',
  border: '1px solid var(--mf-border)',
  borderRadius: 'var(--mf-r-lg)',
  backdropFilter: 'blur(12px)',
  overflow: 'hidden',
};

const STATUS_META = {
  pending:    { label: 'Aguardando',  color: 'var(--mf-text-3)', icon: '○' },
  queued:     { label: 'Na fila',     color: 'var(--mf-info-500)', icon: '⋯' },
  processing: { label: 'Processando', color: 'var(--mf-warning-500)', icon: '◌' },
  completed:  { label: 'Concluído',   color: 'var(--mf-success-500)', icon: '✓' },
  failed:     { label: 'Falhou',      color: 'var(--mf-danger-500)', icon: '✗' },
  cancelled:  { label: 'Cancelado',   color: 'var(--mf-text-3)', icon: '⊘' },
};

const BATCH_STATUS = {
  pending:    { label: 'Aguardando',  color: 'var(--mf-text-3)' },
  processing: { label: 'Processando', color: 'var(--mf-info-500)' },
  completed:  { label: 'Concluído',   color: 'var(--mf-success-500)' },
  failed:     { label: 'Falhou',      color: 'var(--mf-danger-500)' },
  cancelled:  { label: 'Cancelado',   color: 'var(--mf-text-3)' },
};

function ProgressBar({ completed, failed, total }) {
  const okPct  = total > 0 ? (completed / total) * 100 : 0;
  const errPct = total > 0 ? (failed   / total) * 100 : 0;
  return (
    <div style={{ height: 6, background: 'var(--mf-border)', borderRadius: 'var(--mf-r-full)', overflow: 'hidden' }}>
      <div style={{ height: '100%', display: 'flex' }}>
        <div style={{ width: `${okPct}%`,  background: 'var(--mf-success-500)', transition: 'width .4s' }} />
        <div style={{ width: `${errPct}%`, background: 'var(--mf-danger-500)', transition: 'width .4s' }} />
      </div>
    </div>
  );
}

function fmtDuration(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtSize(bytes) {
  if (!bytes) return '—';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function VideoBatchDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [logsJob, setLogsJob] = useState(null);
  const [logs, setLogs]       = useState(null);
  const pollRef = useRef(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function load() {
    try {
      const r = await api.get(`/video-batches/${id}`);
      setData(r.data);
    } catch {
      showToast('error', 'Erro', 'Não foi possível carregar o lote.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Poll while processing
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.get(`/video-batches/${id}`);
        setData(r.data);
        if (!['processing', 'pending'].includes(r.data.batch?.status)) {
          clearInterval(pollRef.current);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [id]);

  async function cancel() {
    try { await api.post(`/video-batches/${id}/cancel`); showToast('success', 'Cancelado', 'Lote cancelado.'); load(); }
    catch { showToast('error', 'Erro', 'Não foi possível cancelar.'); }
  }

  async function retry(renderId) {
    try { await api.post(`/video-batches/${id}/renders/${renderId}/retry`); showToast('success', 'Reenviado', 'Job adicionado à fila novamente.'); load(); }
    catch (err) { showToast('error', 'Erro', err?.response?.data?.error || 'Falha ao reenviar.'); }
  }

  async function showLogs(renderId) {
    try {
      const r = await api.get(`/video-batches/${id}/renders/${renderId}/logs`);
      setLogsJob(renderId);
      setLogs(r.data.logs || []);
    } catch { showToast('error', 'Erro', 'Não foi possível carregar os logs.'); }
  }

  function downloadUrl(renderId) {
    const token = getToken();
    const base  = import.meta.env.VITE_API_URL || '';
    return `${base}/video-batches/${id}/renders/${renderId}/download?token=${token}`;
  }

  async function downloadRender(renderId, originalName, idx) {
    const url = downloadUrl(renderId);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        let msg = 'Erro ao baixar arquivo';
        try { const j = await res.json(); msg = j.error || msg; } catch {}
        showToast('error', 'Erro no download', msg);
        return;
      }
      // Pega o filename do header Content-Disposition ou usa fallback
      const disp = res.headers.get('Content-Disposition') || '';
      const match = disp.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      const filename = match ? match[1].replace(/['"]/g, '') : (originalName ? originalName.replace(/\.[^.]+$/, '') + '_rendered.mp4' : `render_${idx + 1}.mp4`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    } catch (err) {
      showToast('error', 'Erro no download', err.message || 'Falha de rede');
    }
  }

  function downloadAll() {
    const completed = renderJobs.filter(rj => rj.status === 'completed');
    completed.forEach((rj, i) => {
      setTimeout(() => downloadRender(rj._id, rj.originalName, i), i * 800);
    });
  }

  if (loading) {
    return (
      <PageShell title="Lote de Vídeo" accent="green">
        <div style={{ display:'flex', flexDirection:'column', gap:'var(--mf-4)' }}>
          <Bloco style={{ height:120, borderRadius:'var(--mf-r-lg)' }} />
          <EsqueletoTabela linhas={6} colunas={4} />
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell title="Lote não encontrado" accent="green">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <button className="btn-ghost" onClick={() => navigate('/video-batches')}>← Voltar</button>
        </div>
      </PageShell>
    );
  }

  const { batch, renderJobs = [] } = data;
  const bMeta = BATCH_STATUS[batch.status] || BATCH_STATUS.pending;
  const pct   = batch.totalJobs > 0 ? Math.round(((batch.completedJobs + batch.failedJobs) / batch.totalJobs) * 100) : 0;

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );

  const completedCount = renderJobs.filter(rj => rj.status === 'completed').length;

  const pageActions = (
    <>
      <button className="btn-ghost" onClick={() => navigate('/video-batches')} style={{ padding: '5px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Lotes
      </button>
      {completedCount > 0 && (
        <button className="btn-ghost" onClick={downloadAll} style={{ padding: '5px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-success-500)', borderColor: '#4ade8030', display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Baixar todos ({completedCount})
        </button>
      )}
      {batch.status === 'processing' && (
        <button className="btn-ghost" onClick={cancel} style={{ padding: '5px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', color: 'var(--mf-danger-500)' }}>
          Cancelar lote
        </button>
      )}
    </>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Logs modal */}
      {logsJob && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setLogsJob(null); setLogs(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ ...CARD, width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--mf-border)', flexShrink: 0 }}>
              <strong style={{ fontSize: 'var(--mf-t-body)', color: 'var(--mf-text)' }}>Logs do render</strong>
              <button className="btn-ghost" onClick={() => { setLogsJob(null); setLogs(null); }} style={{ padding: '3px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-h1)' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(logs || []).length === 0 ? (
                <p style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)', textAlign: 'center', padding: 20 }}>Sem logs disponíveis.</p>
              ) : (logs || []).map((log, i) => (
                <div key={i} style={{ fontSize: 'var(--mf-t-xs)', fontFamily: 'var(--mf-mono)', color: log.level === 'error' ? 'var(--mf-danger-500)' : log.level === 'warn' ? 'var(--mf-warning-500)' : 'var(--mf-text-3)', display: 'flex', gap: 8 }}>
                  <span style={{ flexShrink: 0, color: 'var(--mf-border-strong)' }}>{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PageShell icon={pageIcon} title={batch.name} subtitle={`Template: ${batch.templateId?.name || '—'} · ${batch.totalJobs} vídeos`} accent="green" actions={pageActions}>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Overview card */}
          <div style={CARD}>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.5rem', fontWeight: 700, color: bMeta.color, fontFamily: 'var(--mf-mono)' }}>{pct}%</span>
                  <span style={{ fontSize: 'var(--mf-t-xs)', borderRadius: 'var(--mf-r-full)', padding: '3px 10px', background: `${bMeta.color}15`, color: bMeta.color, border: `1px solid ${bMeta.color}30` }}>{bMeta.label}</span>
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 'var(--mf-t-xs)', fontFamily: 'var(--mf-mono)' }}>
                  <span style={{ color: 'var(--mf-success-500)' }}>✓ {batch.completedJobs} concluídos</span>
                  {batch.failedJobs > 0 && <span style={{ color: 'var(--mf-danger-500)' }}>✗ {batch.failedJobs} falhos</span>}
                  {batch.pendingJobs > 0 && <span style={{ color: 'var(--mf-text-3)' }}>⋯ {batch.pendingJobs} pendentes</span>}
                  <span style={{ color: 'var(--mf-text-3)' }}>Total: {batch.totalJobs}</span>
                </div>
              </div>
              <ProgressBar completed={batch.completedJobs} failed={batch.failedJobs} total={batch.totalJobs} />
              <div style={{ marginTop: 8, display: 'flex', gap: 14, fontSize: 'var(--mf-t-micro)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)' }}>
                <span>Criado: {new Date(batch.createdAt).toLocaleString('pt-BR')}</span>
                {batch.completedAt && <span>Concluído: {new Date(batch.completedAt).toLocaleString('pt-BR')}</span>}
                <span>Qualidade: {batch.quality}</span>
              </div>
            </div>
          </div>

          {/* Render jobs */}
          <div style={CARD}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--mf-border)' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)' }}>Renders ({renderJobs.length})</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--mf-t-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--mf-border)' }}>
                    {['Arquivo', 'Status', 'Duração', 'Tamanho', 'Ações'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 'var(--mf-t-micro)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)', fontWeight: 600, letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {renderJobs.map((rj, i) => {
                    const sm = STATUS_META[rj.status] || STATUS_META.pending;
                    return (
                      <motion.tr
                        key={rj._id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        style={{ borderBottom: '1px solid var(--mf-border-subtle)' }}
                      >
                        <td style={{ padding: '9px 12px', color: 'var(--mf-text)', maxWidth: 220 }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rj.originalName}>{rj.originalName || '—'}</span>
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 'var(--mf-t-micro)', borderRadius: 'var(--mf-r-full)', padding: '2px 8px', background: `${sm.color}15`, color: sm.color, border: `1px solid ${sm.color}25` }}>
                            {sm.icon} {sm.label}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', whiteSpace: 'nowrap' }}>
                          {fmtDuration(rj.duration)}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', whiteSpace: 'nowrap' }}>
                          {fmtSize(rj.metrics?.outputSize)}
                        </td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-ghost" onClick={() => showLogs(rj._id)} style={{ padding: '3px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)' }}>Logs</button>
                            {rj.status === 'completed' && (
                              <button className="btn-ghost" onClick={() => downloadRender(rj._id, rj.originalName, renderJobs.indexOf(rj))} style={{ padding: '3px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-success-500)', borderColor: '#4ade8030' }}>
                                Download
                              </button>
                            )}
                            {['failed', 'cancelled'].includes(rj.status) && (
                              <button className="btn-ghost" onClick={() => retry(rj._id)} style={{ padding: '3px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-info-500)' }}>Retentar</button>
                            )}
                            {rj.error && (
                              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rj.error}>{rj.error}</span>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                  {!renderJobs.length && (
                    <tr><td colSpan={5} style={{ padding: '30px 12px', textAlign: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-body)' }}>Nenhum render ainda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PageShell>
    </>
  );
}

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

const CARD = {
  background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)',
  border: '1px solid var(--mf-border)',
  borderRadius: 'var(--mf-r-lg)',
  backdropFilter: 'blur(12px)',
  overflow: 'hidden',
};

const STATUS_META = {
  pending:    { label: 'Aguardando', color: 'var(--mf-text-3)' },
  processing: { label: 'Processando', color: 'var(--mf-info-500)' },
  completed:  { label: 'Concluído',   color: 'var(--mf-success-500)' },
  failed:     { label: 'Falhou',      color: 'var(--mf-danger-500)' },
  cancelled:  { label: 'Cancelado',   color: 'var(--mf-text-3)' },
};

const QUALITY_LABEL = { fast: 'Rápido (CRF 26)', balanced: 'Balanceado (CRF 20)', high: 'Alta qualidade (CRF 16)' };

function ProgressBar({ completed, failed, total }) {
  const pct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
  return (
    <div style={{ height: 4, background: 'var(--mf-border)', borderRadius: 'var(--mf-r-full)', overflow: 'hidden', margin: '8px 0 4px' }}>
      <div style={{
        height: '100%', borderRadius: 'var(--mf-r-full)', transition: 'width .4s',
        background: `linear-gradient(90deg, var(--mf-info-500) ${completed / (total || 1) * 100}%, var(--mf-danger-500) 0%)`,
        width: `${pct}%`,
      }} />
    </div>
  );
}

function NewBatchModal({ onClose, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [batchName, setBatchName]   = useState('');
  const [quality, setQuality]       = useState('balanced');
  const [files, setFiles]           = useState([]);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);
  const fileRef = useRef();

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3000); }

  useEffect(() => {
    api.get('/video-templates').then(r => {
      setTemplates(r.data);
      if (r.data.length > 0) setTemplateId(r.data[0]._id);
    }).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!templateId) return showToast('warning', 'Atenção', 'Selecione um template.');
    if (!files.length) return showToast('warning', 'Atenção', 'Selecione ao menos um vídeo.');

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('templateId', templateId);
      fd.append('name', batchName || `Lote ${new Date().toLocaleDateString('pt-BR')}`);
      fd.append('quality', quality);
      for (const f of files) fd.append('videos', f);

      const res = await api.post('/video-batches', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onCreated(res.data.batch._id);
    } catch (err) {
      showToast('error', 'Erro', err?.response?.data?.error || 'Falha ao criar lote.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <Toast toast={toast} onClose={() => setToast(null)} />
      <motion.div
        initial={{ scale: .96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        style={{ ...CARD, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--mf-border)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--mf-t-h2)', fontWeight: 700, color: 'var(--mf-text)' }}>Novo Lote de Vídeo</h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-h1)', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18 }}>
          <div className="form-group">
            <label>Template</label>
            {templates.length === 0 ? (
              <p style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-danger-500)', margin: 0 }}>
                Nenhum template disponível.{' '}
                <a href="/video-templates/new" style={{ color: 'var(--mf-primary-300)' }}>Criar um template</a>
              </p>
            ) : (
              <select className="inp" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                {templates.map(t => (
                  <option key={t._id} value={t._id}>
                    {t.name} — {t.canvas?.width}×{t.canvas?.height}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label>Nome do Lote (opcional)</label>
            <input className="inp" value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="Ex: Reels de setembro" />
          </div>

          <div className="form-group">
            <label>Qualidade</label>
            <select className="inp" value={quality} onChange={e => setQuality(e.target.value)}>
              {Object.entries(QUALITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Vídeos ({files.length} selecionado{files.length !== 1 ? 's' : ''})</label>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: '2px dashed var(--mf-border-strong)', borderRadius: 'var(--mf-r-md)', padding: '18px 14px',
                textAlign: 'center', cursor: 'pointer', transition: 'border-color var(--mf-fast) var(--mf-ease-out)',
              }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--mf-primary-300)'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--mf-border-strong)'; }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'var(--mf-border-strong)';
                const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
                setFiles(prev => [...prev, ...dropped]);
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text-3)" strokeWidth="1.5" strokeLinecap="round" style={{ margin: '0 auto 8px', display: 'block' }}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p style={{ margin: 0, fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)' }}>Arraste os vídeos aqui ou <span style={{ color: 'var(--mf-primary-300)' }}>clique para selecionar</span></p>
              <p style={{ margin: '4px 0 0', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>MP4, MOV, AVI, MKV — até 500 MB por arquivo</p>
              <input ref={fileRef} type="file" multiple accept="video/*" style={{ display: 'none' }} onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])} />
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', background: 'var(--mf-border-subtle)', borderRadius: 'var(--mf-r-sm)', padding: '4px 10px' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-info-500)" strokeWidth="2.5" strokeLinecap="round"><path d="M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontFamily: 'var(--mf-mono)', flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => setFiles(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--mf-text-3)', cursor: 'pointer', padding: 0, fontSize: 'var(--mf-t-body)', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
            <button type="button" className="btn-ghost" onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-body)' }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving} style={{ flex: 2, padding: '9px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {saving ? 'Criando…' : `Criar Lote (${files.length} vídeo${files.length !== 1 ? 's' : ''})`}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default function VideoBatches() {
  const navigate = useNavigate();
  const [batches, setBatches]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showNew, setShowNew]   = useState(false);
  const [toast, setToast]       = useState(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function load() {
    try { setLoading(true); const r = await api.get('/video-batches'); setBatches(r.data); }
    catch { showToast('error', 'Erro', 'Não foi possível carregar os lotes.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function cancelBatch(id) {
    try { await api.post(`/video-batches/${id}/cancel`); showToast('success', 'Cancelado', 'Lote cancelado.'); load(); }
    catch { showToast('error', 'Erro', 'Não foi possível cancelar.'); }
  }

  function onCreated(batchId) {
    setShowNew(false);
    navigate(`/video-batches/${batchId}`);
  }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );

  const pageActions = (
    <>
      <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', background: 'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', padding: '4px 10px' }}>
        {batches.length} lotes
      </span>
      <button className="btn-primary" onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-sm)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Lote
      </button>
    </>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <AnimatePresence>{showNew && <NewBatchModal onClose={() => setShowNew(false)} onCreated={onCreated} />}</AnimatePresence>

      <PageShell icon={pageIcon} title="Lotes de Vídeo" subtitle="Renderize múltiplos vídeos em lote com o mesmo template" accent="green" actions={pageActions}>
        <div style={{ padding: '16px 20px' }}>
          {loading ? (
            <EsqueletoLista itens={4} />
          ) : !batches.length ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ ...CARD, padding: '60px 20px', textAlign: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--mf-border-strong)" strokeWidth="1.5" strokeLinecap="round" style={{ margin: '0 auto 16px', display: 'block' }}>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              <p style={{ color: 'var(--mf-text-3)', marginBottom: 16, fontSize: 'var(--mf-t-body)' }}>Nenhum lote criado ainda.</p>
              <button className="btn-primary" onClick={() => setShowNew(true)} style={{ padding: '8px 20px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-body)' }}>Criar primeiro lote</button>
            </motion.div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {batches.map((batch, i) => {
                const meta = STATUS_META[batch.status] || STATUS_META.pending;
                const pct  = batch.totalJobs > 0 ? Math.round(((batch.completedJobs + batch.failedJobs) / batch.totalJobs) * 100) : 0;

                return (
                  <motion.div
                    key={batch._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    style={{ ...CARD, cursor: 'pointer' }}
                    onClick={() => navigate(`/video-batches/${batch._id}`)}
                  >
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 'var(--mf-t-body)', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{batch.name}</strong>
                            <span style={{ fontSize: 'var(--mf-t-micro)', borderRadius: 'var(--mf-r-full)', padding: '2px 8px', background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30`, flexShrink: 0 }}>
                              {meta.label}
                            </span>
                          </div>
                          {batch.templateId?.name && (
                            <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 3, display: 'block' }}>
                              Template: {batch.templateId.name}
                            </span>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: meta.color, fontFamily: 'var(--mf-mono)' }}>{pct}%</span>
                          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', marginTop: 2 }}>
                            {batch.completedJobs}/{batch.totalJobs}
                          </div>
                        </div>
                      </div>

                      <ProgressBar completed={batch.completedJobs} failed={batch.failedJobs} total={batch.totalJobs} />

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 10, fontSize: 'var(--mf-t-micro)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-3)' }}>
                          {batch.completedJobs > 0 && <span style={{ color: 'var(--mf-success-500)' }}>✓ {batch.completedJobs}</span>}
                          {batch.failedJobs    > 0 && <span style={{ color: 'var(--mf-danger-500)' }}>✗ {batch.failedJobs}</span>}
                          {batch.pendingJobs   > 0 && <span>⋯ {batch.pendingJobs}</span>}
                          <span>{new Date(batch.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {batch.status === 'processing' && (
                          <button
                            className="btn-ghost"
                            style={{ padding: '3px 10px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)' }}
                            onClick={e => { e.stopPropagation(); cancelBatch(batch._id); }}
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </PageShell>
    </>
  );
}

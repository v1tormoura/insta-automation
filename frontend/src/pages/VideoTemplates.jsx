import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

const CARD = {
  background: 'oklch(0.16 0.05 235 / 0.85)',
  border: '1px solid oklch(1 0 0 / 0.07)',
  borderRadius: 14,
  backdropFilter: 'blur(12px)',
  overflow: 'hidden',
};

const FIT_LABELS = { cover: 'Cover', contain: 'Contain', blur: 'Blur', stretch: 'Stretch' };

function StatusPill({ count, label, color }) {
  return (
    <span style={{
      fontSize: '.7rem', fontFamily: 'var(--font-mono)', borderRadius: 100,
      padding: '2px 8px', background: `${color}18`, color, border: `1px solid ${color}30`,
    }}>
      {count} {label}
    </span>
  );
}

export default function VideoTemplates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState(null);
  const [deleting, setDeleting]   = useState(null);

  function showToast(type, title, message) {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/video-templates');
      setTemplates(res.data);
    } catch {
      showToast('error', 'Erro', 'Não foi possível carregar os templates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function duplicate(id) {
    try {
      await api.post(`/video-templates/${id}/duplicate`);
      showToast('success', 'Duplicado', 'Template duplicado com sucesso.');
      load();
    } catch {
      showToast('error', 'Erro', 'Não foi possível duplicar.');
    }
  }

  async function remove(id) {
    if (deleting === id) {
      try {
        await api.delete(`/video-templates/${id}`);
        showToast('success', 'Removido', 'Template excluído.');
        load();
      } catch {
        showToast('error', 'Erro', 'Não foi possível excluir.');
      } finally {
        setDeleting(null);
      }
    } else {
      setDeleting(id);
      setTimeout(() => setDeleting(d => d === id ? null : d), 3000);
    }
  }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="3"/><path d="M8 2v20M16 2v20M2 8h6M2 16h6M16 8h6M16 16h6"/>
    </svg>
  );

  const pageActions = (
    <>
      <span style={{ fontSize: '.78rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)', background: 'oklch(0.10 0.03 235 / 0.6)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 8, padding: '4px 10px' }}>
        {templates.length} templates
      </span>
      <button
        className="btn-primary"
        onClick={() => navigate('/video-templates/new')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 9, fontSize: '.83rem' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Template
      </button>
    </>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Templates de Vídeo" subtitle="Defina layouts reutilizáveis para renderização em lote" accent="purple" actions={pageActions}>
        <div style={{ padding: '16px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text3)', fontSize: '.88rem' }}>
              Carregando templates…
            </div>
          ) : !templates.length ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ ...CARD, padding: '60px 20px', textAlign: 'center' }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="oklch(1 0 0 / 0.2)" strokeWidth="1.5" strokeLinecap="round" style={{ margin: '0 auto 16px' }}>
                <rect x="2" y="2" width="20" height="20" rx="3"/><path d="M8 2v20M16 2v20M2 8h6M2 16h6M16 8h6M16 16h6"/>
              </svg>
              <p style={{ color: 'var(--text3)', marginBottom: 16, fontSize: '.88rem' }}>Nenhum template criado ainda.</p>
              <button className="btn-primary" onClick={() => navigate('/video-templates/new')} style={{ padding: '8px 20px', borderRadius: 9, fontSize: '.85rem' }}>
                Criar primeiro template
              </button>
            </motion.div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {templates.map((tmpl, i) => {
                const videoEl = tmpl.elements?.find(el => el.type === 'video');
                const imageEls = tmpl.elements?.filter(el => el.type === 'image') || [];
                const textEls  = tmpl.elements?.filter(el => el.type === 'text')  || [];
                const isDel = deleting === tmpl._id;

                return (
                  <motion.div
                    key={tmpl._id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    style={{ ...CARD }}
                  >
                    {/* Header */}
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid oklch(1 0 0 / 0.07)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                        background: 'rgba(139,92,246,.12)', border: '1px solid rgba(139,92,246,.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round">
                          <rect x="2" y="2" width="20" height="20" rx="3"/><path d="M8 2v20M16 2v20M2 8h6M16 8h6"/>
                        </svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '.9rem', color: 'var(--text)' }}>{tmpl.name}</strong>
                        {tmpl.description && (
                          <span style={{ fontSize: '.75rem', color: 'var(--text3)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{tmpl.description}</span>
                        )}
                      </div>
                      <span style={{ fontSize: '.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text3)', flexShrink: 0 }}>v{tmpl.version}</span>
                    </div>

                    {/* Info */}
                    <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: '.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text3)', background: 'oklch(1 0 0 / 0.04)', border: '1px solid oklch(1 0 0 / 0.08)', borderRadius: 6, padding: '2px 8px' }}>
                        {tmpl.canvas?.width}×{tmpl.canvas?.height}
                      </span>
                      <span style={{ fontSize: '.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text3)', background: 'oklch(1 0 0 / 0.04)', border: '1px solid oklch(1 0 0 / 0.08)', borderRadius: 6, padding: '2px 8px' }}>
                        {tmpl.canvas?.fps || 30} fps
                      </span>
                      {videoEl && (
                        <span style={{ fontSize: '.72rem', fontFamily: 'var(--font-mono)', color: '#818cf8', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 6, padding: '2px 8px' }}>
                          {FIT_LABELS[videoEl.fit] || 'Cover'}
                        </span>
                      )}
                      {imageEls.length > 0 && <StatusPill count={imageEls.length} label="img" color="#60a5fa" />}
                      {textEls.length  > 0 && <StatusPill count={textEls.length}  label="text" color="#4ade80" />}
                    </div>

                    {/* Footer */}
                    <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid oklch(1 0 0 / 0.06)' }}>
                      <button
                        className="btn-ghost"
                        onClick={() => navigate(`/video-templates/${tmpl._id}/edit`)}
                        style={{ flex: 1, padding: '5px', borderRadius: 7, fontSize: '.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></svg>
                        Editar
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => duplicate(tmpl._id)}
                        style={{ flex: 1, padding: '5px', borderRadius: 7, fontSize: '.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        Duplicar
                      </button>
                      <button
                        className={isDel ? 'btn-danger' : 'btn-ghost'}
                        onClick={() => remove(tmpl._id)}
                        style={{ padding: '5px 10px', borderRadius: 7, fontSize: '.75rem' }}
                        title={isDel ? 'Clique novamente para confirmar' : 'Excluir'}
                      >
                        {isDel ? 'Confirmar?' : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                        )}
                      </button>
                    </div>

                    {/* Usage */}
                    {tmpl.usageCount > 0 && (
                      <div style={{ padding: '4px 14px 8px', fontSize: '.7rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                        Usado em {tmpl.usageCount} lote{tmpl.usageCount !== 1 ? 's' : ''}
                      </div>
                    )}
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

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';

export default function Legends() {
  const [legends, setLegends]   = useState([]);
  const [title, setTitle]       = useState('');
  const [category, setCategory] = useState('Geral');
  const [text, setText]         = useState('');
  const [toast, setToast]       = useState(null);
  const [editId, setEditId]     = useState(null);
  const [search, setSearch]     = useState('');

  function showToast(type, t, message) { setToast({ type, title: t, message }); setTimeout(() => setToast(null), 3500); }

  const [primeiraCarga, setPrimeiraCarga] = useState(true);

  async function load() {
    try { const res = await api.get('/legends'); setLegends(res.data); }
    finally { setPrimeiraCarga(false); }
  }

  useEffect(() => { load(); }, []);

  function startEdit(legend) {
    setEditId(legend._id);
    setTitle(legend.title);
    setCategory(legend.category || 'Geral');
    setText(legend.text);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditId(null);
    setTitle(''); setCategory('Geral'); setText('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return showToast('warning', 'Atenção', 'Preencha título e legenda.');
    if (editId) {
      await api.patch(`/legends/${editId}`, { title, category, text });
      showToast('success', 'Legenda atualizada', 'As alterações foram salvas.');
      setEditId(null);
    } else {
      await api.post('/legends', { title, category, text, isActive: true });
      showToast('success', 'Legenda salva', 'A legenda foi adicionada ao banco.');
    }
    setTitle(''); setCategory('Geral'); setText('');
    load();
  }

  async function deleteLegend(id) {
    await api.delete(`/legends/${id}`);
    showToast('success', 'Removida', 'Legenda excluída.');
    if (editId === id) cancelEdit();
    load();
  }

  const filtered = search.trim()
    ? legends.filter(l =>
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        l.text.toLowerCase().includes(search.toLowerCase()) ||
        (l.category || '').toLowerCase().includes(search.toLowerCase())
      )
    : legends;

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  );

  const pageActions = (
    <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)', background: 'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', padding: '4px 8px' }}>
      {legends.length} legendas
    </span>
  );

  const cardStyle = {
    background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)',
    border: '1px solid var(--mf-border)',
    borderRadius: 'var(--mf-r-lg)',
    backdropFilter: 'blur(12px)',
    overflow: 'hidden',
  };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageShell
        icon={pageIcon}
        title="Banco de Legendas"
        subtitle="Salve legendas prontas e use nas publicações automaticamente"
        accent="purple"
        actions={pageActions}
      >
        <div className="layout-legends">

          {/* ── Form criar / editar ── */}
          <form
            onSubmit={submit}
            style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 0, position: 'sticky', top: 16, alignSelf: 'start' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--mf-border)' }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                {editId ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-primary-300)" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Editando legenda
                  </>
                ) : 'Nova legenda'}
              </h3>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: text.length > 2000 ? 'var(--mf-danger-500)' : 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{text.length} chars</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
              {editId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--mf-r-sm)', background: 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-primary-500) 20%, transparent)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-primary-300)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  Modo edição ativo
                  <button type="button" onClick={cancelEdit} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--mf-primary-300)', cursor: 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight: 600, padding: 0 }}>Cancelar</button>
                </div>
              )}

              <div className="form-group">
                <label>Título</label>
                <input className="inp" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Curiosidade viral 01" />
              </div>
              <div className="form-group">
                <label>Categoria</label>
                <input className="inp" value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Hot, Curiosidades, Viral..." />
              </div>
              <div className="form-group">
                <label>Legenda</label>
                <textarea className="txta" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Digite sua legenda pronta..." />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {editId && (
                  <button type="button" className="btn-ghost" onClick={cancelEdit} style={{ flex: 1, padding: '8px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-sm)' }}>
                    Cancelar
                  </button>
                )}
                <button className="btn-primary" type="submit" style={{ flex: 1, padding: '8px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {editId ? 'Salvar alterações' : 'Salvar legenda'}
                </button>
              </div>
            </div>
          </form>

          {/* ── Lista ── */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--mf-border)', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)', margin: 0 }}>Legendas salvas</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'color-mix(in oklch, var(--mf-bg) 80%, transparent)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', padding: '4px 8px', flex: 1, minWidth: 160, transition: 'border-color var(--mf-fast) var(--mf-ease-out)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text-3)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--mf-text)', fontSize: 'var(--mf-t-xs)', width: '100%' }} />
                </div>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{filtered.length} total</span>
              </div>
            </div>

            <div style={{ padding: '12px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
              {primeiraCarga && !filtered.length && (
                <div style={{ gridColumn: '1 / -1' }}><EsqueletoLista itens={4} /></div>
              )}
              {filtered.map((legend, i) => (
                <motion.div
                  key={legend._id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.2 }}
                  style={{
                    background: 'color-mix(in oklch, var(--mf-bg) 70%, transparent)',
                    border: `1px solid ${editId === legend._id ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-border)'}`,
                    borderRadius: 'var(--mf-r-md)', overflow: 'hidden',
                    boxShadow: editId === legend._id ? '0 0 0 2px color-mix(in oklch, var(--mf-primary-500) 20%, transparent)' : 'none',
                  }}
                >
                  <div className="legend-card-top" style={{ padding: '8px 12px', borderBottom: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text)' }}>{legend.title}</strong>
                    <span style={{ fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)', background: 'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color: 'var(--mf-mod-publicar)', border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)', borderRadius: 'var(--mf-r-full)', padding: '2px 8px', flexShrink: 0 }}>{legend.category}</span>
                  </div>
                  <p style={{ margin: 0, padding: '8px 12px', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{legend.text}</p>
                  <div style={{ display: 'flex', gap: 6, padding: '8px 8px', borderTop: '1px solid var(--mf-border)' }}>
                    <button
                      className="btn-ghost"
                      onClick={() => startEdit(legend)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '4px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Editar
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => deleteLegend(legend._id)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-xs)' }}
                    >
                      Excluir
                    </button>
                  </div>
                </motion.div>
              ))}
              {!filtered.length && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 16px', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-body)' }}>
                  {search ? 'Nenhuma legenda encontrada.' : 'Nenhuma legenda salva ainda.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </PageShell>
    </>
  );
}

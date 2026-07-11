import { useEffect, useState } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

export default function Legends() {
  const [legends, setLegends]   = useState([]);
  const [title, setTitle]       = useState('');
  const [category, setCategory] = useState('Geral');
  const [text, setText]         = useState('');
  const [toast, setToast]       = useState(null);
  const [editId, setEditId]     = useState(null); // id sendo editado
  const [search, setSearch]     = useState('');

  function showToast(type, t, message) { setToast({ type, title: t, message }); setTimeout(() => setToast(null), 3500); }

  async function load() { const res = await api.get('/legends'); setLegends(res.data); }

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

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Conteúdo</div>
          <h1>Banco de Legendas</h1>
          <p>Salve legendas prontas e use nas publicações automaticamente.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-indigo">{legends.length} legendas</span>
        </div>
      </div>

      <div className="layout-legends">

        {/* ── Form criar / editar ── */}
        <form className="legends-form card" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 16, alignSelf: 'start' }}>
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {editId ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editando legenda
                </>
              ) : 'Nova legenda'}
            </h3>
            <span style={{ fontSize: 12, color: text.length > 2000 ? '#f87171' : '#475569' }}>{text.length} chars</span>
          </div>

          {editId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', fontSize: 12, color: '#a5b4fc' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Modo edição ativo
              <button type="button" onClick={cancelEdit} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: 0 }}>Cancelar</button>
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
              <button type="button" className="btn btn-ghost" onClick={cancelEdit} style={{ flex: 1, justifyContent: 'center' }}>
                Cancelar
              </button>
            )}
            <button className="btn btn-primary" type="submit" style={{ flex: 1, justifyContent: 'center' }}>
              {editId ? 'Salvar alterações' : 'Salvar legenda'}
            </button>
          </div>
        </form>

        {/* ── Lista ── */}
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3>Legendas salvas</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              {/* Busca */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(15,23,42,.6)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 8, padding: '5px 10px', width: 200 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." style={{ background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 12, width: '100%' }} />
              </div>
              <span style={{ fontSize: 12, color: '#475569' }}>{filtered.length} total</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10, padding: '4px 0' }}>
            {filtered.map(legend => (
              <div key={legend._id} className="legend-card" style={{ outline: editId === legend._id ? '2px solid rgba(99,102,241,.5)' : 'none', outlineOffset: 2 }}>
                <div className="legend-card-top">
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{legend.title}</strong>
                  <span className="legend-cat">{legend.category}</span>
                </div>
                <p className="legend-text">{legend.text}</p>
                <div className="legend-footer">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => startEdit(legend)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Editar
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteLegend(legend._id)}>Excluir</button>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                {search ? 'Nenhuma legenda encontrada.' : 'Nenhuma legenda salva ainda.'}
              </div>
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

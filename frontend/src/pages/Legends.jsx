import { useEffect, useState } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

export default function Legends() {
  const [legends, setLegends] = useState([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Geral');
  const [text, setText] = useState('');
  const [toast, setToast] = useState(null);

  function showToast(type, t, message) { setToast({ type, title: t, message }); setTimeout(() => setToast(null), 3500); }

  async function loadLegends() { const res = await api.get('/legends'); setLegends(res.data); }

  async function createLegend(e) {
    e.preventDefault();
    if (!title || !text) return showToast('warning', 'Atenção', 'Preencha título e legenda.');
    await api.post('/legends', { title, category, text, isActive: true });
    setTitle(''); setCategory('Geral'); setText('');
    showToast('success', 'Legenda salva', 'A legenda foi adicionada ao banco.');
    loadLegends();
  }

  async function deleteLegend(id) {
    await api.delete(`/legends/${id}`);
    showToast('success', 'Legenda removida', 'A legenda foi excluída.');
    loadLegends();
  }

  useEffect(() => { loadLegends(); }, []);

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

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14 }}>
        {/* Form */}
        <form className="card" onSubmit={createLegend} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-header">
            <h3>Nova legenda</h3>
            <span>{text.length} chars</span>
          </div>
          <div className="form-group">
            <label>Título</label>
            <input className="inp" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Curiosidade viral 01" />
          </div>
          <div className="form-group">
            <label>Categoria</label>
            <input className="inp" value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Curiosidades" />
          </div>
          <div className="form-group">
            <label>Legenda</label>
            <textarea className="txta" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Digite sua legenda pronta..." />
          </div>
          <button className="btn btn-primary" type="submit" style={{ justifyContent: 'center' }}>Salvar legenda</button>
        </form>

        {/* List */}
        <div className="card">
          <div className="card-header">
            <h3>Legendas salvas</h3>
            <span>{legends.length} total</span>
          </div>
          <div className="legends-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
            {legends.map(legend => (
              <div key={legend._id} className="legend-card">
                <div className="legend-card-top">
                  <strong>{legend.title}</strong>
                  <span className="legend-cat">{legend.category}</span>
                </div>
                <p className="legend-text">{legend.text}</p>
                <div className="legend-footer">
                  <button className="btn btn-danger btn-sm" onClick={() => deleteLegend(legend._id)}>Excluir</button>
                </div>
              </div>
            ))}
            {!legends.length && <div className="empty-state">Nenhuma legenda salva ainda.</div>}
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../services/api';

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

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Automação</div>
          <h1>Agendador</h1>
          <p>Visualize todos os posts programados e a fila de execução.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot"></span>Scheduler ativo</span>
        </div>
      </div>

      {/* Stats */}
      <div className="g3" style={{ gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Posts na fila', value: posts.length, color: '#6366f1' },
          { label: 'Agendados', value: agendados, color: '#f59e0b' },
          { label: 'Executando', value: pendentes, color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: -1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="layout-media-lib" style={{ gap: 14 }}>
        {/* Date filter */}
        <div className="card">
          <div className="card-header"><h3>Filtro por data</h3></div>
          <div className="form-group">
            <label>Data</label>
            <input className="inp" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
          </div>
          {selectedDate && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate('')} style={{ marginTop: 6 }}>Limpar filtro</button>
          )}
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{filteredPosts.length}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>Resultados</div>
            </div>
          </div>
        </div>

        {/* Queue */}
        <div className="card">
          <div className="card-header">
            <h3>Fila de publicação</h3>
            <span>{filteredPosts.length} itens</span>
          </div>

          {filteredPosts.length === 0 ? (
            <div className="empty-state">Nenhum agendamento encontrado</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredPosts.map(post => (
                <div key={post._id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                  background: 'var(--card2)', borderRadius: 10, border: '1px solid var(--border)',
                  borderLeft: '3px solid var(--indigo)',
                }}>
                  <div style={{ textAlign: 'center', flexShrink: 0, width: 52 }}>
                    {post.scheduledAt ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{new Date(post.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: 10, color: 'var(--text2)' }}>{countdown(post.scheduledAt)}</div>
                      </>
                    ) : <div style={{ fontSize: 20 }}>📤</div>}
                  </div>
                  <div style={{ width: 1, height: 40, background: 'var(--border2)', flexShrink: 0 }}></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{post.caption ? post.caption.slice(0, 50) + (post.caption.length > 50 ? '...' : '') : 'Sem legenda'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 12 }}>
                      <span>{post.postType === 'reel' ? '🎬 Reel' : '📸 Post'}</span>
                      {post.scheduledAt && <span>📅 {fmtDate(post.scheduledAt)}</span>}
                      {post.accounts?.length && <span>👤 {post.accounts.map(a => `@${a.username}`).join(', ')}</span>}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                    background: post.status === 'agendado' ? 'var(--amber-dim)' : 'var(--green-dim)',
                    color: post.status === 'agendado' ? '#fbbf24' : '#34d399',
                  }}>{post.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

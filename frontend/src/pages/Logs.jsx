import { useEffect, useState } from 'react';
import api from '../services/api';

export default function Logs() {
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('all');

  async function load() {
    const res = await api.get('/posts');
    setPosts(res.data.posts || res.data || []);
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  function statusColor(status) {
    if (status === 'concluido') return 'var(--green)';
    if (status === 'erro') return 'var(--red)';
    if (status === 'processando') return 'var(--indigo)';
    if (status === 'agendado') return 'var(--amber)';
    return 'var(--text3)';
  }
  function statusBorderColor(status) {
    if (status === 'concluido') return 'var(--green)';
    if (status === 'erro') return 'var(--red)';
    if (status === 'processando') return 'var(--indigo)';
    return 'var(--border2)';
  }

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Monitoramento</div>
          <h1>Logs do Sistema</h1>
          <p>Histórico completo de publicações e automações.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot"></span>Atualiza a cada 10s</span>
        </div>
      </div>

      {/* Filter */}
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        {['all', 'concluido', 'erro', 'processando', 'agendado', 'pendente'].map(f => (
          <button key={f} className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Todos' : f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text2)', lineHeight: '30px' }}>{filtered.length} registro(s)</span>
      </div>

      {/* Log lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(post => (
          <div key={post._id} style={{
            background: 'var(--card)', border: `1px solid var(--border)`, borderLeft: `3px solid ${statusBorderColor(post.status)}`,
            borderRadius: 10, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>{post.postType === 'reel' ? '🎬' : '🖼️'}</span>
                <div>
                  <strong style={{ fontSize: 13 }}>{post.postType === 'reel' ? 'Reel' : 'Post'}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text2)', display: 'block' }}>{new Date(post.createdAt).toLocaleString('pt-BR')}</span>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(post.status), background: `${statusColor(post.status)}18`, padding: '3px 10px', borderRadius: 999 }}>
                {post.status}
              </span>
            </div>
            <div style={{ fontFamily: "'Courier New',monospace", fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span><span style={{ color: 'var(--text3)' }}>conta:</span> {post.accounts?.map(a => a.username).join(', ') || '—'}</span>
              <span><span style={{ color: 'var(--text3)' }}>mídia:</span> {post.media || '—'}</span>
              <span><span style={{ color: 'var(--text3)' }}>legenda:</span> {post.caption ? post.caption.slice(0, 60) + (post.caption.length > 60 ? '...' : '') : 'Sem legenda'}</span>
              {post.error && <span style={{ color: '#f87171' }}><span style={{ color: 'var(--text3)' }}>erro:</span> {post.error}</span>}
            </div>
          </div>
        ))}
        {!filtered.length && <div className="empty-state">Nenhum registro encontrado.</div>}
      </div>
    </div>
  );
}

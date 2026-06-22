import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';

export default function Posts() {
  const [posts, setPosts] = useState([]);
  const [postType, setPostType] = useState('auto');
  const [accounts, setAccounts] = useState([]);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState([]);
  const [cover, setCover] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState({});
  const [scheduledAt, setScheduledAt] = useState('');
  const [intervalHours, setIntervalHours] = useState(0);
  const [intervalMinutes, setIntervalMinutes] = useState(0);
  const [intervalSeconds, setIntervalSeconds] = useState(0);
  const [toast, setToast] = useState(null);
  const [legends, setLegends] = useState([]);
  const [selectedLegend, setSelectedLegend] = useState('');
  const [location, setLocation] = useState('Brasil');
  const [retryingId, setRetryingId] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [postPage, setPostPage] = useState(1);
  const [postPagination, setPostPagination] = useState(null);

  const selectedCount = Object.values(selectedAccounts).filter(Boolean).length;
  const selectedAccountsData = useMemo(() => accounts.filter(acc => selectedAccounts[String(acc._id)]), [accounts, selectedAccounts]);
  const totalEstimated = media.length * selectedCount;

  function showToast(type, title, message) {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  }

  async function load(targetPage = postPage) {
    const [postsRes, accountsRes, legendsRes] = await Promise.all([
      api.get(`/posts?page=${targetPage}&limit=20`),
      api.get('/accounts?limit=200'),
      api.get('/legends'),
    ]);
    setPosts(postsRes.data.posts || []);
    setPostPagination(postsRes.data.pagination || null);
    setAccounts(accountsRes.data.accounts || []);
    setLegends(legendsRes.data);
  }

  function goToPostPage(p) { setPostPage(p); load(p); }
  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  async function retryPost(id) {
    try { setRetryingId(id); await api.post(`/posts/${id}/retry`); showToast('success', 'Reprocessando', 'Post adicionado à fila novamente.'); load(); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar post.'); }
    finally { setRetryingId(null); }
  }

  async function retryAllErrors() {
    try {
      setRetryingAll(true);
      const res = await api.post('/posts/retry-errors');
      const total = res.data.total || 0;
      showToast('success', 'Reprocessando', total > 0 ? `${total} posts adicionados à fila.` : 'Nenhum post com erro encontrado.');
      load();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar posts.'); }
    finally { setRetryingAll(false); }
  }

  async function useRandomLegend() {
    try { const res = await api.get('/legends/random'); setCaption(res.data.text); showToast('success', 'Legenda carregada', 'Legenda aleatória aplicada.'); }
    catch { showToast('warning', 'Sem legendas', 'Nenhuma legenda encontrada.'); }
  }

  function toggleAccount(id) {
    const accountId = String(id);
    setSelectedAccounts(prev => ({ ...prev, [accountId]: !prev[accountId] }));
  }

  function selectedAccountsList() { return Object.keys(selectedAccounts).filter(id => selectedAccounts[id]); }
  function isAccountSelected(id) { return !!selectedAccounts[String(id)]; }

  function avatarSrc(acc) {
    if (acc.avatar?.startsWith('/uploads')) return `http://localhost:3000${acc.avatar}`;
    return acc.avatar || 'https://i.pravatar.cc/100';
  }

  async function createPost(e) {
    e.preventDefault();
    if (!media.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma mídia');
    if (!selectedAccountsList().length) return showToast('warning', 'Atenção', 'Selecione uma conta');
    const form = new FormData();
    media.forEach(file => form.append('media', file));
    if (cover) form.append('cover', cover);
    form.append('caption', caption);
    if (location) form.append('location', location);
    form.append('postType', postType);
    form.append('accounts', JSON.stringify(selectedAccountsList()));
    form.append('intervalHours', intervalHours);
    form.append('intervalMinutes', intervalMinutes);
    form.append('intervalSeconds', intervalSeconds);
    if (scheduledAt) form.append('scheduledAt', new Date(scheduledAt).toISOString());
    await api.post('/posts', form);
    setCaption(''); setPostType('auto'); setMedia([]); setCover(null);
    setLocation(''); setSelectedAccounts({}); setScheduledAt('');
    setIntervalHours(0); setIntervalMinutes(0); setIntervalSeconds(0); setSelectedLegend('');
    showToast('success', scheduledAt ? 'Posts agendados!' : 'Posts enviados!', scheduledAt ? 'Publicações adicionadas ao agendamento.' : 'Publicações enviadas para a fila.');
    load();
  }

  function statusBadgeClass(status) {
    if (status === 'concluido') return 'badge-green';
    if (status === 'erro') return 'badge-red';
    if (status === 'processando') return 'badge-indigo';
    if (status === 'agendado') return 'badge-amber';
    if (status === 'parcial') return 'badge-amber';
    return 'badge-gray';
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Publicação</div>
          <h1>Painel de Automação</h1>
          <p>Postagens em andamento em tempo real</p>
        </div>
        <div className="page-header-right">
          <button className="btn btn-ghost btn-sm" type="button" onClick={retryAllErrors} disabled={retryingAll}>
            ⚡ {retryingAll ? 'Reprocessando...' : 'Reprocessar com erro'}
          </button>
        </div>
      </div>

      {/* Form grid */}
      <form onSubmit={createPost} style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, marginBottom: 20 }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Upload */}
          <div className="card">
            <div className="card-header">
              <h3>Upload de Mídia</h3>
              <span>{media.length} arquivo(s)</span>
            </div>
            <label className="upload-zone" style={{ cursor: 'pointer' }}>
              <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                onChange={e => setMedia(Array.from(e.target.files || []))} />
              <div className="uz-icon">⬆️</div>
              <strong>Arraste ou selecione seus vídeos</strong>
              <span>MP4, MOV, imagens ou múltiplos arquivos</span>
            </label>
            {media.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, marginTop: 12 }}>
                {media.map((file, i) => (
                  <div key={i} style={{ background: 'var(--card2)', borderRadius: 9, padding: '10px 8px', textAlign: 'center', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{file.type?.includes('video') ? '🎬' : '🖼️'}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cover */}
          <div className="card">
            <div className="card-header">
              <h3>Capa do Reel</h3>
              <span>Opcional</span>
            </div>
            <label className="upload-zone" style={{ padding: '16px', cursor: 'pointer' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => setCover(e.target.files?.[0] || null)} />
              <div style={{ fontSize: 20 }}>🖼️</div>
              <strong style={{ fontSize: 13 }}>{cover ? cover.name : 'Selecionar capa opcional'}</strong>
              <span>A capa será usada somente em Reels</span>
            </label>
          </div>

          {/* Caption */}
          <div className="card">
            <div className="card-header">
              <h3>Legenda</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>{caption.length}/2200</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={useRandomLegend}>🎲 Aleatória</button>
              </div>
            </div>
            <div className="form-group">
              <select className="sel" value={selectedLegend} onChange={e => {
                setSelectedLegend(e.target.value);
                const l = legends.find(l => l._id === e.target.value);
                if (l) setCaption(l.text);
              }}>
                <option value="">Selecione uma legenda...</option>
                {legends.map(l => <option key={l._id} value={l._id}>{l.title}</option>)}
              </select>
            </div>
            <textarea className="txta" placeholder="Digite a legenda da publicação..."
              value={caption} maxLength={2200} onChange={e => setCaption(e.target.value)} rows={5} />
          </div>

          {/* Location */}
          <div className="card">
            <div className="card-header">
              <h3>📍 Localização</h3>
              <span>Opcional</span>
            </div>
            <div className="form-group">
              <input
                className="inp"
                type="text"
                placeholder="Ex: São Paulo, Brasil"
                value={location}
                onChange={e => setLocation(e.target.value)}
                list="brazil-cities"
              />
              <datalist id="brazil-cities">
                <option value="São Paulo, Brasil" />
                <option value="Rio de Janeiro, Brasil" />
                <option value="Belo Horizonte, Brasil" />
                <option value="Brasília, Brasil" />
                <option value="Salvador, Brasil" />
                <option value="Fortaleza, Brasil" />
                <option value="Curitiba, Brasil" />
                <option value="Manaus, Brasil" />
                <option value="Recife, Brasil" />
                <option value="Porto Alegre, Brasil" />
                <option value="Goiânia, Brasil" />
                <option value="Florianópolis, Brasil" />
                <option value="Campinas, Brasil" />
                <option value="Natal, Brasil" />
                <option value="Maceió, Brasil" />
              </datalist>
              <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, display: 'block' }}>
                Digite o nome da cidade/local. O bot irá pesquisar e selecionar o primeiro resultado.
              </span>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Accounts */}
          <div className="card">
            <div className="card-header">
              <h3>Contas ({selectedCount}/{accounts.length})</h3>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {accounts.map(acc => (
                <button type="button" key={acc._id} onClick={() => toggleAccount(acc._id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                    borderRadius: 9, border: `1px solid ${isAccountSelected(acc._id) ? 'rgba(99,102,241,.4)' : 'var(--border)'}`,
                    background: isAccountSelected(acc._id) ? 'var(--indigo-dim)' : 'var(--card2)',
                    cursor: 'pointer', transition: '.15s', textAlign: 'left', color: 'var(--text)',
                  }}>
                  <img src={avatarSrc(acc)} alt="" style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>@{acc.username}</div>
                    <div style={{ fontSize: 10, color: 'var(--text2)' }}>{acc.healthStatus || 'ativa'}</div>
                  </div>
                  {isAccountSelected(acc._id) && <span style={{ color: '#a5b4fc', fontSize: 13, fontWeight: 700 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Type + Schedule */}
          <div className="card">
            <div className="card-header"><h3>Agendamento</h3></div>
            <div className="form-group">
              <label>Tipo de post</label>
              <select className="sel" value={postType} onChange={e => setPostType(e.target.value)}>
                <option value="auto">Automático</option>
                <option value="post">📸 Post</option>
                <option value="reel">🎬 Reel</option>
              </select>
            </div>
            <div className="form-group">
              <label>Intervalo entre posts</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                <input className="inp" type="number" min="0" value={intervalHours} onChange={e => setIntervalHours(e.target.value)} placeholder="0" />
                <input className="inp" type="number" min="0" value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} placeholder="0" />
                <input className="inp" type="number" min="0" value={intervalSeconds} onChange={e => setIntervalSeconds(e.target.value)} placeholder="0" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>Horas</span>
                <span style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>Min</span>
                <span style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>Seg</span>
              </div>
            </div>
            <div className="form-group">
              <label>Agendar para</label>
              <input className="inp" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
            </div>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
              {[['Mídias', media.length], ['Contas', selectedCount], ['Total', totalEstimated]].map(([l, v]) => (
                <div key={l} style={{ textAlign: 'center', background: 'var(--card2)', borderRadius: 8, padding: '8px 4px' }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
                  <div style={{ fontSize: 10, color: 'var(--text2)' }}>{l}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>
              🚀 {scheduledAt ? 'Agendar postagens' : 'Publicar agora'}
            </button>
          </div>
        </div>
      </form>

      {/* Posts list */}
      {posts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>Posts registrados</h3>
            <span>{postPagination?.total || posts.length} no total</span>
          </div>
          <div className="queue-list">
            {posts.map(post => (
              <div className="queue-row" key={post._id}>
                <div className="queue-icon" style={{ background: post.postType === 'reel' ? 'var(--indigo-dim)' : 'var(--cyan-dim)' }}>
                  {post.postType === 'reel' ? '🎬' : '📸'}
                </div>
                <div className="queue-info">
                  <strong>{post.postType === 'reel' ? 'Reel' : 'Post'}</strong>
                  <span>{post.accounts?.map(a => `@${a.username}`).join(', ') || 'Sem conta'}</span>
                  {post.error && <em style={{ fontSize: 11, color: '#f87171', display: 'block', marginTop: 1 }}>{post.error}</em>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className={`badge ${statusBadgeClass(post.status)}`}>{post.status}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                    {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('pt-BR') : new Date(post.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                {['erro', 'parcial', 'cancelado'].includes(post.status) && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => retryPost(post._id)} disabled={retryingId === post._id}>
                    {retryingId === post._id ? '...' : '↺ Retry'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {postPagination && postPagination.pages > 1 && (
            <div className="pagination">
              <button className="btn btn-ghost btn-sm" disabled={postPage <= 1} onClick={() => goToPostPage(postPage - 1)}>← Anterior</button>
              <span>Página {postPagination.page} de {postPagination.pages} · {postPagination.total} posts</span>
              <button className="btn btn-ghost btn-sm" disabled={postPage >= postPagination.pages} onClick={() => goToPostPage(postPage + 1)}>Próxima →</button>
            </div>
          )}
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

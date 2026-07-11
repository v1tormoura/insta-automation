import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function Posts() {
  const [posts, setPosts] = useState([]);
  const [postType, setPostType] = useState('reel');
  const [accounts, setAccounts] = useState([]);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState([]);
  const [cover, setCover] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState({});
  const [scheduledAt, setScheduledAt] = useState('');
  const [intervalMins, setIntervalMins] = useState(0);
  const [simultaneousLimit, setSimultaneousLimit] = useState(1);
  const [processMode, setProcessMode] = useState('limpeza_leve');
  const [toast, setToast] = useState(null);
  const [legends, setLegends] = useState([]);
  const [selectedLegend, setSelectedLegend] = useState('');
  const [location, setLocation] = useState('');
  const [retryingId, setRetryingId] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [postPage, setPostPage] = useState(1);
  const [postPagination, setPostPagination] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Library picker
  const [mediaSource, setMediaSource]     = useState('upload'); // 'upload' | 'library'
  const [libOpen, setLibOpen]             = useState(false);
  const [libFiles, setLibFiles]           = useState([]);
  const [libFolders, setLibFolders]       = useState(['default']);
  const [libFolder, setLibFolder]         = useState('default');
  const [libSelected, setLibSelected]     = useState({}); // { id: mediaObj }

  const selectedCount = Object.values(selectedAccounts).filter(Boolean).length;
  const totalMedia    = media.length + Object.keys(libSelected).length;
  const totalEstimated = totalMedia * selectedCount;

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
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar.'); }
    finally { setRetryingId(null); }
  }

  async function retryAllErrors() {
    try {
      setRetryingAll(true);
      const res = await api.post('/posts/retry-errors');
      const total = res.data.total || 0;
      showToast('success', 'Reprocessando', total > 0 ? `${total} posts adicionados à fila.` : 'Nenhum post com erro.');
      load();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar.'); }
    finally { setRetryingAll(false); }
  }

  async function useRandomLegend() {
    try { const res = await api.get('/legends/random'); setCaption(res.data.text); showToast('success', 'Legenda carregada', 'Legenda aleatória aplicada.'); }
    catch { showToast('warning', 'Sem legendas', 'Nenhuma legenda encontrada.'); }
  }

  function toggleAccount(id) {
    setSelectedAccounts(prev => ({ ...prev, [String(id)]: !prev[String(id)] }));
  }
  function toggleAllAccounts() {
    if (selectedCount === accounts.length) {
      setSelectedAccounts({});
    } else {
      const all = {};
      accounts.forEach(a => { all[String(a._id)] = true; });
      setSelectedAccounts(all);
    }
  }

  function selectedAccountsList() { return Object.keys(selectedAccounts).filter(id => selectedAccounts[id]); }
  function isAccountSelected(id) { return !!selectedAccounts[String(id)]; }

  function avatarSrc(acc) {
    if (acc.avatar?.startsWith('/uploads')) return `${API}${acc.avatar}`;
    return acc.avatar || null;
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'));
    if (files.length) setMedia(prev => [...prev, ...files]);
  }

  async function openLibrary() {
    try {
      const res = await api.get('/media');
      const d = res.data;
      const allFiles = d.files || d || [];
      const allFolders = d.folders || [...new Set(allFiles.map(f => f.folder || 'default'))].sort();
      setLibFiles(allFiles.filter(f => !f.filename?.startsWith('__folder_')));
      setLibFolders(['default', ...allFolders.filter(f => f !== 'default')]);
      setLibOpen(true);
    } catch { showToast('error', 'Erro', 'Não foi possível carregar a biblioteca.'); }
  }

  function toggleLib(item) {
    setLibSelected(s => {
      const n = { ...s };
      if (n[item._id]) delete n[item._id];
      else n[item._id] = item;
      return n;
    });
  }

  async function createPost(e) {
    e.preventDefault();
    const libItems = Object.values(libSelected);
    if (!media.length && !libItems.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma mídia');
    if (!selectedAccountsList().length) return showToast('warning', 'Atenção', 'Selecione uma conta');
    const form = new FormData();
    media.forEach(file => form.append('media', file));
    if (libItems.length) form.append('mediaIds', JSON.stringify(libItems.map(i => i._id)));
    if (cover) form.append('cover', cover);
    form.append('caption', caption);
    if (location) form.append('location', location);
    form.append('postType', postType);
    form.append('accounts', JSON.stringify(selectedAccountsList()));
    form.append('intervalMinutes', intervalMins);
    form.append('simultaneousLimit', simultaneousLimit);
    form.append('processMode', processMode);
    if (scheduledAt) form.append('scheduledAt', new Date(scheduledAt).toISOString());
    try {
      await api.post('/posts', form);
      setCaption(''); setMedia([]); setCover(null); setLibSelected({});
      setLocation(''); setSelectedAccounts({}); setScheduledAt('');
      setIntervalMins(0); setSelectedLegend('');
      showToast('success', scheduledAt ? 'Posts agendados!' : 'Posts enviados!', `${totalEstimated} publicações adicionadas à fila.`);
      load();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao criar posts.');
    }
  }

  function statusBadgeClass(status) {
    if (status === 'concluido') return 'badge-green';
    if (status === 'erro') return 'badge-red';
    if (status === 'processando') return 'badge-indigo';
    if (status === 'agendado') return 'badge-amber';
    if (status === 'parcial') return 'badge-amber';
    return 'badge-gray';
  }

  const processModes = [
    { id: 'sem_limpeza', label: 'Sem Limpeza', tag: 'SAFE', desc: 'Posta o vídeo original, sem alterar nada', color: '#10b981' },
    { id: 'limpeza_leve', label: 'Limpeza Leve', tag: 'RECOM', desc: 'Remove metadados e gera hash diferente', color: '#3b82f6' },
    { id: 'ultra_clean', label: 'Ultra Clean', tag: 'ULTRA', desc: 'Remove todos metadados + re-encoda o vídeo', color: '#8b5cf6' },
  ];

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
            ↻ {retryingAll ? 'Reprocessando...' : 'Reprocessar vencidos'}
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => document.getElementById('postform').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))}>
            🚀 Agendar nova postagem
          </button>
        </div>
      </div>

      {/* Form grid */}
      <form id="postform" onSubmit={createPost} className="layout-form-2col" style={{ marginBottom: 20 }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Upload */}
          <div className="card">
            <div className="card-header">
              <h3>Mídia</h3>
              <span className="badge badge-cyan">{media.length + Object.keys(libSelected).length} arquivo(s)</span>
            </div>
            <div className="card-body">
            {/* Type tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {['reel', 'post', 'story'].map(t => (
                <button key={t} type="button"
                  onClick={() => setPostType(t)}
                  style={{
                    padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                    background: postType === t ? 'rgba(37,99,235,0.18)' : 'transparent',
                    borderColor: postType === t ? 'rgba(37,99,235,0.5)' : 'var(--border)',
                    color: postType === t ? '#60a5fa' : 'var(--text2)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  {t === 'reel' ? '🎬' : t === 'post' ? '📸' : '📖'} {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Source toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[['upload','⬆️ Upload'], ['library','📁 Da Biblioteca']].map(([v,l]) => (
                <button key={v} type="button" onClick={() => setMediaSource(v)} style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                  background: mediaSource === v ? 'rgba(99,102,241,.15)' : 'transparent',
                  borderColor: mediaSource === v ? 'rgba(99,102,241,.4)' : 'var(--border)',
                  color: mediaSource === v ? '#a5b4fc' : 'var(--text2)',
                }}>{l}</button>
              ))}
            </div>

            {mediaSource === 'upload' ? (
              <>
                <label
                  className={`upload-zone${dragOver ? ' drag-over' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                    onChange={e => setMedia(Array.from(e.target.files || []))} />
                  <div style={{ fontSize: 28, marginBottom: 6 }}>⬆️</div>
                  <strong>Arraste ou envie seus vídeos</strong>
                  <span>MP4, MOV, JPG, PNG — sem limite de quantidade</span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>Selecionar arquivos</button>
                </label>
                {media.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8, marginTop: 12 }}>
                    {media.map((file, i) => (
                      <div key={i} style={{ background: 'var(--card2)', borderRadius: 9, padding: '10px 8px', textAlign: 'center', border: '1px solid var(--border)', position: 'relative' }}>
                        <button type="button" onClick={() => setMedia(m => m.filter((_, j) => j !== i))}
                          style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(239,68,68,.2)', border: 'none', color: '#f87171', borderRadius: 4, width: 18, height: 18, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        <div style={{ fontSize: 22, marginBottom: 4 }}>{file.type?.includes('video') ? '🎬' : '🖼️'}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* Library mode */
              <div>
                <button type="button" onClick={openLibrary} className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
                  📂 Abrir biblioteca {Object.keys(libSelected).length > 0 && `(${Object.keys(libSelected).length} selecionado(s))`}
                </button>
                {Object.keys(libSelected).length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(100px,1fr))', gap: 8 }}>
                    {Object.values(libSelected).map(item => (
                      <div key={item._id} style={{ background: 'var(--card2)', borderRadius: 9, border: '1px solid rgba(99,102,241,.35)', position: 'relative', overflow: 'hidden' }}>
                        <button type="button" onClick={() => toggleLib(item)}
                          style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, background: 'rgba(239,68,68,.5)', border: 'none', color: '#fff', borderRadius: 4, width: 18, height: 18, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        <div style={{ aspectRatio: '1', overflow: 'hidden' }}>
                          {item.type === 'video'
                            ? <video src={`${API}${item.url}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <img src={`${API}${item.url}`} alt={item.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </div>
                        <div style={{ padding: '4px 6px', fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.originalName}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>{/* /card-body */}
          </div>

          {/* Cover */}
          <div className="card">
            <div className="card-header"><h3>Capa do Reel</h3><span>Opcional — aplica a todos os vídeos da fila</span></div>
            <div className="card-body">
              <label style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px', background: 'var(--card2)', borderRadius: 10, border: '1px dashed var(--border)', cursor: 'pointer' }}>
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => setCover(e.target.files?.[0] || null)} />
                <div style={{ fontSize: 24 }}>🖼️</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: cover ? '#60a5fa' : 'var(--text2)' }}>{cover ? cover.name : 'Nenhuma capa salva. Faça upload de uma imagem 1080×1920.'}</div>
                  {cover && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Clique para trocar</div>}
                </div>
              </label>
            </div>
          </div>

          {/* Caption */}
          <div className="card">
            <div className="card-header">
              <h3>Legenda</h3>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => {}}>Gerenciar →</button>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{caption.length}/2200</span>
              </div>
            </div>
            <div className="card-body">
              {legends.length > 0 && (
                <select className="sel" style={{ marginBottom: 10 }} value={selectedLegend} onChange={e => {
                  setSelectedLegend(e.target.value);
                  const l = legends.find(l => l._id === e.target.value);
                  if (l) setCaption(l.text);
                }}>
                  <option value="">Selecione uma legenda salva...</option>
                  {legends.map(l => <option key={l._id} value={l._id}>{l.title}</option>)}
                </select>
              )}
              <textarea className="txta"
                placeholder="Escreva a legenda do seu post. Use #hashtags e {variáveis}."
                value={caption} maxLength={2200} onChange={e => setCaption(e.target.value)} rows={4} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={useRandomLegend}>🎲 Aleatória</button>
              </div>
              {/* Location */}
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>📍</span> Localização (opcional)
                </div>
                <input className="inp" type="text" placeholder="Belo Horizonte, Brasil" value={location} onChange={e => setLocation(e.target.value)} list="brazil-cities" />
                <datalist id="brazil-cities">
                  {['São Paulo','Rio de Janeiro','Belo Horizonte','Brasília','Salvador','Fortaleza','Curitiba','Manaus','Recife','Porto Alegre'].map(c => (
                    <option key={c} value={`${c}, Brasil`} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Simultaneous publications */}
          <div className="card">
            <div className="card-header">
              <h3>Publicações simultâneas</h3>
              <span className="badge badge-cyan">
                {simultaneousLimit === 1 ? 'Sequencial' : `Lotes de ${simultaneousLimit}`}
              </span>
            </div>
            <div className="card-body">
              <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
                Quantos reels são enviados juntos em cada lote para todas as contas
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>LOTE</span>
                <span style={{ fontSize: 22, fontWeight: 900, color: '#60a5fa', letterSpacing: -1 }}>{simultaneousLimit}</span>
                <span style={{ fontSize: 14, color: 'var(--text3)' }}>/{Math.max(totalMedia, 1)} reels</span>
              </div>
              <input type="range" min="1" max={Math.max(totalMedia, 1)} value={Math.min(simultaneousLimit, Math.max(totalMedia, 1))}
                onChange={e => setSimultaneousLimit(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                <span>1</span><span>{Math.max(totalMedia, 1)}</span>
              </div>
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(59,130,246,0.06)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.15)', fontSize: 11, color: '#93c5fd', lineHeight: 1.5 }}>
                {simultaneousLimit === 1
                  ? 'Sequencial — 1 reel por vez. Todas as contas recebem cada reel em paralelo, depois aguarda o intervalo.'
                  : `Lotes de ${simultaneousLimit} — reels 1–${simultaneousLimit} vão juntos para todas as contas em paralelo, depois aguarda o intervalo, depois reels ${simultaneousLimit + 1}–${simultaneousLimit * 2}, e assim por diante.`
                }
              </div>
            </div>
          </div>

          {/* Interval */}
          <div className="card">
            <div className="card-header">
              <h3>Intervalo entre posts</h3>
              <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 700 }}>{intervalMins} min</span>
            </div>
            <div className="card-body">
              <input type="range" min="0" max="120" step="1" value={intervalMins}
                onChange={e => setIntervalMins(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer', marginBottom: 6 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
                <span>Sem intervalo</span><span>120 min</span>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 5 }}>Início (deixe vazio = agora + 1 min)</label>
                <input className="inp" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Processing mode */}
          <div className="card">
            <div className="card-header"><h3>Modo de processamento</h3><span>Limpeza aplicada</span></div>
            <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {processModes.map(m => (
                <div key={m.id} onClick={() => setProcessMode(m.id)}
                  style={{
                    padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: '1px solid',
                    background: processMode === m.id ? `rgba(${m.id === 'sem_limpeza' ? '16,185,129' : m.id === 'limpeza_leve' ? '59,130,246' : '139,92,246'},.08)` : 'transparent',
                    borderColor: processMode === m.id ? `${m.color}44` : 'var(--border)',
                    transition: 'all .15s',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: processMode === m.id ? m.color : 'var(--text)' }}>{m.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${m.color}22`, color: m.color }}>{m.tag}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{m.desc}</div>
                </div>
              ))}
            </div>
            </div>{/* /card-body */}
          </div>

          {/* Accounts */}
          <div className="card">
            <div className="card-header">
              <h3>Contas</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAllAccounts}>
                {selectedCount === accounts.length && accounts.length > 0 ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>
            <div className="card-body">
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
              Selecione onde publicar — cada conta posta 1 vez por mídia
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {accounts.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12, padding: 20 }}>Nenhuma conta cadastrada</div>
              )}
              {accounts.map(acc => (
                <button type="button" key={acc._id} onClick={() => toggleAccount(acc._id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                    borderRadius: 9, border: `1px solid ${isAccountSelected(acc._id) ? 'rgba(59,130,246,.4)' : 'var(--border)'}`,
                    background: isAccountSelected(acc._id) ? 'rgba(59,130,246,.08)' : 'var(--card2)',
                    cursor: 'pointer', transition: '.15s', textAlign: 'left', color: 'var(--text)', width: '100%',
                  }}>
                  {avatarSrc(acc)
                    ? <img src={avatarSrc(acc)} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--indigo-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, color: '#a5b4fc' }}>{acc.username?.[0]?.toUpperCase()}</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{acc.username}</div>
                    <div style={{ fontSize: 10, color: acc.healthStatus === 'ativa' ? '#34d399' : 'var(--text3)' }}>{acc.healthStatus || 'ativa'}</div>
                  </div>
                  {isAccountSelected(acc._id) && <span style={{ color: '#60a5fa', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>✓</span>}
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="g3" style={{ gap: 6, marginTop: 12 }}>
              {[['Mídias', media.length], ['Contas', selectedCount], ['Total', totalEstimated]].map(([l, v]) => (
                <div key={l} style={{ textAlign: 'center', background: 'var(--card2)', borderRadius: 8, padding: '8px 4px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -1 }}>{v}</div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>

            <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center', padding: '12px', marginTop: 12, fontSize: 14 }}>
              🚀 {scheduledAt ? 'Agendar postagens' : 'Publicar agora'}
            </button>
            </div>{/* /card-body */}
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

      {/* ── Library picker modal ── */}
      {libOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setLibOpen(false)}>
          <div className="modal" style={{ width: 'min(760px,95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>📁 Escolher da Biblioteca</h3>
              <button onClick={() => setLibOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {/* Folder tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {libFolders.map(f => (
                <button key={f} type="button" onClick={() => setLibFolder(f)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                  background: libFolder === f ? 'rgba(99,102,241,.18)' : 'transparent',
                  borderColor: libFolder === f ? 'rgba(99,102,241,.4)' : 'var(--border2)',
                  color: libFolder === f ? '#a5b4fc' : 'var(--text2)',
                }}>📁 {f}</button>
              ))}
            </div>

            {/* Grid */}
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {(() => {
                const shown = libFiles.filter(f => (f.folder || 'default') === libFolder);
                if (!shown.length) return (
                  <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text2)' }}>
                    <div style={{ fontSize: 32 }}>📂</div>
                    <div style={{ marginTop: 8 }}>Pasta vazia</div>
                  </div>
                );
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8 }}>
                    {shown.map(item => {
                      const sel = !!libSelected[item._id];
                      return (
                        <div key={item._id} onClick={() => toggleLib(item)} style={{
                          borderRadius: 10, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                          border: `2px solid ${sel ? '#6366f1' : 'rgba(51,65,85,.4)'}`,
                          transition: 'border-color .15s',
                        }}>
                          <div style={{ aspectRatio: '1', background: '#0d1520', overflow: 'hidden' }}>
                            {item.type === 'video'
                              ? <video src={`${API}${item.url}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <img src={`${API}${item.url}`} alt={item.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          </div>
                          {sel && (
                            <div style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700 }}>✓</div>
                          )}
                          <div style={{ padding: '4px 6px', fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'rgba(15,23,42,.9)' }}>{item.originalName}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>{Object.keys(libSelected).length} arquivo(s) selecionado(s)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setLibSelected({})}>Limpar</button>
                <button type="button" className="btn btn-primary" onClick={() => setLibOpen(false)}>Confirmar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

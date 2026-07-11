import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function fmt(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function Stories() {
  const [accounts, setAccounts]       = useState([]);
  const [selected, setSelected]       = useState([]);
  const [medias, setMedias]           = useState([]);   // { file, url, name, size, type, fromLib, id }
  const [uploading, setUploading]     = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const [gridMode, setGridMode]       = useState(true);
  const [linkOn, setLinkOn]           = useState(false);
  const [linkUrl, setLinkUrl]         = useState('');
  const [interval, setIntervalMin]    = useState(3);
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState(null);
  const [toast, setToast]             = useState(null);
  const fileRef = useRef();

  function showToast(type, t, msg) { setToast({ type, title: t, message: msg }); setTimeout(() => setToast(null), 3500); }

  useEffect(() => {
    api.get('/accounts').then(r => {
      const accs = r.data.accounts || r.data || [];
      setAccounts(accs);
      setSelected(accs.filter(a => a.accessToken || a.igSession).map(a => a._id));
    }).catch(() => {});
  }, []);

  function toggleAccount(id) {
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }
  function toggleAll() {
    const eligible = accounts.filter(a => a.accessToken || a.igSession).map(a => a._id);
    setSelected(selected.length === eligible.length ? [] : eligible);
  }

  async function addFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      for (const f of list) {
        const form = new FormData();
        form.append('image', f);
        const { data } = await api.post('/api/stories/upload', form);
        setMedias(p => [...p, {
          id: data.url + Date.now(),
          url: data.url.startsWith('http') ? data.url : `${API}${data.url}`,
          name: f.name,
          size: f.size,
          type: f.type.startsWith('video') ? 'video' : 'image',
          selected: true,
        }]);
      }
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha no upload.'); }
    finally { setUploading(false); }
  }

  function toggleMedia(id) {
    setMedias(p => p.map(m => m.id === id ? { ...m, selected: !m.selected } : m));
  }
  function removeMedia(id) { setMedias(p => p.filter(m => m.id !== id)); }
  function selectAllMedia() { setMedias(p => p.map(m => ({ ...m, selected: true }))); }
  function clearSelection() { setMedias(p => p.map(m => ({ ...m, selected: false }))); }

  const selectedMedia = medias.filter(m => m.selected);
  const totalMin = Math.max(0, (selectedMedia.length - 1)) * interval;

  async function publish() {
    if (!selected.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma conta.');
    if (!selectedMedia.length) return showToast('warning', 'Atenção', 'Adicione pelo menos uma mídia.');
    setLoading(true); setResults(null);
    try {
      const { data } = await api.post('/api/stories', {
        accountIds: selected,
        imageUrl: selectedMedia[0].url,
        linkUrl: linkOn && linkUrl.trim() ? linkUrl.trim() : null,
        linkText: 'Ver mais',
        mediaUrls: selectedMedia.map(m => m.url),
        intervalMinutes: interval,
      });
      setResults(data);
      showToast('success', 'Publicado!', `${data.successCount || 0} de ${data.total || selected.length} publicados.`);
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha ao publicar.'); }
    finally { setLoading(false); }
  }

  const eligibleAccounts = accounts.filter(a => a.accessToken || a.igSession);

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Publicação</div>
          <h1>Publicar Stories em massa</h1>
          <p>Envie fotos ou vídeos e publique como Story em todas as contas conectadas.</p>
        </div>
      </div>

      {/* ── Hero card ── */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 14,
        background: 'linear-gradient(145deg,rgba(17,25,37,.98),rgba(11,17,27,.98))',
        border: '1px solid rgba(30,42,58,.8)',
        padding: 'clamp(16px,4vw,26px) clamp(16px,4vw,32px)', marginBottom: 14,
        display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap',
        boxShadow: '0 22px 56px rgba(0,0,0,.23)',
      }}>
        {/* orb */}
        <div style={{ width: 62, height: 62, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#f7faff', background: 'radial-gradient(circle at 50% 42%,#2b8fff 0 15%,#2961ff 36%,#2d2d92 63%,#15234b 100%)', boxShadow: '0 0 0 12px rgba(19,40,87,.35),0 0 0 25px rgba(18,28,65,.35)', marginTop: 4 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{ margin: '4px 0 8px', fontSize: 22, letterSpacing: '-.5px' }}>Publicar Stories em massa</h2>
          <p style={{ margin: 0, color: '#a7b1c2', fontSize: 12, lineHeight: 1.55 }}>
            Envie fotos ou vídeos e publique como Story em todas as contas conectadas — com intervalo e lembrete de link na bio.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            {[
              { icon: '👥', label: 'Contas', val: `${selected.length}/${accounts.length}` },
              { icon: '🖼', label: 'Mídias', val: `${selectedMedia.length}/${medias.length}` },
              { icon: '⏱', label: 'Duração', val: totalMin < 60 ? `${totalMin} min` : `${(totalMin/60).toFixed(1)}h` },
              { icon: '⚙️', label: 'Intervalo', val: `${interval} min` },
            ].map(s => (
              <span key={s.label} style={{ height: 30, borderRadius: 99, border: '1px solid rgba(38,49,65,.8)', background: 'rgba(7,12,20,.5)', color: '#a4afc1', padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                {s.icon} {s.label} <strong style={{ marginLeft: 4, color: '#e9effe', fontSize: 11 }}>{s.val}</strong>
              </span>
            ))}
          </div>
        </div>
        {/* wave decoration */}
        <div className="stories-hero-wave" style={{ position: 'absolute', right: -35, bottom: -27, width: 440, height: 180, opacity: .7, transform: 'rotate(-8deg)', pointerEvents: 'none' }}>
          <span style={{ position: 'absolute', display: 'block', borderRadius: '100% 0 100% 0', transform: 'rotate(35deg)', filter: 'blur(.1px)', height: 42, width: 396, right: 0, bottom: 70, background: 'linear-gradient(90deg,transparent 10%,#1b4aff 45%,#6a30e8 100%)', opacity: .93 }} />
          <span style={{ position: 'absolute', display: 'block', borderRadius: '100% 0 100% 0', transform: 'rotate(35deg)', height: 22, width: 336, right: -7, bottom: 45, background: 'linear-gradient(90deg,transparent 15%,#197bff 65%,#863ff4)', opacity: .55 }} />
          <span style={{ position: 'absolute', display: 'block', borderRadius: '100% 0 100% 0', transform: 'rotate(35deg)', height: 12, width: 245, right: 5, bottom: 23, background: 'linear-gradient(90deg,transparent,#7e4dff)', opacity: .7 }} />
        </div>
      </div>

      {/* ── Workspace ── */}
      <div className="layout-2col">

        {/* ── Coluna esquerda: Mídias ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={PANEL}>
            {/* Panel heading */}
            <div style={PANEL_HEAD}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <h3 style={PANEL_TITLE}>Mídias do story</h3>
                <span style={{ fontSize: 11, color: '#8996a9' }}>{selectedMedia.length} de {medias.length > 0 ? medias.length : 60} selecionadas</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={DARK_BTN}>
                  <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                    onChange={e => addFiles(e.target.files)} />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  {uploading ? 'Enviando...' : 'Adicionar mídias'}
                </label>
                <button onClick={() => setGridMode(true)} style={{ ...VIEW_BTN, ...(gridMode ? VIEW_BTN_ON : {}) }} title="Grade">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </button>
                <button onClick={() => setGridMode(false)} style={{ ...VIEW_BTN, ...(!gridMode ? VIEW_BTN_ON : {}) }} title="Lista">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                </button>
              </div>
            </div>

            {/* Dropzone */}
            <label
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              style={{
                margin: '0 19px', height: 112, border: `1.5px dashed ${dragOver ? '#4993ff' : '#285bff'}`,
                borderRadius: 9, background: dragOver ? 'linear-gradient(105deg,rgba(30,73,148,.45),rgba(13,21,33,.3))' : 'linear-gradient(105deg,rgba(22,51,96,.25),rgba(15,22,33,.15))',
                display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 7, cursor: 'pointer', transition: '.2s',
              }}>
              <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
              <div style={{ width: 34, height: 34, borderRadius: 12, background: 'radial-gradient(circle at 45% 35%,rgba(62,153,255,.18),rgba(53,93,255,.13))', display: 'grid', placeItems: 'center', color: '#2d84ff' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
              </div>
              <strong style={{ fontSize: 12 }}>Arraste fotos ou vídeos para enviar</strong>
              <span style={{ fontSize: 11, color: '#9ba7b8' }}>MP4, MOV, JPG, PNG <em style={{ fontStyle: 'normal', color: '#6e7b91' }}>(máx. 200MB por arquivo)</em></span>
            </label>

            {/* Grid */}
            {medias.length > 0 && (
              <div className={gridMode ? 'stories-media-grid' : ''}
                style={{
                  padding: '15px 19px 10px',
                  display: 'grid',
                  gridTemplateColumns: gridMode ? undefined : '1fr',
                  gap: 10, maxHeight: 330, overflowY: 'auto',
                }}>
                {medias.map(m => gridMode ? (
                  // Card mode
                  <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                    position: 'relative', height: 165, border: `1px solid ${m.selected ? '#2967ff' : '#263447'}`,
                    background: '#111a26', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', transition: '.18s',
                    boxShadow: m.selected ? '0 0 0 1px rgba(52,107,255,.18)' : 'none',
                  }}>
                    <div style={{ height: 138, overflow: 'hidden', background: '#152235', position: 'relative' }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 60%,rgba(0,0,0,.52))' }} />
                      {m.type === 'video'
                        ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      }
                      {/* checkbox */}
                      <div style={{ position: 'absolute', left: 8, top: 8, width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', background: m.selected ? '#2167ff' : '#172331', border: `1px solid ${m.selected ? 'rgba(255,255,255,.35)' : '#536175'}`, boxShadow: '0 3px 9px rgba(0,0,0,.2)', color: '#fff', zIndex: 1 }}>
                        {m.selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                    </div>
                    <div style={{ height: 27, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: 10, color: '#dce5f6' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{m.name}</span>
                      <button onClick={e => { e.stopPropagation(); removeMedia(m.id); }} style={{ background: 'none', border: 'none', color: '#7e8a9b', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                ) : (
                  // List mode
                  <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                    display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'center', gap: 10,
                    height: 52, border: `1px solid ${m.selected ? '#2967ff' : '#263447'}`,
                    background: '#111a26', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: '0 12px 0 0',
                  }}>
                    <div style={{ height: '100%', overflow: 'hidden', background: '#152235' }}>
                      {m.type === 'video'
                        ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      }
                    </div>
                    <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#dce5f6' }}>{m.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: '#7e8a9b' }}>{fmt(m.size)}</span>
                      <div style={{ width: 17, height: 17, borderRadius: 4, display: 'grid', placeItems: 'center', border: `1px solid ${m.selected ? '#2673ff' : '#3f4b5e'}`, background: m.selected ? '#2673ff' : 'transparent', color: '#fff' }}>
                        {m.selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div style={{ height: 54, borderTop: '1px solid rgba(37,49,66,.5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 19px', marginTop: medias.length > 0 ? 0 : 4 }}>
              <span style={{ fontSize: 11, color: '#2d83ff' }}>{selectedMedia.length} selecionadas</span>
              <div style={{ display: 'flex', gap: 20 }}>
                <button onClick={clearSelection} style={{ background: 'transparent', border: 'none', color: '#ff6377', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Limpar seleção</button>
                <button onClick={selectAllMedia} style={{ background: 'transparent', border: 'none', color: '#2790ff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Selecionar todas</button>
              </div>
            </div>
          </div>

          {/* Resultados */}
          {results && (
            <div style={PANEL}>
              <div style={PANEL_HEAD}>
                <h3 style={PANEL_TITLE}>Resultado</h3>
                <span style={{ fontSize: 11, color: '#8996a9' }}>{results.successCount} de {results.total} publicados</span>
              </div>
              <div style={{ padding: '8px 19px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(results.results || []).map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(37,49,66,.4)', fontSize: 12 }}>
                    <span style={{ fontSize: 14 }}>{r.status === 'success' ? '✅' : '❌'}</span>
                    <strong>@{r.username}</strong>
                    <span style={{ color: r.status === 'success' ? '#22c55e' : '#f87171', flex: 1 }}>
                      {r.status === 'success' ? (r.method === 'graph' ? 'Graph API' : 'API Privada') + (r.withLink ? ' + link' : '') : r.error}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Coluna direita ── */}
        <div className="stories-right-col" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>

          {/* Contas */}
          <div style={{ ...PANEL, overflow: 'visible' }}>
            <div style={{ ...PANEL_HEAD, borderRadius: '11px 11px 0 0', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <h3 style={PANEL_TITLE}>Contas</h3>
                <span style={{ fontSize: 11, color: '#9faabc', background: '#202938', borderRadius: 6, padding: '3px 8px' }}>
                  <strong style={{ color: '#fff' }}>{selected.length}</strong> selecionadas
                </span>
              </div>
              <button onClick={toggleAll} style={{ fontSize: 11, fontWeight: 600, color: '#2485ff', background: 'none', border: 'none', cursor: 'pointer' }}>
                {selected.length === eligibleAccounts.length && eligibleAccounts.length > 0 ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>

            <div className="g2" style={{ padding: '10px 12px 14px', gap: 4, maxHeight: 290, overflowY: 'auto' }}>
              {accounts.length === 0 && <span style={{ fontSize: 12, color: '#475569', gridColumn: '1/-1', padding: '8px 4px' }}>Carregando contas...</span>}
              {accounts.map(acc => {
                const eligible = !!(acc.accessToken || acc.igSession);
                const isSel = selected.includes(acc._id);
                const initials = acc.username?.slice(0, 2).toUpperCase() || 'IG';
                return (
                  <div key={acc._id} onClick={() => eligible && toggleAccount(acc._id)} style={{
                    display: 'grid', gridTemplateColumns: '32px 1fr 18px', alignItems: 'center', gap: 9,
                    minHeight: 44, padding: '0 9px', borderRadius: 9,
                    cursor: eligible ? 'pointer' : 'default',
                    opacity: eligible ? 1 : 0.4, transition: 'background .15s',
                    background: 'transparent',
                  }}
                    onMouseEnter={e => { if (eligible) e.currentTarget.style.background = '#121d2a'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* avatar — overflow:visible para o anel aparecer */}
                    <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0, overflow: 'visible' }}>
                      {acc.avatar ? (
                        <img
                          src={acc.avatar.startsWith('http') ? `${API}/image-proxy?url=${encodeURIComponent(acc.avatar)}` : `${API}${acc.avatar}`}
                          alt=""
                          style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', display: 'block', border: '1.5px solid rgba(255,255,255,.08)' }}
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'grid'; }}
                        />
                      ) : null}
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: 'linear-gradient(145deg,#1e3a5f,#0d2240)',
                        display: acc.avatar ? 'none' : 'grid',
                        placeItems: 'center', fontSize: 10, fontWeight: 800, color: '#7ab8f5',
                        border: '1.5px solid rgba(255,255,255,.06)',
                      }}>{initials}</div>
                      {/* anel Instagram */}
                      <div style={{
                        position: 'absolute', right: -2, bottom: -2, width: 11, height: 11,
                        borderRadius: '50%',
                        background: 'radial-gradient(circle at 70% 70%,#ffbb5a 0 18%,#d74883 19% 44%,#7a4fff 45% 73%,#fc5a50 74%)',
                        border: '1.5px solid #0d141f',
                        zIndex: 1,
                      }} />
                    </div>
                    {/* info */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#eaf1ff' }}>@{acc.username}</div>
                      <div style={{ fontSize: 9, color: '#8e9aac' }}>{acc.accessToken ? 'OAuth' : acc.igSession ? 'Sessão' : 'Sem credencial'}</div>
                    </div>
                    {/* checkbox */}
                    <div style={{ width: 16, height: 16, borderRadius: 4, display: 'grid', placeItems: 'center', border: `1px solid ${isSel ? '#2673ff' : '#3f4b5e'}`, background: isSel ? '#2673ff' : 'transparent', color: '#fff', justifySelf: 'end' }}>
                      {isSel && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agendamento / Intervalo */}
          <div style={PANEL}>
            <div style={{ minHeight: 56, padding: '14px 18px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ ...PANEL_TITLE, margin: 0 }}>Intervalo entre stories</h3>
                <p style={{ color: '#8e9aad', fontSize: 11, margin: '4px 0 0' }}>Aguarda este tempo entre cada publicação.</p>
              </div>
            </div>
            <div style={{ padding: '4px 18px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#a6b1c1', fontSize: 11, marginBottom: 8 }}>
                <span>Intervalo entre stories</span>
                <strong style={{ fontSize: 11, color: '#e9f1ff' }}>{interval} {interval === 1 ? 'minuto' : 'minutos'}</strong>
              </div>
              <input type="range" min={1} max={15} value={interval} onChange={e => setIntervalMin(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#2888ff', margin: '0 0 4px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#768398', fontSize: 10 }}>
                <span>1 min</span><span>15 min</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#a6b1c1', fontSize: 11, borderTop: '1px solid #253042', marginTop: 10, paddingTop: 10 }}>
                <span>Duração total estimada</span>
                <strong style={{ fontSize: 11, color: '#e9f1ff' }}>{totalMin} {totalMin === 1 ? 'minuto' : 'minutos'}</strong>
              </div>
            </div>
          </div>

          {/* Link na bio + Publicar */}
          <div style={{ ...PANEL, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ ...PANEL_TITLE, margin: 0 }}>Link para a bio (lembrete)</h3>
              {/* Toggle */}
              <button onClick={() => setLinkOn(p => !p)} style={{
                width: 31, height: 19, borderRadius: 999, padding: 2,
                background: linkOn ? '#2775ff' : '#253044', border: 'none', cursor: 'pointer',
                display: 'flex', justifyContent: linkOn ? 'flex-end' : 'flex-start', transition: '.2s',
              }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', background: linkOn ? '#fff' : '#c6d1e1', transition: '.2s', display: 'block' }} />
              </button>
            </div>

            {linkOn && (
              <div style={{ height: 35, marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', background: '#0f1722', border: '1px solid #263448', borderRadius: 7 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#76849a" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://meusite.com/oferta"
                  style={{ flex: 1, minWidth: 0, outline: 'none', border: 'none', background: 'transparent', color: '#e8effe', fontSize: 11 }} />
              </div>
            )}

            <p style={{ margin: linkOn ? '7px 0 0' : '10px 0 0', color: '#8c98aa', fontSize: 10 }}>
              {linkOn ? 'Um lembrete será exibido no final da sequência de stories.' : 'Ative para adicionar um link de redirecionamento.'}
            </p>

            <button onClick={publish} disabled={loading || !selected.length || !selectedMedia.length} style={{
              marginTop: 16, width: '100%', height: 48, borderRadius: 7, border: 'none', cursor: loading || !selected.length || !selectedMedia.length ? 'not-allowed' : 'pointer',
              background: loading || !selected.length || !selectedMedia.length ? 'rgba(26,87,255,.35)' : 'linear-gradient(100deg,#1277ff,#2c46f6)',
              color: '#fff', fontSize: 13, fontWeight: 750, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 11px 26px rgba(26,87,255,.22)', transition: 'opacity .2s',
              opacity: loading || !selected.length || !selectedMedia.length ? 0.65 : 1,
            }}>
              {loading ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                  Publicando...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Publicar agora
                </>
              )}
            </button>
            <p style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '8px 0 0', color: '#718096', fontSize: 10 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              As publicações serão distribuídas conforme o intervalo definido.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .stories-media-grid { grid-template-columns: repeat(5, minmax(0,1fr)); }
        @media (max-width: 1024px) { .stories-media-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } }
        @media (max-width: 768px)  { .stories-media-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } .stories-hero-wave { display: none !important; } }
        @media (max-width: 480px)  { .stories-media-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
      `}</style>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

const PANEL = {
  border: '1px solid rgba(30,42,58,.8)',
  background: 'linear-gradient(145deg,rgba(17,25,37,.98),rgba(11,17,27,.98))',
  borderRadius: 11,
  overflow: 'hidden',
  boxShadow: '0 22px 56px rgba(0,0,0,.23)',
};
const PANEL_HEAD = {
  minHeight: 56, display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', padding: '0 18px',
  borderBottom: '1px solid rgba(37,49,66,.47)',
};
const PANEL_TITLE = { margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '-.2px' };
const DARK_BTN = {
  height: 31, borderRadius: 7, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
  background: '#1b2431', border: '1px solid #2a3647', color: '#eff4ff', fontSize: 11, fontWeight: 650, cursor: 'pointer',
};
const VIEW_BTN = {
  width: 31, height: 31, borderRadius: 7, display: 'grid', placeItems: 'center',
  color: '#8793a7', background: '#111925', border: '1px solid #273446', cursor: 'pointer',
};
const VIEW_BTN_ON = { background: '#1b2535', color: '#eef4ff' };

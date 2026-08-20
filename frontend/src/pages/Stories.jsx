import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import AccountPicker from '../components/AccountPicker';
import useServerEvents from '../services/useServerEvents';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const DRAFT_KEY = 'stories_form_draft_v1';

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
  const [linkLabel, setLinkLabel]     = useState('');
  /* Posição do link sticker em coordenadas normalizadas (0..1) do story, onde
     x/y é o CENTRO do sticker. Padrão 0.5/0.8 = rodapé, como o app faz. */
  const [linkPos, setLinkPos]         = useState({ x: 0.5, y: 0.8 });
  const [interval, setIntervalMin]    = useState(3);
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState(null);
  const [bgStatus, setBgStatus]       = useState(null);
  const [toast, setToast]             = useState(null);
  const fileRef = useRef();

  function showToast(type, t, msg) { setToast({ type, title: t, message: msg }); setTimeout(() => setToast(null), 3500); }

  /* Converte o clique no preview 9:16 em coordenadas normalizadas do story.
     É o mesmo sistema que o Instagram usa: 0,0 é o canto superior esquerdo. */
  function posicionarSticker(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top)  / r.height));
    setLinkPos({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
  }

  const PRESETS_STICKER = [
    { rotulo: 'Topo',   x: 0.5, y: 0.15 },
    { rotulo: 'Centro', x: 0.5, y: 0.5  },
    { rotulo: 'Rodapé', x: 0.5, y: 0.8  },
  ];

  /* ── Recupera rascunho salvo ao abrir ou voltar para a página ────────────── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.linkUrl !== undefined) setLinkUrl(d.linkUrl);
        if (d.linkLabel !== undefined) setLinkLabel(d.linkLabel);
        if (d.linkOn !== undefined) setLinkOn(d.linkOn);
        if (d.linkPos) setLinkPos(d.linkPos);
        if (d.interval !== undefined) setIntervalMin(d.interval);
        if (Array.isArray(d.medias) && d.medias.length) setMedias(d.medias);
        if (Array.isArray(d.selected) && d.selected.length) setSelected(d.selected);
      }
    } catch {}

    // Verifica status de envio em segundo plano
    api.get('/api/stories/status').then(r => {
      if (r.data?.running) setBgStatus(r.data);
    }).catch(() => {});
  }, []);

  /* ── Salva rascunho automaticamente a cada alteração ───────────────────── */
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        linkUrl, linkLabel, linkOn, linkPos, interval, medias, selected
      }));
    } catch {}
  }, [linkUrl, linkLabel, linkOn, linkPos, interval, medias, selected]);

  useEffect(() => {
    api.get('/accounts').then(r => {
      const accs = r.data.accounts || r.data || [];
      setAccounts(accs);
      if (!selected.length) {
        setSelected(
          accs
            .filter(a => a.hasApiToken || a.hasInstagrapiSession || a.hasIgSession || a.healthStatus === 'ativa' || a.accessToken || a.igSession)
            .map(a => a._id)
        );
      }
    }).catch(() => {});
  }, []);

  // Escuta eventos SSE em tempo real de stories
  useServerEvents(['stories', 'posts'], (ev) => {
    if (ev?.action === 'progress') {
      setBgStatus(prev => ({ ...(prev || {}), running: true, completed: ev.completed, total: ev.total, lastUser: ev.username }));
    } else if (ev?.action === 'completed') {
      setBgStatus(null);
      showToast('success', 'Stories Concluídos!', 'Todos os stories agendados foram publicados.');
    }
  });

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
        linkText: linkOn && linkLabel.trim() ? linkLabel.trim() : null,
        ...(linkOn ? { linkX: linkPos.x, linkY: linkPos.y } : {}),
        mediaUrls: selectedMedia.map(m => m.url),
        intervalMinutes: interval,
      });
      setResults(data);
      if (data.inBackground) {
        setBgStatus({ running: true, total: selected.length, completed: 0 });
        showToast('success', 'Publicação iniciada!', data.message || 'Stories em execução em segundo plano.');
      } else {
        showToast('success', 'Publicado!', `${data.successCount || 0} de ${data.total || selected.length} publicados.`);
      }
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha ao publicar.'); }
    finally { setLoading(false); }
  }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );

  const pageActions = (
    <button
      onClick={publish}
      disabled={loading || !selected.length || !selectedMedia.length}
      className="btn-primary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, fontSize: '.83rem', fontWeight: 700, opacity: (loading || !selected.length || !selectedMedia.length) ? 0.5 : 1 }}
    >
      {loading ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          Iniciando...
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Publicar agora
        </>
      )}
    </button>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageShell
        icon={pageIcon}
        title="Stories em Massa"
        subtitle="Publique fotos e vídeos em todas as contas conectadas"
        accent="purple"
        actions={pageActions}
      >
        {/* Banner de status em segundo plano */}
        {bgStatus?.running && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderRadius: 10, background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.3)', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cyan)' }}>
                Publicação de stories em segundo plano ativa ({bgStatus.completed || 0}/{bgStatus.total || selected.length})
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>Você pode navegar livremente</span>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          {[
            { label: 'Contas', val: `${selected.length}/${accounts.length}`, color: 'var(--cyan)' },
            { label: 'Mídias', val: `${selectedMedia.length}/${medias.length}`, color: '#a78bfa' },
            { label: 'Duração', val: totalMin < 60 ? `${totalMin} min` : `${(totalMin/60).toFixed(1)}h`, color: '#fb923c' },
            { label: 'Intervalo', val: `${interval} min`, color: '#34d399' },
          ].map(s => (
            <div key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 8, background: 'oklch(0.10 0.03 235 / 0.6)', border: '1px solid oklch(1 0 0 / 0.07)', fontSize: 11 }}>
              <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{s.label}</span>
              <strong style={{ color: s.color, fontFamily: 'var(--font-mono)' }}>{s.val}</strong>
            </div>
          ))}
        </div>

        {/* Workspace */}
        <div className="layout-2col">

          {/* ── Left: Mídias ── */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div style={PANEL}>
              {/* Panel heading */}
              <div style={PANEL_HEAD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <h3 style={PANEL_TITLE}>Mídias do story</h3>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{selectedMedia.length} de {medias.length > 0 ? medias.length : 60} selecionadas</span>
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
                  margin: '0 19px', height: 112,
                  border: `1.5px dashed ${dragOver ? 'var(--cyan)' : 'oklch(0.82 0.19 196 / 0.3)'}`,
                  borderRadius: 9,
                  background: dragOver ? 'oklch(0.82 0.19 196 / 0.06)' : 'oklch(0.82 0.19 196 / 0.02)',
                  display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 7, cursor: 'pointer', transition: '.2s',
                }}>
                <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                <div style={{ width: 34, height: 34, borderRadius: 12, background: 'oklch(0.82 0.19 196 / 0.08)', display: 'grid', placeItems: 'center', color: 'var(--cyan)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                </div>
                <strong style={{ fontSize: 12, color: 'var(--text2)' }}>Arraste fotos ou vídeos para enviar</strong>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>MP4, MOV, JPG, PNG <em style={{ fontStyle: 'normal', color: 'oklch(1 0 0 / 0.2)' }}>(máx. 200MB por arquivo)</em></span>
              </label>

              {/* Grid */}
              {medias.length > 0 && (
                <div className={gridMode ? 'stories-media-grid' : ''}
                  style={{
                    padding: '15px 19px 10px',
                    display: 'grid',
                    gridTemplateColumns: gridMode ? undefined : '1fr',
                    gap: 10, maxHeight: 330, overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                  }}>
                  {medias.map(m => gridMode ? (
                    <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                      position: 'relative', height: 165,
                      border: `1px solid ${m.selected ? 'var(--cyan)' : 'oklch(1 0 0 / 0.08)'}`,
                      background: 'oklch(0.12 0.04 235)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', transition: '.18s',
                      boxShadow: m.selected ? '0 0 0 2px oklch(0.82 0.19 196 / 0.2)' : 'none',
                    }}>
                      <div style={{ height: 138, overflow: 'hidden', background: 'oklch(0.10 0.03 235)', position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 60%,oklch(0 0 0 / 0.52))' }} />
                        {m.type === 'video'
                          ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        }
                        <div style={{ position: 'absolute', left: 8, top: 8, width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', background: m.selected ? 'var(--cyan)' : 'oklch(0.15 0.04 235)', border: `1px solid ${m.selected ? 'oklch(1 0 0 / 0.35)' : 'oklch(1 0 0 / 0.15)'}`, boxShadow: '0 3px 9px oklch(0 0 0 / 0.3)', color: '#040e1c', zIndex: 1 }}>
                          {m.selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                      <div style={{ height: 27, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: 10, color: 'var(--text2)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', fontFamily: 'var(--font-mono)' }}>{m.name}</span>
                        <button onClick={e => { e.stopPropagation(); removeMedia(m.id); }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                      display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'center', gap: 10,
                      height: 52, border: `1px solid ${m.selected ? 'var(--cyan)' : 'oklch(1 0 0 / 0.08)'}`,
                      background: 'oklch(0.12 0.04 235)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: '0 12px 0 0',
                    }}>
                      <div style={{ height: '100%', overflow: 'hidden', background: 'oklch(0.10 0.03 235)' }}>
                        {m.type === 'video'
                          ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        }
                      </div>
                      <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{m.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{fmt(m.size)}</span>
                        <div style={{ width: 17, height: 17, borderRadius: 4, display: 'grid', placeItems: 'center', border: `1px solid ${m.selected ? 'var(--cyan)' : 'oklch(1 0 0 / 0.15)'}`, background: m.selected ? 'var(--cyan)' : 'transparent', color: '#040e1c' }}>
                          {m.selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div style={{ minHeight: 54, borderTop: '1px solid oklch(1 0 0 / 0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 19px', flexWrap: 'wrap', gap: 8, marginTop: medias.length > 0 ? 0 : 4 }}>
                <span style={{ fontSize: 11, color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>{selectedMedia.length} selecionadas</span>
                <div style={{ display: 'flex', gap: 20 }}>
                  <button onClick={clearSelection} style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Limpar seleção</button>
                  <button onClick={selectAllMedia} style={{ background: 'transparent', border: 'none', color: 'var(--cyan)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Selecionar todas</button>
                </div>
              </div>
            </div>

            {/* Resultados */}
            {results && (
              <div style={PANEL}>
                <div style={PANEL_HEAD}>
                  <h3 style={PANEL_TITLE}>Resultado</h3>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{results.successCount} de {results.total} publicados</span>
                </div>
                <div style={{ padding: '8px 19px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(results.results || []).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid oklch(1 0 0 / 0.06)', fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.status === 'success' ? '#22c55e' : '#f87171', flexShrink: 0, display: 'inline-block' }} />
                      <strong>@{r.username}</strong>
                      <span style={{ color: r.status === 'success' ? '#22c55e' : '#f87171', flex: 1 }}>
                        {r.status === 'success' ? (r.method === 'graph' ? 'Graph API' : 'API Privada') + (r.withLink ? ' + link' : '') : r.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          {/* ── Right column ── */}
          <motion.div
            className="stories-right-col"
            style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.06 }}
          >

            {/* Contas */}
            <div style={PANEL}>
              <div style={{ ...PANEL_HEAD, borderRadius: '11px 11px 0 0' }}>
                <h3 style={PANEL_TITLE}>Contas</h3>
              </div>
              <div style={{ padding: '10px 14px 14px' }}>
                <AccountPicker
                  accounts={accounts}
                  selected={selected}
                  onChange={setSelected}
                />
              </div>
            </div>

            {/* Intervalo */}
            <div style={PANEL}>
              <div style={{ minHeight: 56, padding: '14px 18px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ ...PANEL_TITLE, margin: 0 }}>Intervalo entre stories</h3>
                  <p style={{ color: 'var(--text3)', fontSize: 11, margin: '4px 0 0' }}>Aguarda este tempo entre cada publicação.</p>
                </div>
              </div>
              <div style={{ padding: '4px 18px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text3)', fontSize: 11, marginBottom: 8 }}>
                  <span>Intervalo entre stories</span>
                  <strong style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{interval} {interval === 1 ? 'minuto' : 'minutos'}</strong>
                </div>
                <input type="range" min={1} max={15} value={interval} onChange={e => setIntervalMin(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--cyan)', margin: '0 0 4px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                  <span>1 min</span><span>15 min</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text3)', fontSize: 11, borderTop: '1px solid oklch(1 0 0 / 0.07)', marginTop: 10, paddingTop: 10 }}>
                  <span>Duração total estimada</span>
                  <strong style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{totalMin} {totalMin === 1 ? 'minuto' : 'minutos'}</strong>
                </div>
              </div>
            </div>

            {/* Link sticker + Publicar */}
            <div style={{ ...PANEL, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ ...PANEL_TITLE, margin: 0 }}>Link sticker no story</h3>
                  <p style={{ margin: '3px 0 0', fontSize: 10, color: 'var(--text3)' }}>Figurinha clicável — contas API Mobile e OAuth</p>
                </div>
                <button onClick={() => setLinkOn(p => !p)} style={{
                  width: 31, height: 19, borderRadius: 999, padding: 2,
                  background: linkOn ? 'var(--cyan)' : 'oklch(0.12 0.04 235)', border: '1px solid oklch(1 0 0 / 0.1)', cursor: 'pointer',
                  display: 'flex', justifyContent: linkOn ? 'flex-end' : 'flex-start', transition: '.2s', flexShrink: 0,
                }}>
                  <span style={{ width: 13, height: 13, borderRadius: '50%', background: linkOn ? '#040e1c' : 'var(--text3)', transition: '.2s', display: 'block' }} />
                </button>
              </div>

              {linkOn && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  <div style={{ height: 35, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', background: 'oklch(0.10 0.03 235)', border: '1px solid oklch(0.82 0.19 196 / 0.25)', borderRadius: 7 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                    <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://meusite.com/oferta"
                      style={{ flex: 1, minWidth: 0, outline: 'none', border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 11 }} />
                  </div>
                  <div style={{ height: 35, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', background: 'oklch(0.10 0.03 235)', border: '1px solid oklch(1 0 0 / 0.08)', borderRadius: 7 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <input type="text" value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Texto do sticker (ex: Ver oferta, Clique aqui)"
                      maxLength={35}
                      style={{ flex: 1, minWidth: 0, outline: 'none', border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 11 }} />
                    <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{linkLabel.length}/35</span>
                  </div>

                  {/* ── Posicionador do sticker ──────────────────────────────
                      Clique no preview define onde a figurinha fica. As
                      coordenadas são normalizadas (0..1) e x/y é o centro do
                      sticker — mesmo sistema que o Instagram usa. */}
                  <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                    <div
                      onClick={posicionarSticker}
                      title="Clique para posicionar a figurinha"
                      style={{
                        position: 'relative', width: 186, flexShrink: 0, aspectRatio: '9 / 16',
                        borderRadius: 10, overflow: 'hidden', cursor: 'crosshair',
                        border: '1px solid oklch(1 0 0 / 0.14)',
                        background: 'linear-gradient(160deg, oklch(0.20 0.05 260), oklch(0.12 0.04 235))',
                      }}
                    >
                      {/* A mídia entra como <img> com object-fit: cover — mesmo
                          enquadramento que o Instagram aplica no story 9:16. */}
                      {selectedMedia[0]?.url && (
                        /\.(mp4|mov|webm|m4v)(\?|$)/i.test(selectedMedia[0].url)
                          ? <video src={selectedMedia[0].url} muted playsInline
                              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
                          : <img src={selectedMedia[0].url} alt=""
                              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
                      )}

                      {!selectedMedia.length && (
                        <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center',
                          fontSize:10, color:'var(--text3)', textAlign:'center', padding:'0 14px', lineHeight:1.5 }}>
                          Selecione uma mídia para ver o enquadramento real
                        </div>
                      )}

                      {/* grade de terços — ajuda a mirar */}
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                        background:
                          'linear-gradient(to bottom, transparent 33.3%, oklch(1 0 0 / .12) 33.3%, oklch(1 0 0 / .12) 33.5%, transparent 33.5%,' +
                          ' transparent 66.6%, oklch(1 0 0 / .12) 66.6%, oklch(1 0 0 / .12) 66.8%, transparent 66.8%)' }} />

                      {/* Sticker no tamanho REAL */}
                      <div style={{
                        position: 'absolute',
                        left: `${linkPos.x * 100}%`, top: `${linkPos.y * 100}%`,
                        width: '56%', height: '20%',
                        transform: 'translate(-50%, -50%)',
                        display: 'grid', placeItems: 'center', pointerEvents: 'none',
                        border: '1px dashed oklch(1 0 0 / 0.35)', borderRadius: 8,
                      }}>
                        <span style={{
                          maxWidth: '96%', padding: '4px 10px', borderRadius: 999,
                          background: '#FFFFFF', color: '#111827',
                          fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          boxShadow: '0 3px 12px rgba(0,0,0,.35)',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                          <span style={{ color: '#2563eb' }}>🔗</span> {linkLabel ? linkLabel : 'Acessar link ›'}
                        </span>
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>Posição da figurinha</div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {PRESETS_STICKER.map(p => {
                          const ativo = Math.abs(linkPos.x - p.x) < 0.02 && Math.abs(linkPos.y - p.y) < 0.02;
                          return (
                            <button key={p.rotulo} onClick={() => setLinkPos({ x: p.x, y: p.y })} style={{
                              padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                              background: ativo ? 'rgba(0,212,255,.14)' : 'oklch(1 0 0 / 0.04)',
                              color:      ativo ? 'var(--cyan)'        : 'var(--text3)',
                              border:     ativo ? '1px solid rgba(0,212,255,.35)' : '1px solid oklch(1 0 0 / 0.08)',
                            }}>{p.rotulo}</button>
                          );
                        })}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
                        x {linkPos.x.toFixed(2)} · y {linkPos.y.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
                        Clique no preview para posicionar. A figurinha visual oficial do Instagram será renderizada e aplicada na posição exata de toque.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <p style={{ margin: linkOn ? '7px 0 0' : '14px 0 0', color: 'var(--text3)', fontSize: 10 }}>
                {linkOn ? 'A figurinha de link será adicionada automaticamente a cada story publicado.' : 'Ative para adicionar uma figurinha de link clicável em cada story.'}
              </p>

              <button onClick={publish} disabled={loading || !selected.length || !selectedMedia.length} style={{
                marginTop: 16, width: '100%', height: 48, borderRadius: 9, border: 'none',
                cursor: loading || !selected.length || !selectedMedia.length ? 'not-allowed' : 'pointer',
                background: loading || !selected.length || !selectedMedia.length
                  ? 'oklch(0.82 0.19 196 / 0.15)'
                  : 'linear-gradient(135deg, oklch(0.74 0.20 196), oklch(0.82 0.19 196))',
                color: loading || !selected.length || !selectedMedia.length ? 'oklch(0.82 0.19 196 / 0.5)' : '#040e1c',
                fontSize: 13, fontWeight: 750, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: loading || !selected.length || !selectedMedia.length ? 'none' : '0 8px 22px oklch(0.82 0.19 196 / 0.25)',
                transition: 'all .2s',
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
              <p style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '8px 0 0', color: 'var(--text3)', fontSize: 10 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                As publicações serão distribuídas conforme o intervalo definido.
              </p>
            </div>
          </motion.div>
        </div>

        <style>{`
          .stories-media-grid { grid-template-columns: repeat(5, minmax(0,1fr)); }
          @media (max-width: 1024px) { .stories-media-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } }
          @media (max-width: 768px)  { .stories-media-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } }
          @media (max-width: 480px)  { .stories-media-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </PageShell>
    </>
  );
}

const PANEL = {
  border: '1px solid oklch(1 0 0 / 0.07)',
  background: 'oklch(0.16 0.05 235 / 0.85)',
  borderRadius: 12,
  overflow: 'hidden',
  backdropFilter: 'blur(12px)',
};
const PANEL_HEAD = {
  minHeight: 52, display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', padding: '0 18px',
  borderBottom: '1px solid oklch(1 0 0 / 0.07)',
};
const PANEL_TITLE = { margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '-.2px', color: 'var(--text)' };
const DARK_BTN = {
  height: 30, borderRadius: 7, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
  background: 'oklch(0.12 0.04 235)', border: '1px solid oklch(1 0 0 / 0.09)', color: 'var(--text2)', fontSize: 11, fontWeight: 650, cursor: 'pointer',
};
const VIEW_BTN = {
  width: 30, height: 30, borderRadius: 7, display: 'grid', placeItems: 'center',
  color: 'var(--text3)', background: 'oklch(0.12 0.04 235)', border: '1px solid oklch(1 0 0 / 0.09)', cursor: 'pointer',
};
const VIEW_BTN_ON = { background: 'oklch(0.18 0.05 235)', color: 'var(--text)' };

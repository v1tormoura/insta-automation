import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function fmt(v) {
  const n = Number(v || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default function MediaLibrary() {
  const [files, setFiles]         = useState([]);
  const [folders, setFolders]     = useState(['default']);
  const [activeFolder, setActive] = useState('default');
  const [toast, setToast]         = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver]   = useState(false);

  // create folder modal
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [savingFolder, setSavingFolder]   = useState(false);

  // move modal
  const [moveItem, setMoveItem]     = useState(null);
  const [moveTarget, setMoveTarget] = useState('');

  // preview
  const [preview, setPreview] = useState(null);

  // confirm delete modal
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'file'|'folder', id?, name?, item? }

  const fileInputRef = useRef();

  function toast_(type, title, msg) { setToast({ type, title, message: msg }); setTimeout(() => setToast(null), 3500); }

  async function load() {
    try {
      const res = await api.get('/media');
      const data = res.data;
      const allFiles = data.files || data || [];
      const allFolders = data.folders || [...new Set(allFiles.map(f => f.folder || 'default'))].sort();
      setFiles(allFiles);
      const merged = [...new Set(['default', ...allFolders])];
      setFolders(merged);
    } catch { toast_('error', 'Erro', 'Erro ao carregar biblioteca.'); }
  }

  useEffect(() => { load(); }, []);

  async function upload(rawFiles) {
    if (!rawFiles.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(rawFiles).forEach(f => form.append('media', f));
      form.append('folder', activeFolder);
      await api.post('/media/upload', form);
      await load();
      toast_('success', 'Upload concluído', `${rawFiles.length} arquivo(s) adicionado(s) à pasta "${activeFolder}".`);
    } catch { toast_('error', 'Erro', 'Falha no upload.'); }
    finally { setUploading(false); }
  }

  async function deleteFile(id) {
    const item = files.find(f => f._id === id);
    setConfirmModal({ type: 'file', id, name: item?.originalName || 'esta mídia' });
  }

  async function doDeleteFile(id) {
    try { await api.delete(`/media/${id}`); await load(); toast_('success', 'Removida', 'Mídia excluída.'); }
    catch { toast_('error', 'Erro', 'Falha ao excluir.'); }
    setConfirmModal(null);
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setSavingFolder(true);
    try {
      await api.post('/media/folder', { name });
      await load();
      setActive(name.toLowerCase().replace(/[^a-z0-9_\-\s]/g, '').trim());
      setNewFolderOpen(false);
      setNewFolderName('');
      toast_('success', 'Pasta criada', `"${name}" adicionada.`);
    } catch (e) { toast_('error', 'Erro', e.response?.data?.error || 'Falha ao criar pasta.'); }
    finally { setSavingFolder(false); }
  }

  async function moveFile() {
    if (!moveItem || !moveTarget) return;
    try {
      await api.patch(`/media/${moveItem._id}/folder`, { folder: moveTarget });
      await load();
      setMoveItem(null);
      toast_('success', 'Movida', `Mídia movida para "${moveTarget}".`);
    } catch { toast_('error', 'Erro', 'Falha ao mover.'); }
  }

  async function deleteFolder(name) {
    if (name === 'default') return;
    setConfirmModal({ type: 'folder', name });
  }

  async function doDeleteFolder(name) {
    try {
      await api.delete(`/media/folder/${name}`);
      await load();
      setActive('default');
      toast_('success', 'Pasta excluída', `Mídias movidas para "default".`);
    } catch { toast_('error', 'Erro', 'Falha ao excluir pasta.'); }
    setConfirmModal(null);
  }

  const shown = files.filter(f => !f.filename?.startsWith('__folder_') && (f.folder || 'default') === activeFolder);
  const folderCounts = {};
  files.filter(f => !f.filename?.startsWith('__folder_')).forEach(f => {
    const k = f.folder || 'default';
    folderCounts[k] = (folderCounts[k] || 0) + 1;
  });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Arquivos</div>
          <h1>Biblioteca de Mídias</h1>
          <p>Organize seus vídeos e imagens em pastas para reutilizar nas postagens.</p>
        </div>
        <div className="page-header-right">
          <button className="btn btn-ghost btn-sm" onClick={() => setNewFolderOpen(true)}>📁 Nova pasta</button>
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
              onChange={e => upload(Array.from(e.target.files || []))} />
            {uploading ? '⏳ Enviando...' : '⬆️ Upload'}
          </label>
        </div>
      </div>

      {/* Layout */}
      <div className="layout-media-lib">

        {/* ── Sidebar de pastas ── */}
        <div style={{ background: 'rgba(15,23,42,.8)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 14, overflow: 'hidden', position: 'sticky', top: 20 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(51,65,85,.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: .6 }}>Pastas</span>
            <button onClick={() => setNewFolderOpen(true)} title="Nova pasta"
              style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: '#818cf8', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
          </div>

          <div style={{ padding: '8px 8px' }}>
            {folders.map(f => (
              <div key={f}
                onClick={() => setActive(f)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
                  background: activeFolder === f ? 'rgba(99,102,241,.15)' : 'transparent',
                  border: activeFolder === f ? '1px solid rgba(99,102,241,.25)' : '1px solid transparent',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { if (activeFolder !== f) e.currentTarget.style.background = 'rgba(255,255,255,.04)'; }}
                onMouseLeave={e => { if (activeFolder !== f) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 14 }}>📁</span>
                  <span style={{ fontSize: 13, fontWeight: activeFolder === f ? 600 : 400, color: activeFolder === f ? '#a5b4fc' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#475569', background: 'rgba(51,65,85,.4)', borderRadius: 10, padding: '1px 7px' }}>{folderCounts[f] || 0}</span>
                  {f !== 'default' && (
                    <button onClick={e => { e.stopPropagation(); deleteFolder(f); }}
                      title="Excluir pasta"
                      style={{ width: 18, height: 18, borderRadius: 4, background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .6 }}>✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ borderTop: '1px solid rgba(51,65,85,.4)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { l: 'Total', v: files.filter(f => !f.filename?.startsWith('__folder_')).length, c: '#6366f1' },
              { l: 'Vídeos', v: files.filter(f => f.type === 'video').length, c: '#8b5cf6' },
              { l: 'Imagens', v: files.filter(f => f.type === 'image').length, c: '#10b981' },
            ].map(s => (
              <div key={s.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#475569' }}>{s.l}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: s.c }}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main area ── */}
        <div>
          {/* Folder header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>📁</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{activeFolder}</div>
                <div style={{ fontSize: 12, color: '#475569' }}>{shown.length} arquivo(s)</div>
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <label
            className={`upload-zone${dragOver ? ' drag-over' : ''}`}
            style={{ marginBottom: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); upload(Array.from(e.dataTransfer.files)); }}
          >
            <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
              onChange={e => upload(Array.from(e.target.files || []))} />
            <div style={{ fontSize: 24, marginBottom: 6 }}>⬆️</div>
            <strong>{uploading ? 'Enviando...' : `Arraste para "${activeFolder}" ou clique`}</strong>
            <span style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>MP4, MOV, JPG, PNG · Múltiplos arquivos</span>
          </label>

          {/* Grid */}
          {shown.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
              {shown.map(item => (
                <div key={item._id} style={{ background: 'rgba(15,23,42,.8)', border: '1px solid rgba(51,65,85,.4)', borderRadius: 12, overflow: 'hidden', transition: 'border-color .15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,.4)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(51,65,85,.4)'}
                >
                  {/* thumb */}
                  <div onClick={() => setPreview(item)} style={{ width: '100%', aspectRatio: '1', background: '#0d1520', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
                    {item.type === 'video' ? (
                      <video src={`${API}${item.url}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : item.type === 'image' ? (
                      <img src={`${API}${item.url}`} alt={item.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📄</div>
                    )}
                    <span style={{
                      position: 'absolute', top: 6, left: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px',
                      borderRadius: 5, background: item.type === 'video' ? 'rgba(139,92,246,.85)' : 'rgba(16,185,129,.85)',
                      color: '#fff', letterSpacing: .4,
                    }}>{item.type === 'video' ? 'VID' : 'IMG'}</span>
                  </div>

                  {/* info */}
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.originalName}>{item.originalName}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{fmt(item.size)}</div>
                  </div>

                  {/* actions */}
                  <div style={{ display: 'flex', gap: 6, padding: '0 10px 10px' }}>
                    <button onClick={() => { setMoveItem(item); setMoveTarget(folders.find(f => f !== (item.folder || 'default')) || 'default'); }}
                      style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 7, border: '1px solid rgba(51,65,85,.5)', background: 'rgba(30,41,59,.6)', color: '#94a3b8', cursor: 'pointer' }}>
                      Mover
                    </button>
                    <button onClick={() => deleteFile(item._id)}
                      style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 7, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171', cursor: 'pointer' }}>
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#475569', background: 'rgba(15,23,42,.5)', borderRadius: 14, border: '1px dashed rgba(51,65,85,.5)' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>Pasta vazia</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Arraste arquivos ou clique em "Upload" para adicionar mídias.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal nova pasta ── */}
      {newFolderOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setNewFolderOpen(false)}>
          <div className="modal" style={{ width: 'min(400px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>📁 Nova pasta</h3>
              <button onClick={() => setNewFolderOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <input className="inp" placeholder="Ex.: clientes, reels-jan, stories"
              value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()} autoFocus />
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>Use letras minúsculas, números e hífens.</div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setNewFolderOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={createFolder} disabled={!newFolderName.trim() || savingFolder}>
                {savingFolder ? 'Criando...' : 'Criar pasta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal mover mídia ── */}
      {moveItem && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMoveItem(null)}>
          <div className="modal" style={{ width: 'min(380px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Mover mídia</h3>
              <button onClick={() => setMoveItem(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px' }}>
              Mover <strong style={{ color: 'var(--text1)' }}>{moveItem.originalName}</strong> para:
            </p>
            <select className="sel" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
              {folders.filter(f => f !== (moveItem.folder || 'default')).map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setMoveItem(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={moveFile}>Mover</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview ── */}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}
          style={{ cursor: 'zoom-out', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, overflow: 'hidden', background: '#000', position: 'relative' }}>
            <button onClick={() => setPreview(null)} style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.6)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 16, zIndex: 10 }}>×</button>
            {preview.type === 'video' ? (
              <video src={`${API}${preview.url}`} controls autoPlay style={{ maxWidth: '85vw', maxHeight: '85vh', display: 'block' }} />
            ) : (
              <img src={`${API}${preview.url}`} alt={preview.originalName} style={{ maxWidth: '85vw', maxHeight: '85vh', display: 'block' }} />
            )}
          </div>
        </div>
      )}

      {/* ── Modal confirmação exclusão ── */}
      {confirmModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmModal(null)}
          style={{ zIndex: 1100 }}>
          <div style={{
            background: 'linear-gradient(160deg,#0f172a,#0a1424)',
            border: '1px solid rgba(239,68,68,.25)',
            borderRadius: 18,
            padding: '28px 28px 24px',
            width: 'min(420px,92vw)',
            boxShadow: '0 24px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(239,68,68,.08)',
            position: 'relative',
          }}>
            {/* icon */}
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'rgba(239,68,68,.12)',
              border: '1px solid rgba(239,68,68,.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </div>

            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>
              {confirmModal.type === 'folder' ? 'Excluir pasta' : 'Excluir mídia'}
            </h3>

            {confirmModal.type === 'folder' ? (
              <div>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 4px', lineHeight: 1.55 }}>
                  Tem certeza que deseja excluir a pasta:
                </p>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.15)', borderRadius: 8, padding: '8px 12px', margin: '6px 0 8px', wordBreak: 'break-all' }}>
                  📁 {confirmModal.name}
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
                  Todas as mídias serão movidas para <strong style={{ color: '#94a3b8' }}>default</strong>.
                </p>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 4px', lineHeight: 1.55 }}>
                  Tem certeza que deseja excluir:
                </p>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.15)', borderRadius: 8, padding: '8px 12px', margin: '6px 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={confirmModal.name}>
                  🎬 {confirmModal.name}
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Esta ação não pode ser desfeita.</p>
              </div>
            )}

            <div style={{ height: 1, background: 'rgba(51,65,85,.4)', margin: '20px 0' }} />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmModal(null)}
                style={{
                  padding: '9px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: 'rgba(51,65,85,.4)', border: '1px solid rgba(71,85,105,.4)',
                  color: '#94a3b8', transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(71,85,105,.5)'; e.currentTarget.style.color = '#cbd5e1'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(51,65,85,.4)'; e.currentTarget.style.color = '#94a3b8'; }}
              >
                Cancelar
              </button>
              <button
                onClick={() => confirmModal.type === 'folder'
                  ? doDeleteFolder(confirmModal.name)
                  : doDeleteFile(confirmModal.id)
                }
                style={{
                  padding: '9px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: 'linear-gradient(135deg,#dc2626,#b91c1c)',
                  border: '1px solid rgba(239,68,68,.4)',
                  color: '#fff',
                  boxShadow: '0 4px 14px rgba(220,38,38,.35)',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg,#ef4444,#dc2626)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(220,38,38,.5)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg,#dc2626,#b91c1c)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(220,38,38,.35)'; }}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

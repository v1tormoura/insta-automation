import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function fmt(v) {
  const n = Number(v || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

const modalOverlay = { position:'fixed', inset:0, background:'oklch(0.06 0.02 235 / 0.85)', backdropFilter:'blur(6px)', display:'grid', placeItems:'center', zIndex:9999 };
const modalBox     = { background:'oklch(0.14 0.04 235 / 0.98)', border:'1px solid oklch(1 0 0 / 0.1)', borderRadius:16, padding:'20px 24px', width:'min(460px,calc(100vw - 32px))', boxSizing:'border-box', boxShadow:'0 24px 60px oklch(0 0 0 / 0.6)' };
const inp = { width:'100%', height:40, padding:'0 12px', borderRadius:8, border:'1px solid oklch(1 0 0 / 0.09)', background:'oklch(0.10 0.03 235 / 0.8)', color:'var(--text)', fontSize:13, boxSizing:'border-box', outline:'none' };
const sel = { ...inp, appearance:'none' };

export default function MediaLibrary() {
  const [files, setFiles]         = useState([]);
  const [folders, setFolders]     = useState([]);
  const [activeFolder, setActive] = useState(null);
  const [toast, setToast]         = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver]   = useState(false);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [savingFolder, setSavingFolder]   = useState(false);

  const [moveItem, setMoveItem]     = useState(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [preview, setPreview]       = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const fileInputRef = useRef();

  function toast_(type, title, msg) { setToast({ type, title, message: msg }); setTimeout(() => setToast(null), 3500); }

  async function load() {
    try {
      const res = await api.get('/media');
      const data = res.data;
      const allFiles = data.files || data || [];
      const rawFolders = data.folders || [...new Set(allFiles.map(f => f.folder).filter(Boolean))];
      const allFolders = rawFolders.filter(f => f && f !== 'default');
      setFiles(allFiles);
      const merged = [...new Set(allFolders)].sort();
      setFolders(merged);
      setActive(prev => merged.includes(prev) ? prev : (merged[0] || null));
    } catch { toast_('error', 'Erro', 'Erro ao carregar biblioteca.'); }
  }

  useEffect(() => { load(); }, []);

  async function upload(rawFiles) {
    if (!rawFiles.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(rawFiles).forEach(f => form.append('media', f));
      form.append('folder', activeFolder || 'default');
      await api.post('/media/upload', form);
      await load();
      toast_('success', 'Upload concluído', `${rawFiles.length} arquivo(s) adicionado(s)${activeFolder ? ` à pasta "${activeFolder}"` : ''}.`);
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

  async function deleteFolder(name) { setConfirmModal({ type: 'folder', name }); }

  async function doDeleteFolder(name) {
    try {
      await api.delete(`/media/folder/${name}`);
      await load();
      toast_('success', 'Pasta excluída', 'Pasta excluída com sucesso.');
    } catch { toast_('error', 'Erro', 'Falha ao excluir pasta.'); }
    setConfirmModal(null);
  }

  const shown = files.filter(f => !f.filename?.startsWith('__folder_') && (!activeFolder || (f.folder || 'default') === activeFolder));
  const folderCounts = {};
  files.filter(f => !f.filename?.startsWith('__folder_')).forEach(f => {
    const k = f.folder;
    if (k && k !== 'default') folderCounts[k] = (folderCounts[k] || 0) + 1;
  });

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:8 }}>
      <button className="btn-ghost" style={{ fontSize:'.78rem', padding:'6px 12px', borderRadius:8 }} onClick={() => setNewFolderOpen(true)}>📁 Nova pasta</button>
      <label className="btn-primary" style={{ cursor:'pointer', fontSize:'.78rem', padding:'6px 14px', borderRadius:8, display:'flex', alignItems:'center' }}>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple style={{ display:'none' }}
          onChange={e => upload(Array.from(e.target.files || []))} />
        {uploading ? '⏳ Enviando...' : '⬆️ Upload'}
      </label>
    </div>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Biblioteca de Mídias" subtitle="Organize seus vídeos e imagens em pastas para reutilizar nas postagens." accent="purple" actions={pageActions}>

        <div className="layout-media-lib">

          {/* Sidebar de pastas */}
          <div style={{ background:'oklch(0.12 0.04 235 / 0.8)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', position:'sticky', top:20 }}>
            <div style={{ padding:'12px 14px', borderBottom:'1px solid oklch(1 0 0 / 0.07)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:10, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', fontFamily:'var(--font-mono)' }}>Pastas</span>
              <button onClick={() => setNewFolderOpen(true)} style={{ width:22, height:22, borderRadius:6, background:'oklch(0.68 0.18 270 / 0.15)', border:'1px solid oklch(0.68 0.18 270 / 0.3)', color:'oklch(0.68 0.18 270)', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            </div>
            <div style={{ padding:'8px' }}>
              {folders.length === 0 && (
                <div style={{ padding:'12px 10px', fontSize:12, color:'var(--text3)', textAlign:'center' }}>Clique em "+" para criar uma pasta.</div>
              )}
              {folders.map(f => (
                <div key={f} onClick={() => setActive(f)}
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', borderRadius:8, cursor:'pointer', marginBottom:2, background: activeFolder === f ? 'oklch(0.68 0.18 270 / 0.15)' : 'transparent', border: activeFolder === f ? '1px solid oklch(0.68 0.18 270 / 0.25)' : '1px solid transparent', transition:'all .15s' }}
                  onMouseEnter={e => { if (activeFolder !== f) e.currentTarget.style.background = 'oklch(1 0 0 / 0.04)'; }}
                  onMouseLeave={e => { if (activeFolder !== f) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
                    <span style={{ fontSize:13 }}>📁</span>
                    <span style={{ fontSize:12, fontWeight: activeFolder === f ? 600 : 400, color: activeFolder === f ? 'oklch(0.80 0.16 270)' : 'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <span style={{ fontSize:10, color:'var(--text3)', background:'oklch(0.10 0.03 235 / 0.5)', borderRadius:10, padding:'1px 6px' }}>{folderCounts[f] || 0}</span>
                    <button onClick={e => { e.stopPropagation(); deleteFolder(f); }} style={{ width:17, height:17, borderRadius:4, background:'transparent', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:10, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop:'1px solid oklch(1 0 0 / 0.07)', padding:'10px 14px', display:'flex', flexDirection:'column', gap:5 }}>
              {[
                { l:'Total',   v:files.filter(f => !f.filename?.startsWith('__folder_')).length, c:'oklch(0.68 0.18 270)' },
                { l:'Vídeos',  v:files.filter(f => f.type === 'video').length,                    c:'oklch(0.72 0.2 270)'  },
                { l:'Imagens', v:files.filter(f => f.type === 'image').length,                    c:'oklch(0.72 0.18 150)' },
              ].map(s => (
                <div key={s.l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:11, color:'var(--text3)' }}>{s.l}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Main area */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:18 }}>📁</span>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{activeFolder || 'Todos os arquivos'}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{shown.length} arquivo(s)</div>
                </div>
              </div>
            </div>

            {/* Drop zone */}
            <label
              style={{ marginBottom:14, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', padding:'20px', borderRadius:12, border:`2px dashed ${dragOver ? 'var(--cyan)' : 'oklch(1 0 0 / 0.12)'}`, background: dragOver ? 'oklch(0.72 0.19 196 / 0.06)' : 'oklch(0.12 0.04 235 / 0.4)', transition:'.15s' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); upload(Array.from(e.dataTransfer.files)); }}
            >
              <input type="file" accept="image/*,video/*" multiple style={{ display:'none' }}
                onChange={e => upload(Array.from(e.target.files || []))} />
              <div style={{ fontSize:24, marginBottom:6 }}>⬆️</div>
              <strong style={{ fontSize:13, color:'var(--text)' }}>{uploading ? 'Enviando...' : activeFolder ? `Arraste para "${activeFolder}" ou clique` : 'Arraste arquivos ou clique'}</strong>
              <span style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>MP4, MOV, JPG, PNG · Múltiplos arquivos</span>
            </label>

            {/* Grid */}
            {shown.length > 0 ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))', gap:10 }}>
                {shown.map((item, i) => (
                  <motion.div key={item._id} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*.02 }}
                    style={{ background:'oklch(0.14 0.04 235 / 0.8)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:12, overflow:'hidden' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'oklch(0.68 0.18 270 / 0.4)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'oklch(1 0 0 / 0.07)'}
                  >
                    <div onClick={() => setPreview(item)} style={{ width:'100%', aspectRatio:'1', background:'oklch(0.10 0.03 235)', cursor:'pointer', position:'relative', overflow:'hidden' }}>
                      {item.type === 'video' ? (
                        <video src={`${API}${item.url}`} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      ) : item.type === 'image' ? (
                        <img src={`${API}${item.url}`} alt={item.originalName} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      ) : (
                        <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28 }}>📄</div>
                      )}
                      <span style={{ position:'absolute', top:6, left:6, fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:5, background: item.type === 'video' ? 'oklch(0.68 0.18 270 / 0.85)' : 'oklch(0.72 0.18 150 / 0.85)', color:'#fff', letterSpacing:.4 }}>
                        {item.type === 'video' ? 'VID' : 'IMG'}
                      </span>
                    </div>
                    <div style={{ padding:'8px 10px' }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={item.originalName}>{item.originalName}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{fmt(item.size)}</div>
                    </div>
                    <div style={{ display:'flex', gap:6, padding:'0 10px 10px' }}>
                      <button onClick={() => { setMoveItem(item); setMoveTarget(folders.find(f => f !== item.folder) || folders[0] || ''); }}
                        style={{ flex:1, fontSize:11, padding:'5px 0', borderRadius:7, border:'1px solid oklch(1 0 0 / 0.09)', background:'oklch(0.10 0.03 235 / 0.5)', color:'var(--text2)', cursor:'pointer' }}>
                        Mover
                      </button>
                      <button onClick={() => deleteFile(item._id)}
                        style={{ flex:1, fontSize:11, padding:'5px 0', borderRadius:7, border:'1px solid oklch(0.38 0.12 15 / 0.3)', background:'oklch(0.22 0.06 15 / 0.2)', color:'#f87171', cursor:'pointer' }}>
                        Excluir
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--text3)', background:'oklch(0.12 0.04 235 / 0.4)', borderRadius:14, border:'1px dashed oklch(1 0 0 / 0.1)' }}>
                <div style={{ fontSize:40, marginBottom:10 }}>📂</div>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--text2)' }}>Pasta vazia</div>
                <div style={{ fontSize:12, marginTop:4 }}>Arraste arquivos ou clique em "Upload" para adicionar mídias.</div>
              </div>
            )}
          </div>
        </div>

        {/* Modal nova pasta */}
        {newFolderOpen && (
          <div style={modalOverlay} onClick={e => e.target === e.currentTarget && setNewFolderOpen(false)}>
            <div style={modalBox}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize:'.95rem', fontWeight:800 }}>📁 Nova pasta</h3>
                <button onClick={() => setNewFolderOpen(false)} style={{ background:'none', border:'none', color:'var(--text3)', fontSize:22, cursor:'pointer' }}>×</button>
              </div>
              <input style={inp} placeholder="Ex.: clientes, reels-jan, stories"
                value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFolder()} autoFocus />
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>Use letras minúsculas, números e hífens.</div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn-ghost" style={{ borderRadius:8, padding:'7px 14px' }} onClick={() => setNewFolderOpen(false)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius:8, padding:'7px 16px' }} onClick={createFolder} disabled={!newFolderName.trim() || savingFolder}>
                  {savingFolder ? 'Criando...' : 'Criar pasta'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal mover mídia */}
        {moveItem && (
          <div style={modalOverlay} onClick={e => e.target === e.currentTarget && setMoveItem(null)}>
            <div style={modalBox}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize:'.95rem', fontWeight:800 }}>Mover mídia</h3>
                <button onClick={() => setMoveItem(null)} style={{ background:'none', border:'none', color:'var(--text3)', fontSize:22, cursor:'pointer' }}>×</button>
              </div>
              <p style={{ fontSize:13, color:'var(--text2)', margin:'0 0 12px' }}>
                Mover <strong style={{ color:'var(--text)' }}>{moveItem.originalName}</strong> para:
              </p>
              <select style={sel} value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
                {folders.filter(f => f !== moveItem.folder).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn-ghost" style={{ borderRadius:8, padding:'7px 14px' }} onClick={() => setMoveItem(null)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius:8, padding:'7px 16px' }} onClick={moveFile}>Mover</button>
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div style={{ ...modalOverlay, cursor:'zoom-out' }} onClick={() => setPreview(null)}>
            <div onClick={e => e.stopPropagation()} style={{ maxWidth:'90vw', maxHeight:'90vh', borderRadius:12, overflow:'hidden', background:'#000', position:'relative' }}>
              <button onClick={() => setPreview(null)} style={{ position:'absolute', top:10, right:10, background:'oklch(0 0 0 / 0.6)', border:'none', color:'#fff', borderRadius:'50%', width:32, height:32, cursor:'pointer', fontSize:16, zIndex:10 }}>×</button>
              {preview.type === 'video' ? (
                <video src={`${API}${preview.url}`} controls autoPlay style={{ maxWidth:'85vw', maxHeight:'85vh', display:'block' }} />
              ) : (
                <img src={`${API}${preview.url}`} alt={preview.originalName} style={{ maxWidth:'85vw', maxHeight:'85vh', display:'block' }} />
              )}
            </div>
          </div>
        )}

        {/* Confirm delete */}
        {confirmModal && (
          <div style={{ ...modalOverlay, zIndex:10000 }} onClick={e => e.target === e.currentTarget && setConfirmModal(null)}>
            <div style={{ background:'linear-gradient(160deg, oklch(0.12 0.04 235), oklch(0.09 0.03 235))', border:'1px solid oklch(0.38 0.12 15 / 0.25)', borderRadius:18, padding:'28px 28px 24px', width:'min(420px,92vw)', boxShadow:'0 24px 60px oklch(0 0 0 / 0.6)' }}>
              <div style={{ width:52, height:52, borderRadius:14, background:'oklch(0.22 0.06 15 / 0.3)', border:'1px solid oklch(0.38 0.12 15 / 0.3)', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:18 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
              </div>
              <h3 style={{ margin:'0 0 8px', fontSize:17, fontWeight:700, color:'var(--text)' }}>
                {confirmModal.type === 'folder' ? 'Excluir pasta' : 'Excluir mídia'}
              </h3>
              <p style={{ fontSize:13, color:'var(--text2)', margin:'0 0 4px', lineHeight:1.55 }}>
                {confirmModal.type === 'folder' ? 'Tem certeza que deseja excluir a pasta:' : 'Tem certeza que deseja excluir:'}
              </p>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', background:'oklch(0.22 0.06 15 / 0.15)', border:'1px solid oklch(0.38 0.12 15 / 0.2)', borderRadius:8, padding:'8px 12px', margin:'6px 0 8px', wordBreak:'break-all' }}>
                {confirmModal.type === 'folder' ? `📁 ${confirmModal.name}` : confirmModal.name}
              </div>
              {confirmModal.type === 'folder'
                ? <p style={{ fontSize:12, color:'var(--text3)', margin:0 }}>As mídias desta pasta não serão excluídas.</p>
                : <p style={{ fontSize:12, color:'var(--text3)', margin:0 }}>Esta ação não pode ser desfeita.</p>
              }
              <div style={{ height:1, background:'oklch(1 0 0 / 0.07)', margin:'20px 0' }} />
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={() => setConfirmModal(null)} className="btn-ghost" style={{ borderRadius:10, padding:'9px 20px' }}>Cancelar</button>
                <button
                  onClick={() => confirmModal.type === 'folder' ? doDeleteFolder(confirmModal.name) : doDeleteFile(confirmModal.id)}
                  style={{ padding:'9px 22px', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', background:'linear-gradient(135deg,#dc2626,#b91c1c)', border:'1px solid oklch(0.38 0.12 15 / 0.4)', color:'#fff', boxShadow:'0 4px 14px oklch(0.38 0.12 15 / 0.35)' }}
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}

      </PageShell>
    </>
  );
}

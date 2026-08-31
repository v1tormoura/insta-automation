import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import { EsqueletoGrade } from '../components/Estados';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function fmt(v) {
  const n = Number(v || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

const modalOverlay = { position:'fixed', inset:0, background:'color-mix(in oklch, var(--mf-bg) 85%, transparent)', backdropFilter:'blur(6px)', display:'grid', placeItems:'center', zIndex:9999 };
const modalBox     = { background:'color-mix(in oklch, var(--mf-surface-1) 98%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', padding:'16px 24px', width:'min(460px,calc(100vw - 32px))', boxSizing:'border-box',
  /* A largura já cedia; a altura não. Um modal mais alto que a tela
     empurra o botão de confirmar para fora do alcance. */
  maxHeight:'calc(100vh - 32px)', overflowY:'auto', boxShadow:'0 24px 60px oklch(0 0 0 / 0.6)' };
const inp = { width:'100%', height:40, padding:'0 12px', borderRadius: 'var(--mf-r-sm)', border:'1px solid var(--mf-border)', background:'color-mix(in oklch, var(--mf-bg) 80%, transparent)', color:'var(--mf-text)', fontSize: 'var(--mf-t-sm)', boxSizing:'border-box', outline:'none' };
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

  /* Biblioteca de mídia costuma trazer centenas de arquivos e demora o
     bastante para a espera ser percebida. O esqueleto vale só na primeira
     carga — depois o conteúdo já está na tela. */
  const [primeiraCarga, setPrimeiraCarga] = useState(true);

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
    finally { setPrimeiraCarga(false); }
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
      <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)' }} onClick={() => setNewFolderOpen(true)}>📁 Nova pasta</button>
      <label className="btn-primary" style={{ cursor:'pointer', fontSize: 'var(--mf-t-xs)', padding:'4px 12px', borderRadius: 'var(--mf-r-sm)', display:'flex', alignItems:'center' }}>
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
          <div style={{ background:'color-mix(in oklch, var(--mf-bg) 80%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', overflow:'hidden', position:'sticky', top:20 }}>
            <div style={{ padding:'12px 12px', borderBottom:'1px solid var(--mf-border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.06em', fontFamily:'var(--mf-mono)' }}>Pastas</span>
              <button onClick={() => setNewFolderOpen(true)} style={{ width:22, height:22, borderRadius: 'var(--mf-r-sm)', background:'oklch(0.68 0.18 270 / 0.15)', border:'1px solid oklch(0.68 0.18 270 / 0.3)', color:'oklch(0.68 0.18 270)', cursor:'pointer', fontSize: 'var(--mf-t-body)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            </div>
            <div style={{ padding:'8px' }}>
              {folders.length === 0 && (
                <div style={{ padding:'12px 8px', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', textAlign:'center' }}>Clique em "+" para criar uma pasta.</div>
              )}
              {folders.map(f => (
                <div key={f} onClick={() => setActive(f)}
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', marginBottom:2, background: activeFolder === f ? 'oklch(0.68 0.18 270 / 0.15)' : 'transparent', border: activeFolder === f ? '1px solid oklch(0.68 0.18 270 / 0.25)' : '1px solid transparent', transition:'all .15s' }}
                  onMouseEnter={e => { if (activeFolder !== f) e.currentTarget.style.background = 'var(--mf-border-subtle)'; }}
                  onMouseLeave={e => { if (activeFolder !== f) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
                    <span style={{ fontSize: 'var(--mf-t-sm)' }}>📁</span>
                    <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: activeFolder === f ? 600 : 400, color: activeFolder === f ? 'oklch(0.80 0.16 270)' : 'var(--mf-text-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'2px 4px' }}>{folderCounts[f] || 0}</span>
                    <button onClick={e => { e.stopPropagation(); deleteFolder(f); }} style={{ width:17, height:17, borderRadius: 'var(--mf-r-xs)', background:'transparent', border:'none', color:'var(--mf-text-3)', cursor:'pointer', fontSize: 'var(--mf-t-nano)', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop:'1px solid var(--mf-border)', padding:'8px 12px', display:'flex', flexDirection:'column', gap:5 }}>
              {[
                { l:'Total',   v:files.filter(f => !f.filename?.startsWith('__folder_')).length, c:'oklch(0.68 0.18 270)' },
                { l:'Vídeos',  v:files.filter(f => f.type === 'video').length,                    c:'oklch(0.72 0.2 270)'  },
                { l:'Imagens', v:files.filter(f => f.type === 'image').length,                    c:'oklch(0.72 0.18 150)' },
              ].map(s => (
                <div key={s.l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>{s.l}</span>
                  <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color:s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Main area */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize: 'var(--mf-t-h1)' }}>📁</span>
                <div>
                  <div style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)' }}>{activeFolder || 'Todos os arquivos'}</div>
                  <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>{shown.length} arquivo(s)</div>
                </div>
              </div>
            </div>

            {/* Drop zone */}
            <label
              style={{ marginBottom:14, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', padding:'16px', borderRadius: 'var(--mf-r-md)', border:`2px dashed ${dragOver ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border-strong)'}`, background: dragOver ? 'oklch(0.72 0.19 196 / 0.06)' : 'color-mix(in oklch, var(--mf-bg) 40%, transparent)', transition:'.15s' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); upload(Array.from(e.dataTransfer.files)); }}
            >
              <input type="file" accept="image/*,video/*" multiple style={{ display:'none' }}
                onChange={e => upload(Array.from(e.target.files || []))} />
              <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:6 }}>⬆️</div>
              <strong style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)' }}>{uploading ? 'Enviando...' : activeFolder ? `Arraste para "${activeFolder}" ou clique` : 'Arraste arquivos ou clique'}</strong>
              <span style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', marginTop:4 }}>MP4, MOV, JPG, PNG · Múltiplos arquivos</span>
            </label>

            {/* Grid */}
            {/* O esqueleto vem ANTES de "tem arquivo?": posto dentro daquele
                ramo, ele exigia `shown.length > 0` e `!shown.length` ao mesmo
                tempo — condição impossível, código morto. */}
            {primeiraCarga && !shown.length ? (
              <EsqueletoGrade itens={12} minimo={124} />
            ) : shown.length > 0 ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))', gap:10 }}>
                {shown.map((item, i) => (
                  <motion.div key={item._id} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*.02 }}
                    style={{ background:'color-mix(in oklch, var(--mf-surface-1) 80%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', overflow:'hidden' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'oklch(0.68 0.18 270 / 0.4)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--mf-border)'}
                  >
                    <div onClick={() => setPreview(item)} style={{ width:'100%', aspectRatio:'1', background:'var(--mf-bg)', cursor:'pointer', position:'relative', overflow:'hidden' }}>
                      {item.type === 'video' ? (
                        <video src={`${API}${item.url}`} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      ) : item.type === 'image' ? (
                        <img src={`${API}${item.url}`} alt={item.originalName} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      ) : (
                        <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 'var(--mf-t-display)' }}>📄</div>
                      )}
                      <span style={{ position:'absolute', top:6, left:6, fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 4px', borderRadius: 'var(--mf-r-xs)', background: item.type === 'video' ? 'oklch(0.68 0.18 270 / 0.85)' : 'oklch(0.72 0.18 150 / 0.85)', color:'var(--mf-text)', letterSpacing:.4 }}>
                        {item.type === 'video' ? 'VID' : 'IMG'}
                      </span>
                    </div>
                    <div style={{ padding:'8px 8px' }}>
                      <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight:600, color:'var(--mf-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={item.originalName}>{item.originalName}</div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2 }}>{fmt(item.size)}</div>
                    </div>
                    <div style={{ display:'flex', gap:6, padding:'0 8px 8px' }}>
                      <button onClick={() => { setMoveItem(item); setMoveTarget(folders.find(f => f !== item.folder) || folders[0] || ''); }}
                        style={{ flex:1, fontSize: 'var(--mf-t-micro)', padding:'4px 0', borderRadius: 'var(--mf-r-sm)', border:'1px solid var(--mf-border)', background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)', color:'var(--mf-text-2)', cursor:'pointer' }}>
                        Mover
                      </button>
                      <button onClick={() => deleteFile(item._id)}
                        style={{ flex:1, fontSize: 'var(--mf-t-micro)', padding:'4px 0', borderRadius: 'var(--mf-r-sm)', border:'1px solid oklch(0.38 0.12 15 / 0.3)', background:'color-mix(in oklch, var(--mf-danger-500) 4%, transparent)', color:'var(--mf-danger-500)', cursor:'pointer' }}>
                        Excluir
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign:'center', padding:'48px 16px', color:'var(--mf-text-3)', background:'color-mix(in oklch, var(--mf-bg) 40%, transparent)', borderRadius: 'var(--mf-r-lg)', border:'1px dashed var(--mf-border)' }}>
                <div style={{ fontSize: 'var(--mf-t-display)', marginBottom:10 }}>📂</div>
                <div style={{ fontSize: 'var(--mf-t-body)', fontWeight:600, color:'var(--mf-text-2)' }}>Pasta vazia</div>
                <div style={{ fontSize: 'var(--mf-t-xs)', marginTop:4 }}>Arraste arquivos ou clique em "Upload" para adicionar mídias.</div>
              </div>
            )}
          </div>
        </div>

        {/* Modal nova pasta */}
        {newFolderOpen && (
          <div style={modalOverlay} onClick={e => e.target === e.currentTarget && setNewFolderOpen(false)}>
            <div style={modalBox}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize: 'var(--mf-t-h2)', fontWeight:800 }}>📁 Nova pasta</h3>
                <button onClick={() => setNewFolderOpen(false)} style={{ background:'none', border:'none', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-h1)', cursor:'pointer' }}>×</button>
              </div>
              <input style={inp} placeholder="Ex.: clientes, reels-jan, stories"
                value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFolder()} autoFocus />
              <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:6 }}>Use letras minúsculas, números e hífens.</div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn-ghost" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 12px' }} onClick={() => setNewFolderOpen(false)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 16px' }} onClick={createFolder} disabled={!newFolderName.trim() || savingFolder}>
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
                <h3 style={{ margin:0, fontSize: 'var(--mf-t-h2)', fontWeight:800 }}>Mover mídia</h3>
                <button onClick={() => setMoveItem(null)} style={{ background:'none', border:'none', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-h1)', cursor:'pointer' }}>×</button>
              </div>
              <p style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-2)', margin:'0 0 12px' }}>
                Mover <strong style={{ color:'var(--mf-text)' }}>{moveItem.originalName}</strong> para:
              </p>
              <select style={sel} value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
                {folders.filter(f => f !== moveItem.folder).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn-ghost" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 12px' }} onClick={() => setMoveItem(null)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius: 'var(--mf-r-sm)', padding:'8px 16px' }} onClick={moveFile}>Mover</button>
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div style={{ ...modalOverlay, cursor:'zoom-out' }} onClick={() => setPreview(null)}>
            <div onClick={e => e.stopPropagation()} style={{ maxWidth:'90vw', maxHeight:'90vh', borderRadius: 'var(--mf-r-md)', overflow:'hidden', background:'#000', position:'relative' }}>
              <button onClick={() => setPreview(null)} style={{ position:'absolute', top:10, right:10, background:'oklch(0 0 0 / 0.6)', border:'none', color:'var(--mf-text)', borderRadius: 'var(--mf-r-full)', width:32, height:32, cursor:'pointer', fontSize: 'var(--mf-t-h2)', zIndex:10 }}>×</button>
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
            <div style={{ background:'linear-gradient(160deg, var(--mf-bg), var(--mf-bg))', border:'1px solid oklch(0.38 0.12 15 / 0.25)', borderRadius: 'var(--mf-r-xl)', padding:'24px 24px 24px', width:'min(420px,92vw)', boxShadow:'0 24px 60px oklch(0 0 0 / 0.6)' }}>
              <div style={{ width:52, height:52, borderRadius: 'var(--mf-r-lg)', background:'color-mix(in oklch, var(--mf-danger-500) 7%, transparent)', border:'1px solid oklch(0.38 0.12 15 / 0.3)', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:18 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
              </div>
              <h3 style={{ margin:'0 0 8px', fontSize: 'var(--mf-t-h2)', fontWeight:700, color:'var(--mf-text)' }}>
                {confirmModal.type === 'folder' ? 'Excluir pasta' : 'Excluir mídia'}
              </h3>
              <p style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-2)', margin:'0 0 4px', lineHeight:1.55 }}>
                {confirmModal.type === 'folder' ? 'Tem certeza que deseja excluir a pasta:' : 'Tem certeza que deseja excluir:'}
              </p>
              <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:600, color:'var(--mf-text)', background:'color-mix(in oklch, var(--mf-danger-500) 4%, transparent)', border:'1px solid oklch(0.38 0.12 15 / 0.2)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', margin:'6px 0 8px', wordBreak:'break-all' }}>
                {confirmModal.type === 'folder' ? `📁 ${confirmModal.name}` : confirmModal.name}
              </div>
              {confirmModal.type === 'folder'
                ? <p style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', margin:0 }}>As mídias desta pasta não serão excluídas.</p>
                : <p style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', margin:0 }}>Esta ação não pode ser desfeita.</p>
              }
              <div style={{ height:1, background:'var(--mf-border)', margin:'20px 0' }} />
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={() => setConfirmModal(null)} className="btn-ghost" style={{ borderRadius: 'var(--mf-r-md)', padding:'8px 16px' }}>Cancelar</button>
                <button
                  onClick={() => confirmModal.type === 'folder' ? doDeleteFolder(confirmModal.name) : doDeleteFile(confirmModal.id)}
                  style={{ padding:'8px 24px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-sm)', fontWeight:700, cursor:'pointer', background:'linear-gradient(135deg,var(--mf-danger-500),var(--mf-danger-500))', border:'1px solid oklch(0.38 0.12 15 / 0.4)', color:'var(--mf-text)', boxShadow:'0 4px 14px oklch(0.38 0.12 15 / 0.35)' }}
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

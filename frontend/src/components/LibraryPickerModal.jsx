import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function thumbSrc(file) {
  if (!file?.filename) return null;
  const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(file.filename);
  if (isVideo) return `${API}/uploads/${file.filename.replace(/\.[^.]+$/, '')}.thumb.jpg`;
  return `${API}${file.url || `/uploads/${file.filename}`}`;
}

function FileThumb({ file, selected, onClick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = thumbSrc(file);
  const isVideo = file.type === 'video';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative', aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden',
        border: selected ? '2px solid var(--cyan)' : '2px solid oklch(1 0 0 / 0.08)',
        background: 'oklch(0.12 0.04 235)',
        cursor: 'pointer', padding: 0, display: 'block',
        boxShadow: selected ? '0 0 0 1px var(--cyan)' : 'none',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      {src && !imgFailed
        ? <img src={src} alt="" loading="lazy" onError={() => setImgFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', opacity: .5, fontSize: 22 }}>
            {isVideo ? '🎬' : '🖼️'}
          </div>
      }
      {isVideo && !imgFailed && src && (
        <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'oklch(0 0 0 / 0.65)', borderRadius: 4, padding: '1px 5px', fontSize: 9, color: '#fff', fontFamily: 'var(--font-mono)' }}>▶</div>
      )}
      {selected && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,212,255,.12)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 5 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#040e1c" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
      )}
      <div style={{ position: 'absolute', top: 3, left: 3, fontSize: 8, fontWeight: 700, fontFamily: 'var(--font-mono)', background: 'oklch(0 0 0 / 0.65)', color: '#fff', borderRadius: 3, padding: '1px 4px', maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.originalName || file.filename}
      </div>
    </button>
  );
}

export default function LibraryPickerModal({ onClose, onConfirm, mode = 'multi' }) {
  const [files,     setFiles]     = useState([]);
  const [folders,   setFolders]   = useState([]);
  const [activeFolder, setActive] = useState(null);
  const [selected,  setSelected]  = useState(new Map()); // _id → file
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver,  setDragOver]  = useState(false);

  useEffect(() => {
    api.get('/media').then(r => {
      const data = r.data;
      const allFiles = data.files || [];
      const allFolders = data.folders || [];
      setFiles(allFiles);
      setFolders(allFolders);
      if (allFolders.length) setActive(allFolders[0]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function uploadFiles(rawFiles) {
    if (!rawFiles?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(rawFiles).forEach(f => form.append('media', f));
      form.append('folder', activeFolder || 'default');
      await api.post('/media/upload', form);
      const r = await api.get('/media');
      const data = r.data;
      setFiles(data.files || []);
      setFolders(data.folders || []);
    } catch {} finally { setUploading(false); }
  }

  function toggle(file) {
    setSelected(prev => {
      const m = new Map(prev);
      if (m.has(file._id)) m.delete(file._id);
      else {
        if (mode === 'single') m.clear();
        m.set(file._id, file);
      }
      return m;
    });
  }

  const shown = files.filter(f =>
    !f.filename?.startsWith('__folder_') &&
    (!activeFolder || (f.folder || 'default') === activeFolder)
  );

  const folderCounts = {};
  files.filter(f => !f.filename?.startsWith('__folder_')).forEach(f => {
    const k = f.folder || 'default';
    folderCounts[k] = (folderCounts[k] || 0) + 1;
  });

  const allFoldersForSidebar = ['default', ...folders.filter(f => f !== 'default')];

  function confirm() {
    onConfirm(Array.from(selected.values()));
    onClose();
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={e => e.target === e.currentTarget && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'oklch(0.06 0.02 235 / 0.85)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 16 }}
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
          style={{ background: 'oklch(0.14 0.04 235 / 0.98)', border: '1px solid oklch(1 0 0 / 0.1)', borderRadius: 16, width: 'min(820px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px oklch(0 0 0 / .6)' }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid oklch(1 0 0 / 0.08)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>📁</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Biblioteca de Mídias</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{selected.size > 0 ? `${selected.size} selecionado(s)` : 'Clique para selecionar'}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'oklch(1 0 0 / 0.06)', border: '1px solid oklch(1 0 0 / 0.08)', color: 'var(--text3)', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Sidebar pastas */}
            <div style={{ width: 170, borderRight: '1px solid oklch(1 0 0 / 0.07)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
              <div style={{ padding: '10px 10px 6px', fontSize: 9, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: 'var(--font-mono)' }}>Pastas</div>
              {allFoldersForSidebar.map(f => (
                <button key={f} type="button" onClick={() => setActive(f)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', margin: '0 6px 2px', borderRadius: 7, cursor: 'pointer', border: 'none', textAlign: 'left',
                    background: activeFolder === f ? 'oklch(0.68 0.18 270 / 0.15)' : 'transparent',
                    color: activeFolder === f ? 'oklch(0.80 0.16 270)' : 'var(--text2)',
                    fontWeight: activeFolder === f ? 600 : 400, fontSize: 12, transition: '.15s',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {f === 'default' ? 'Geral' : f}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)', background: 'oklch(0.10 0.03 235 / 0.5)', borderRadius: 8, padding: '1px 5px', flexShrink: 0, marginLeft: 4 }}>{folderCounts[f] || 0}</span>
                </button>
              ))}
              {/* Upload na sidebar */}
              <div style={{ marginTop: 'auto', padding: '10px 8px', borderTop: '1px solid oklch(1 0 0 / 0.07)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: uploading ? 'wait' : 'pointer', background: 'rgba(0,212,255,.08)', border: '1px solid rgba(0,212,255,.2)', color: 'var(--cyan)', fontSize: 11, fontWeight: 600 }}>
                  <input type="file" multiple accept="image/*,video/*" hidden onChange={e => uploadFiles(e.target.files)} />
                  {uploading ? '⏳ Enviando...' : '⬆ Upload'}
                </label>
              </div>
            </div>

            {/* Grid de arquivos */}
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
            >
              {loading && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>Carregando...</div>}
              {!loading && shown.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
                  <div style={{ fontSize: 13 }}>Nenhuma mídia nesta pasta.</div>
                  <div style={{ fontSize: 11, marginTop: 6 }}>Use o botão "Upload" para adicionar arquivos.</div>
                </div>
              )}
              {dragOver && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,212,255,.1)', border: '2px dashed var(--cyan)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--cyan)', pointerEvents: 'none', zIndex: 10 }}>
                  Solte para fazer upload
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(80px,1fr))', gap: 6 }}>
                {shown.map(file => (
                  <FileThumb key={file._id} file={file} selected={selected.has(file._id)} onClick={() => toggle(file)} />
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid oklch(1 0 0 / 0.08)', flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              {files.filter(f => !f.filename?.startsWith('__folder_')).length} mídia(s) na biblioteca
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid oklch(1 0 0 / 0.09)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
              <button type="button" onClick={confirm} disabled={selected.size === 0}
                style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: selected.size > 0 ? 'var(--cyan)' : 'oklch(1 0 0 / 0.08)', color: selected.size > 0 ? '#040e1c' : 'var(--text3)', cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: 13, fontWeight: 700, transition: '.15s' }}>
                {selected.size > 0 ? `Adicionar ${selected.size} arquivo(s)` : 'Selecione arquivos'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

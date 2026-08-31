import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const ehVideo = f =>
  f?.type === 'video' || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(f?.filename || '');

/** Endereço do arquivo em si. */
function arquivoSrc(file) {
  if (!file?.filename) return null;
  return `${API}${file.url || `/uploads/${file.filename}`}`;
}

/**
 * Miniatura gerada no servidor. O caminho é ADIVINHADO por convenção — o
 * backend grava `nome.thumb.jpg` ao lado do vídeo — e por isso pode não
 * existir: vídeo que entrou antes da geração, ou que a rotina pulou.
 *
 * Quando não existe, quem chama cai para o próprio vídeo. Ver FileThumb.
 */
function thumbSrc(file) {
  if (!file?.filename) return null;
  if (ehVideo(file)) return `${API}/uploads/${file.filename.replace(/\.[^.]+$/, '')}.thumb.jpg`;
  return arquivoSrc(file);
}

function FileThumb({ file, selected, onClick }) {
  /* Três estágios, nesta ordem: a miniatura pronta do servidor, o vídeo em si,
     e só então o emoji.
     
     Antes eram dois, e o do meio faltava: quando o `.thumb.jpg` não existia —
     que é o caso de toda a biblioteca antes de rodar "Gerar thumbs" — a
     biblioteca inteira virava uma grade de claquetes, sem jeito de saber qual
     vídeo era qual. O navegador decodifica o primeiro quadro sozinho com
     `preload="metadata"`, então não é preciso esperar geração nenhuma. */
  const [estagio, setEstagio] = useState('thumb');   // thumb → video → emoji
  const src = thumbSrc(file);
  const isVideo = ehVideo(file);
  const imgFailed = estagio === 'emoji';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative', aspectRatio: '9/16', borderRadius: 'var(--mf-r-sm)', overflow: 'hidden',
        border: selected ? '2px solid var(--mf-mod, var(--mf-accent-500))' : '2px solid var(--mf-border)',
        background: 'var(--mf-surface-2)',
        cursor: 'pointer', padding: 0, display: 'block',
        boxShadow: selected ? '0 0 0 1px var(--mf-mod, var(--mf-accent-500))' : 'none',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      {src && estagio === 'thumb' && (
        <img src={src} alt="" loading="lazy"
          onError={() => setEstagio(isVideo ? 'video' : 'emoji')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      )}
      {estagio === 'video' && (
        <video src={arquivoSrc(file)} muted playsInline preload="metadata"
          onError={() => setEstagio('emoji')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      )}
      {(estagio === 'emoji' || !src) && (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mf-text-3)', opacity: .5, fontSize: 'var(--mf-t-h1)' }}>
          {isVideo ? '🎬' : '🖼️'}
        </div>
      )}
      {isVideo && !imgFailed && src && (
        <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'oklch(0 0 0 / 0.65)', borderRadius: 'var(--mf-r-xs)', padding: '1px 5px', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)' }}>▶</div>
      )}
      {selected && (
        <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 5 }}>
          <div style={{ width: 18, height: 18, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-mod, var(--mf-accent-500))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--mf-bg)" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
      )}
      <div style={{ position: 'absolute', top: 3, left: 3, fontSize: 'var(--mf-t-nano)', fontWeight: 700, fontFamily: 'var(--mf-mono)', background: 'oklch(0 0 0 / 0.65)', color: 'var(--mf-text)', borderRadius: 'var(--mf-r-xs)', padding: '1px 4px', maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.originalName || file.filename}
      </div>
    </button>
  );
}

export default function LibraryPickerModal({ onClose, onConfirm, mode = 'multi', accept = 'all' }) {
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
      const allFolders = (data.folders || []).filter(f => f !== 'default');
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
    (!activeFolder || (f.folder || 'default') === activeFolder) &&
    (accept === 'all' || f.type === accept)
  );

  const folderCounts = {};
  files.filter(f => !f.filename?.startsWith('__folder_')).forEach(f => {
    const k = f.folder || 'default';
    folderCounts[k] = (folderCounts[k] || 0) + 1;
  });

  const allFoldersForSidebar = folders.filter(f => f !== 'default');

  const shownSelected = shown.filter(f => selected.has(f._id)).length;
  const allShownSel   = shown.length > 0 && shownSelected === shown.length;

  function toggleSelectAll() {
    if (allShownSel) {
      setSelected(prev => { const m = new Map(prev); shown.forEach(f => m.delete(f._id)); return m; });
    } else {
      setSelected(prev => { const m = new Map(prev); shown.forEach(f => m.set(f._id, f)); return m; });
    }
  }

  function confirm() {
    onConfirm(Array.from(selected.values()));
    onClose();
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={e => e.target === e.currentTarget && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'color-mix(in oklch, var(--mf-bg) 85%, transparent)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 16 }}
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
          style={{ background: 'color-mix(in oklch, var(--mf-surface-1) 98%, transparent)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)', width: 'min(820px, 100%)', maxHeight: 'min(90dvh,90vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--mf-shadow-3)' }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--mf-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 'var(--mf-t-h1)' }}>📁</span>
              <div>
                <div style={{ fontSize: 'var(--mf-t-body)', fontWeight: 700, color: 'var(--mf-text)' }}>Biblioteca de Mídias</div>
                <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{selected.size > 0 ? `${selected.size} selecionado(s)` : 'Clique para selecionar'}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-border)', border: '1px solid var(--mf-border)', color: 'var(--mf-text-3)', cursor: 'pointer', fontSize: 'var(--mf-t-h2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>

          {/* Body */}
          <div className="lib-picker-body">
            {/* Sidebar pastas */}
            <div className="lib-picker-sidebar">
              <div className="lib-picker-sidebar-label" style={{ padding: '10px 10px 6px', fontSize: 'var(--mf-t-nano)', fontWeight: 700, color: 'var(--mf-text-3)', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: 'var(--mf-mono)' }}>Pastas</div>
              {allFoldersForSidebar.map(f => (
                <button key={f} type="button" onClick={() => setActive(f)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', margin: '0 6px 2px', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', border: 'none', textAlign: 'left',
                    background: activeFolder === f ? 'oklch(0.68 0.18 270 / 0.15)' : 'transparent',
                    color: activeFolder === f ? 'oklch(0.80 0.16 270)' : 'var(--mf-text-2)',
                    fontWeight: activeFolder === f ? 600 : 400, fontSize: 'var(--mf-t-xs)', transition: 'all var(--mf-fast) var(--mf-ease-out)',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {f === 'default' ? 'Geral' : f}</span>
                  <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', background: 'color-mix(in oklch, var(--mf-bg) 50%, transparent)', borderRadius: 'var(--mf-r-sm)', padding: '1px 5px', flexShrink: 0, marginLeft: 4 }}>{folderCounts[f] || 0}</span>
                </button>
              ))}
              {/* Upload na sidebar */}
              <div className="lib-picker-sidebar-upload" style={{ marginTop: 'auto', padding: '10px 8px', borderTop: '1px solid var(--mf-border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 'var(--mf-r-sm)', cursor: uploading ? 'wait' : 'pointer', background: 'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', color: 'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-micro)', fontWeight: 600 }}>
                  <input type="file" multiple accept="image/*,video/*" hidden onChange={e => uploadFiles(e.target.files)} />
                  {uploading ? '⏳ Enviando...' : '⬆ Upload'}
                </label>
              </div>
            </div>

            {/* Grid de arquivos */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Toolbar de seleção */}
              {!loading && shown.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid var(--mf-border)', flexShrink: 0 }}>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>
                    {shown.length} arquivo{shown.length !== 1 ? 's' : ''}
                    {shownSelected > 0 && (
                      <> · <span style={{ color: 'var(--mf-mod, var(--mf-accent-500))', fontWeight: 700 }}>{shownSelected} sel.</span></>
                    )}
                  </span>
                  <button type="button" onClick={toggleSelectAll}
                    style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer', transition: 'all var(--mf-fast) var(--mf-ease-out)',
                      border: `1px solid ${allShownSel ? 'color-mix(in oklch, var(--mf-danger-500) 30%, transparent)' : 'var(--mf-border)'}`,
                      background: allShownSel ? 'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)' : 'var(--mf-border-subtle)',
                      color: allShownSel ? 'var(--mf-danger-500)' : 'var(--mf-text-2)',
                    }}>
                    {allShownSel ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                </div>
              )}
              <div style={{ flex: 1, overflow: 'auto', padding: 12, position: 'relative', overscrollBehavior: 'contain' }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
              >
                {loading && <div style={{ textAlign: 'center', color: 'var(--mf-text-3)', padding: 40 }}>Carregando...</div>}
                {!loading && shown.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--mf-text-3)', padding: 40 }}>
                    <div style={{ fontSize: 'var(--mf-t-display)', marginBottom: 10 }}>📂</div>
                    <div style={{ fontSize: 'var(--mf-t-sm)' }}>Nenhuma mídia nesta pasta.</div>
                    <div style={{ fontSize: 'var(--mf-t-micro)', marginTop: 6 }}>Use o botão "Upload" para adicionar arquivos.</div>
                  </div>
                )}
                {dragOver && (
                  <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', border: '2px dashed var(--mf-mod, var(--mf-accent-500))', borderRadius: 'var(--mf-r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--mf-t-h2)', color: 'var(--mf-mod, var(--mf-accent-500))', pointerEvents: 'none', zIndex: 10 }}>
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
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid var(--mf-border)', flexShrink: 0 }}>
            <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>
              {files.filter(f => !f.filename?.startsWith('__folder_')).length} mídia(s) na biblioteca
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={{ padding: '7px 16px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--mf-border)', background: 'transparent', color: 'var(--mf-text-3)', cursor: 'pointer', fontSize: 'var(--mf-t-sm)' }}>Cancelar</button>
              <button type="button" onClick={confirm} disabled={selected.size === 0}
                style={{ padding: '7px 20px', borderRadius: 'var(--mf-r-sm)', border: 'none', background: selected.size > 0 ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)', color: selected.size > 0 ? 'var(--mf-bg)' : 'var(--mf-text-3)', cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: 'var(--mf-t-sm)', fontWeight: 700, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
                {selected.size > 0 ? `Adicionar ${selected.size} arquivo(s)` : 'Selecione arquivos'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

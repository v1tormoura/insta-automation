import { useEffect, useState } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

export default function MediaLibrary() {
  const [media, setMedia] = useState([]);
  const [toast, setToast] = useState(null);
  const [uploading, setUploading] = useState(false);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function loadMedia() {
    try { const res = await api.get('/media'); setMedia(res.data); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao carregar biblioteca.'); }
  }

  useEffect(() => { loadMedia(); }, []);

  async function uploadFiles(files) {
    try {
      if (!files.length) return;
      setUploading(true);
      const form = new FormData();
      Array.from(files).forEach(file => form.append('media', file));
      await api.post('/media/upload', form);
      await loadMedia();
      showToast('success', 'Upload concluído', 'Mídias adicionadas à biblioteca.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao enviar mídia.'); }
    finally { setUploading(false); }
  }

  async function deleteMedia(id) {
    try { await api.delete(`/media/${id}`); await loadMedia(); showToast('success', 'Mídia removida', 'Arquivo removido da biblioteca.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao remover mídia.'); }
  }

  function formatSize(size) {
    const v = Number(size || 0);
    if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
    if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${v} B`;
  }

  function mediaUrl(item) { return `http://localhost:3000${item.url}`; }

  const videos = media.filter(i => i.type === 'video').length;
  const images = media.filter(i => i.type === 'image').length;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Arquivos</div>
          <h1>Biblioteca de Mídias</h1>
          <p>Guarde vídeos e imagens para reutilizar nas postagens.</p>
        </div>
        <div className="page-header-right">
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
              onChange={e => uploadFiles(e.target.files || [])} />
            {uploading ? '⏳ Enviando...' : '⬆️ Upload'}
          </label>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', value: media.length, color: '#6366f1' },
          { label: 'Vídeos', value: videos, color: '#8b5cf6' },
          { label: 'Imagens', value: images, color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: -1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Upload zone */}
      <label className="upload-zone" style={{ marginBottom: 20, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
          onChange={e => uploadFiles(e.target.files || [])} />
        <div className="uz-icon">⬆️</div>
        <strong>{uploading ? 'Enviando arquivos...' : 'Arraste ou clique para enviar'}</strong>
        <span>MP4, MOV, JPG, PNG · Múltiplos arquivos suportados</span>
      </label>

      {/* Media grid */}
      {media.length > 0 ? (
        <div className="media-grid">
          {media.map(item => (
            <div className="media-item" key={item._id}>
              <div className="media-thumb">
                {item.type === 'video' ? (
                  <video src={mediaUrl(item)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : item.type === 'image' ? (
                  <img src={mediaUrl(item)} alt={item.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📁</div>
                )}
                <span className={`media-type-badge ${item.type === 'video' ? 'vid' : 'img'}`}>
                  {item.type === 'video' ? 'VID' : 'IMG'}
                </span>
              </div>
              <div className="media-info">
                <strong>{item.originalName}</strong>
                <span>{formatSize(item.size)}</span>
              </div>
              <div style={{ padding: '0 10px 10px' }}>
                <button className="btn btn-danger btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => deleteMedia(item._id)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">Nenhuma mídia salva ainda.</div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

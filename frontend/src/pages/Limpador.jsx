import { useState, useRef } from 'react';
import Toast from '../components/Toast';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const MODES = [
  {
    key: 'limpeza_leve',
    label: 'Limpeza Leve',
    desc: 'Remove metadados básicos. Mais rápido, sem reencoding.',
    badge: 'RÁPIDO',
    badgeColor: '#22c55e',
  },
  {
    key: 'ultra_clean',
    label: 'Ultra Clean',
    desc: 'Limpeza profunda com reencoding completo do arquivo.',
    badge: 'ULTRA',
    badgeColor: 'var(--cyan)',
  },
  {
    key: 'humanizador',
    label: 'Humanizador',
    desc: 'Micro-variações únicas (crop, cor, áudio) + limpeza total.',
    badge: 'MAX',
    badgeColor: '#a78bfa',
  },
];

export default function Limpador() {
  const [file, setFile]         = useState(null);
  const [mode, setMode]         = useState('limpeza_leve');
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast]       = useState(null);
  const fileRef = useRef();

  function showToast(type, title, message) {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 4000);
  }

  function handleFiles(files) {
    const f = files[0];
    if (!f) return;
    if (f.size > 500 * 1024 * 1024) return showToast('error', 'Arquivo grande', 'Tamanho máximo: 500 MB.');
    setFile(f);
  }

  async function process() {
    if (!file) return showToast('warning', 'Atenção', 'Selecione um arquivo primeiro.');
    setLoading(true);
    setProgress('Enviando arquivo...');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', mode);

      const token = localStorage.getItem('token');
      const res = await fetch(`${API}/api/limpador/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao processar' }));
        throw new Error(err.error || 'Erro ao processar arquivo');
      }

      setProgress('Processando...');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `limpo_${file.name}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast('success', 'Concluído!', 'Arquivo processado e baixado com sucesso.');
    } catch (e) {
      showToast('error', 'Erro', e.message || 'Falha ao processar arquivo.');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Conteúdo</div>
          <h1>Limpador de Metadados</h1>
          <p>Remova metadados de vídeos e imagens antes de publicar para evitar rastreamento.</p>
        </div>
      </div>

      <div className="layout-2col">
        {/* Coluna esquerda — upload */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-header"><span>Arquivo</span></div>
            <div className="card-body">
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                style={{
                  display: 'block', padding: '36px 16px', textAlign: 'center',
                  border: `1.5px dashed ${dragOver ? 'var(--cyan)' : 'rgba(0,212,255,.35)'}`,
                  borderRadius: 10, cursor: 'pointer', transition: '.2s',
                  background: dragOver ? 'rgba(0,212,255,.07)' : 'rgba(0,212,255,.02)',
                }}
              >
                <input ref={fileRef} type="file" accept="video/*,image/*" style={{ display: 'none' }}
                  onChange={e => handleFiles(e.target.files)} />

                {file ? (
                  <>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>
                      {file.type.startsWith('video') ? '🎬' : '🖼️'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                    <button onClick={e => { e.preventDefault(); setFile(null); }} style={{
                      background: 'none', border: '1px solid rgba(248,113,113,.4)', color: '#f87171',
                      padding: '4px 14px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    }}>Remover</button>
                  </>
                ) : (
                  <>
                    <div style={{ width: 48, height: 48, borderRadius: 12, margin: '0 auto 12px', background: 'rgba(0,212,255,.08)', display: 'grid', placeItems: 'center' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.8" strokeLinecap="round">
                        <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                        <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                      </svg>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Arraste ou clique para selecionar</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>MP4, MOV, JPG, PNG — máx. 500 MB</div>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Info */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text2)' }}>O que são metadados?</strong><br />
              Informações ocultas embutidas no arquivo: câmera usada, GPS, software de edição, data/hora de criação. O Instagram usa esses dados para identificar conteúdo duplicado.
            </div>
          </div>
        </div>

        {/* Coluna direita — modo + botão */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="card-header"><span>Modo de limpeza</span></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MODES.map(m => (
                <div key={m.key} onClick={() => setMode(m.key)} style={{
                  padding: '13px 14px', borderRadius: 9, cursor: 'pointer', transition: '.15s',
                  border: `1px solid ${mode === m.key ? 'var(--cyan)' : 'var(--border)'}`,
                  background: mode === m.key ? 'rgba(0,212,255,.06)' : 'transparent',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: mode === m.key ? 'var(--cyan)' : 'var(--text)' }}>
                      {m.label}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 99, letterSpacing: .8,
                      background: mode === m.key ? m.badgeColor : 'var(--bg3)',
                      color: mode === m.key ? '#040e1c' : 'var(--text3)',
                    }}>{m.badge}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={process}
            disabled={loading || !file}
            style={{
              height: 52, borderRadius: 9, border: 'none', fontWeight: 750, fontSize: 14,
              cursor: loading || !file ? 'not-allowed' : 'pointer', transition: '.2s',
              background: loading || !file ? 'rgba(0,212,255,.15)' : 'linear-gradient(100deg, var(--cyan), #00b8d9)',
              color: loading || !file ? 'rgba(0,212,255,.4)' : '#040e1c',
              boxShadow: loading || !file ? 'none' : '0 8px 22px rgba(0,212,255,.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56"/>
                </svg>
                {progress || 'Processando...'}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Processar e baixar
              </>
            )}
          </button>

          <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 }}>
            O arquivo processado será baixado automaticamente.<br />
            Vídeos grandes podem demorar alguns minutos.
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const MODES = [
  {
    key: 'limpeza_leve',
    label: 'Limpeza Leve',
    desc: 'Remove metadados básicos. Mais rápido, sem reencoding.',
    badge: 'RÁPIDO',
    badgeColor: '#22c55e',
    badgeBg: 'rgba(34,197,94,.15)',
  },
  {
    key: 'ultra_clean',
    label: 'Ultra Clean',
    desc: 'Limpeza profunda com reencoding completo do arquivo.',
    badge: 'ULTRA',
    badgeColor: 'var(--cyan)',
    badgeBg: 'rgba(0,212,255,.15)',
  },
  {
    key: 'humanizador',
    label: 'Humanizador',
    desc: 'Micro-variações únicas (crop, cor, áudio) + limpeza total.',
    badge: 'MAX',
    badgeColor: '#a78bfa',
    badgeBg: 'rgba(167,139,250,.15)',
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

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  );

  const cardStyle = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell
        icon={pageIcon}
        title="Limpador de Metadados"
        subtitle="Remova metadados de vídeos e imagens antes de publicar"
        accent="orange"
      >
        <div className="layout-2col">
          {/* Coluna esquerda — upload */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25 }} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={cardStyle}>
              <div style={{ display:'flex', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
                <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Arquivo</h3>
              </div>
              <div style={{ padding:14 }}>
                <label
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                  style={{
                    display:'block', padding:'36px 16px', textAlign:'center',
                    border:`1.5px dashed ${dragOver ? 'var(--cyan)' : 'oklch(0.72 0.19 196 / 0.3)'}`,
                    borderRadius:10, cursor:'pointer', transition:'.2s',
                    background: dragOver ? 'rgba(0,212,255,.07)' : 'rgba(0,212,255,.02)',
                  }}
                >
                  <input ref={fileRef} type="file" accept="video/*,image/*" style={{ display:'none' }}
                    onChange={e => handleFiles(e.target.files)} />

                  {file ? (
                    <>
                      <div style={{ fontSize:40, marginBottom:8 }}>
                        {file.type.startsWith('video') ? '🎬' : '🖼️'}
                      </div>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:4 }}>{file.name}</div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:12, fontFamily:'var(--font-mono)' }}>
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </div>
                      <button onClick={e => { e.preventDefault(); setFile(null); }} style={{
                        background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.3)', color:'#f87171',
                        padding:'4px 14px', borderRadius:6, fontSize:11, cursor:'pointer',
                      }}>Remover</button>
                    </>
                  ) : (
                    <>
                      <div style={{ width:48, height:48, borderRadius:12, margin:'0 auto 12px', background:'rgba(0,212,255,.08)', display:'grid', placeItems:'center' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.8" strokeLinecap="round">
                          <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                          <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                        </svg>
                      </div>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:4 }}>Arraste ou clique para selecionar</div>
                      <div style={{ fontSize:11, color:'var(--text3)' }}>MP4, MOV, JPG, PNG — máx. 500 MB</div>
                    </>
                  )}
                </label>
              </div>
            </div>

            {/* Info */}
            <div style={{ ...cardStyle, padding:16 }}>
              <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
                <strong style={{ color:'var(--text2)' }}>O que são metadados?</strong><br />
                Informações ocultas embutidas no arquivo: câmera usada, GPS, software de edição, data/hora de criação. O Instagram usa esses dados para identificar conteúdo duplicado.
              </div>
            </div>
          </motion.div>

          {/* Coluna direita — modo + botão */}
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={cardStyle}>
              <div style={{ display:'flex', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
                <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Modo de limpeza</h3>
              </div>
              <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
                {MODES.map(m => (
                  <div key={m.key} onClick={() => setMode(m.key)} style={{
                    padding:'13px 14px', borderRadius:9, cursor:'pointer', transition:'.15s',
                    border:`1px solid ${mode === m.key ? 'oklch(0.72 0.19 196 / 0.4)' : 'oklch(1 0 0 / 0.06)'}`,
                    background: mode === m.key ? 'rgba(0,212,255,.05)' : 'oklch(0.12 0.04 235 / 0.4)',
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                      <span style={{ fontSize:13, fontWeight:700, color: mode === m.key ? 'var(--cyan)' : 'var(--text)' }}>
                        {m.label}
                      </span>
                      <span style={{
                        fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, letterSpacing:.8,
                        background: mode === m.key ? m.badgeBg : 'oklch(0.10 0.03 235 / 0.5)',
                        color: mode === m.key ? m.badgeColor : 'var(--text3)',
                        border:`1px solid ${mode === m.key ? m.badgeColor + '33' : 'transparent'}`,
                      }}>{m.badge}</span>
                    </div>
                    <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.4 }}>{m.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={process}
              disabled={loading || !file}
              style={{
                height:52, borderRadius:9, border:'none', fontWeight:750, fontSize:14,
                cursor: loading || !file ? 'not-allowed' : 'pointer', transition:'.2s',
                background: loading || !file ? 'rgba(0,212,255,.1)' : 'linear-gradient(100deg, var(--cyan), #00b8d9)',
                color: loading || !file ? 'rgba(0,212,255,.35)' : '#040e1c',
                boxShadow: loading || !file ? 'none' : '0 8px 22px rgba(0,212,255,.22)',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              }}
            >
              {loading ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'spin 1s linear infinite' }}>
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

            <div style={{ fontSize:10, color:'var(--text3)', textAlign:'center', lineHeight:1.6 }}>
              O arquivo processado será baixado automaticamente.<br />
              Vídeos grandes podem demorar alguns minutos.
            </div>
          </motion.div>
        </div>
      </PageShell>
    </>
  );
}

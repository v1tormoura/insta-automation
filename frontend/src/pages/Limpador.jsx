import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import api from '../services/api';
import PageShell from '../components/PageShell';

const MODES = [
  {
    key: 'limpeza_leve',
    label: 'Limpeza Leve',
    desc: 'Remove metadados básicos. Mais rápido, sem reencoding.',
    badge: 'RÁPIDO',
    badgeColor: '#22c55e',
    badgeBg: 'rgba(34,197,94,.15)',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
  },
  {
    key: 'ultra_clean',
    label: 'Ultra Clean',
    desc: 'Limpeza profunda com reencoding completo do arquivo.',
    badge: 'ULTRA',
    badgeColor: 'var(--cyan)',
    badgeBg: 'rgba(0,212,255,.15)',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
  },
  {
    key: 'humanizador',
    label: 'Humanizador',
    desc: 'Micro-variações únicas (crop, cor, áudio) + limpeza total.',
    badge: 'MAX',
    badgeColor: '#a78bfa',
    badgeBg: 'rgba(167,139,250,.15)',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
];

const TIPS = [
  { icon: '🕵️', text: 'O Instagram analisa metadados para detectar reuploads e conteúdo duplicado.' },
  { icon: '📍', text: 'GPS, câmera usada, data de criação — tudo visível sem limpeza.' },
  { icon: '🔄', text: 'O modo Humanizador gera um arquivo tecnicamente único, ideal para múltiplas contas.' },
];

export default function Limpador() {
  const [file,      setFile]      = useState(null);
  const [mode,      setMode]      = useState('limpeza_leve');
  const [loading,   setLoading]   = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [phase,     setPhase]     = useState(''); // '' | 'upload' | 'processing'
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef = useRef();

  function handleFiles(files) {
    const f = files[0];
    if (!f) return;
    if (f.size > 500 * 1024 * 1024) return toast.error('Arquivo muito grande. Máximo: 500 MB.');
    if (!f.type.startsWith('video/') && !f.type.startsWith('image/')) {
      return toast.error('Tipo não suportado. Envie vídeos ou imagens.');
    }
    setFile(f);
  }

  async function process() {
    if (!file) return toast.warning('Selecione um arquivo primeiro.');
    setLoading(true);
    setUploadPct(0);
    setPhase('upload');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', mode);

      const res = await api.post('/api/limpador/process', form, {
        responseType: 'blob',
        onUploadProgress: e => {
          const pct = e.total ? Math.round(e.loaded * 100 / e.total) : 0;
          setUploadPct(pct);
          if (pct >= 100) setPhase('processing');
        },
      });

      const blob = res.data;
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `limpo_${file.name}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success('Arquivo processado e baixado com sucesso!');
      setFile(null);
    } catch (e) {
      let msg = e.message || 'Falha ao processar arquivo.';
      if (e.response?.data instanceof Blob) {
        try { const j = JSON.parse(await e.response.data.text()); msg = j.error || msg; } catch {}
      }
      toast.error(msg);
    } finally {
      setLoading(false);
      setUploadPct(0);
      setPhase('');
    }
  }

  const selectedMode = MODES.find(m => m.key === mode);

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );

  const cardStyle = {
    background: 'oklch(0.16 0.05 235 / 0.85)',
    border: '1px solid oklch(1 0 0 / 0.07)',
    borderRadius: 14,
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
  };

  const fileSize = file ? (file.size / 1024 / 1024).toFixed(1) : null;
  const isVideo  = file?.type.startsWith('video/');
  const isImage  = file?.type.startsWith('image/');

  return (
    <PageShell
      icon={pageIcon}
      title="Limpador de Metadados"
      subtitle="Remove fingerprints e torna cada arquivo único para repostar sem detecção"
      accent="purple"
    >
      <style>{`
        @keyframes limpador-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @keyframes limpador-spin { to { transform: rotate(360deg); } }
        @keyframes limpador-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>

      <div className="layout-2col">
        {/* ── Coluna esquerda: upload + info ── */}
        <motion.div
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0 }}
          transition={{ duration:.25 }}
          style={{ display:'flex', flexDirection:'column', gap:12 }}
        >
          {/* Drop zone */}
          <div style={cardStyle}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
              <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Arquivo de entrada</h3>
              {file && (
                <button onClick={() => setFile(null)} style={{ fontSize:11, color:'#f87171', background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.2)', borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>
                  Remover
                </button>
              )}
            </div>
            <div style={{ padding:14 }}>
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                style={{
                  display:'block', padding: file ? '20px 16px' : '40px 16px',
                  textAlign:'center',
                  border:`1.5px dashed ${dragOver ? 'var(--cyan)' : file ? '#a78bfa44' : 'oklch(0.72 0.19 196 / 0.25)'}`,
                  borderRadius:10, cursor:'pointer', transition:'.2s',
                  background: dragOver ? 'rgba(0,212,255,.06)' : file ? 'rgba(167,139,250,.04)' : 'rgba(0,212,255,.02)',
                }}
              >
                <input ref={fileRef} type="file" accept="video/*,image/*" style={{ display:'none' }}
                  onChange={e => handleFiles(e.target.files)} />

                {file ? (
                  <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                    {/* File type icon */}
                    <div style={{ flexShrink:0, width:52, height:52, borderRadius:12, background: isVideo ? 'rgba(167,139,250,.12)' : 'rgba(0,212,255,.1)', display:'grid', placeItems:'center' }}>
                      {isVideo ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                        </svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                        </svg>
                      )}
                    </div>
                    {/* File info */}
                    <div style={{ flex:1, textAlign:'left', minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{file.name}</div>
                      <div style={{ display:'flex', gap:10, marginTop:4 }}>
                        <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>{fileSize} MB</span>
                        <span style={{ fontSize:11, color: isVideo ? '#a78bfa' : 'var(--cyan)', fontWeight:600 }}>
                          {isVideo ? 'VÍDEO' : 'IMAGEM'}
                        </span>
                      </div>
                      <div style={{ marginTop:6, fontSize:10, color:'#22c55e', fontWeight:600 }}>✓ Pronto para limpar</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ width:48, height:48, borderRadius:14, margin:'0 auto 14px', background:'rgba(0,212,255,.08)', display:'grid', placeItems:'center', border:'1px solid rgba(0,212,255,.15)' }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.8" strokeLinecap="round">
                        <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                        <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                      </svg>
                    </div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:5 }}>Arraste ou clique para selecionar</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>MP4 · MOV · JPG · PNG · WebM — máx. 500 MB</div>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Tips */}
          <div style={{ ...cardStyle, padding:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>Por que limpar?</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {TIPS.map((tip, i) => (
                <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontSize:14, flexShrink:0 }}>{tip.icon}</span>
                  <span style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>{tip.text}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Coluna direita: modo + ação ── */}
        <motion.div
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0 }}
          transition={{ duration:.25, delay:.06 }}
          style={{ display:'flex', flexDirection:'column', gap:12 }}
        >
          {/* Mode selector */}
          <div style={cardStyle}>
            <div style={{ display:'flex', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
              <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Modo de limpeza</h3>
            </div>
            <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
              {MODES.map(m => {
                const sel = mode === m.key;
                return (
                  <div key={m.key} onClick={() => setMode(m.key)} style={{
                    padding:'14px 16px', borderRadius:10, cursor:'pointer', transition:'.15s',
                    border:`1.5px solid ${sel ? m.badgeColor + '66' : 'oklch(1 0 0 / 0.06)'}`,
                    background: sel ? m.badgeBg : 'oklch(0.12 0.04 235 / 0.4)',
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ color: sel ? m.badgeColor : 'var(--text3)' }}>{m.icon}</span>
                        <span style={{ fontSize:13, fontWeight:700, color: sel ? m.badgeColor : 'var(--text)' }}>{m.label}</span>
                      </div>
                      <span style={{
                        fontSize:9, fontWeight:800, padding:'2px 9px', borderRadius:99, letterSpacing:.8,
                        background: sel ? m.badgeBg : 'oklch(0.10 0.03 235 / 0.5)',
                        color: sel ? m.badgeColor : 'var(--text3)',
                        border:`1px solid ${sel ? m.badgeColor + '40' : 'transparent'}`,
                      }}>{m.badge}</span>
                    </div>
                    <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.4 }}>{m.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Process button */}
          <button
            onClick={process}
            disabled={loading || !file}
            style={{
              height:52, borderRadius:10, border:'none', fontWeight:750, fontSize:14,
              cursor: loading || !file ? 'not-allowed' : 'pointer', transition:'.2s',
              background: loading || !file
                ? 'rgba(167,139,250,.08)'
                : 'linear-gradient(120deg, #7c3aed, #a78bfa)',
              color: loading || !file ? 'rgba(167,139,250,.3)' : '#fff',
              boxShadow: loading || !file ? 'none' : '0 8px 24px rgba(167,139,250,.3)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            }}
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'limpador-spin 1s linear infinite', flexShrink:0 }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56"/>
                </svg>
                {phase === 'processing' ? 'Processando com FFmpeg...' : `Enviando... ${uploadPct}%`}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                Processar e baixar
              </>
            )}
          </button>

          {/* Progress bar */}
          {loading && (
            <div style={{ background:'oklch(0.12 0.04 235 / 0.6)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:10, padding:'12px 14px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                <span style={{ fontSize:11, color:'var(--text3)', fontWeight:600 }}>
                  {phase === 'processing' ? '⚙ FFmpeg processando...' : '↑ Enviando arquivo ao servidor'}
                </span>
                {phase === 'upload' && (
                  <span style={{ fontSize:11, fontWeight:800, color:'#a78bfa', fontFamily:'var(--font-mono)' }}>{uploadPct}%</span>
                )}
              </div>
              {/* Track */}
              <div style={{ height:4, borderRadius:99, background:'oklch(0.10 0.03 235 / 0.6)', overflow:'hidden', position:'relative' }}>
                {phase === 'upload' ? (
                  <div style={{ height:'100%', width:`${uploadPct}%`, background:'linear-gradient(90deg, #7c3aed, #a78bfa)', borderRadius:99, transition:'width .3s ease' }} />
                ) : (
                  /* indeterminate shimmer */
                  <div style={{ height:'100%', background:'linear-gradient(90deg, #7c3aed, #a78bfa, #7c3aed)', backgroundSize:'200% 100%', animation:'limpador-shimmer 1.4s linear infinite', borderRadius:99, position:'absolute', inset:0 }} />
                )}
              </div>
              {phase === 'processing' && (
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:6, animation:'limpador-pulse 1.5s infinite' }}>
                  Aguarde — arquivos grandes podem demorar alguns minutos...
                </div>
              )}
            </div>
          )}

          {/* Hint */}
          {!loading && (
            <div style={{ fontSize:11, color:'var(--text3)', textAlign:'center', lineHeight:1.7 }}>
              O arquivo processado é baixado automaticamente.<br />
              Modo {selectedMode?.label}: {selectedMode?.desc}
            </div>
          )}
        </motion.div>
      </div>
    </PageShell>
  );
}

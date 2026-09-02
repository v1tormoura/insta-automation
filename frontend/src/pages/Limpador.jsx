import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../services/api';
import PageShell from '../components/PageShell';

const MODES = [
  {
    key: 'limpeza_leve',
    label: 'Limpeza Leve',
    desc: 'Remove metadados + reencoding em 1080×1920. Mais rápido.',
    badge: 'RÁPIDO',
    badgeColor: 'var(--mf-success-500)',
    badgeBg: 'color-mix(in oklch, var(--mf-success-500) 15%, transparent)',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
  },
  {
    key: 'ultra_clean',
    label: 'Ultra Clean',
    desc: 'Reencoding + micro-variação de brilho por pixel. Hash único.',
    badge: 'ULTRA',
    badgeColor: 'var(--mf-mod, var(--mf-accent-500))',
    badgeBg: 'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)',
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
    badgeColor: 'var(--mf-mod-publicar)',
    badgeBg: 'color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    key: 'watermark',
    label: 'Remover Marca D\'água',
    desc: 'Detecta automaticamente e remove logo/watermark estático. Saída em 1080×1920.',
    badge: 'AUTO',
    badgeColor: 'var(--mf-warning-500)',
    badgeBg: 'color-mix(in oklch, var(--mf-warning-500) 15%, transparent)',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    ),
  },
];

const TIPS = [
  { icon: '🕵️', text: 'O Instagram analisa metadados para detectar reuploads e conteúdo duplicado.' },
  { icon: '📍', text: 'GPS, câmera usada, data de criação — tudo visível sem limpeza.' },
  { icon: '🔄', text: 'O modo Humanizador gera um arquivo tecnicamente único, ideal para múltiplas contas.' },
];

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// estado por arquivo: 'waiting' | 'uploading' | 'processing' | 'done' | 'error'
function makeItem(f) {
  return { id: `${f.name}-${f.size}-${Date.now()}`, file: f, status: 'waiting', pct: 0, error: null };
}

const WM_PRESETS = [
  { key: 'auto',      label: 'Auto',      desc: 'Detecta automaticamente' },
  { key: 'kwai',      label: 'Kwai',      desc: 'Username + logo (baixo)' },
  { key: 'tiktok',    label: 'TikTok',    desc: 'Username + info (baixo-esq)' },
  { key: 'instagram', label: 'Instagram', desc: 'Barra inferior' },
  { key: 'youtube',   label: 'YouTube',   desc: 'Logo (topo-esq)' },
  { key: 'corner_tl', label: '↖ Canto',  desc: 'Topo esquerda' },
  { key: 'corner_tr', label: '↗ Canto',  desc: 'Topo direita' },
  { key: 'corner_bl', label: '↙ Canto',  desc: 'Baixo esquerda' },
  { key: 'corner_br', label: '↘ Canto',  desc: 'Baixo direita' },
];

export default function Limpador() {
  const [items,    setItems]    = useState([]);   // [{ id, file, status, pct, error }]
  const [mode,     setMode]     = useState('limpeza_leve');
  const [wmPreset, setWmPreset] = useState('auto');
  const [running,  setRunning]  = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  function updateItem(id, patch) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  }

  function addFiles(fileList) {
    const list = Array.from(fileList);
    const valid = [];
    for (const f of list) {
      if (f.size > 500 * 1024 * 1024) { toast.error(`${f.name}: máximo 500 MB.`); continue; }
      if (!f.type.startsWith('video/') && !f.type.startsWith('image/')) {
        toast.error(`${f.name}: tipo não suportado.`); continue;
      }
      valid.push(makeItem(f));
    }
    if (valid.length) setItems(prev => [...prev, ...valid]);
  }

  function removeItem(id) {
    setItems(prev => prev.filter(it => it.id !== id));
  }

  function clearDone() {
    setItems(prev => prev.filter(it => it.status !== 'done' && it.status !== 'error'));
  }

  async function processOne(item) {
    updateItem(item.id, { status: 'uploading', pct: 0, error: null });
    try {
      const form = new FormData();
      form.append('file', item.file);
      form.append('mode', mode);
      if (mode === 'watermark') form.append('preset', wmPreset);

      const res = await api.post('/api/limpador/process', form, {
        responseType: 'blob',
        onUploadProgress: e => {
          const pct = e.total ? Math.round(e.loaded * 100 / e.total) : 0;
          updateItem(item.id, { pct, status: pct >= 100 ? 'processing' : 'uploading' });
        },
      });

      const prefix   = mode === 'watermark' ? 'sem_marca' : 'limpo';
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${prefix}_${item.file.name}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      updateItem(item.id, { status: 'done', pct: 100 });
    } catch (e) {
      let msg = e.message || 'Erro ao processar.';
      if (e.response?.data instanceof Blob) {
        try { const j = JSON.parse(await e.response.data.text()); msg = j.error || msg; } catch {}
      }
      updateItem(item.id, { status: 'error', error: msg });
    }
  }

  async function processAll() {
    const waiting = items.filter(it => it.status === 'waiting' || it.status === 'error');
    if (!waiting.length) return toast.warning('Nenhum arquivo na fila.');
    setRunning(true);
    for (const item of waiting) {
      await processOne(item);
    }
    setRunning(false);
    toast.success('Fila concluída!');
  }

  const selectedMode = MODES.find(m => m.key === mode);
  const hasPending   = items.some(it => it.status === 'waiting' || it.status === 'error');
  const hasDone      = items.some(it => it.status === 'done' || it.status === 'error');

  const cardStyle = {
    background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)',
    border: '1px solid var(--mf-border)',
    borderRadius: 'var(--mf-r-lg)',
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
  };

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );

  return (
    <PageShell
      icon={pageIcon}
      title="Limpador de Metadados"
      subtitle="Remove fingerprints e torna cada arquivo único para repostar sem detecção"
      accent="purple"
    >
      <style>{`
        @keyframes limpador-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(300%)} }
        @keyframes limpador-spin    { to{transform:rotate(360deg)} }
        @keyframes limpador-pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>

      <div className="layout-2col">
        {/* ── Coluna esquerda: upload + fila ── */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25 }}
          style={{ display:'flex', flexDirection:'column', gap:12 }}>

          {/* Drop zone */}
          <div style={cardStyle}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>
                Arquivos de entrada
                {items.length > 0 && (
                  <span style={{ marginLeft:8, fontSize: 'var(--mf-t-micro)', fontWeight:600, color:'var(--mf-mod, var(--mf-accent-500))', background:'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'2px 8px' }}>
                    {items.length}
                  </span>
                )}
              </h3>
              {hasDone && !running && (
                <button onClick={clearDone} style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)', padding:'2px 8px', cursor:'pointer' }}>
                  Limpar concluídos
                </button>
              )}
            </div>

            {/* Dropzone clickable */}
            <div style={{ padding:14 }}>
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                style={{
                  display:'block', padding:'24px 16px', textAlign:'center',
                  border:`1.5px dashed ${dragOver ? 'var(--mf-mod, var(--mf-accent-500))' : 'color-mix(in oklch, var(--mf-primary-500) 25%, transparent)'}`,
                  borderRadius: 'var(--mf-r-md)', cursor:'pointer', transition:'.2s',
                  background: dragOver ? 'color-mix(in oklch, var(--mf-mod-contas) 6%, transparent)' : 'color-mix(in oklch, var(--mf-mod-contas) 2%, transparent)',
                }}
              >
                <input ref={fileRef} type="file" accept="video/*,image/*" multiple style={{ display:'none' }}
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                <div style={{ width:44, height:44, borderRadius: 'var(--mf-r-md)', margin:'0 auto 12px', background:'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)', display:'grid', placeItems:'center', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth="1.8" strokeLinecap="round">
                    <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                  </svg>
                </div>
                <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:600, color:'var(--mf-text)', marginBottom:4 }}>
                  Arraste ou clique para selecionar
                </div>
                <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
                  Vários arquivos de uma vez — MP4 · MOV · JPG · PNG · WebM · máx. 500 MB cada
                </div>
              </label>
            </div>
          </div>

          {/* Lista de arquivos na fila */}
          {items.length > 0 && (
            <div style={cardStyle}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Fila de processamento</h3>
                <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)' }}>
                  {items.filter(i => i.status === 'done').length}/{items.length} prontos
                </span>
              </div>
              <div style={{ maxHeight:320, overflowY:'auto', padding:'8px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                <AnimatePresence initial={false}>
                  {items.map(item => (
                    <motion.div key={item.id}
                      initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}
                      transition={{ duration:.15 }}
                    >
                      <FileRow item={item} running={running} mode={mode} onRemove={() => removeItem(item.id)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Tips */}
          <div style={{ ...cardStyle, padding:16 }}>
            <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>Por que limpar?</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {TIPS.map((tip, i) => (
                <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontSize: 'var(--mf-t-body)', flexShrink:0 }}>{tip.icon}</span>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', lineHeight:1.6 }}>{tip.text}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Coluna direita: modo + ação ── */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.06 }}
          style={{ display:'flex', flexDirection:'column', gap:12 }}>

          {/* Mode selector */}
          <div style={cardStyle}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--mf-border)' }}>
              <h3 style={{ fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-text)', margin:0 }}>Modo de limpeza</h3>
            </div>
            <div style={{ padding:'12px 12px', display:'flex', flexDirection:'column', gap:8 }}>
              {MODES.map(m => {
                const sel = mode === m.key;
                return (
                  <div key={m.key} onClick={() => !running && setMode(m.key)} style={{
                    padding:'12px 16px', borderRadius: 'var(--mf-r-md)', cursor: running ? 'default' : 'pointer', transition:'.15s',
                    border:`1.5px solid ${sel ? m.badgeColor + '66' : 'var(--mf-border)'}`,
                    background: sel ? m.badgeBg : 'color-mix(in oklch, var(--mf-bg) 40%, transparent)',
                    opacity: running && !sel ? 0.5 : 1,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ color: sel ? m.badgeColor : 'var(--mf-text-3)' }}>{m.icon}</span>
                        <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color: sel ? m.badgeColor : 'var(--mf-text)' }}>{m.label}</span>
                      </div>
                      <span style={{
                        fontSize: 'var(--mf-t-nano)', fontWeight:800, padding:'2px 8px', borderRadius: 'var(--mf-r-full)', letterSpacing:.8,
                        background: sel ? m.badgeBg : 'color-mix(in oklch, var(--mf-bg) 50%, transparent)',
                        color: sel ? m.badgeColor : 'var(--mf-text-3)',
                        border:`1px solid ${sel ? m.badgeColor + '40' : 'transparent'}`,
                      }}>{m.badge}</span>
                    </div>
                    <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', lineHeight:1.4 }}>{m.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Botão processar */}
          <button
            onClick={processAll}
            disabled={running || !hasPending}
            style={{
              height:52, borderRadius: 'var(--mf-r-md)', border:'none', fontWeight:750, fontSize: 'var(--mf-t-body)',
              cursor: running || !hasPending ? 'not-allowed' : 'pointer', transition:'.2s',
              background: running || !hasPending
                ? 'color-mix(in oklch, var(--mf-mod-publicar) 8%, transparent)'
                : 'linear-gradient(120deg, var(--mf-primary-500), var(--mf-mod-publicar))',
              color: running || !hasPending ? 'color-mix(in oklch, var(--mf-mod-publicar) 30%, transparent)' : 'var(--mf-text)',
              boxShadow: running || !hasPending ? 'none' : '0 8px 24px color-mix(in oklch, var(--mf-mod-publicar) 30%, transparent)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            }}
          >
            {running ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'limpador-spin 1s linear infinite', flexShrink:0 }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56"/>
                </svg>
                Processando fila...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                {items.length > 1
                  ? `Processar ${items.filter(i => i.status === 'waiting' || i.status === 'error').length} arquivo(s)`
                  : 'Processar e baixar'}
              </>
            )}
          </button>

          {/* Seletor de preset — aparece só no modo watermark */}
          {mode === 'watermark' && (
            <div style={{ background:'color-mix(in oklch, var(--mf-surface-1) 80%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', overflow:'hidden' }}>
              <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--mf-border)', fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-3)', textTransform:'uppercase', letterSpacing:'.06em' }}>
                Plataforma / Posição
              </div>
              <div style={{ padding:'8px 12px', display:'flex', flexWrap:'wrap', gap:6 }}>
                {WM_PRESETS.map(p => {
                  const sel = wmPreset === p.key;
                  return (
                    <button key={p.key}
                      onClick={() => !running && setWmPreset(p.key)}
                      title={p.desc}
                      style={{
                        fontSize: 'var(--mf-t-micro)', fontWeight:700, padding:'4px 12px', borderRadius: 'var(--mf-r-sm)', cursor: running ? 'default' : 'pointer',
                        border:`1.5px solid ${sel ? 'color-mix(in oklch, var(--mf-warning-500) 60%, transparent)' : 'var(--mf-border)'}`,
                        background: sel ? 'color-mix(in oklch, var(--mf-warning-500) 15%, transparent)' : 'color-mix(in oklch, var(--mf-bg) 50%, transparent)',
                        color: sel ? 'var(--mf-warning-500)' : 'var(--mf-text-3)',
                        transition:'.15s',
                      }}
                    >{p.label}</button>
                  );
                })}
              </div>
              {wmPreset === 'auto' && (
                <div style={{ padding:'8px 12px', borderTop:'1px solid var(--mf-border)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', lineHeight:1.5 }}>
                  Auto analisa 3 frames e detecta a região mais estática. Falha em vídeos estáticos — selecione a plataforma acima.
                </div>
              )}
            </div>
          )}

          {/* Info modo */}
          {!running && mode !== 'watermark' && (
            <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', textAlign:'center', lineHeight:1.7 }}>
              Os arquivos são processados um a um e baixados automaticamente.<br />
              Modo {selectedMode?.label}: {selectedMode?.desc}
            </div>
          )}

          {/* Progresso geral enquanto processa */}
          {running && (
            <div style={{ background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:'12px 12px' }}>
              <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginBottom:6, fontWeight:600 }}>
                ⚙ Processando — os downloads iniciam automaticamente
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', animation:'limpador-pulse 1.5s infinite' }}>
                Aguarde — cada arquivo é enviado, processado com FFmpeg e baixado em sequência.
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </PageShell>
  );
}

/* ── Linha de arquivo na fila ── */
function FileRow({ item, running, mode, onRemove }) {
  const { file, status, pct, error } = item;
  const isVideo = file.type.startsWith('video/');

  const statusColor = {
    waiting:    'var(--mf-text-3)',
    uploading:  'var(--mf-mod, var(--mf-accent-500))',
    processing: mode === 'watermark' ? 'var(--mf-warning-500)' : 'var(--mf-mod-publicar)',
    done:       'var(--mf-success-500)',
    error:      'var(--mf-danger-500)',
  }[status];

  const processingLabel = mode === 'watermark' ? 'Detectando e removendo...' : 'Processando...';

  const statusLabel = {
    waiting:    'Aguardando',
    uploading:  `Enviando ${pct}%`,
    processing: processingLabel,
    done:       'Concluído ✓',
    error:      'Erro',
  }[status];

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10, padding:'8px 8px', borderRadius: 'var(--mf-r-md)',
      background:'color-mix(in oklch, var(--mf-bg) 50%, transparent)',
      border:`1px solid ${status === 'done' ? 'color-mix(in oklch, var(--mf-success-500) 20%, transparent)' : status === 'error' ? 'color-mix(in oklch, var(--mf-danger-500) 20%, transparent)' : 'var(--mf-border)'}`,
    }}>
      {/* Type icon */}
      <div style={{ width:30, height:30, borderRadius: 'var(--mf-r-sm)', flexShrink:0, display:'grid', placeItems:'center',
        background: isVideo ? 'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)' : 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)' }}>
        {isVideo ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod-publicar)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
        )}
      </div>

      {/* Info + progress */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
          <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600, color:'var(--mf-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
            {file.name}
          </span>
          <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, color:statusColor, flexShrink:0, whiteSpace:'nowrap' }}>
            {statusLabel}
          </span>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
          <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', fontFamily:'var(--mf-mono)', flexShrink:0 }}>
            {fmtSize(file.size)}
          </span>

          {/* Progress bar */}
          {(status === 'uploading' || status === 'processing') && (
            <div style={{ flex:1, height:3, borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-bg) 60%, transparent)', overflow:'hidden', position:'relative' }}>
              {status === 'uploading' ? (
                <div style={{ height:'100%', width:`${pct}%`, background:'linear-gradient(90deg,var(--mf-primary-500),var(--mf-mod-publicar))', borderRadius: 'var(--mf-r-full)', transition:'width .3s' }} />
              ) : (
                <div style={{ height:'100%', background:'linear-gradient(90deg,var(--mf-primary-500),var(--mf-mod-publicar),var(--mf-primary-500))', backgroundSize:'200% 100%', animation:'limpador-shimmer 1.2s linear infinite', position:'absolute', inset:0 }} />
              )}
            </div>
          )}

          {status === 'done' && (
            <div style={{ flex:1, height:3, borderRadius: 'var(--mf-r-full)', background:'color-mix(in oklch, var(--mf-success-500) 30%, transparent)' }} />
          )}

          {status === 'error' && error && (
            <span style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-danger-500)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={error}>
              {error}
            </span>
          )}
        </div>
      </div>

      {/* Remove button */}
      {!running && status !== 'uploading' && status !== 'processing' && (
        <button onClick={onRemove} style={{ flexShrink:0, width:22, height:22, borderRadius: 'var(--mf-r-sm)', background:'transparent', border:'1px solid var(--mf-border)', cursor:'pointer', display:'grid', placeItems:'center', color:'var(--mf-text-3)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  );
}

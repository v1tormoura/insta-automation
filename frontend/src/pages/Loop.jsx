import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Plus, Pause, Play, Trash2, Clock, Film,
  History, AlertTriangle, CheckCircle, X,
  Upload,
} from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import PageShell from '../components/PageShell';
import './Loop.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  return `${Math.floor(s / 3600)}h atrás`;
}
function timeUntil(date) {
  if (!date) return '—';
  const s = Math.floor((new Date(date) - Date.now()) / 1000);
  if (s <= 0) return 'agora';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}

/* ──────────────────── Loop Card ──────────────────── */
function LoopCard({ loop, onToggle, onDelete, onHistory }) {
  const running = loop.status === 'ativo';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`lc ${running ? 'lc--on' : 'lc--off'}`}
    >
      <div className="lc-head">
        <span className={`lc-dot ${running ? 'on' : 'off'}`} />
        <span className="lc-name">{loop.name || `Loop #${loop._id?.slice(-4)}`}</span>
        <div className="lc-btns">
          <button onClick={() => onHistory(loop)}><History size={13} /></button>
          <button onClick={() => onToggle(loop)} className={running ? 'warn' : 'ok'}>
            {running ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button onClick={() => onDelete(loop)} className="del"><Trash2 size={13} /></button>
        </div>
      </div>

      <p className="lc-sub">{loop.type} · {loop.mediaFiles?.length || 0} mídias</p>

      <div className="lc-stats">
        <div><span>INTERVALO</span><b>{loop.intervalMinutes}m</b></div>
        <div><span>PUBLICADOS</span><b>{loop.postsCount || 0}</b></div>
        <div><span>PRÓXIMO</span><b>{running ? timeUntil(loop.nextRunAt) : '—'}</b></div>
      </div>

      {loop.lastError && (
        <div className="lc-err"><AlertTriangle size={11} />{loop.lastError}</div>
      )}
      <div className="lc-foot"><Clock size={11} /> {timeAgo(loop.lastRunAt)}</div>
    </motion.div>
  );
}

/* ──────────────────── Modal ──────────────────── */
function LoopModal({ onClose, onCreated }) {
  const [accounts,      setAccounts]      = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [legends,       setLegends]       = useState([]);
  const [uploading,     setUploading]     = useState(false);
  const [uploadingCover,setUploadingCover]= useState(false);
  const [dragOver,      setDragOver]      = useState(false);
  const [dragOverCover, setDragOverCover] = useState(false);
  const [legendOpen,    setLegendOpen]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState('');
  const fileInputRef  = useRef();
  const coverInputRef = useRef();
  const legendRef     = useRef();

  const [form, setForm] = useState({
    name: '', accounts: [], mediaFiles: [],
    type: 'reel', intervalMinutes: '', caption: '', coverFile: '', ctaComment: '', engageComment: '',
  });

  useEffect(() => {
    api.get('/accounts').then(r => setAccounts(r.data?.accounts || r.data || [])).catch(() => {});
    api.get('/legends').then(r => setLegends(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!legendOpen) return;
    const close = e => { if (legendRef.current && !legendRef.current.contains(e.target)) setLegendOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [legendOpen]);

  const tog = (key, val) => setForm(f => ({
    ...f,
    [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val],
  }));

  async function handleUpload(files, isCover = false) {
    if (!files?.length) return;
    if (isCover) setUploadingCover(true); else setUploading(true);
    setErr('');
    const fileArr = Array.from(files);
    try {
      if (isCover) {
        // capa: envia arquivo único
        const fd = new FormData();
        fd.append('file', fileArr[0]);
        const res = await api.post('/loops/upload-media', fd);
        const newFiles = res.data.files || [];
        if (newFiles.length > 0) setForm(f => ({ ...f, coverFile: newFiles[newFiles.length - 1].filename }));
      } else {
        // reels: envia um por vez, adiciona na lista conforme vai subindo
        for (const file of fileArr) {
          try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post('/loops/upload-media', fd);
            const newFiles = res.data.files || [];
            if (newFiles.length > 0) {
              setUploadedFiles(prev => [...prev, ...newFiles]);
              setForm(f => ({ ...f, mediaFiles: [...new Set([...f.mediaFiles, ...newFiles.map(x => x.filename)])] }));
            }
          } catch (ex) {
            const status = ex.response?.status;
            const data   = ex.response?.data;
            const msg    = data?.error
              || (typeof data === 'string' ? data.slice(0, 120) : null)
              || ex.message
              || 'sem resposta do servidor';
            setErr(`[${status ?? 'network'}] ${msg}`);
          }
        }
      }
    } finally {
      if (isCover) setUploadingCover(false); else setUploading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.accounts.length) return setErr('Selecione ao menos uma conta.');
    if (!form.mediaFiles.length) return setErr('Envie ao menos um reel para o loop.');
    const intervalVal = Number(String(form.intervalMinutes).trim());
    if (!intervalVal || intervalVal < 1) return setErr('Informe um intervalo válido (mínimo 1 minuto).');
    setSaving(true);
    try {
      const res = await api.post('/loops', { ...form, intervalMinutes: intervalVal });
      onCreated(res.data); onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally { setSaving(false); }
  }

  const selectedLegendLabel = () => {
    if (!form.caption) return 'Sem legenda';
    const found = legends.find(l => (l.text || l.content || '') === form.caption);
    return found ? (found.title || form.caption.slice(0, 40)) : form.caption.slice(0, 40) + (form.caption.length > 40 ? '…' : '');
  };

  return (
    <motion.div
      className="lm-bg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="lm"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      >

        {/* Header */}
        <div className="lm-hd">
          <div className="lm-hd-l">
            <div className="lm-ico"><RefreshCw size={16} /></div>
            <div>
              <h2>Novo loop contínuo</h2>
              <p>{form.mediaFiles.length > 0
                ? `${form.mediaFiles.length} mídia(s)${form.coverFile ? ' · capa definida' : ''}`
                : 'Configure as opções do loop'}</p>
            </div>
          </div>
          <button className="lm-x" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Single-page form */}
        <form onSubmit={submit} className="lm-body">

          {/* Nome */}
          <div className="lm-row">
            <label className="lm-label">Nome</label>
            <input className="lm-input" placeholder="Ex.: Ciclo motivacional"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {/* Contas */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label">
                Contas&nbsp;<span className="lm-count">({form.accounts.length} selecionada{form.accounts.length !== 1 ? 's' : ''})</span>
              </label>
              <button type="button" className="lm-tiny"
                onClick={() => setForm(f => ({
                  ...f,
                  accounts: f.accounts.length === accounts.length ? [] : accounts.map(a => a._id),
                }))}>
                {form.accounts.length === accounts.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>
            <div className="lm-acc-list">
              {accounts.map(a => {
                const sel = form.accounts.includes(a._id);
                const ok  = !a.healthStatus || a.healthStatus === 'ativa';
                return (
                  <label key={a._id} className={`lm-acc ${sel ? 'sel' : ''}`}>
                    <input type="checkbox" hidden checked={sel} onChange={() => tog('accounts', a._id)} />
                    <div className="lm-av">
                      {a.avatar
                        ? <img src={`${API_URL}${a.avatar}`} alt="" />
                        : <span>{(a.username || '?')[0].toUpperCase()}</span>}
                    </div>
                    <span className="lm-uname">@{a.username}</span>
                    <span className={`lm-acc-dot ${ok ? 'ok' : 'err'}`} />
                    {sel && <CheckCircle size={13} className="lm-chk" />}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Tipo + Intervalo */}
          <div className="lm-2col">
            <div className="lm-row">
              <label className="lm-label">Tipo</label>
              <div className="lm-tabs">
                {[['reel','Reels'],['post','Feed'],['story','Stories']].map(([v,l]) => (
                  <button key={v} type="button"
                    className={form.type === v ? 'a' : ''}
                    onClick={() => setForm(f => ({ ...f, type: v }))}>{l}</button>
                ))}
              </div>
            </div>
            <div className="lm-row">
              <label className="lm-label">Intervalo entre posts</label>
              <div className="lm-int">
                <input type="text" inputMode="numeric" placeholder="minutos"
                  value={form.intervalMinutes}
                  onChange={e => setForm(f => ({ ...f, intervalMinutes: e.target.value }))} />
                <span>min</span>
              </div>
              <span className="lm-hint">Mínimo 5 min</span>
            </div>
          </div>

          {/* Reels do loop */}
          <div className="lm-section">
            <div className="lm-section-hd">
              <div className="lm-section-hd-l">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/></svg>
                <span className="lm-label">Reels do loop</span>
                {form.mediaFiles.length === 0
                  ? <span className="lm-section-note">Nenhum reel — envie agora</span>
                  : <span className="lm-section-count">{form.mediaFiles.length}</span>}
              </div>
              <button type="button" className="lm-upload-btn" onClick={() => fileInputRef.current?.click()}>
                <Upload size={11} /> Enviar reels
              </button>
              <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" hidden
                onChange={e => handleUpload(e.target.files)} />
            </div>

            <div
              className={`lm-dropzone lm-dropzone--sm ${dragOver ? 'drag' : ''}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
            >
              <div className="lm-dz-inner">
                {uploading
                  ? <><RefreshCw size={20} className="spin lm-dz-ic" /><span className="lm-dz-sub">Fazendo upload...</span></>
                  : <><Upload size={20} className="lm-dz-ic" />
                      <span className="lm-dz-sub">Arraste ou envie seus reels</span>
                      <span className="lm-dz-formats">MP4, MOV — envio em paralelo</span></>}
              </div>
            </div>

            {uploadedFiles.length > 0 && (
              <div className="lm-grid" style={{ marginTop: 8 }}>
                {uploadedFiles.map((m, i) => {
                  const sel = form.mediaFiles.includes(m.filename);
                  const vid = m.type === 'video';
                  return (
                    <button key={m.filename} type="button"
                      className={`lm-thumb ${sel ? 'sel' : ''}`}
                      onClick={() => tog('mediaFiles', m.filename)}>
                      {vid
                        ? <video src={`${API_URL}/uploads/${m.filename}`} muted playsInline />
                        : <img src={`${API_URL}/uploads/${m.filename}`} alt="" />}
                      <span className="lm-num">#{i + 1}</span>
                      {sel && <div className="lm-chk2"><CheckCircle size={12} /></div>}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="lm-section-footer">
              Reels enviados aqui rodam somente neste loop e são apagados automaticamente após publicar — não ficam salvos no sistema.
            </p>
          </div>

          {/* Capa dos Reels */}
          <div className="lm-section">
            <div className="lm-section-hd">
              <div className="lm-section-hd-l">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="lm-label">Capa dos Reels (opcional)</span>
              </div>
              <button type="button" className="lm-upload-btn" onClick={() => coverInputRef.current?.click()}>
                <Upload size={11} /> Enviar capa
              </button>
              <input ref={coverInputRef} type="file" accept="image/*" hidden
                onChange={e => handleUpload(e.target.files, true)} />
            </div>

            {form.coverFile ? (
              <div className="lm-cover-preview">
                <img src={`${API_URL}/uploads/${form.coverFile}`} alt="Capa" />
                <button type="button" className="lm-cover-remove" onClick={() => setForm(f => ({ ...f, coverFile: '' }))}>
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div
                className={`lm-dropzone lm-dropzone--sm ${dragOverCover ? 'drag' : ''}`}
                onClick={() => !uploadingCover && coverInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOverCover(true); }}
                onDragLeave={() => setDragOverCover(false)}
                onDrop={e => { e.preventDefault(); setDragOverCover(false); handleUpload(e.dataTransfer.files, true); }}
              >
                <div className="lm-dz-inner">
                  {uploadingCover
                    ? <><RefreshCw size={20} className="spin lm-dz-ic" /><span className="lm-dz-sub">Enviando capa...</span></>
                    : <><svg width="20" height="20" className="lm-dz-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <span className="lm-dz-sub">Arraste ou envie uma imagem 1080×1920</span></>}
                </div>
              </div>
            )}

            <p className="lm-section-footer">Sem capa selecionada — usa o primeiro frame do vídeo.</p>
          </div>

          {/* Legenda */}
          <div className="lm-row">
            <label className="lm-label">Legenda</label>
            <div ref={legendRef} className="lm-legend-wrap">
              <button type="button" className="lm-legend-trigger" onClick={() => setLegendOpen(o => !o)}>
                <span>{selectedLegendLabel()}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: legendOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {legendOpen && (
                <div className="lm-legend-panel">
                  <div className={`lm-legend-opt ${!form.caption ? 'sel' : ''}`}
                    onClick={() => { setForm(f => ({ ...f, caption: '' })); setLegendOpen(false); }}>
                    <span className="lm-leg-dot" /> Sem legenda
                  </div>
                  {legends.length > 0 && <div className="lm-legend-divider" />}
                  {legends.map(leg => {
                    const txt = leg.text || leg.content || '';
                    const sel = form.caption === txt;
                    return (
                      <div key={leg._id || txt} className={`lm-legend-opt ${sel ? 'sel' : ''}`}
                        onClick={() => { setForm(f => ({ ...f, caption: txt })); setLegendOpen(false); }}>
                        <span className="lm-leg-dot" />
                        <span className="lm-legend-opt-text">{leg.title || txt.slice(0, 60)}</span>
                      </div>
                    );
                  })}
                  {legends.length === 0 && (
                    <div className="lm-legend-empty">Nenhuma legenda salva ainda.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Comentário CTA */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                Comentário CTA (auto-postado)
              </label>
              <label className="lm-cta-toggle">
                <input type="checkbox"
                  checked={!!form.ctaComment}
                  onChange={e => setForm(f => ({ ...f, ctaComment: e.target.checked ? '👇 Acesse meu bot no Telegram!\n🤖 {link}' : '' }))}
                />
                <span className="lm-cta-knob" />
              </label>
            </div>
            {!!form.ctaComment && (
              <>
                <textarea className="lm-input" rows={2}
                  value={form.ctaComment}
                  onChange={e => setForm(f => ({ ...f, ctaComment: e.target.value }))} />
                <div className="lm-cta-hint">Postado ~2 min após publicar · Use <code>{'{link}'}</code> <code>{'{username}'}</code></div>
              </>
            )}
          </div>

          {/* Pergunta de engajamento */}
          <div className="lm-row">
            <div className="lm-row-hd">
              <label className="lm-label">Pergunta de engajamento</label>
              <label className="lm-cta-toggle">
                <input type="checkbox"
                  checked={!!form.engageComment}
                  onChange={e => setForm(f => ({ ...f, engageComment: e.target.checked ? 'O que acharam? 👇 Comenta aí!' : '' }))}
                />
                <span className="lm-cta-knob" />
              </label>
            </div>
            {!!form.engageComment && (
              <>
                <textarea className="lm-input" rows={2}
                  value={form.engageComment}
                  onChange={e => setForm(f => ({ ...f, engageComment: e.target.value }))} />
                <div className="lm-cta-hint">Postado ~60 min após publicar</div>
              </>
            )}
          </div>

          {err && <div className="lm-err"><AlertTriangle size={13} />{err}</div>}

          <div className="lm-ft">
            <button type="button" className="lm-cancel" onClick={onClose}>Cancelar</button>
            <button type="submit" className="lm-next" disabled={saving || uploading}>
              {saving ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
              {saving ? 'Criando...' : 'Criar loop'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* ──────────────────── Página ──────────────────── */
export default function LoopPage() {
  const [loops,     setLoops]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [histLoop,  setHistLoop]  = useState(null);
  const [histPosts, setHistPosts] = useState([]);

  const load = useCallback(async () => {
    try { const r = await api.get('/loops'); setLoops(r.data || []); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  async function handleToggle(loop) {
    try {
      const r = await api.post(`/loops/${loop._id}/toggle`);
      setLoops(ls => ls.map(l => l._id === loop._id ? r.data : l));
    } catch (e) { alert(e.response?.data?.error || e.message); }
  }
  async function handleDelete(loop) {
    if (!confirm(`Excluir "${loop.name}"?`)) return;
    try { await api.delete(`/loops/${loop._id}`); setLoops(ls => ls.filter(l => l._id !== loop._id)); }
    catch (e) { alert(e.response?.data?.error || e.message); }
  }
  async function handleHistory(loop) {
    setHistLoop(loop);
    try { const r = await api.get(`/loops/${loop._id}/history`); setHistPosts(r.data || []); }
    catch { setHistPosts([]); }
  }

  const byAccount = {};
  for (const loop of loops) {
    for (const acc of (loop.accounts || [])) {
      const k = acc._id || acc;
      if (!byAccount[k]) byAccount[k] = { account: acc, loops: [] };
      byAccount[k].loops.push(loop);
    }
  }

  const activeCount = loops.filter(l => l.status === 'ativo').length;
  const totalPosts  = loops.reduce((s, l) => s + (l.postsCount || 0), 0);

  const pageActions = (
    <>
      <div className="lp-chip"><RefreshCw size={12} /> {activeCount} ativos</div>
      <div className="lp-chip"><Film size={12} /> {totalPosts} publicados</div>
      <button className="btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 16px', fontSize:'.83rem', fontWeight:700, borderRadius:9 }} onClick={() => setShowModal(true)}>
        <Plus size={14} /> Novo loop
      </button>
    </>
  );

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  );

  return (
    <>
      <PageShell
        icon={pageIcon}
        title="Loop Contínuo"
        subtitle="Ciclos automáticos de postagem em escala"
        accent="cyan"
        actions={pageActions}
      >
        {loading ? (
          <div className="lp-load"><RefreshCw size={18} className="spin" /> Carregando...</div>
        ) : loops.length === 0 ? (
          <motion.div
            className="lp-empty"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="lp-empty-ic"><RefreshCw size={24} /></div>
            <strong>Nenhum loop criado</strong>
            <span>Crie um loop para postar em ciclo contínuo em todas as suas contas.</span>
            <button
              className="btn-primary"
              style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:4 }}
              onClick={() => setShowModal(true)}
            >
              <Plus size={13} /> Criar loop
            </button>
          </motion.div>
        ) : (
          <motion.div
            style={{ display:'flex', flexDirection:'column', gap:20 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            {Object.values(byAccount).map(({ account, loops: al }) => (
              <div key={account._id || account} className="lp-group">
                <div className="lp-group-hd">
                  <div className="lp-av">
                    {account.avatar
                      ? <img src={`${API_URL}${account.avatar}`} alt="" />
                      : <span>{(account.username || '?')[0].toUpperCase()}</span>}
                    <i />
                  </div>
                  <div>
                    <strong>@{account.username}</strong>
                    <span>{al.length} loop(s) · {al.filter(l => l.status==='ativo').length} ativo(s) · {al.reduce((s,l)=>s+(l.postsCount||0),0)} publicados</span>
                  </div>
                </div>
                <div className="lp-grid">
                  <AnimatePresence>
                    {al.map(loop => (
                      <LoopCard key={loop._id} loop={loop}
                        onToggle={handleToggle} onDelete={handleDelete} onHistory={handleHistory} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </PageShell>

      <AnimatePresence>
        {showModal && (
          <LoopModal onClose={() => setShowModal(false)} onCreated={l => setLoops(ls => [l, ...ls])} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {histLoop && (
          <motion.div
            className="lm-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setHistLoop(null)}
          >
            <motion.div
              className="lm lm--sm"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.22 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="lm-hd">
                <div className="lm-hd-l">
                  <div className="lm-ico"><History size={14} /></div>
                  <div><h2>Histórico</h2><p>{histLoop.name}</p></div>
                </div>
                <button className="lm-x" onClick={() => setHistLoop(null)}><X size={15} /></button>
              </div>
              <div className="lm-hist">
                {histPosts.length === 0
                  ? <p className="lm-hist-empty">Nenhum post registrado ainda.</p>
                  : histPosts.map(p => (
                    <div key={p._id} className="lm-hist-row">
                      <span className={`lm-hist-tag ${p.status}`}>{p.status}</span>
                      <span className="lm-hist-f">{p.media}</span>
                      <span className="lm-hist-d">{new Date(p.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

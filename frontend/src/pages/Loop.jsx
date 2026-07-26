import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Plus, Pause, Play, Trash2, Clock, Film,
  History, AlertTriangle, CheckCircle, X, ChevronRight,
  Edit3, BookOpen, Upload, Folder, Crown, Image,
} from 'lucide-react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
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
    <div className={`lc ${running ? 'lc--on' : 'lc--off'}`}>
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

      <p className="lc-sub">{loop.folder || 'default'} · {loop.type} · {loop.mediaFiles?.length || 0} mídias</p>

      <div className="lc-stats">
        <div><span>INTERVALO</span><b>{loop.intervalMinutes}m</b></div>
        <div><span>PUBLICADOS</span><b>{loop.postsCount || 0}</b></div>
        <div><span>PRÓXIMO</span><b>{running ? timeUntil(loop.nextRunAt) : '—'}</b></div>
      </div>

      {loop.lastError && (
        <div className="lc-err"><AlertTriangle size={11} />{loop.lastError}</div>
      )}
      <div className="lc-foot"><Clock size={11} /> {timeAgo(loop.lastRunAt)}</div>
    </div>
  );
}

/* ──────────────────── Modal ──────────────────── */
function LoopModal({ onClose, onCreated }) {
  const [accounts,  setAccounts]  = useState([]);
  const [medias,    setMedias]    = useState([]);
  const [folders,   setFolders]   = useState(['default']);
  const [legends,   setLegends]   = useState([]);
  const [capMode,   setCapMode]   = useState('manual');
  const [step,      setStep]      = useState(1);
  const [uploading, setUploading] = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');
  const fileInputRef = useRef();

  const [form, setForm] = useState({
    name: '', accounts: [], folder: 'default', mediaFiles: [],
    type: 'reel', intervalMinutes: '', caption: '', coverFile: '', ctaComment: '', engageComment: '',
  });

  const loadMedias = useCallback(async () => {
    const r = await api.get('/media');
    const files = r.data?.files || r.data || [];
    setMedias(files);
    const folds = [...new Set(files.map(f => f.folder || 'default'))];
    setFolders(folds.length ? folds : ['default']);
  }, []);

  useEffect(() => {
    api.get('/accounts').then(r => setAccounts(r.data?.accounts || r.data || [])).catch(() => {});
    loadMedias().catch(() => {});
    api.get('/legends').then(r => setLegends(r.data || [])).catch(() => {});
  }, [loadMedias]);

  const isUploadTab   = form.folder === '__upload__';
  const folderMedias  = isUploadTab ? [] : medias.filter(m => (m.folder || 'default') === form.folder);

  const tog = (key, val) => setForm(f => ({
    ...f,
    [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val],
  }));

  async function handleUpload(files) {
    if (!files?.length) return;
    setUploading(true); setErr('');
    try {
      const fd = new FormData();
      for (const file of files) fd.append('files', file);
      fd.append('folder', 'default');
      await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await loadMedias();
      setForm(f => ({ ...f, folder: 'default' }));
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Erro ao fazer upload');
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  function goNext(e) {
    e.preventDefault();
    if (!form.accounts.length) return setErr('Selecione ao menos uma conta.');
    setErr(''); setStep(2);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.mediaFiles.length) return setErr('Selecione ao menos uma mídia.');
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

  return (
    <div className="lm-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="lm">

        {/* ── Header ── */}
        <div className="lm-hd">
          <div className="lm-hd-l">
            <div className="lm-ico"><RefreshCw size={16} /></div>
            <div>
              <h2>Novo loop contínuo</h2>
              <p>
                {step === 1
                  ? 'Configure as opções do loop'
                  : `${form.mediaFiles.length} mídia(s)${form.coverFile ? ' · capa definida' : ''}`}
              </p>
            </div>
          </div>
          <div className="lm-hd-r">
            <div className="lm-steps">
              <span className={step === 1 ? 'cur' : 'done'}>
                {step > 1 ? <CheckCircle size={11} /> : '1'}
              </span>
              <div className={`lm-line ${step > 1 ? 'done' : ''}`} />
              <span className={step === 2 ? 'cur' : ''}>2</span>
            </div>
            <button className="lm-x" onClick={onClose}><X size={15} /></button>
          </div>
        </div>

        {/* ══════════ STEP 1 ══════════ */}
        {step === 1 && (
          <form onSubmit={goNext} className="lm-body">

            {/* Nome */}
            <div className="lm-row">
              <label className="lm-label">Nome do loop</label>
              <input className="lm-input" placeholder="Ex.: Ciclo motivacional"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            {/* Tipo + Intervalo (2 col) */}
            <div className="lm-2col">
              <div className="lm-row">
                <label className="lm-label">Tipo de post</label>
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
                  <input type="text" inputMode="numeric" placeholder="Ex: 60"
                    value={form.intervalMinutes}
                    onChange={e => setForm(f => ({ ...f, intervalMinutes: e.target.value }))} />
                  <span>min</span>
                </div>
              </div>
            </div>

            {/* Contas */}
            <div className="lm-row">
              <div className="lm-row-hd">
                <label className="lm-label">
                  Contas&nbsp;<span className="lm-count">{form.accounts.length}/{accounts.length}</span>
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
                  const bad = a.healthStatus && a.healthStatus !== 'ativa';
                  return (
                    <label key={a._id} className={`lm-acc ${sel ? 'sel' : ''}`}>
                      <input type="checkbox" hidden checked={sel} onChange={() => tog('accounts', a._id)} />
                      <div className="lm-av">
                        {a.avatar
                          ? <img src={`${API_URL}${a.avatar}`} alt="" />
                          : <span>{(a.username || '?')[0].toUpperCase()}</span>}
                      </div>
                      <span className="lm-uname">@{a.username}</span>
                      {bad && <span className="lm-badge-err">{a.healthStatus}</span>}
                      {sel && <CheckCircle size={13} className="lm-chk" />}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* CTA Comment */}
            <div className="lm-row">
              <div className="lm-row-hd">
                <label className="lm-label">💬 Comentário fixado automático</label>
                <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'var(--text2)' }}>
                  <input
                    type="checkbox"
                    checked={!!form.ctaComment}
                    onChange={e => setForm(f => ({ ...f, ctaComment: e.target.checked ? '👇 Acesse meu bot gratuito no Telegram!\n🤖 {link}' : '' }))}
                  />
                  {form.ctaComment ? 'Ativo' : 'Inativo'}
                </label>
              </div>
              {!!form.ctaComment && (
                <>
                  <textarea className="lm-input" rows={3}
                    placeholder="Ex: 👇 Acesse meu bot no Telegram! {link}"
                    value={form.ctaComment}
                    onChange={e => setForm(f => ({ ...f, ctaComment: e.target.value }))} />
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                    Postado ~2 min após publicar · Use {'{link}'} {'{username}'} {'{nome}'}
                  </div>
                </>
              )}
            </div>

            {/* Engage Comment */}
            <div className="lm-row">
              <div className="lm-row-hd">
                <label className="lm-label">🔥 Pergunta de engajamento</label>
                <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'var(--text2)' }}>
                  <input
                    type="checkbox"
                    checked={!!form.engageComment}
                    onChange={e => setForm(f => ({ ...f, engageComment: e.target.checked ? 'O que acharam? 👇 Comenta aí!' : '' }))}
                  />
                  {form.engageComment ? 'Ativo' : 'Inativo'}
                </label>
              </div>
              {!!form.engageComment && (
                <>
                  <textarea className="lm-input" rows={2}
                    placeholder="Ex: Gostaram? Comenta aí! 👇"
                    value={form.engageComment}
                    onChange={e => setForm(f => ({ ...f, engageComment: e.target.value }))} />
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                    Postado ~60 min após publicar · estimula comentários e sinaliza engajamento pro algoritmo
                  </div>
                </>
              )}
            </div>

            {/* Legenda */}
            <div className="lm-row">
              <div className="lm-row-hd">
                <label className="lm-label">Legenda</label>
                <div className="lm-cap-sw">
                  <button type="button" className={capMode === 'manual' ? 'a' : ''} onClick={() => setCapMode('manual')}>
                    <Edit3 size={11} /> Manual
                  </button>
                  <button type="button" className={capMode === 'saved' ? 'a' : ''} onClick={() => setCapMode('saved')}>
                    <BookOpen size={11} /> Salvas {legends.length > 0 && `(${legends.length})`}
                  </button>
                </div>
              </div>
              {capMode === 'manual' ? (
                <>
                <textarea className="lm-input" rows={3} placeholder="Deixe em branco para postar sem legenda..."
                  value={form.caption}
                  onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} />
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                  Variáveis: {'{data}'} {'{hora}'} {'{username}'} {'{nome}'} {'{cidade}'}
                </div>
                </>
              ) : (
                <div className="lm-leg-list">
                  <div className={`lm-leg-item ${form.caption === '' ? 'sel' : ''}`}
                    onClick={() => setForm(f => ({ ...f, caption: '' }))}>
                    <span className="lm-leg-dot" /> Sem legenda
                  </div>
                  {legends.length === 0
                    ? <div className="lm-leg-empty">Nenhuma legenda salva ainda.</div>
                    : legends.map(leg => {
                        const txt = leg.text || leg.content || String(leg);
                        return (
                          <div key={leg._id || txt}
                            className={`lm-leg-item ${form.caption === txt ? 'sel' : ''}`}
                            onClick={() => setForm(f => ({ ...f, caption: txt }))}>
                            <span className="lm-leg-dot" />
                            <span>{leg.title || txt.slice(0, 70)}</span>
                          </div>
                        );
                      })}
                </div>
              )}
            </div>

            {err && <div className="lm-err"><AlertTriangle size={13} />{err}</div>}

            <div className="lm-ft">
              <button type="button" className="lm-cancel" onClick={onClose}>Cancelar</button>
              <button type="submit" className="lm-next">
                Próximo <ChevronRight size={14} />
              </button>
            </div>
          </form>
        )}

        {/* ══════════ STEP 2 ══════════ */}
        {step === 2 && (
          <form onSubmit={submit} className="lm-body">

            {/* Folder tabs */}
            <div className="lm-row">
              <label className="lm-label">Origem das mídias</label>
              <div className="lm-folders">
                {folders.map(f => (
                  <button key={f} type="button"
                    className={`lm-ftab ${form.folder === f ? 'active' : ''}`}
                    onClick={() => setForm(p => ({ ...p, folder: f, mediaFiles: [], coverFile: '' }))}>
                    <Folder size={11} /> {f}
                  </button>
                ))}
                <button type="button"
                  className={`lm-ftab lm-ftab--upload ${isUploadTab ? 'active' : ''}`}
                  onClick={() => setForm(p => ({ ...p, folder: '__upload__', mediaFiles: [], coverFile: '' }))}>
                  <Upload size={11} /> Upload
                </button>
              </div>
            </div>

            {/* Upload zone */}
            {isUploadTab ? (
              <div
                className={`lm-dropzone ${dragOver ? 'drag' : ''}`}
                onClick={() => !uploading && fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" multiple accept="video/*,image/*" hidden
                  onChange={e => handleUpload(e.target.files)} />
                <div className="lm-dz-inner">
                  {uploading
                    ? <><RefreshCw size={28} className="spin lm-dz-ic" /><span className="lm-dz-title">Fazendo upload...</span></>
                    : <>
                        <Upload size={28} className="lm-dz-ic" />
                        <span className="lm-dz-title">Arraste vídeos ou imagens aqui</span>
                        <span className="lm-dz-sub">ou clique para selecionar do dispositivo</span>
                        <span className="lm-dz-formats">MP4 · MOV · JPG · PNG · WEBM</span>
                      </>
                  }
                </div>
              </div>
            ) : (
              <>
                {/* Media grid */}
                <div className="lm-row">
                  <div className="lm-row-hd">
                    <label className="lm-label">
                      Mídias&nbsp;<span className="lm-count">{form.mediaFiles.length}/{folderMedias.length}</span>
                    </label>
                    <button type="button" className="lm-tiny"
                      onClick={() => setForm(f => ({
                        ...f,
                        mediaFiles: f.mediaFiles.length === folderMedias.length
                          ? [] : folderMedias.map(m => m.filename),
                        coverFile: f.mediaFiles.length === folderMedias.length ? '' : f.coverFile,
                      }))}>
                      {form.mediaFiles.length === folderMedias.length ? 'Desmarcar' : 'Selecionar todas'}
                    </button>
                  </div>
                  <div className="lm-grid">
                    {folderMedias.map((m, i) => {
                      const sel     = form.mediaFiles.includes(m.filename);
                      const isCover = form.coverFile === m.filename;
                      const vid     = /\.(mp4|mov|webm)$/i.test(m.filename);
                      return (
                        <button key={m.filename} type="button"
                          className={`lm-thumb ${sel ? 'sel' : ''} ${isCover ? 'lm-thumb--cover' : ''}`}
                          onClick={() => {
                            tog('mediaFiles', m.filename);
                            if (isCover) setForm(f => ({ ...f, coverFile: '' }));
                          }}>
                          {vid
                            ? <video src={`${API_URL}/uploads/${m.filename}`} muted playsInline />
                            : <img src={`${API_URL}/uploads/${m.filename}`} alt="" />}
                          <span className="lm-num">#{i + 1}</span>
                          {isCover && (
                            <div className="lm-crown"><Crown size={9} /></div>
                          )}
                          {sel && !isCover && (
                            <div className="lm-chk2"><CheckCircle size={12} /></div>
                          )}
                        </button>
                      );
                    })}
                    {folderMedias.length === 0 && (
                      <p className="lm-no-media">
                        <Image size={20} style={{opacity:.4, display:'block', margin:'0 auto 8px'}} />
                        Nenhuma mídia na pasta "{form.folder}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Capa do post */}
                {form.mediaFiles.length > 0 && (
                  <div className="lm-row">
                    <div className="lm-row-hd">
                      <label className="lm-label">
                        <Crown size={11} style={{marginRight:4, color:'#f59e0b'}} />
                        Capa do post
                      </label>
                      {form.coverFile && (
                        <button type="button" className="lm-tiny"
                          onClick={() => setForm(f => ({ ...f, coverFile: '' }))}>
                          Remover capa
                        </button>
                      )}
                    </div>
                    <p className="lm-cover-hint">
                      {form.coverFile ? 'Capa definida — clique em outra mídia para trocar' : 'Clique em uma mídia para definir como capa do post'}
                    </p>
                    <div className="lm-cover-strip">
                      {folderMedias
                        .filter(m => form.mediaFiles.includes(m.filename))
                        .map(m => {
                          const isCover = form.coverFile === m.filename;
                          const vid     = /\.(mp4|mov|webm)$/i.test(m.filename);
                          return (
                            <button key={m.filename} type="button"
                              className={`lm-cover-thumb ${isCover ? 'sel' : ''}`}
                              onClick={() => setForm(f => ({ ...f, coverFile: isCover ? '' : m.filename }))}>
                              {vid
                                ? <video src={`${API_URL}/uploads/${m.filename}`} muted playsInline />
                                : <img src={`${API_URL}/uploads/${m.filename}`} alt="" />}
                              {isCover && (
                                <div className="lm-cover-ic"><Crown size={12} /></div>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            )}

            {err && <div className="lm-err"><AlertTriangle size={13} />{err}</div>}

            <div className="lm-ft">
              <button type="button" className="lm-cancel"
                onClick={() => { setStep(1); setErr(''); }}>
                ← Voltar
              </button>
              <button type="submit" className="lm-next" disabled={saving || uploading}>
                {saving ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                {saving ? 'Criando...' : 'Criar loop'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
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

  return (
    <div className="lp-page">
      <div className="lp-hd">
        <div>
          <h1>Loop</h1>
          <p>Ciclos contínuos de postagem automática</p>
        </div>
        <div className="lp-hd-r">
          <span className="lp-chip"><RefreshCw size={12} /> {activeCount} ativos</span>
          <span className="lp-chip"><Film size={12} /> {totalPosts} publicados</span>
          <button className="lp-new" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Novo loop
          </button>
        </div>
      </div>

      {loading ? (
        <div className="lp-load"><RefreshCw size={18} className="spin" /> Carregando...</div>
      ) : loops.length === 0 ? (
        <div className="lp-empty">
          <div className="lp-empty-ic"><RefreshCw size={24} /></div>
          <strong>Nenhum loop criado</strong>
          <span>Crie um loop para postar em ciclo contínuo em todas as suas contas.</span>
          <button className="lp-new" onClick={() => setShowModal(true)}><Plus size={13} /> Criar loop</button>
        </div>
      ) : (
        Object.values(byAccount).map(({ account, loops: al }) => (
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
              {al.map(loop => (
                <LoopCard key={loop._id} loop={loop}
                  onToggle={handleToggle} onDelete={handleDelete} onHistory={handleHistory} />
              ))}
            </div>
          </div>
        ))
      )}

      {showModal && <LoopModal onClose={() => setShowModal(false)} onCreated={l => setLoops(ls => [l, ...ls])} />}

      {histLoop && (
        <div className="lm-bg" onClick={() => setHistLoop(null)}>
          <div className="lm lm--sm" onClick={e => e.stopPropagation()}>
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
          </div>
        </div>
      )}
    </div>
  );
}

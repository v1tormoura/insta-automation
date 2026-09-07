import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import Segmentado from '../components/Segmentado';
import AccountPicker from '../components/AccountPicker';
import LibraryPickerModal from '../components/LibraryPickerModal';
import MarcaDaguaModal from '../components/MarcaDaguaModal';
import { MARCA_PADRAO } from '../services/marcaDagua';
import ChaveDeOpcao from '../components/ChaveDeOpcao';
import { getCTASuffix, setCTASuffix, applyCTASuffix } from '../services/captionSuffix';
import { EsqueletoLista } from '../components/Estados';

/* ── Custom legend dropdown ── */
function LegendDropdown({ legends, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = legends.find(l => l._id === value);

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'color-mix(in oklch, var(--mf-bg) 80%, transparent)',
          border: `1px solid ${open ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
          borderRadius: open ? '9px 9px 0 0' : 9,
          padding: '8px 12px', fontSize: 'var(--mf-t-sm)', cursor: 'pointer', textAlign: 'left',
          color: selected ? 'var(--mf-text)' : 'var(--mf-text-3)',
          transition: 'border-color var(--mf-fast) var(--mf-ease-out)',
          boxShadow: open ? '0 0 0 3px color-mix(in oklch, var(--mf-primary-500) 8%, transparent)' : 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selected ? selected.title : 'Selecione uma legenda salva...'}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
          style={{ flexShrink: 0, marginLeft: 8, transition: 'transform var(--mf-normal) var(--mf-ease-out)', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--mf-text-3)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: 'color-mix(in oklch, var(--mf-surface-1) 98%, transparent)', border: '1px solid var(--mf-border)',
          borderTop: 'none', borderRadius: '0 0 10px 10px',
          boxShadow: '0 16px 40px oklch(0 0 0 / 0.55)', maxHeight: 220, overflowY: 'auto',
          backdropFilter: 'blur(16px)',
        }}>
          {[{ _id: '', title: 'Selecione uma legenda salva...' }, ...legends].map((l, i) => (
            <div
              key={l._id || 'empty'}
              onClick={() => { onChange(l._id); setOpen(false); }}
              style={{
                padding: '8px 12px', fontSize: 'var(--mf-t-sm)', cursor: 'pointer',
                color: l._id === '' ? 'var(--mf-text-3)' : l._id === value ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text)',
                background: l._id !== '' && l._id === value ? 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)' : 'transparent',
                borderBottom: i < legends.length ? '1px solid var(--mf-border-subtle)' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'background .1s',
                fontStyle: l._id === '' ? 'italic' : 'normal',
              }}
              onMouseEnter={e => { if (l._id !== value) e.currentTarget.style.background = 'var(--mf-border-subtle)'; }}
              onMouseLeave={e => { if (l._id !== value) e.currentTarget.style.background = l._id === value ? 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)' : 'transparent'; }}
            >
              {l.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/* ── Card de mídia com thumbnail real (canvas para vídeo, objectURL para imagem) ── */
/* ── Atalhos de valor ──────────────────────────────────────────────────────
   Fileira de valores prontos ao lado de um campo. O campo continua aceitando
   qualquer número — os atalhos são para os quatro valores que se usa em 95%
   das vezes, e o realce diz qual deles está em vigor agora. */
function Atalhos({ opcoes, atual, onEscolher }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {opcoes.map(([valor, rotulo]) => {
        const ativo = valor === atual;
        return (
          <button key={String(valor)} type="button" onClick={() => onEscolher(valor)}
            style={{
              padding: '4px 10px', borderRadius: 'var(--mf-r-xl)', cursor: 'pointer',
              fontSize: 'var(--mf-t-nano)', fontWeight: 700, whiteSpace: 'nowrap',
              background: ativo ? 'color-mix(in oklch, var(--mf-mod-publicar) 14%, transparent)' : 'var(--mf-surface-2)',
              border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-mod-publicar) 34%, transparent)' : 'var(--mf-border)'}`,
              color: ativo ? 'var(--mf-mod-publicar)' : 'var(--mf-text-3)',
              transition: 'all var(--mf-fast) var(--mf-ease-out)',
            }}>
            {rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** "30 min", "1 hora", "4 horas" — em vez de 240 min, que ninguém lê como 4h. */
function rotuloDeIntervalo(min) {
  const n = Math.max(1, Number(min) || 1);
  if (n < 60) return `${n} min`;
  const horas = n / 60;
  const texto = Number.isInteger(horas) ? String(horas) : horas.toFixed(1);
  return `${texto} ${horas === 1 ? 'hora' : 'horas'}`;
}

/* ── Quando começar ────────────────────────────────────────────────────────

   Cada atalho calcula a data na hora do clique, não na montagem da tela: a
   página fica aberta por muito tempo enquanto se escolhe mídia e conta, e
   "Hoje 19h" calculado no carregamento poderia já ter passado quando o botão
   for clicado.

   "Hoje 19h" depois das 19h vira amanhã às 19h. Agendar para o passado faria o
   BullMQ disparar tudo de imediato — que é o oposto do que o botão promete. */
const INICIOS = [
  { id: 'agora',    rotulo: 'Agora',       quando: () => null },
  { id: 'em1h',     rotulo: 'Em 1h',       quando: () => new Date(Date.now() + 3_600_000) },
  { id: 'hoje19',   rotulo: 'Hoje 19h',    quando: () => proximaHora(19) },
  { id: 'amanha09', rotulo: 'Amanhã 09h',  quando: () => proximaHora(9, 1) },
  { id: 'escolher', rotulo: 'Escolher',    quando: () => null },
];

/** A próxima ocorrência daquela hora; passa para o dia seguinte se já passou. */
function proximaHora(hora, somarDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + somarDias);
  d.setHours(hora, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Data no formato que `<input type="datetime-local">` aceita.
 *
 * `toISOString()` não serve: ele converte para UTC, então às 19:00 de Brasília
 * o campo mostraria 22:00. O formato do campo é sempre hora local.
 */
function paraCampoLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function MediaCard({ file, index, onRemove }) {
  const [thumb, setThumb] = useState(null);
  const isVideo = file.type?.startsWith('video/');

  useEffect(() => {
    let objectUrl;
    if (!isVideo) {
      objectUrl = URL.createObjectURL(file);
      setThumb(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = objectUrl;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) * 0.05);
    };
    video.onseeked = () => {
      try {
        const W = 270, H = 480;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const vr = video.videoWidth / video.videoHeight;
        const cr = W / H;
        let sw, sh, sx, sy;
        if (vr > cr) { sh = video.videoHeight; sw = sh * cr; sx = (video.videoWidth - sw) / 2; sy = 0; }
        else { sw = video.videoWidth; sh = sw / cr; sx = 0; sy = (video.videoHeight - sh) / 2; }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
        setThumb(canvas.toDataURL('image/jpeg', 0.75));
      } catch { /* canvas tainted ou erro */ }
      URL.revokeObjectURL(objectUrl);
    };
    video.onerror = () => URL.revokeObjectURL(objectUrl);
    return () => { video.src = ''; URL.revokeObjectURL(objectUrl); };
  }, []);

  return (
    <div style={{
      position: 'relative', borderRadius: 'var(--mf-r-md)', overflow: 'hidden',
      background: 'var(--mf-bg)', border: '1px solid var(--mf-border)',
      aspectRatio: '9/16',
    }}>
      <button
        type="button"
        onClick={() => onRemove(index)}
        style={{
          position: 'absolute', top: 5, right: 5, zIndex: 2,
          background: 'color-mix(in oklch, var(--mf-danger-500) 85%, transparent)', border: 'none', color: 'var(--mf-text)',
          borderRadius: 'var(--mf-r-xs)', width: 20, height: 20, cursor: 'pointer', fontSize: 'var(--mf-t-nano)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      {thumb ? (
        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: isVideo ? 'var(--mf-primary-300)' : 'var(--mf-info-500)', opacity: .55,
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {isVideo
              ? <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>
              : <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>}
          </svg>
        </div>
      )}

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent, oklch(0 0 0 / 0.78))',
        padding: '24px 4px 4px', pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, color: 'oklch(1 0 0)', textShadow:'0 1px 2px oklch(0 0 0 / 0.6)', fontFamily: 'var(--mf-mono)' }}>
          #{index + 1}
        </div>
        <div style={{ fontSize: 'var(--mf-t-nano)', color: 'oklch(1 0 0 / 0.86)', textShadow:'0 1px 2px oklch(0 0 0 / 0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {file.name}
        </div>
      </div>
    </div>
  );
}

export default function Posts() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [postType, setPostType] = useState('reel');
  const [accounts, setAccounts] = useState([]);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState([]);
  const [cover, setCover] = useState(null);
  const [coverLibFile, setCoverLibFile] = useState(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);

  /* A biblioteca guarda o arquivo em `filename` e o caminho servido em `url`,
     e nenhum dos dois é obrigatório. Derivar aqui, uma vez, evita repetir a
     checagem nos três lugares que usam a capa — e foi a falta dela que fez
     escolher uma capa apagar a tela. */
  const nomeDaCapa = coverLibFile?.originalName || coverLibFile?.filename || '';
  /* `API`, do escopo do módulo — não `API_URL`, que só existe dentro de um
     callback lá embaixo. Referenciado aqui, lançava ReferenceError, e esta
     linha só executa quando há capa escolhida: era a tela azul ao selecionar
     capa da biblioteca. O build não pega, porque o Vite não analisa escopo. */
  const urlDaCapa  = coverLibFile
    ? (coverLibFile.url ? `${API}${coverLibFile.url}` : `${API}/uploads/${coverLibFile.filename || ''}`)
    : '';
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [intervalMins, setIntervalMins] = useState(3);   // backend exige >= 1
  const [simultaneousLimit, setSimultaneousLimit] = useState(1);
  const [processMode, setProcessMode] = useState('limpeza_leve');
  const [toast, setToast] = useState(null);
  const [legends, setLegends] = useState([]);
  const [selectedLegend, setSelectedLegend] = useState('');
  const [location, setLocation] = useState('');
  const [ctaSuffix, setCtaSuffixState] = useState(() => getCTASuffix());

  function updateCtaSuffix(patch) {
    const next = { ...ctaSuffix, ...patch };
    setCtaSuffixState(next);
    setCTASuffix(next);
  }
  const [retryingId, setRetryingId] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [postPage, setPostPage] = useState(1);
  const [postPagination, setPostPagination] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted]   = useState(false);
  const [ctaComment, setCtaComment]       = useState('');
  const [engageComment, setEngageComment] = useState('');
  const [mediaSource, setMediaSource]     = useState('upload');
  const [libraryMedia, setLibraryMedia]   = useState([]);
  const [showLibPicker, setShowLibPicker] = useState(false);

  /* ── Ordem da fila e marca d'água ─────────────────────────────────────────
     Todas estas escolhas viajam para o backend e são resolvidas na criação do
     job: a ordem fixa `mediaFiles`, o loop infinito escolhe `type`, e a marca
     é gravada como configuração — o texto dela é o @ de cada conta, resolvido
     no servidor na hora de publicar. */
  const [ordemDasMidias,  setOrdemDasMidias]  = useState('antigos_primeiro');
  const [midiasAleatorias, setMidiasAleatorias] = useState(false);
  const [loopInfinito,    setLoopInfinito]    = useState(false);
  const [marcaDagua,      setMarcaDagua]      = useState(MARCA_PADRAO);
  const [marcaModal,      setMarcaModal]      = useState(false);

  /* ── Configurações de envio ───────────────────────────────────────────────
     `postsPor24h` NÃO fica no job: ele é gravado em `Account.dailyPostLimit`,
     que é o campo que o planejador e a verificação de publicação já obedecem.
     Um segundo número no job criaria duas respostas para "quantas esta conta
     pode hoje". */
  const [nomeDoEnvio,     setNomeDoEnvio]     = useState('');
  const [aquecimento,     setAquecimento]     = useState(false);
  const [postsPor24h,     setPostsPor24h]     = useState(10);
  const [inicioEscolhido, setInicioEscolhido] = useState('agora');

  const DRAFT_POSTS_KEY = 'posts_form_draft_v1';

  /* ── Restaura rascunho de posts salvo ────────────────────────────────────── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_POSTS_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.caption !== undefined) setCaption(d.caption);
        if (d.postType) setPostType(d.postType);
        if (d.intervalMins !== undefined) setIntervalMins(d.intervalMins);
        if (d.simultaneousLimit !== undefined) setSimultaneousLimit(d.simultaneousLimit);
        if (d.processMode) setProcessMode(d.processMode);
        if (d.location !== undefined) setLocation(d.location);
        if (d.ctaComment !== undefined) setCtaComment(d.ctaComment);
        if (d.engageComment !== undefined) setEngageComment(d.engageComment);
        if (Array.isArray(d.selectedAccounts) && d.selectedAccounts.length) setSelectedAccounts(d.selectedAccounts);
        if (d.mediaSource) setMediaSource(d.mediaSource);
        if (d.ordemDasMidias) setOrdemDasMidias(d.ordemDasMidias);
        if (d.midiasAleatorias !== undefined) setMidiasAleatorias(!!d.midiasAleatorias);
        if (d.loopInfinito !== undefined) setLoopInfinito(!!d.loopInfinito);
        if (d.marcaDagua) setMarcaDagua({ ...MARCA_PADRAO, ...d.marcaDagua });
        if (d.nomeDoEnvio !== undefined) setNomeDoEnvio(d.nomeDoEnvio);
        if (d.postsPor24h !== undefined) setPostsPor24h(d.postsPor24h);
        if (d.aquecimento !== undefined) setAquecimento(!!d.aquecimento);
      }
    } catch {}
  }, []);

  /* ── Salva rascunho de posts automaticamente ────────────────────────────── */
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_POSTS_KEY, JSON.stringify({
        caption, postType, intervalMins, simultaneousLimit, processMode,
        location, ctaComment, engageComment, selectedAccounts, mediaSource,
        ordemDasMidias, midiasAleatorias, loopInfinito, marcaDagua,
        nomeDoEnvio, postsPor24h, aquecimento,
      }));
    } catch {}
  }, [caption, postType, intervalMins, simultaneousLimit, processMode, location, ctaComment, engageComment, selectedAccounts, mediaSource, ordemDasMidias, midiasAleatorias, loopInfinito, marcaDagua, nomeDoEnvio, postsPor24h, aquecimento]);

  const selectedCount  = selectedAccounts.length;
  const activeMediaCount = mediaSource === 'library' ? libraryMedia.length : media.length;
  const totalEstimated = activeMediaCount * selectedCount;

  function showToast(type, title, message) {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  }

  const [primeiraCarga, setPrimeiraCarga] = useState(true);

  async function load(targetPage = postPage) {
    try {
      const [postsRes, accountsRes, legendsRes] = await Promise.all([
        api.get(`/posts?page=${targetPage}&limit=20`),
        api.get('/accounts?limit=200'),
        api.get('/legends'),
      ]);
      setPosts(postsRes.data.posts || []);
      setPostPagination(postsRes.data.pagination || null);
      setAccounts(accountsRes.data.accounts || []);
      setLegends(Array.isArray(legendsRes.data) ? legendsRes.data : []);
    } catch { /* silencioso — estado anterior mantido */ }
  }

  function goToPostPage(p) { setPostPage(p); load(p); }
  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  async function retryPost(id) {
    try { setRetryingId(id); await api.post(`/posts/${id}/retry`); showToast('success', 'Reprocessando', 'Post adicionado à fila novamente.'); load(); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar.'); }
    finally { setRetryingId(null); }
  }

  async function retryAllErrors() {
    try {
      setRetryingAll(true);
      const res = await api.post('/posts/retry-errors');
      const total = res.data.total || 0;
      showToast('success', 'Reprocessando', total > 0 ? `${total} posts adicionados à fila.` : 'Nenhum post com erro.');
      load();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao reprocessar.'); }
    finally { setRetryingAll(false); }
  }

  async function useRandomLegend() {
    try { const res = await api.get('/legends/random'); setCaption(res.data.text); showToast('success', 'Legenda carregada', 'Legenda aleatória aplicada.'); }
    catch { showToast('warning', 'Sem legendas', 'Nenhuma legenda encontrada.'); }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'));
    if (files.length) setMedia(prev => [...prev, ...files]);
  }

  async function createPost(e) {
    e.preventDefault();
    const hasMedia = mediaSource === 'library' ? libraryMedia.length > 0 : media.length > 0;
    if (!hasMedia) return showToast('warning', 'Atenção', 'Selecione pelo menos uma mídia');
    if (!selectedAccounts.length) return showToast('warning', 'Atenção', 'Selecione uma conta');
    const form = new FormData();
    if (mediaSource === 'library') {
      form.append('mediaIds', JSON.stringify(libraryMedia.map(m => m._id)));
    } else {
      media.forEach(file => form.append('media', file));
    }
    if (cover) form.append('cover', cover);
    else if (coverLibFile?.filename) form.append('coverFilename', coverLibFile.filename);
    form.append('caption', applyCTASuffix(caption, ctaSuffix));
    if (location) form.append('location', location);
    form.append('postType', postType);
    form.append('accounts', JSON.stringify(selectedAccounts));
    form.append('intervalMinutes', intervalMins);
    form.append('simultaneousLimit', simultaneousLimit);
    form.append('processMode', processMode);
    /* Ordem, loop e marca. `multipart/form-data` só carrega texto — por isso a
       marca vai como JSON e os booleanos como 'true'/'false'. O backend aceita
       as duas formas; ver `lerDoCorpo` em marcaDagua.js. */
    form.append('ordemDasMidias', ordemDasMidias);
    form.append('midiasAleatorias', String(midiasAleatorias));
    form.append('loopInfinito', String(loopInfinito));
    if (nomeDoEnvio.trim()) form.append('name', nomeDoEnvio.trim());
    /* Vai como número e o servidor normaliza de novo: ele é quem manda, e
       `normalizarTeto` recusa o que não é um teto utilizável. */
    form.append('postsPor24h', String(postsPor24h));
    if (marcaDagua.ativa) form.append('marcaDagua', JSON.stringify(marcaDagua));
    if (ctaComment.trim())    form.append('ctaComment', ctaComment);
    if (engageComment.trim()) form.append('engageComment', engageComment);
    if (scheduledAt) form.append('scheduledAt', new Date(scheduledAt).toISOString());
    setPosting(true);
    try {
      await api.post('/posts', form);
      setCaption(''); setMedia([]); setCover(null);
      setLocation(''); setSelectedAccounts([]); setScheduledAt('');
      setIntervalMins(0); setSelectedLegend(''); setCtaComment(''); setEngageComment('');
      setLibraryMedia([]);
      showToast(
        'success',
        scheduledAt ? 'Posts agendados!' : loopInfinito ? 'Loop infinito iniciado!' : 'Posts enviados!',
        /* Loop infinito não tem total: ele volta ao começo quando as mídias
           acabam, então anunciar um número seria anunciar um fim que não vem. */
        loopInfinito
          ? `${activeMediaCount} mídia(s) em ${selectedCount} conta(s), repetindo a cada ${intervalMins} min.`
          : `${totalEstimated} publicações adicionadas à fila.`,
      );
      setPosted(true);
      setTimeout(() => setPosted(false), 2500);
      load();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao criar posts.');
    } finally {
      setPosting(false);
    }
  }

  function statusBadgeClass(status) {
    if (status === 'concluido') return 'badge-green';
    if (status === 'erro') return 'badge-red';
    if (status === 'processando') return 'badge-indigo';
    if (status === 'agendado') return 'badge-amber';
    if (status === 'parcial') return 'badge-amber';
    return 'badge-gray';
  }

  const processModes = [
    { id: 'sem_limpeza',  label: 'Sem Limpeza',  tag: 'SAFE',  desc: 'Posta o vídeo original, sem alterar nada',                          color: 'var(--mf-success-500)' },
    { id: 'limpeza_leve', label: 'Limpeza Leve', tag: 'RECOM', desc: 'Remove metadados e gera hash diferente',                            color: 'var(--mf-info-500)' },
    { id: 'ultra_clean',  label: 'Ultra Clean',  tag: 'ULTRA', desc: 'Remove todos metadados + re-encoda o vídeo',                        color: 'var(--mf-mod-publicar)' },
    { id: 'humanizador',  label: 'Humanizador',  tag: 'MAX',   desc: 'Micro-crop + cor + pitch áudio + CRF aleatório — fingerprint único', color: 'var(--mf-warning-500)' },
  ];

  /* ── Icon ── */
  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
    </svg>
  );

  /* ── Header actions ── */
  const pageActions = (
    <>
      <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-sm)', padding: '8px 12px', borderRadius: 'var(--mf-r-sm)' }} type="button" onClick={retryAllErrors} disabled={retryingAll}>
        ↻ {retryingAll ? 'Reprocessando...' : 'Reprocessar vencidos'}
      </button>
      <button className="btn-primary" style={{ fontSize: 'var(--mf-t-sm)', padding: '8px 16px', borderRadius: 'var(--mf-r-sm)', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, minWidth: 120, justifyContent: 'center', opacity: posting ? 0.8 : 1 }} type="button"
        disabled={posting}
        onClick={() => document.getElementById('postform').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))}>
        {posting ? (
          <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>Publicando...</>
        ) : posted ? (
          <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>Publicado!</>
        ) : (
          scheduledAt ? 'Agendar' : 'Publicar agora'
        )}
      </button>
    </>
  );

  /* ── Premium card style ── */
  /* Superfícies do formulário sobre os tokens do sistema. O backdrop-filter
     saiu: a tela tem oito cards empilhados, e desfocar o que está atrás de
     cada um custa uma camada de composição por card sem nada por baixo que
     valha a pena ver desfocado. */
  const cardStyle = {
    background: 'var(--mf-surface-1)',
    border: '1px solid var(--mf-border)',
    borderRadius: 'var(--mf-r-lg)',
    overflow: 'hidden',
    containerType: 'inline-size',
  };
  const cardHdStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 'var(--mf-3)', padding: 'var(--mf-3) var(--mf-4)',
    borderBottom: '1px solid var(--mf-border)',
    flexWrap: 'wrap', rowGap: 'var(--mf-2)',
  };
  const cardH3Style = { fontSize: 'var(--mf-t-h2)', fontWeight: 650, color: 'var(--mf-text)', margin: 0 };
  const cardBodyStyle = { padding: 'var(--mf-4)' };
  const rotuloForm = {
    display: 'block', marginBottom: 7,
    fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)',
    letterSpacing: .5, textTransform: 'uppercase',
  };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageShell
        icon={pageIcon}
        title="Painel de Publicação"
        subtitle="Publicações em tempo real · múltiplas contas"
        accent="purple"
        actions={pageActions}
      >
        {/* Form grid */}
        <form id="postform" onSubmit={createPost} className="layout-form-2col" style={{ marginBottom: 20 }}>

          {/* ── LEFT COLUMN ── */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >

            {/* Upload / Biblioteca */}
            {showLibPicker && (
              <LibraryPickerModal
                onClose={() => setShowLibPicker(false)}
                onConfirm={items => setLibraryMedia(prev => {
                  const existing = new Map(prev.map(m => [m._id, m]));
                  items.forEach(m => existing.set(m._id, m));
                  return Array.from(existing.values());
                })}
              />
            )}

            {/* Picker de capa da biblioteca */}
            {showCoverPicker && (
              <LibraryPickerModal
                mode="single"
                accept="image"
                onClose={() => setShowCoverPicker(false)}
                onConfirm={items => {
                  /* Recusa o item sem arquivo na hora da escolha. Aceitar e
                     falhar depois, na hora de publicar, esconde o problema
                     atrás de um passo que o usuário já considerava resolvido. */
                  const escolhido = items.find(i => i?.filename);
                  if (escolhido) { setCoverLibFile(escolhido); setCover(null); }
                  else if (items.length) setToast({ type: 'error', title: 'Capa inválida', message: 'Esse item da biblioteca está sem arquivo. Escolha outro.' });
                  setShowCoverPicker(false);
                }}
              />
            )}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Mídia</h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {/* Source toggle */}
                  <Segmentado
                    rotulo="Origem da mídia"
                    opcoes={[{ value:'upload', label:'Upload' }, { value:'library', label:'Biblioteca' }]}
                    valor={mediaSource} onChange={setMediaSource} mod="publicar"
                  />
                  <span className="mf-mono" style={{ fontSize:'var(--mf-t-micro)', borderRadius:'var(--mf-r-full)', padding:'2px 8px', whiteSpace:'nowrap',
                    background:'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)',
                    color:'var(--mf-mod-contas)',
                    border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 26%, transparent)' }}>
                    {activeMediaCount} {activeMediaCount === 1 ? 'arquivo' : 'arquivos'}
                  </span>
                </div>
              </div>
              <div style={cardBodyStyle}>
                {/* Type tabs */}
                <div style={{ marginBottom: 'var(--mf-3)' }}>
                  <Segmentado
                    full rotulo="Tipo de publicação"
                    opcoes={[
                      { value:'reel',  label:'Reel'  },
                      { value:'post',  label:'Post'  },
                      { value:'story', label:'Story' },
                    ]}
                    valor={postType} onChange={setPostType} mod="publicar"
                  />
                </div>

                {/* Media Source Buttons (Upload vs Biblioteca) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  <button type="button"
                    onClick={() => setMediaSource('upload')}
                    style={{
                      padding: '8px 12px', borderRadius: 'var(--mf-r-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      border: `1.5px solid ${mediaSource === 'upload' ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
                      background: mediaSource === 'upload' ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-bg)',
                      color: mediaSource === 'upload' ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-2)',
                      fontWeight: mediaSource === 'upload' ? 700 : 500, fontSize: 'var(--mf-t-sm)', transition: 'all var(--mf-fast) var(--mf-ease-out)',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Upload de arquivos
                  </button>

                  <button type="button"
                    onClick={() => { setMediaSource('library'); setShowLibPicker(true); }}
                    style={{
                      padding: '8px 12px', borderRadius: 'var(--mf-r-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      border: `1.5px solid ${mediaSource === 'library' ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
                      background: mediaSource === 'library' ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-bg)',
                      color: mediaSource === 'library' ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-2)',
                      fontWeight: mediaSource === 'library' ? 700 : 500, fontSize: 'var(--mf-t-sm)', transition: 'all var(--mf-fast) var(--mf-ease-out)',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    Abrir biblioteca
                  </button>
                </div>

                {mediaSource === 'upload' ? (
                  <>
                    <label
                      className={`upload-zone${dragOver ? ' drag-over' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                    >
                      <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                        onChange={e => setMedia(Array.from(e.target.files || []))} />
                      <div style={{ marginBottom: 8 }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--mf-text-3)' }}>
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                      </div>
                      <strong>Arraste ou envie seus vídeos / fotos</strong>
                      <span>MP4, MOV, JPG, PNG — sem limite de quantidade</span>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" className="btn btn-primary btn-sm">Selecionar arquivos</button>
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLibPicker(true); setMediaSource('library'); }} className="btn btn-ghost btn-sm">Usar da biblioteca</button>
                      </div>
                    </label>
                    {media.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(100px,1fr))', gap: 8, marginTop: 12 }}>
                        {media.map((file, i) => (
                          <MediaCard
                            key={`${file.name}-${i}`}
                            file={file}
                            index={i}
                            onRemove={idx => setMedia(m => m.filter((_, j) => j !== idx))}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setShowLibPicker(true)}
                      style={{ width: '100%', padding: '16px 16px', border: '1.5px dashed color-mix(in oklch, var(--mf-primary-500) 35%, transparent)', borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-primary-500) 4%, transparent)', cursor: 'pointer', color: 'var(--mf-mod, var(--mf-accent-500))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                      <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 600 }}>Escolher da biblioteca</span>
                      <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Selecione mídias já enviadas nas suas pastas</span>
                    </button>
                    {libraryMedia.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{libraryMedia.length} selecionado(s)</span>
                          <button type="button" onClick={() => setShowLibPicker(true)} style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-mod, var(--mf-accent-500))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Adicionar mais</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(80px,1fr))', gap: 6 }}>
                          {libraryMedia.map((m, i) => {
                            const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(m.filename || '');
                            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
                            const src = isVideo ? `${API_URL}/uploads/${(m.filename||'').replace(/\.[^.]+$/,'')}.thumb.jpg` : `${API_URL}${m.url || `/uploads/${m.filename}`}`;
                            return (
                              <div key={m._id} style={{ position: 'relative', aspectRatio: '9/16', borderRadius: 'var(--mf-r-sm)', overflow: 'hidden', border: '1px solid var(--mf-border)', background: 'var(--mf-bg)' }}>
                                <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { e.target.style.display='none'; }} />
                                <button type="button" onClick={() => setLibraryMedia(prev => prev.filter(x => x._id !== m._id))}
                                   style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 'var(--mf-r-xs)', background: 'color-mix(in oklch, var(--mf-danger-500) 85%, transparent)', border: 'none', color: 'var(--mf-text)', cursor: 'pointer', fontSize: 'var(--mf-t-nano)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent,oklch(0 0 0 / .7))', padding: '12px 4px 2px' }}>
                                  <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{i+1} {m.originalName || m.filename}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Ordem da fila ────────────────────────────────────────
                    Estas três opções decidem em que ordem as mídias entram na
                    fila, e a ordem é fixada na criação do job — o worker só
                    caminha pelo array. Ver `ordemDasMidias.js`.

                    Só aparecem com duas ou mais mídias: com uma, ordem não é
                    uma pergunta. */}
                {activeMediaCount > 1 && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--mf-border)' }}>
                    <label style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: .5, textTransform: 'uppercase', display: 'block', marginBottom: 7 }}>
                      Ordem de postagem
                    </label>
                    <select className="inp" value={ordemDasMidias} onChange={e => setOrdemDasMidias(e.target.value)}
                      disabled={midiasAleatorias}
                      style={{ width: '100%', opacity: midiasAleatorias ? .5 : 1 }}>
                      <option value="antigos_primeiro">Mais antigos primeiro (padrão)</option>
                      <option value="recentes_primeiro">Mais recentes primeiro</option>
                      <option value="selecao">Na ordem em que eu escolhi</option>
                    </select>
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 6, lineHeight: 1.6 }}>
                      {mediaSource === 'library'
                        ? 'Define em que ordem os vídeos entram na fila. Ex: subiu 400 vídeos e quer postar os mais novos primeiro? Escolha "Mais recentes primeiro".'
                        /* Upload direto não tem data na biblioteca: todos
                           acabaram de subir. Dizer isso evita a pergunta
                           "escolhi recentes primeiro e nada mudou". */
                        : 'No upload direto todos os arquivos acabaram de subir, então a ordem é a que você selecionou no seletor.'}
                    </div>

                    <ChaveDeOpcao
                      titulo="Ordem Aleatória"
                      descricao="Posta os vídeos embaralhados. Sem marcar, segue a ordem escolhida acima."
                      marcada={midiasAleatorias}
                      onChange={setMidiasAleatorias}
                    />
                    <ChaveDeOpcao
                      titulo="Modo Loop Infinito"
                      descricao="Repete as mesmas mídias continuamente, respeitando o intervalo. Sem marcar, termina quando as mídias acabam."
                      marcada={loopInfinito}
                      onChange={setLoopInfinito}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Cover */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Capa do Reel</h3>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Opcional — aplica a todos</span>
              </div>
              <div style={cardBodyStyle}>
                {/* Botões de origem */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button type="button"
                    onClick={() => setShowCoverPicker(true)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--mf-border)', background: coverLibFile ? 'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)' : 'var(--mf-border-subtle)', color: coverLibFile ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-2)', fontSize: 'var(--mf-t-xs)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    {/* `filename` não é obrigatório no modelo de mídia, então
                        pode chegar vazio. Antes isto era `.slice()` direto num
                        possível undefined, e a exceção derrubava o render
                        inteiro — a tela ficava em branco ao escolher a capa. */}
                    {nomeDaCapa ? nomeDaCapa.slice(0, 18) + (nomeDaCapa.length > 18 ? '…' : '') : 'Da biblioteca'}
                  </button>
                  <label style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--mf-border)', background: cover ? 'color-mix(in oklch, var(--mf-info-500) 8%, transparent)' : 'var(--mf-border-subtle)', color: cover ? 'var(--mf-info-500)' : 'var(--mf-text-2)', fontSize: 'var(--mf-t-xs)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all var(--mf-fast) var(--mf-ease-out)' }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { setCover(e.target.files?.[0] || null); setCoverLibFile(null); }} />
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    {cover ? cover.name.slice(0, 18) + '…' : 'Upload'}
                  </label>
                </div>
                {/* Preview / estado vazio */}
                {(cover || coverLibFile) ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    {cover
                      ? <img src={URL.createObjectURL(cover)} alt="Capa" style={{ height: 80, borderRadius: 'var(--mf-r-sm)', objectFit: 'cover', border: '1px solid var(--mf-border)' }} />
                      : <img src={urlDaCapa} alt="Capa" style={{ height: 80, borderRadius: 'var(--mf-r-sm)', objectFit: 'cover', border: '1px solid var(--mf-border)' }} />
                    }
                    <button type="button" onClick={() => { setCover(null); setCoverLibFile(null); }}
                      style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-danger-500)', border: 'none', color: 'var(--mf-text)', fontSize: 'var(--mf-t-micro)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontStyle: 'italic' }}>Sem capa — usa o primeiro frame do vídeo</div>
                )}
              </div>
            </div>

            {/* Caption */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Legenda</h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/legends')}>Gerenciar →</button>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{caption.length}/2200</span>
                </div>
              </div>
              <div style={cardBodyStyle}>
                {legends.length > 0 && (
                  <LegendDropdown
                    legends={legends}
                    value={selectedLegend}
                    onChange={id => {
                      setSelectedLegend(id);
                      const l = legends.find(l => l._id === id);
                      if (l) setCaption(l.text);
                      else if (!id) setCaption('');
                    }}
                  />
                )}
                <textarea className="txta"
                  placeholder="Escreva a legenda do seu post. Use #hashtags e {variáveis}."
                  value={caption} maxLength={2200} onChange={e => setCaption(e.target.value)} rows={4} />
                <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4, fontFamily: 'var(--mf-mono)' }}>
                  Variáveis: {'{data}'} {'{hora}'} {'{username}'} {'{nome}'} {'{cidade}'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={useRandomLegend}>Aleatória</button>
                </div>
                {/* CTA sufixo automático */}
                <div style={{ marginTop: 10, borderTop: '1px solid var(--mf-border)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ctaSuffix.enabled ? 8 : 0 }}>
                    <label style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={ctaSuffix.enabled} onChange={e => updateCtaSuffix({ enabled: e.target.checked })}
                        style={{ accentColor: 'var(--mf-mod, var(--mf-accent-500))', width: 14, height: 14 }} />
                      Sufixo automático na legenda
                    </label>
                    {ctaSuffix.enabled && (
                      <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>adicionado ao final</span>
                    )}
                  </div>
                  {ctaSuffix.enabled && (
                    <textarea
                      value={ctaSuffix.text}
                      onChange={e => updateCtaSuffix({ text: e.target.value })}
                      rows={2}
                      placeholder={`Ex: \n\n🔗 Link na bio`}
                      style={{ width:'100%', padding:'var(--mf-3)', borderRadius:'var(--mf-r-md)', border:'1px solid var(--mf-border)', background:'var(--mf-surface-2)', color:'var(--mf-text)', fontSize:'var(--mf-t-sm)', lineHeight:1.5, resize:'vertical', fontFamily:'inherit', boxSizing:'border-box', outline:'none' }}
                    />
                  )}
                </div>

                <div style={{ marginTop: 10, borderTop: '1px solid var(--mf-border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Localização (opcional)
                  </div>
                  <input className="inp" type="text" placeholder="Belo Horizonte, Brasil" value={location} onChange={e => setLocation(e.target.value)} list="brazil-cities" />
                  <datalist id="brazil-cities">
                    {['São Paulo','Rio de Janeiro','Belo Horizonte','Brasília','Salvador','Fortaleza','Curitiba','Manaus','Recife','Porto Alegre'].map(c => (
                      <option key={c} value={`${c}, Brasil`} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            {/* Engage Comment */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Pergunta de engajamento</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--mf-t-xs)', color: engageComment ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)' }}>
                  <input
                    type="checkbox"
                    checked={!!engageComment}
                    onChange={e => setEngageComment(e.target.checked ? 'O que acharam? 👇 Comenta aí!' : '')}
                  />
                  {engageComment ? 'Ativo' : 'Inativo'}
                </label>
              </div>
              {!!engageComment && (
                <div style={cardBodyStyle}>
                  <textarea className="txta" rows={2}
                    placeholder="Ex: Gostaram? Comenta aí! 👇"
                    value={engageComment}
                    onChange={e => setEngageComment(e.target.value)} />
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4 }}>
                    Postado ~60 min após publicar · estimula comentários pro algoritmo
                  </div>
                </div>
              )}
            </div>

            {/* CTA Comment */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Comentário fixado automático</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--mf-t-xs)', color: ctaComment ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)' }}>
                  <input
                    type="checkbox"
                    checked={!!ctaComment}
                    onChange={e => setCtaComment(e.target.checked ? '👇 Acesse meu bot gratuito no Telegram!\n🤖 {link}' : '')}
                  />
                  {ctaComment ? 'Ativo' : 'Inativo'}
                </label>
              </div>
              {!!ctaComment && (
                <div style={cardBodyStyle}>
                  <textarea className="txta" rows={3}
                    placeholder="Ex: 👇 Acesse meu bot no Telegram! {link}"
                    value={ctaComment}
                    onChange={e => setCtaComment(e.target.value)} />
                  <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4 }}>
                    Postado ~2 min após publicar · Use {'{link}'} {'{username}'} {'{nome}'}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── RIGHT COLUMN ── */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.06 }}
          >

            {/* Simultaneous publications */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Publicações simultâneas</h3>
                <span style={{ fontSize: 'var(--mf-t-micro)', fontFamily: 'var(--mf-mono)', background: 'color-mix(in oklch, var(--mf-primary-500) 10%, transparent)', color: 'var(--mf-mod, var(--mf-accent-500))', border: '1px solid color-mix(in oklch, var(--mf-primary-500) 20%, transparent)', borderRadius: 'var(--mf-r-full)', padding: '2px 8px' }}>
                  {simultaneousLimit === 1 ? 'Sequencial' : `Lotes de ${simultaneousLimit}`}
                </span>
              </div>
              <div style={cardBodyStyle}>
                <p style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', marginBottom: 12 }}>
                  Quantos reels entram em cada rodada. Dentro da rodada as publicações saem
                  uma a uma, com 2 a 5 min entre elas e ordem de contas sorteada.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>LOTE</span>
                  <span style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 900, color: 'var(--mf-info-500)', letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>{simultaneousLimit}</span>
                  <span style={{ fontSize: 'var(--mf-t-body)', color: 'var(--mf-text-3)' }}>/{Math.max(media.length, 1)} reels</span>
                </div>
                <input type="range" min="1" max={Math.max(media.length, 1)} value={Math.min(simultaneousLimit, Math.max(media.length, 1))}
                  onChange={e => setSimultaneousLimit(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--mf-info-500)', cursor: 'pointer' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4, fontFamily: 'var(--mf-mono)' }}>
                  <span>1</span><span>{Math.max(media.length, 1)}</span>
                </div>
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'color-mix(in oklch, var(--mf-info-500) 6%, transparent)', borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-info-500) 15%, transparent)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-info-500)', lineHeight: 1.5 }}>
                  {simultaneousLimit === 1
                    ? 'Sequencial — 1 reel por rodada, enviado conta a conta com intervalo humano entre cada publicação.'
                    : `Lotes de ${simultaneousLimit} — reels 1–${simultaneousLimit} entram na mesma rodada, mas as publicações saem uma de cada vez: nenhuma conta recebe dois posts seguidos.`
                  }
                </div>
              </div>
            </div>

            {/* ── Ritmo: intervalo, teto por conta e início ─────────────────
                Os três andam juntos porque respondem à mesma pergunta — quanto
                esta conta publica por dia — vista de três ângulos. O resumo
                verde fecha a conta, que é o que ninguém faz de cabeça. */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Configurações de envio</h3>
                <span style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-info-500)', fontWeight: 700, fontFamily: 'var(--mf-mono)' }}>
                  {rotuloDeIntervalo(intervalMins)}
                </span>
              </div>
              <div style={cardBodyStyle}>

                <label style={rotuloForm}>Nome deste envio</label>
                <input className="inp" value={nomeDoEnvio} onChange={e => setNomeDoEnvio(e.target.value)}
                  placeholder="Ex: Aquecimento — Contas Novas" />

                {/* Aquecimento é um preset, não um módulo à parte: ele só move
                    intervalo e teto para valores de conta nova. Dizer os
                    números no rótulo evita ter de adivinhar o que ele fez. */}
                <ChaveDeOpcao
                  titulo="Envio de aquecimento"
                  descricao="Conta nova, ritmo de conta nova: 1 post a cada 3h, teto de 4 por dia. Marcar ajusta o intervalo e o teto abaixo."
                  marcada={aquecimento}
                  onChange={v => {
                    setAquecimento(v);
                    if (v) { setIntervalMins(180); setPostsPor24h(4); }
                  }}
                />

                <label style={{ ...rotuloForm, marginTop: 18 }}>Intervalo entre posts</label>
                <input type="range" min="1" max="240" step="1" value={Math.max(1, intervalMins)}
                  onChange={e => setIntervalMins(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--mf-info-500)', cursor: 'pointer' }} />
                <Atalhos
                  opcoes={[[10, '10 min'], [30, '30 min'], [60, '1 hora'], [240, '4 horas']]}
                  atual={intervalMins}
                  onEscolher={setIntervalMins}
                />

                <label style={{ ...rotuloForm, marginTop: 18 }}>Postagens por conta em 24h</label>
                <input className="inp" type="number" min="1" max="48" value={postsPor24h}
                  onChange={e => setPostsPor24h(Math.min(48, Math.max(1, Number(e.target.value) || 1)))} />
                <Atalhos
                  opcoes={[[6, '6'], [10, '10'], [24, '24'], [48, '48']]}
                  atual={postsPor24h}
                  onEscolher={setPostsPor24h}
                />
                {/* O efeito colateral, escrito. Este número mora na CONTA
                    (`dailyPostLimit`), não no envio — é o campo que o
                    planejador e a verificação de publicação já obedecem. */}
                <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 7, lineHeight: 1.6 }}>
                  Vale para as contas selecionadas de agora em diante, não só para este envio.
                </div>

                {/* O aviso que eu não posso deixar de dar: 6 a 10 por dia é o
                    que o sistema sorteia por padrão, e esse número saiu da
                    correção de "as contas não estão aguentando". */}
                {postsPor24h > 10 && (
                  <div style={{ marginTop: 9, padding: '9px 11px', borderRadius: 'var(--mf-r-sm)',
                    background: 'color-mix(in oklch, var(--mf-warning-500) 9%, transparent)',
                    border: '1px solid color-mix(in oklch, var(--mf-warning-500) 26%, transparent)',
                    fontSize: 'var(--mf-t-nano)', color: 'var(--mf-warning-500)', lineHeight: 1.65 }}>
                    Acima de 10 por dia. O sistema sorteia 6 a 10 por conta justamente
                    porque o padrão anterior — dezenas por dia, dia e noite — foi a causa
                    mais provável de as contas pararem de entregar. É sua escolha, mas é
                    esta a troca.
                  </div>
                )}

                {/* O resumo fecha a conta: quantas, de quanto em quanto, e
                    quantas horas do dia isso ocupa. Passando de 24h, o próprio
                    teto deixa de caber no dia — e é melhor saber antes. */}
                {(() => {
                  const horas = (postsPor24h * intervalMins) / 60;
                  const cabe = horas <= 24;
                  const tom = cabe ? 'var(--mf-success-500)' : 'var(--mf-danger-500)';
                  return (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 'var(--mf-r-sm)',
                      background: `color-mix(in oklch, ${tom} 9%, transparent)`,
                      border: `1px solid color-mix(in oklch, ${tom} 26%, transparent)`,
                      fontSize: 'var(--mf-t-micro)', color: tom, lineHeight: 1.6 }}>
                      {cabe
                        ? `${postsPor24h} posts por conta em 24h, um a cada ${rotuloDeIntervalo(intervalMins)} (ocupa ${horas.toFixed(horas % 1 ? 1 : 0)}h do dia).`
                        : `${postsPor24h} posts a cada ${rotuloDeIntervalo(intervalMins)} pedem ${horas.toFixed(0)}h — não cabe em 24h. O teto será alcançado antes; reduza um dos dois.`}
                    </div>
                  );
                })()}

                <label style={{ ...rotuloForm, marginTop: 18 }}>Quando começar a postar?</label>
                <Atalhos
                  opcoes={INICIOS.map(i => [i.id, i.rotulo])}
                  atual={inicioEscolhido}
                  onEscolher={id => {
                    setInicioEscolhido(id);
                    const quando = INICIOS.find(i => i.id === id)?.quando?.();
                    /* 'escolher' não calcula data nenhuma: ele só abre o campo
                       abaixo, e é o campo que manda. */
                    setScheduledAt(quando ? paraCampoLocal(quando) : '');
                  }}
                />
                {inicioEscolhido === 'escolher' && (
                  <input className="inp" type="datetime-local" style={{ marginTop: 8 }}
                    value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                )}
                <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 7, lineHeight: 1.6 }}>
                  {scheduledAt
                    ? `Começa em ${new Date(scheduledAt).toLocaleString('pt-BR')} — os próximos seguem o intervalo acima.`
                    : 'Começa agora — os próximos posts seguem o intervalo definido acima.'}
                </div>
              </div>
            </div>

            {/* Processing mode */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Modo de processamento</h3>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>Limpeza aplicada</span>
              </div>
              <div style={cardBodyStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {processModes.map(m => (
                    <div key={m.id} onClick={() => setProcessMode(m.id)}
                      style={{
                        padding: '8px 12px', borderRadius: 'var(--mf-r-md)', cursor: 'pointer', border: '1px solid',
                        background: processMode === m.id ? `${m.color}14` : 'color-mix(in oklch, var(--mf-bg) 50%, transparent)',
                        borderColor: processMode === m.id ? `${m.color}44` : 'var(--mf-border)',
                        transition: 'all var(--mf-fast) var(--mf-ease-out)',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 600, color: processMode === m.id ? m.color : 'var(--mf-text)' }}>{m.label}</span>
                        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 4px', borderRadius: 'var(--mf-r-xs)', background: `${m.color}22`, color: m.color, fontFamily: 'var(--mf-mono)' }}>{m.tag}</span>
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{m.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Accounts */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>
                <h3 style={cardH3Style}>Contas</h3>
              </div>
              <div style={cardBodyStyle}>
                <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', marginBottom: 10 }}>
                  Selecione onde publicar — cada conta posta 1 vez por mídia
                </div>

                <AccountPicker
                  accounts={accounts}
                  selected={selectedAccounts}
                  onChange={setSelectedAccounts}
                />

                {/* ── Marca d'água ──────────────────────────────────────────
                    Fica junto às contas porque o texto dela É o @ da conta:
                    não há um texto a escrever, e a única pergunta é como
                    desenhar. `type="button"` porque estamos dentro do form —
                    sem isso, abrir o modal publicaria. */}
                <button type="button" onClick={() => setMarcaModal(true)}
                  className={marcaDagua.ativa ? 'btn-ghost tom-modulo' : 'btn-ghost'}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 10,
                    ...(marcaDagua.ativa ? {
                      '--tom': 'var(--mf-mod-publicar)',
                      color: 'var(--mf-mod-publicar)',
                      background: 'color-mix(in oklch, var(--mf-mod-publicar) 10%, transparent)',
                    } : {}) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                  </svg>
                  {marcaDagua.ativa
                    ? `Marca d'água ativa — ${marcaDagua.posicao}, ${marcaDagua.opacidade}%`
                    : "Adicionar marca d'água"}
                </button>

                {/* Summary */}
                <div className="g3" style={{ gap: 6, marginTop: 12 }}>
                  {[['Mídias', media.length, 'var(--mf-info-500)'], ['Contas', selectedCount, 'var(--mf-mod-publicar)'], ['Total', totalEstimated, 'var(--mf-mod, var(--mf-accent-500))']].map(([l, v, c]) => (
                    <div key={l} style={{ textAlign:'center', background:'var(--mf-surface-2)', borderRadius:'var(--mf-r-md)', padding:'var(--mf-2) var(--mf-1)', border:'1px solid var(--mf-border)', minWidth:0 }}>
                      <div style={{ fontSize: 'var(--mf-t-h1)', fontWeight: 900, letterSpacing: -1, color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 2, fontFamily: 'var(--mf-mono)' }}>{l}</div>
                    </div>
                  ))}
                </div>

                <button className="btn-primary" type="submit" disabled={posting}
                  style={{
                    width: '100%', justifyContent: 'center', padding: '12px', marginTop: 12,
                    fontSize: 'var(--mf-t-body)', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 'var(--mf-r-md)',
                    transition: 'all var(--mf-normal) var(--mf-ease-out)',
                    background: posted
                      ? 'linear-gradient(135deg,var(--mf-success-500),#059669)'
                      : undefined,
                    opacity: posting ? 0.85 : 1,
                  }}>
                  {posting ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                      Publicando...
                    </>
                  ) : posted ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
                      Publicado!
                    </>
                  ) : (
                    scheduledAt ? 'Agendar postagens' : 'Publicar agora'
                  )}
                </button>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            </div>
          </motion.div>
        </form>

        {/* Fora do <form> de propósito: dentro dele, o Enter num controle do
            modal submeteria a publicação. */}
        <MarcaDaguaModal
          aberto={marcaModal}
          valor={marcaDagua}
          contas={selectedCount}
          mod="publicar"
          onCancelar={() => setMarcaModal(false)}
          onAplicar={c => { setMarcaDagua(c); setMarcaModal(false); }}
        />

        {/* Posts list */}
        {posts.length > 0 && (
          <div style={{ ...cardStyle, marginTop: 4 }}>
            <div style={cardHdStyle}>
              <h3 style={cardH3Style}>Posts registrados</h3>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{postPagination?.total || posts.length} no total</span>
            </div>
            <div className="queue-list">
              {primeiraCarga && !posts.length && <EsqueletoLista itens={5} />}
              {posts.map(post => (
                <div className="queue-row" key={post._id}>
                  <div className="queue-icon" style={{ background: post.postType === 'reel' ? 'var(--indigo-dim)' : 'var(--cyan-dim)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {post.postType === 'reel'
                        ? <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>
                        : <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>
                      }
                    </svg>
                  </div>
                  <div className="queue-info">
                    <strong>{post.postType === 'reel' ? 'Reel' : 'Post'}</strong>
                    <span>{post.accounts?.map(a => `@${a.username}`).join(', ') || 'Sem conta'}</span>
                    {post.error && <em style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', display: 'block', marginTop: 1 }}>{post.error}</em>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className={`badge ${statusBadgeClass(post.status)}`}>{post.status}</span>
                    <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>
                      {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('pt-BR') : new Date(post.createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  {['erro', 'parcial', 'cancelado'].includes(post.status) && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => retryPost(post._id)} disabled={retryingId === post._id}>
                      {retryingId === post._id ? '...' : '↺ Retry'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {postPagination && postPagination.pages > 1 && (
              <div className="pagination">
                <button className="btn btn-ghost btn-sm" disabled={postPage <= 1} onClick={() => goToPostPage(postPage - 1)}>← Anterior</button>
                <span>Página {postPagination.page} de {postPagination.pages} · {postPagination.total} posts</span>
                <button className="btn btn-ghost btn-sm" disabled={postPage >= postPagination.pages} onClick={() => goToPostPage(postPage + 1)}>Próxima →</button>
              </div>
            )}
          </div>
        )}
      </PageShell>
    </>
  );
}

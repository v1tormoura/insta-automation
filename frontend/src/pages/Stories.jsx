import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import AccountPicker from '../components/AccountPicker';
import useServerEvents from '../services/useServerEvents';
import { EsqueletoLista } from '../components/Estados';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const DRAFT_KEY = 'stories_form_draft_v1';

function fmt(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function Stories() {
  const [accounts, setAccounts]       = useState([]);
  const [contasCarregando, setContasCarregando] = useState(true);
  const [selected, setSelected]       = useState([]);
  const [medias, setMedias]           = useState([]);   // { file, url, name, size, type, fromLib, id }
  const [uploading, setUploading]     = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const [gridMode, setGridMode]       = useState(true);
  const [linkOn, setLinkOn]           = useState(false);
  const [linkUrl, setLinkUrl]         = useState('');
  const [linkLabel, setLinkLabel]     = useState('');
  /* Posição do link sticker em coordenadas normalizadas (0..1) do story, onde
     x/y é o CENTRO do sticker. Padrão 0.5/0.8 = rodapé, como o app faz. */
  const [linkPos, setLinkPos]         = useState({ x: 0.5, y: 0.8 });
  const [interval, setIntervalMin]    = useState(3);
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState(null);
  const [bgStatus, setBgStatus]       = useState(null);
  const [toast, setToast]             = useState(null);
  const fileRef = useRef();

  function showToast(type, t, msg) { setToast({ type, title: t, message: msg }); setTimeout(() => setToast(null), 3500); }

  /* Converte o clique no preview 9:16 em coordenadas normalizadas do story.
     É o mesmo sistema que o Instagram usa: 0,0 é o canto superior esquerdo. */
  function coordenadasDoEvento(elemento, clientX, clientY) {
    const r = elemento.getBoundingClientRect();
    return {
      x: Number(Math.min(1, Math.max(0, (clientX - r.left) / r.width)).toFixed(3)),
      y: Number(Math.min(1, Math.max(0, (clientY - r.top) / r.height)).toFixed(3)),
    };
  }

  function posicionarSticker(e) {
    setLinkPos(coordenadasDoEvento(e.currentTarget, e.clientX, e.clientY));
  }

  /* ── Arrastar a figurinha ─────────────────────────────────────────────────

     Clicar já posicionava, e clicar é bom para um salto grande. Mas ajustar
     dois por cento é uma sequência de cliques às cegas — você não vê o
     resultado enquanto mira, só depois de soltar. Arrastando, a pílula
     acompanha o dedo e a posição final é a que você viu antes de largar.

     `setPointerCapture` é o que faz o gesto sobreviver a sair da caixa: sem
     ele, arrastar um pouco além da borda entrega o evento a outro elemento e o
     movimento morre no meio, deixando a figurinha onde não se queria. */
  /* Largura do preview e a altura que ela implica no 9:16. Numa constante
     porque a fonte da pílula é calculada a partir dela: com o número repetido,
     mudar a largura da caixa deixaria a fonte para trás e o preview voltaria a
     divergir do que é queimado. */
  const PREVIEW_LARGURA = 260;
  const PREVIEW_ALTURA  = Math.round(PREVIEW_LARGURA * 16 / 9);

  const [arrastando, setArrastando] = useState(false);

  function iniciarArrasto(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setArrastando(true);
    setLinkPos(coordenadasDoEvento(e.currentTarget, e.clientX, e.clientY));
  }

  function moverArrasto(e) {
    if (!arrastando) return;
    e.preventDefault();
    setLinkPos(coordenadasDoEvento(e.currentTarget, e.clientX, e.clientY));
  }

  function soltarArrasto(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setArrastando(false);
  }

  /**
   * O corte que o renderizador aplica quando o texto não cabe na pílula.
   *
   * Espelha `gerarPngFfmpeg`: `maxChars = (largura - altura*1.1) / (fonte*0.58)`,
   * com a fonte em 34% da altura. É corte seco, sem reticência — e por isso o
   * preview precisa mostrá-lo: com reticência a pessoa entende "tem mais
   * texto"; com corte seco ela precisa ver que o fim sumiu, para encurtar.
   *
   * Ao mexer em um dos dois lados, mexa no outro.
   */
  function cortarComoOBackend(texto, larguraPx, alturaPx) {
    const tamanho = Math.round(alturaPx * 0.34);
    const maxChars = Math.max(6, Math.floor((larguraPx - alturaPx * 1.1) / (tamanho * 0.58)));
    const g = [...String(texto)];
    return g.length <= maxChars ? String(texto) : g.slice(0, maxChars).join('');
  }

  /* A figurinha resolvida: rótulo, caixa e o corte que o renderizador aplicaria.
     Num lugar só — a pílula do preview e o aviso de corte precisam do MESMO
     resultado, e recalcular em cada um abriria a porta para eles discordarem. */
  const figurinha = useMemo(() => {
    const cheio = rotuloSticker(linkUrl, linkLabel);
    const caixa = caixaSticker(cheio, linkPos.x, linkPos.y);
    const visivel = cortarComoOBackend(cheio, caixa.width * 1080, 96);
    return { cheio, caixa, visivel, cortado: visivel.length < cheio.length };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [linkUrl, linkLabel, linkPos.x, linkPos.y]);

  const PRESETS_STICKER = [
    { rotulo: 'Topo',   x: 0.5, y: 0.15 },
    { rotulo: 'Centro', x: 0.5, y: 0.5  },
    { rotulo: 'Rodapé', x: 0.5, y: 0.8  },
  ];

  /* Geometria da figurinha — espelha computeStickerBox() em
     backend/src/services/storyStickerRenderer.js. Mesma conta dos dois lados
     para o preview mostrar exatamente a pílula que será queimada na mídia.
     Ao mexer em uma, mexa na outra. */
  function caixaSticker(label, x, y) {
    const STORY_W = 1080, STORY_H = 1920, ALTURA = 96, MARGEM = 28;
    const texto = String(label || 'ACESSAR LINK');
    /* Largura do texto medida no Chromium com a fonte da pílula: maiúsculas
       ~23px, minúsculas ~18px, espaço ~12px. Mais o cromo fixo (ícone,
       chevron, paddings) = 165. */
    const larguraTexto = [...texto].reduce((acc, c) => {
      if (c === ' ') return acc + 12;
      const minuscula = c === c.toLowerCase() && c !== c.toUpperCase();
      return acc + (minuscula ? 18 : 23);
    }, 0);
    const larg  = Math.min(900, Math.max(360, Math.round(larguraTexto + 165)));
    const cx = Math.min(STORY_W - larg / 2 - MARGEM, Math.max(larg / 2 + MARGEM, x * STORY_W));
    const cy = Math.min(STORY_H - ALTURA / 2 - MARGEM, Math.max(ALTURA / 2 + MARGEM, y * STORY_H));
    return {
      x: cx / STORY_W, y: cy / STORY_H,
      width: larg / STORY_W, height: ALTURA / STORY_H,
    };
  }

  /* Mesmo rótulo que o backend usa quando o texto não é preenchido. */
  function rotuloSticker(url, texto) {
    if (texto && texto.trim()) return texto.trim().slice(0, 35);
    try {
      const u = new URL(String(url).startsWith('http') ? url : `https://${url}`);
      const host = u.hostname.replace(/^www\./i, '');
      const rota = u.pathname.replace(/\/$/, '');
      return (rota && rota.length <= 18 ? `${host}${rota}` : host).toUpperCase();
    } catch { return 'ACESSAR LINK'; }
  }

  /* ── Recupera rascunho salvo ao abrir ou voltar para a página ────────────── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.linkUrl !== undefined) setLinkUrl(d.linkUrl);
        if (d.linkLabel !== undefined) setLinkLabel(d.linkLabel);
        if (d.linkOn !== undefined) setLinkOn(d.linkOn);
        if (d.linkPos) setLinkPos(d.linkPos);
        if (d.interval !== undefined) setIntervalMin(d.interval);
        if (Array.isArray(d.medias) && d.medias.length) setMedias(d.medias);
        if (Array.isArray(d.selected) && d.selected.length) setSelected(d.selected);
      }
    } catch {}

    // Verifica status de envio em segundo plano
    api.get('/api/stories/status').then(r => {
      if (r.data?.running) setBgStatus(r.data);
    /* `finally` no FIM da cadeia. Encaixado antes do `then`, ele desligaria a
       bandeira enquanto as contas ainda não entraram no estado, e o seletor
       apareceria vazio por um quadro antes de preencher. */
    }).catch(() => { /* a tela mostra o seletor vazio */ })
      .finally(() => setContasCarregando(false));
  }, []);

  /* ── Salva rascunho automaticamente a cada alteração ───────────────────── */
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        linkUrl, linkLabel, linkOn, linkPos, interval, medias, selected
      }));
    } catch {}
  }, [linkUrl, linkLabel, linkOn, linkPos, interval, medias, selected]);

  useEffect(() => {
    api.get('/accounts').then(r => {
      const accs = r.data.accounts || r.data || [];
      setAccounts(accs);
      /* Nenhuma conta vem marcada.

         Antes todas as conectadas entravam selecionadas. Numa tela cujo botão
         se chama "Publicar agora", um estado inicial que já escolheu por você
         é a forma mais fácil de publicar na conta errada — e o erro é público
         e não se desfaz. Marcar quatro contas custa quatro cliques; despublicar
         um story de uma conta que não era para ter recebido, não custa nada
         porque não dá.

         O rascunho continua sendo restaurado (mais acima): retomar o que VOCÊ
         escolheu é diferente de escolher por você. */
    }).catch(() => {});
  }, []);

  // Escuta eventos SSE em tempo real de stories
  useServerEvents(['stories', 'posts'], (ev) => {
    if (ev?.action === 'progress') {
      setBgStatus(prev => ({ ...(prev || {}), running: true, completed: ev.completed, total: ev.total, lastUser: ev.username }));
    } else if (ev?.action === 'completed') {
      setBgStatus(null);
      showToast('success', 'Stories Concluídos!', 'Todos os stories agendados foram publicados.');
    }
  });

  async function addFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      for (const f of list) {
        const form = new FormData();
        form.append('image', f);
        const { data } = await api.post('/api/stories/upload', form);
        setMedias(p => [...p, {
          id: data.url + Date.now(),
          url: data.url.startsWith('http') ? data.url : `${API}${data.url}`,
          name: f.name,
          size: f.size,
          type: f.type.startsWith('video') ? 'video' : 'image',
          selected: true,
        }]);
      }
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha no upload.'); }
    finally { setUploading(false); }
  }

  function toggleMedia(id) {
    setMedias(p => p.map(m => m.id === id ? { ...m, selected: !m.selected } : m));
  }
  function removeMedia(id) { setMedias(p => p.filter(m => m.id !== id)); }
  function selectAllMedia() { setMedias(p => p.map(m => ({ ...m, selected: true }))); }
  function clearSelection() { setMedias(p => p.map(m => ({ ...m, selected: false }))); }

  const selectedMedia = medias.filter(m => m.selected);
  const totalMin = Math.max(0, (selectedMedia.length - 1)) * interval;

  async function publish() {
    if (!selected.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma conta.');
    if (!selectedMedia.length) return showToast('warning', 'Atenção', 'Adicione pelo menos uma mídia.');
    setLoading(true); setResults(null);
    try {
      const { data } = await api.post('/api/stories', {
        accountIds: selected,
        imageUrl: selectedMedia[0].url,
        linkUrl: linkOn && linkUrl.trim() ? linkUrl.trim() : null,
        linkText: linkOn && linkLabel.trim() ? linkLabel.trim() : null,
        ...(linkOn ? { linkX: linkPos.x, linkY: linkPos.y } : {}),
        mediaUrls: selectedMedia.map(m => m.url),
        intervalMinutes: interval,
      });
      setResults(data);
      if (data.inBackground) {
        setBgStatus({ running: true, total: selected.length, completed: 0 });
        showToast('success', 'Publicação iniciada!', data.message || 'Stories em execução em segundo plano.');
      } else {
        showToast('success', 'Publicado!', `${data.successCount || 0} de ${data.total || selected.length} publicados.`);
      }
      setMedias([]);
      setLinkUrl('');
      setLinkLabel('');
      setLinkOn(false);
      setIntervalMin(1);
    } catch (e) { showToast('error', 'Erro', e.response?.data?.error || 'Falha ao publicar.'); }
    finally { setLoading(false); }
  }

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );

  const pageActions = (
    <button
      onClick={publish}
      disabled={loading || !selected.length || !selectedMedia.length}
      className="btn-primary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, opacity: (loading || !selected.length || !selectedMedia.length) ? 0.5 : 1 }}
    >
      {loading ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          Iniciando...
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Publicar agora
        </>
      )}
    </button>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageShell
        icon={pageIcon}
        title="Stories em Massa"
        subtitle="Publique fotos e vídeos em todas as contas conectadas"
        accent="purple"
        actions={pageActions}
      >
        {/* Banner de status em segundo plano */}
        {bgStatus?.running && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 600, color: 'var(--mf-mod, var(--mf-accent-500))' }}>
                Publicação de stories em segundo plano ativa ({bgStatus.completed || 0}/{bgStatus.total || selected.length})
              </span>
            </div>
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>Você pode navegar livremente</span>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          {[
            { label: 'Contas', val: `${selected.length}/${accounts.length}`, color: 'var(--mf-mod, var(--mf-accent-500))' },
            { label: 'Mídias', val: `${selectedMedia.length}/${medias.length}`, color: 'var(--mf-mod-publicar)' },
            { label: 'Duração', val: totalMin < 60 ? `${totalMin} min` : `${(totalMin/60).toFixed(1)}h`, color: 'var(--mf-warning-500)' },
            { label: 'Intervalo', val: `${interval} min`, color: 'var(--mf-success-500)' },
          ].map(s => (
            <div key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px', borderRadius: 'var(--mf-r-sm)', background: 'color-mix(in oklch, var(--mf-bg) 60%, transparent)', border: '1px solid var(--mf-border)', fontSize: 'var(--mf-t-micro)' }}>
              <span style={{ color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{s.label}</span>
              <strong style={{ color: s.color, fontFamily: 'var(--mf-mono)' }}>{s.val}</strong>
            </div>
          ))}
        </div>

        {/* Workspace */}
        <div className="layout-2col">

          {/* ── Left: Mídias ── */}
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div style={PANEL}>
              {/* Panel heading */}
              <div style={PANEL_HEAD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--mf-2)', flexWrap: 'wrap', minWidth: 0 }}>
                  <h3 style={PANEL_TITLE}>Mídias do story</h3>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{selectedMedia.length} de {medias.length > 0 ? medias.length : 60} selecionadas</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-2)', flexWrap: 'wrap', minWidth: 0 }}>
                  <label style={DARK_BTN}>
                    <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                      onChange={e => addFiles(e.target.files)} />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    {uploading ? 'Enviando...' : 'Adicionar mídias'}
                  </label>
                  <button onClick={() => setGridMode(true)} style={{ ...VIEW_BTN, ...(gridMode ? VIEW_BTN_ON : {}) }} title="Grade">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  </button>
                  <button onClick={() => setGridMode(false)} style={{ ...VIEW_BTN, ...(!gridMode ? VIEW_BTN_ON : {}) }} title="Lista">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  </button>
                </div>
              </div>

              {/* Dropzone */}
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                style={{
                  margin: '0 19px', height: 112,
                  border: `1.5px dashed ${dragOver ? 'var(--mf-mod, var(--mf-accent-500))' : 'color-mix(in oklch, var(--mf-primary-500) 30%, transparent)'}`,
                  borderRadius: 'var(--mf-r-md)',
                  background: dragOver ? 'color-mix(in oklch, var(--mf-primary-500) 6%, transparent)' : 'color-mix(in oklch, var(--mf-primary-500) 2%, transparent)',
                  display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 7, cursor: 'pointer', transition: 'all var(--mf-normal) var(--mf-ease-out)',
                }}>
                <input type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                <div style={{ width: 34, height: 34, borderRadius: 'var(--mf-r-md)', background: 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--mf-mod, var(--mf-accent-500))' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                </div>
                <strong style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>Arraste fotos ou vídeos para enviar</strong>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>MP4, MOV, JPG, PNG <em style={{ fontStyle: 'normal', color: 'var(--mf-border-strong)' }}>(máx. 200MB por arquivo)</em></span>
              </label>

              {/* Grid */}
              {medias.length > 0 && (
                <div className={gridMode ? 'stories-media-grid' : ''}
                  style={{
                    padding: '16px 16px 8px',
                    display: 'grid',
                    gridTemplateColumns: gridMode ? undefined : '1fr',
                    gap: 10, maxHeight: 330, overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                  }}>
                  {medias.map(m => gridMode ? (
                    <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                      position: 'relative', height: 165,
                      border: `1px solid ${m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
                      background: 'var(--mf-bg)', borderRadius: 'var(--mf-r-sm)', overflow: 'hidden', cursor: 'pointer', transition: '.18s',
                      boxShadow: m.selected ? '0 0 0 2px color-mix(in oklch, var(--mf-primary-500) 20%, transparent)' : 'none',
                    }}>
                      <div style={{ height: 138, overflow: 'hidden', background: 'var(--mf-bg)', position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 60%,oklch(0 0 0 / 0.52))' }} />
                        {m.type === 'video'
                          ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        }
                        <div style={{ position: 'absolute', left: 8, top: 8, width: 18, height: 18, borderRadius: 'var(--mf-r-full)', display: 'grid', placeItems: 'center', background: m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-surface-1)', border: `1px solid ${m.selected ? 'var(--mf-surface-3)' : 'var(--mf-border-strong)'}`, boxShadow: '0 3px 9px oklch(0 0 0 / 0.3)', color: 'var(--mf-bg)', zIndex: 1 }}>
                          {m.selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                      <div style={{ height: 27, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-2)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', fontFamily: 'var(--mf-mono)' }}>{m.name}</span>
                        <button onClick={e => { e.stopPropagation(); removeMedia(m.id); }} style={{ background: 'none', border: 'none', color: 'var(--mf-text-3)', cursor: 'pointer', fontSize: 'var(--mf-t-sm)', lineHeight: 1 }}>×</button>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} onClick={() => toggleMedia(m.id)} style={{
                      display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'center', gap: 10,
                      height: 52, border: `1px solid ${m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border)'}`,
                      background: 'var(--mf-bg)', borderRadius: 'var(--mf-r-sm)', overflow: 'hidden', cursor: 'pointer', padding: '0 12px 0 0',
                    }}>
                      <div style={{ height: '100%', overflow: 'hidden', background: 'var(--mf-bg)' }}>
                        {m.type === 'video'
                          ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        }
                      </div>
                      <span style={{ fontSize: 'var(--mf-t-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--mf-text-2)', fontFamily: 'var(--mf-mono)' }}>{m.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{fmt(m.size)}</span>
                        <div style={{ width: 17, height: 17, borderRadius: 'var(--mf-r-xs)', display: 'grid', placeItems: 'center', border: `1px solid ${m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border-strong)'}`, background: m.selected ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent', color: 'var(--mf-bg)' }}>
                          {m.selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div style={{ minHeight: 54, borderTop: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', flexWrap: 'wrap', gap: 8, marginTop: medias.length > 0 ? 0 : 4 }}>
                <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-mod, var(--mf-accent-500))', fontFamily: 'var(--mf-mono)' }}>{selectedMedia.length} selecionadas</span>
                <div style={{ display: 'flex', gap: 20 }}>
                  <button onClick={clearSelection} style={{ background: 'transparent', border: 'none', color: 'var(--mf-danger-500)', fontSize: 'var(--mf-t-micro)', fontWeight: 600, cursor: 'pointer' }}>Limpar seleção</button>
                  <button onClick={selectAllMedia} style={{ background: 'transparent', border: 'none', color: 'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-micro)', fontWeight: 600, cursor: 'pointer' }}>Selecionar todas</button>
                </div>
              </div>
            </div>

            {/* Resultados */}
            {results && (
              <div style={PANEL}>
                <div style={PANEL_HEAD}>
                  <h3 style={PANEL_TITLE}>Resultado</h3>
                  <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'var(--mf-mono)' }}>{results.successCount} de {results.total} publicados</span>
                </div>
                <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(results.results || []).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--mf-border)', fontSize: 'var(--mf-t-xs)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 'var(--mf-r-full)', background: r.status === 'success' ? 'var(--mf-success-500)' : 'var(--mf-danger-500)', flexShrink: 0, display: 'inline-block' }} />
                      <strong>@{r.username}</strong>
                      <span style={{ color: r.status === 'success' ? 'var(--mf-success-500)' : 'var(--mf-danger-500)', flex: 1 }}>
                        {r.status === 'success' ? (r.method === 'graph' ? 'Graph API' : 'API Privada') + (r.withLink ? ' + link' : '') : r.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          {/* ── Right column ── */}
          <motion.div
            className="stories-right-col"
            style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.06 }}
          >

            {/* Contas */}
            <div style={PANEL}>
              <div style={{ ...PANEL_HEAD, borderRadius: '11px 11px 0 0' }}>
                <h3 style={PANEL_TITLE}>Contas</h3>
              </div>
              <div style={{ padding: '8px 12px 12px' }}>
                {contasCarregando && !accounts.length
                  ? <EsqueletoLista itens={3} />
                  : <AccountPicker
                      accounts={accounts}
                      selected={selected}
                      onChange={setSelected}
                    />}
              </div>
            </div>

            {/* Intervalo */}
            <div style={PANEL}>
              <div style={{ minHeight: 56, padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ ...PANEL_TITLE, margin: 0 }}>Intervalo entre stories</h3>
                  <p style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', margin: '4px 0 0' }}>Aguarda este tempo entre cada publicação.</p>
                </div>
              </div>
              <div style={{ padding: '4px 16px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', marginBottom: 8 }}>
                  <span>Intervalo entre stories</span>
                  <strong style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)' }}>{interval} {interval === 1 ? 'minuto' : 'minutos'}</strong>
                </div>
                <input type="range" min={1} max={15} value={interval} onChange={e => setIntervalMin(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--mf-mod, var(--mf-accent-500))', margin: '0 0 4px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', fontFamily: 'var(--mf-mono)' }}>
                  <span>1 min</span><span>15 min</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', borderTop: '1px solid var(--mf-border)', marginTop: 10, paddingTop: 10 }}>
                  <span>Duração total estimada</span>
                  <strong style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text)', fontFamily: 'var(--mf-mono)' }}>{totalMin} {totalMin === 1 ? 'minuto' : 'minutos'}</strong>
                </div>
              </div>
            </div>

            {/* Link sticker + Publicar */}
            <div style={{ ...PANEL, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ ...PANEL_TITLE, margin: 0 }}>Link sticker no story</h3>
                  <p style={{ margin: '3px 0 0', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>Figurinha clicável — contas API Mobile e OAuth</p>
                </div>
                <button onClick={() => setLinkOn(p => !p)} style={{
                  width: 31, height: 19, borderRadius: 'var(--mf-r-full)', padding: 2,
                  background: linkOn ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-bg)', border: '1px solid var(--mf-border)', cursor: 'pointer',
                  display: 'flex', justifyContent: linkOn ? 'flex-end' : 'flex-start', transition: 'all var(--mf-normal) var(--mf-ease-out)', flexShrink: 0,
                }}>
                  <span style={{ width: 13, height: 13, borderRadius: 'var(--mf-r-full)', background: linkOn ? 'var(--mf-bg)' : 'var(--mf-text-3)', transition: 'all var(--mf-normal) var(--mf-ease-out)', display: 'block' }} />
                </button>
              </div>

              {linkOn && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  <div style={{ height: 35, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', background: 'var(--mf-bg)', border: '1px solid color-mix(in oklch, var(--mf-primary-500) 25%, transparent)', borderRadius: 'var(--mf-r-sm)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                    <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://meusite.com/oferta"
                      style={{ flex: 1, minWidth: 0, outline: 'none', border: 'none', background: 'transparent', color: 'var(--mf-text)', fontSize: 'var(--mf-t-micro)' }} />
                  </div>
                  <div style={{ height: 35, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', background: 'var(--mf-bg)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-sm)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text-3)" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <input type="text" value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Texto do sticker (ex: Ver oferta, Clique aqui)"
                      maxLength={35}
                      style={{ flex: 1, minWidth: 0, outline: 'none', border: 'none', background: 'transparent', color: 'var(--mf-text)', fontSize: 'var(--mf-t-micro)' }} />
                    <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', flexShrink: 0, fontFamily: 'var(--mf-mono)' }}>{linkLabel.length}/35</span>
                  </div>

                  {/* ── Posicionador do sticker ──────────────────────────────
                      Clique no preview define onde a figurinha fica. As
                      coordenadas são normalizadas (0..1) e x/y é o centro do
                      sticker — mesmo sistema que o Instagram usa. */}
                  <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                    <div
                      onClick={posicionarSticker}
                      onPointerDown={iniciarArrasto}
                      onPointerMove={moverArrasto}
                      onPointerUp={soltarArrasto}
                      onPointerCancel={soltarArrasto}
                      title="Arraste a figurinha, ou clique para posicionar"
                      style={{
                        /* 186 → 260. O preview é uma miniatura de um story de
                           1080px: a 186px tudo dentro dele fica em 17% do
                           tamanho, e a pílula vira uma tarja de 16px de altura.
                           Mais largura é o que torna a posição escolhível com
                           precisão, que é a única coisa que esta caixa faz.

                           `touch-action: none` para o arrasto funcionar no
                           celular: sem isso o navegador interpreta o gesto como
                           rolagem da página e a figurinha nem se mexe. */
                        position: 'relative', width: PREVIEW_LARGURA, maxWidth: '100%',
                        flexShrink: 0, aspectRatio: '9 / 16', touchAction: 'none',
                        borderRadius: 'var(--mf-r-md)', overflow: 'hidden',
                        cursor: arrastando ? 'grabbing' : 'crosshair',
                        border: '1px solid var(--mf-border-strong)',
                        background: 'linear-gradient(160deg, var(--mf-surface-2), var(--mf-bg))',
                      }}
                    >
                      {/* A mídia entra como <img> com object-fit: cover — mesmo
                          enquadramento que o Instagram aplica no story 9:16. */}
                      {selectedMedia[0]?.url && (
                        /\.(mp4|mov|webm|m4v)(\?|$)/i.test(selectedMedia[0].url)
                          ? <video src={selectedMedia[0].url} muted playsInline
                              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
                          : <img src={selectedMedia[0].url} alt=""
                              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
                      )}

                      {!selectedMedia.length && (
                        <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center',
                          fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', textAlign:'center', padding:'0 12px', lineHeight:1.5 }}>
                          Selecione uma mídia para ver o enquadramento real
                        </div>
                      )}

                      {/* grade de terços — ajuda a mirar */}
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                        background:
                          'linear-gradient(to bottom, transparent 33.3%, var(--mf-border-strong) 33.3%, var(--mf-border-strong) 33.5%, transparent 33.5%,' +
                          ' transparent 66.6%, var(--mf-border-strong) 66.6%, var(--mf-border-strong) 66.8%, transparent 66.8%)' }} />

                      {/* Figurinha no tamanho REAL — mesma caixa que o backend
                          queima na mídia (caixaSticker espelha o cálculo dele). */}
                      {(() => {
                        const { caixa: cx, visivel: rotulo } = figurinha;
                        return (
                          <div style={{
                            position: 'absolute',
                            left: `${cx.x * 100}%`, top: `${cx.y * 100}%`,
                            width: `${cx.width * 100}%`, height: `${cx.height * 100}%`,
                            transform: 'translate(-50%, -50%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: 3, padding: '0 4px 0 4px', pointerEvents: 'none',
                            background: 'var(--mf-text)', color: 'var(--mf-surface-2)', borderRadius: 'var(--mf-r-full)',
                            boxShadow: 'var(--mf-shadow-2)',
                          }}>
                            {/* A fonte acompanha a pílula, como no renderizador.

                                Era `--mf-t-nano` fixo — 10px dentro de uma
                                pílula que, na escala do preview, tem 24px de
                                altura. O texto não cabia e saía cortado com
                                reticências, sugerindo que o story sairia assim.
                                Não sairia: a caixa é dimensionada A PARTIR do
                                texto, então na mídia de 1080px ele sempre coube.
                                O preview mentia, e mentia para pior.

                                34% da altura é a mesma proporção que
                                `storyStickerRenderer` usa (`hPx * 0.34`), o que
                                faz esta caixa ser uma miniatura fiel em vez de
                                uma aproximação. Sem `ellipsis`: com a fonte
                                certa, o texto cabe por construção — e se um dia
                                não couber, transbordar é o aviso correto de que
                                as duas contas divergiram. */}
                            <span style={{
                              flex: 1, minWidth: 0,
                              fontSize: `${Math.max(4, cx.height * PREVIEW_ALTURA * 0.34)}px`,
                              fontWeight: 800, whiteSpace: 'nowrap',
                              textAlign: 'center', lineHeight: 1,
                            }}>{rotulo}</span>
                            <span style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', flexShrink: 0 }}>›</span>
                          </div>
                        );
                      })()}
                    </div>

                    <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>Posição da figurinha</div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {PRESETS_STICKER.map(p => {
                          const ativo = Math.abs(linkPos.x - p.x) < 0.02 && Math.abs(linkPos.y - p.y) < 0.02;
                          return (
                            <button key={p.rotulo} onClick={() => setLinkPos({ x: p.x, y: p.y })} style={{
                              padding: '4px 8px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-nano)', fontWeight: 700, cursor: 'pointer',
                              background: ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 14%, transparent)' : 'var(--mf-border-subtle)',
                              color:      ativo ? 'var(--mf-mod, var(--mf-accent-500))'        : 'var(--mf-text-3)',
                              border:     ativo ? '1px solid color-mix(in oklch, var(--mf-mod-contas) 35%, transparent)' : '1px solid var(--mf-border)',
                            }}>{p.rotulo}</button>
                          );
                        })}
                      </div>
                      <div style={{ fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                        x {linkPos.x.toFixed(2)} · y {linkPos.y.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.5 }}>
                        Arraste a figurinha até onde quiser — ou clique num ponto para ela ir direto.
                        Ela é desenhada na própria mídia nesse tamanho e nessa posição, e a área de
                        toque do link fica exatamente em cima dela.
                      </div>

                      {/* O aviso do corte.

                          O renderizador corta seco, sem reticência. Sem este
                          aviso a pessoa vê o texto completo no campo, um texto
                          menor no preview, e não tem como saber que o segundo é
                          o que vai para o Instagram. */}
                      {figurinha.cortado && (
                          <div style={{ marginTop: 8, fontSize: 'var(--mf-t-nano)', lineHeight: 1.5,
                            color: 'var(--mf-warning-500)',
                            background: 'color-mix(in oklch, var(--mf-warning-500) 8%, transparent)',
                            border: '1px solid color-mix(in oklch, var(--mf-warning-500) 24%, transparent)',
                            borderRadius: 'var(--mf-r-sm)', padding: '6px 9px' }}>
                            O texto não cabe na figurinha e vai sair cortado em
                            “{figurinha.visivel}”. Encurte para caber inteiro.
                          </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <p style={{ margin: linkOn ? '7px 0 0' : '14px 0 0', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)' }}>
                {linkOn ? 'A figurinha de link será adicionada automaticamente a cada story publicado.' : 'Ative para adicionar uma figurinha de link clicável em cada story.'}
              </p>

              <button onClick={publish} disabled={loading || !selected.length || !selectedMedia.length} style={{
                marginTop: 16, width: '100%', height: 48, borderRadius: 'var(--mf-r-md)', border: 'none',
                cursor: loading || !selected.length || !selectedMedia.length ? 'not-allowed' : 'pointer',
                background: loading || !selected.length || !selectedMedia.length
                  ? 'color-mix(in oklch, var(--mf-primary-500) 15%, transparent)'
                  : 'linear-gradient(135deg, var(--mf-primary-500), var(--mf-primary-500))',
                color: loading || !selected.length || !selectedMedia.length ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-bg)',
                fontSize: 'var(--mf-t-sm)', fontWeight: 750, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: loading || !selected.length || !selectedMedia.length ? 'none' : '0 8px 22px color-mix(in oklch, var(--mf-primary-500) 25%, transparent)',
                transition: 'all var(--mf-normal) var(--mf-ease-out)',
              }}>
                {loading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                    Publicando...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Publicar agora
                  </>
                )}
              </button>
              <p style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '8px 0 0', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                As publicações serão distribuídas conforme o intervalo definido.
              </p>
            </div>
          </motion.div>
        </div>

        <style>{`
          .stories-media-grid { grid-template-columns: repeat(5, minmax(0,1fr)); }
          @media (max-width: 1024px) { .stories-media-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } }
          @media (max-width: 768px)  { .stories-media-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } }
          @media (max-width: 480px)  { .stories-media-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </PageShell>
    </>
  );
}

const PANEL = {
  border: '1px solid var(--mf-border)',
  background: 'color-mix(in oklch, var(--mf-surface-1) 85%, transparent)',
  borderRadius: 'var(--mf-r-md)',
  overflow: 'hidden',
  backdropFilter: 'blur(12px)',
};
/* `flexWrap` e `minWidth: 0` porque o cabeçalho tem título de um lado e uma
   fila de botões do outro. Sem quebra, em 320px os dois disputam a mesma
   linha e a fila de botões saía 16px para fora da tela — cortada, não
   rolável. Com quebra, ela desce e continua inteira. */
const PANEL_HEAD = {
  minHeight: 52, display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--mf-2)',
  padding: 'var(--mf-3) var(--mf-4)', minWidth: 0,
  borderBottom: '1px solid var(--mf-border)',
};
const PANEL_TITLE = { margin: 0, fontSize: 'var(--mf-t-sm)', fontWeight: 700, letterSpacing: '-.2px', color: 'var(--mf-text)' };
const DARK_BTN = {
  height: 30, borderRadius: 'var(--mf-r-sm)', padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
  background: 'var(--mf-bg)', border: '1px solid var(--mf-border)', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-micro)', fontWeight: 650, cursor: 'pointer',
};
const VIEW_BTN = {
  width: 30, height: 30, borderRadius: 'var(--mf-r-sm)', display: 'grid', placeItems: 'center',
  color: 'var(--mf-text-3)', background: 'var(--mf-bg)', border: '1px solid var(--mf-border)', cursor: 'pointer',
};
const VIEW_BTN_ON = { background: 'var(--mf-surface-1)', color: 'var(--mf-text)' };

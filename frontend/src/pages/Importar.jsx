import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Film, Image as ImageIcon, Layers, Music, Check, Loader2, ExternalLink, Link2, Upload, FolderOpen, User, Sparkles } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { avisar } from '../services/avisos';
import { useServerEvents } from '../services/useServerEvents';
import { getToken } from '../services/auth';

/**
 * Importar mídias — o que as SUAS contas conectadas já publicaram vai para a
 * Biblioteca, na qualidade e no formato escolhidos (API oficial).
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const srcDo = u => (u?.startsWith('/uploads') ? `${API_URL}${u}` : u);

const QUALIDADES = [
  ['original', 'Original', 'Como está'],
  ['720', '720p HD', 'Menor lado 720'],
  ['480', '480p SD', 'Menor lado 480'],
  ['360', '360p', 'Menor lado 360'],
];
const UPSCALE = [
  ['1080', 'Full HD', '1080 × 1920'],
  ['2160', '4K UHD', '2160 × 3840'],
  ['4320', '8K UHD', '4320 × 7680'],
];
const ABAS = [
  ['contas', 'Minhas contas', User],
  ['url', 'Link (URL)', Link2],
  ['upload', 'Upload', Upload],
  ['biblioteca', 'Da Biblioteca', FolderOpen],
];
const DESTINOS = [
  ['biblioteca', 'Biblioteca', 'Numa pasta', FolderOpen],
  ['baixar', 'Baixar', 'No computador', Download],
  ['ambos', 'Os dois', 'Salva e baixa', Layers],
];

/** Link de download de um item da Biblioteca (`remover`: some da Biblioteca depois de baixado). */
const linkDeDownload = (id, remover) =>
  `${API_URL}/importar/baixar/${id}?token=${encodeURIComponent(getToken() || '')}${remover ? '&remover=1' : ''}`;

/** Dispara os downloads, um a um, com uma folga para o navegador não barrar. */
async function baixarTodos(arquivos, remover) {
  for (const a of arquivos) {
    const link = document.createElement('a');
    link.href = linkDeDownload(a.id, remover);
    link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
    await new Promise(r => setTimeout(r, 900));
  }
}

const tamanhoDe = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);

const FORMATOS = [
  ['mp4', 'MP4', 'Compatível', Film],
  ['webm', 'WEBM', 'Web', Film],
  ['mp3', 'MP3', 'Só áudio', Music],
];

function Opcao({ ativo, onClick, titulo, sub, icone: Icone }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', minWidth: 0,
        borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
        background: ativo ? 'color-mix(in oklch, var(--mf-primary-500) 10%, var(--mf-surface-1))' : 'var(--mf-surface-1)',
        border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-primary-500) 55%, transparent)' : 'var(--mf-border)'}`,
        boxShadow: ativo ? '0 0 18px -6px color-mix(in oklch, var(--mf-primary-500) 60%, transparent)' : 'none',
      }}>
      {Icone && <Icone size={16} style={{ color: ativo ? 'var(--mf-primary-500)' : 'var(--mf-text-3)', flexShrink: 0 }} />}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{sub}</span>
      </span>
      {ativo && <Check size={14} style={{ color: 'var(--mf-primary-500)', flexShrink: 0 }} />}
    </button>
  );
}

const rotulo = t => (
  <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
    color: 'var(--mf-text-3)', margin: '0 0 8px' }}>{t}</div>
);

export default function Importar() {
  const [contas, setContas] = useState([]);
  const [conta, setConta] = useState('');
  const [itens, setItens] = useState([]);
  const [depois, setDepois] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [marcados, setMarcados] = useState(() => new Set());
  const [qualidade, setQualidade] = useState('original');
  const [formato, setFormato] = useState('mp4');
  const [pasta, setPasta] = useState('Importados');
  const [progresso, setProgresso] = useState(null); // { feitas, total } | { fim, importados, erros }
  const [aba, setAba] = useState('contas');
  const [url, setUrl] = useState('');
  const [arquivos, setArquivos] = useState([]);
  const [biblioteca, setBiblioteca] = useState(null);
  const [marcadosBib, setMarcadosBib] = useState(() => new Set());
  const [destino, setDestino] = useState('biblioteca');
  const destinoDoEnvio = useRef('biblioteca'); // o destino de quando o envio começou

  useEffect(() => {
    api.get('/accounts', { params: { limit: 500 } })
      .then(r => {
        const lista = (r.data?.accounts || []).filter(c => c.hasApiToken);
        setContas(lista);
        if (lista[0]) setConta(lista[0].id);
      })
      .catch(() => setContas([]));
  }, []);

  const carregar = useCallback(async (mais = false) => {
    if (!conta) return;
    setCarregando(true); setErro('');
    try {
      const { data } = await api.get(`/importar/${conta}`, { params: mais && depois ? { depois } : {} });
      setItens(v => (mais ? [...v, ...data.itens] : data.itens));
      setDepois(data.depois);
    } catch (e) {
      setErro(e.response?.data?.error || 'Não foi possível listar as publicações.');
    } finally { setCarregando(false); }
  }, [conta, depois]);

  useEffect(() => {
    if (!conta) return;
    let vivo = true;
    api.get(`/importar/${conta}`)
      .then(({ data }) => { if (vivo) { setItens(data.itens); setDepois(data.depois); setErro(''); } })
      .catch(e => { if (vivo) setErro(e.response?.data?.error || 'Não foi possível listar as publicações.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [conta]);

  function terminar({ importados, erros = 0, detalhes = [], arquivos = [] }) {
    const dest = destinoDoEnvio.current;
    setProgresso({ fim: true, importados, erros, detalhe: detalhes[0] || '', arquivos, destino: dest });
    const onde = dest === 'baixar' ? 'baixando no seu computador' : dest === 'ambos' ? 'na Biblioteca e baixando' : 'na Biblioteca';
    avisar(erros ? (importados ? 'warning' : 'error') : 'success', importados ? 'Pronto' : 'Não deu certo',
      importados
        ? `${importados} arquivo(s) ${onde}${erros ? `, ${erros} com erro` : ''}.`
        : String(detalhes[0] || 'Falhou.').replace(/^[^:]*: /, ''));
    if (dest !== 'biblioteca' && arquivos.length) baixarTodos(arquivos, dest === 'baixar');
    if (aba === 'biblioteca') carregarBiblioteca();
  }

  useServerEvents(['media'], d => {
    if (d?.action === 'importacao') setProgresso({ feitas: d.feitas, total: d.total });
    if (d?.action === 'importacao_fim') terminar({ importados: d.importados, erros: d.erros, detalhes: d.detalhes || [], arquivos: d.arquivos || [] });
  });

  const escolherConta = id => {
    if (id === conta) return;
    setCarregando(true); setItens([]); setMarcados(new Set()); setDepois(null); setConta(id);
  };
  const alternar = id => setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosMarcados = itens.length > 0 && itens.every(i => marcados.has(i.id));
  const temVideo = useMemo(() => itens.some(i => marcados.has(i.id) && i.tipo !== 'IMAGE'), [itens, marcados]);
  const importando = progresso && !progresso.fim;

  function carregarBiblioteca() {
    api.get('/media', { params: { limit: 200 } })
      .then(r => setBiblioteca((r.data?.files || []).filter(f => ['video', 'image'].includes(f.type) && !String(f.filename).startsWith('__folder_'))))
      .catch(() => setBiblioteca([]));
  }
  useEffect(() => { if (aba === 'biblioteca' && biblioteca === null) carregarBiblioteca(); }, [aba]); // eslint-disable-line react-hooks/exhaustive-deps

  const semConversao = qualidade === 'original' && formato === 'mp4';
  const quantos = aba === 'contas' ? marcados.size : aba === 'url' ? (url.trim() ? 1 : 0) : aba === 'upload' ? arquivos.length : marcadosBib.size;

  async function importar() {
    if (!quantos) return;
    destinoDoEnvio.current = destino;
    try {
      if (aba === 'contas') {
        await api.post('/importar', { accountId: conta, ids: [...marcados], qualidade, formato, pasta });
      } else if (aba === 'url') {
        await api.post('/importar/url', { url: url.trim(), qualidade, formato, pasta });
      } else if (aba === 'upload') {
        const form = new FormData();
        form.append('folder', pasta || 'Importados');
        for (const f of arquivos) form.append('files', f);
        setProgresso({ feitas: 0, total: arquivos.length });
        const { data } = await api.post('/media/upload', form);
        const enviados = data?.media || [];
        const ids = enviados.map(m => m.id);
        setArquivos([]);
        if (semConversao) {
          terminar({ importados: ids.length, arquivos: enviados.map(m => ({ id: m.id, nome: m.originalName, url: m.url, tipo: m.type, tamanho: m.size })) });
          return;
        }
        // O convertido substitui o que acabou de subir — não fica o antigo na Biblioteca.
        await api.post('/importar/converter', { ids, qualidade, formato, pasta, substituir: true });
        setProgresso({ feitas: 0, total: ids.length });
        return;
      } else {
        await api.post('/importar/converter', { ids: [...marcadosBib], qualidade, formato, pasta });
      }
      setProgresso({ feitas: 0, total: quantos });
    } catch (e) {
      setProgresso(null);
      avisar('error', 'Não foi possível', e.response?.data?.error || e.message);
    }
  }

  const n = quantos || '';
  const rotuloDoBotao = aba === 'contas' ? (destino === 'baixar' ? `Baixar ${n}` : `Importar ${n}`)
    : aba === 'url' ? 'Baixar agora'
    : aba === 'upload' ? (semConversao ? (destino === 'baixar' ? `Baixar ${n}` : `Enviar ${n}`) : `Converter ${n}`)
    : `Converter ${n}`;

  return (
    <PageShell icon={<Download size={18} />} title="Importar mídias"
      subtitle="Das suas contas, por link ou upload — na qualidade e no formato que quiser">

      {/* Abas */}
      <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--mf-4)', borderBottom: '1px solid var(--mf-border)' }}>
        {ABAS.map(([id, rot, Ic]) => {
          const ativa = aba === id;
          return (
            <button key={id} type="button" role="tab" aria-selected={ativa} onClick={() => { setAba(id); if (progresso?.fim) setProgresso(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', marginBottom: -1, cursor: 'pointer',
                background: 'none', border: 'none', borderBottom: `2px solid ${ativa ? 'var(--mf-primary-500)' : 'transparent'}`,
                color: ativa ? 'var(--mf-text)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)', fontWeight: ativa ? 700 : 550 }}>
              <Ic size={15} style={{ color: ativa ? 'var(--mf-primary-500)' : 'currentColor' }} />{rot}
            </button>
          );
        })}
      </div>

      {/* Contas */}
      {aba === 'contas' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--mf-4)' }}>
        {contas.length === 0 && (
          <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)' }}>
            Nenhuma conta conectada pela API. Conecte em <a href="/accounts" style={{ color: 'var(--mf-primary-500)' }}>Contas</a>.
          </div>
        )}
        {contas.map(c => {
          const ativa = c.id === conta;
          return (
            <button key={c.id} type="button" onClick={() => escolherConta(c.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 'var(--mf-r-full)', cursor: 'pointer',
                background: ativa ? 'color-mix(in oklch, var(--mf-primary-500) 12%, var(--mf-surface-1))' : 'var(--mf-surface-1)',
                border: `1px solid ${ativa ? 'color-mix(in oklch, var(--mf-primary-500) 50%, transparent)' : 'var(--mf-border)'}`,
                color: ativa ? 'var(--mf-text)' : 'var(--mf-text-2)', fontSize: 'var(--mf-t-xs)', fontWeight: 650 }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', background: 'var(--mf-surface-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {c.avatar ? <img src={srcDo(c.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : c.username?.[0]?.toUpperCase()}
              </span>
              @{c.username}
            </button>
          );
        })}
      </div>}

      <div style={{ display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
        {/* Link */}
        {aba === 'url' && (
          <section className="mf-card" style={{ padding: 'var(--mf-4)', gridColumn: 'span 2', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 44,
                borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
                <Link2 size={15} style={{ color: 'var(--mf-text-3)', flexShrink: 0 }} />
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Cole o link aqui…"
                  onKeyDown={e => { if (e.key === 'Enter') importar(); }}
                  style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)' }} />
              </div>
              <button type="button" className="btn-primary" onClick={importar} disabled={!url.trim() || importando} style={{ height: 44 }}>
                {importando ? <Loader2 size={16} className="mf-spin" /> : <Download size={16} />} Baixar agora
              </button>
            </div>
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 10, lineHeight: 1.6 }}>
              Aceita o link de uma publicação das <strong style={{ color: 'var(--mf-text-2)' }}>suas contas conectadas</strong> (instagram.com/reel/…)
              ou o <strong style={{ color: 'var(--mf-text-2)' }}>link direto de um arquivo</strong> de vídeo ou imagem (.mp4, .mov, .jpg, .png).
            </div>
          </section>
        )}

        {/* Upload */}
        {aba === 'upload' && (
          <section className="mf-card" style={{ padding: 'var(--mf-4)', gridColumn: 'span 2', minWidth: 0 }}>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 'var(--mf-8) var(--mf-4)',
              borderRadius: 'var(--mf-r-lg)', border: '1.5px dashed var(--mf-border-strong)', background: 'var(--mf-surface-2)', cursor: 'pointer', textAlign: 'center' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); setArquivos(a => [...a, ...[...e.dataTransfer.files].filter(f => /^(video|image)\//.test(f.type))]); }}>
              <Upload size={22} style={{ color: 'var(--mf-primary-500)' }} />
              <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Arraste vídeos ou fotos, ou clique para escolher</span>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>MP4, MOV, WEBM, JPG, PNG, WEBP</span>
              <input type="file" multiple accept="video/*,image/*" style={{ display: 'none' }}
                onChange={e => { const novos = [...e.target.files]; e.target.value = ''; setArquivos(a => [...a, ...novos]); }} />
            </label>
            {arquivos.length > 0 && (
              <div style={{ display: 'grid', gap: 6, marginTop: 'var(--mf-3)' }}>
                {arquivos.map((f, k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)',
                    padding: '6px 10px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)' }}>
                    {f.type.startsWith('video/') ? <Film size={13} /> : <ImageIcon size={13} />}
                    <span className="mf-trunc" style={{ flex: 1 }}>{f.name}</span>
                    <span style={{ color: 'var(--mf-text-3)' }}>{(f.size / 1048576).toFixed(1)} MB</span>
                    <button type="button" onClick={() => setArquivos(a => a.filter((_, j) => j !== k))}
                      style={{ background: 'none', border: 'none', color: 'var(--mf-text-3)', cursor: 'pointer' }} aria-label="Remover">×</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Da Biblioteca */}
        {aba === 'biblioteca' && (
          <section className="mf-card" style={{ padding: 'var(--mf-4)', gridColumn: 'span 2', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--mf-3)' }}>
              <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Vídeos e fotos da Biblioteca</span>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{marcadosBib.size} selecionado(s)</span>
            </div>
            {biblioteca === null && <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--mf-4)' }}><Loader2 size={18} className="mf-spin" /></div>}
            {biblioteca?.length === 0 && <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)', textAlign: 'center', padding: 'var(--mf-6)' }}>A Biblioteca está vazia.</div>}
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
              {(biblioteca || []).map(f => {
                const sel = marcadosBib.has(f.id);
                const thumb = f.type === 'image' ? srcDo(f.url) : srcDo(`/uploads/${String(f.filename).replace(/\.[^.]+$/, '')}.thumb.jpg`);
                return (
                  <button key={f.id} type="button" title={f.originalName}
                    onClick={() => setMarcadosBib(s0 => { const n = new Set(s0); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })}
                    style={{ position: 'relative', aspectRatio: '9 / 14', borderRadius: 'var(--mf-r-md)', overflow: 'hidden', padding: 0, cursor: 'pointer',
                      background: 'var(--mf-surface-2)', border: `2px solid ${sel ? 'var(--mf-primary-500)' : 'transparent'}` }}>
                    <img src={thumb} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <span style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 'var(--mf-r-full)',
                      background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                      {f.type === 'video' ? <Film size={11} /> : <ImageIcon size={11} />}{f.type === 'video' ? 'Vídeo' : 'Foto'}
                    </span>
                    <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%',
                      background: sel ? 'var(--mf-primary-500)' : 'rgba(0,0,0,.45)', border: '1.5px solid #fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {sel && <Check size={12} color="var(--mf-primary-fg)" />}
                    </span>
                    <span className="mf-trunc" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 6px 5px', fontSize: 10, color: '#fff', textAlign: 'left',
                      background: 'linear-gradient(transparent, rgba(0,0,0,.75))' }}>{f.originalName}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Publicações */}
        {aba === 'contas' && <section className="mf-card" style={{ padding: 'var(--mf-4)', gridColumn: 'span 2', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--mf-3)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Publicações</span>
            <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{marcados.size} de {itens.length} selecionadas</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!itens.length}
              onClick={() => setMarcados(todosMarcados ? new Set() : new Set(itens.map(i => i.id)))}>
              {todosMarcados ? 'Limpar seleção' : 'Selecionar todas'}
            </button>
          </div>

          {erro && <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-danger-500)', marginBottom: 'var(--mf-3)' }}>{erro}</div>}

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
            {itens.map(i => {
              const sel = marcados.has(i.id);
              return (
                <button key={i.id} type="button" onClick={() => alternar(i.id)} title={i.legenda || ''}
                  style={{ position: 'relative', aspectRatio: '9 / 14', borderRadius: 'var(--mf-r-md)', overflow: 'hidden', padding: 0, cursor: 'pointer',
                    background: 'var(--mf-surface-2)',
                    border: `2px solid ${sel ? 'var(--mf-primary-500)' : 'transparent'}`,
                    boxShadow: sel ? '0 0 16px -4px color-mix(in oklch, var(--mf-primary-500) 70%, transparent)' : 'none' }}>
                  {i.miniatura && <img src={i.miniatura} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  <span style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 'var(--mf-r-full)',
                    background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                    {i.tipo === 'VIDEO' ? <Film size={11} /> : i.tipo === 'CAROUSEL_ALBUM' ? <Layers size={11} /> : <ImageIcon size={11} />}
                    {i.tipo === 'CAROUSEL_ALBUM' ? i.itens : i.produto === 'REELS' ? 'Reel' : i.tipo === 'VIDEO' ? 'Vídeo' : 'Foto'}
                  </span>
                  <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%',
                    background: sel ? 'var(--mf-primary-500)' : 'rgba(0,0,0,.45)', border: '1.5px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {sel && <Check size={12} color="var(--mf-primary-fg)" />}
                  </span>
                  {i.quando && (
                    <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 6px 5px', fontSize: 10, color: '#fff', textAlign: 'left',
                      background: 'linear-gradient(transparent, rgba(0,0,0,.75))' }}>
                      {new Date(i.quando).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {carregando && <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--mf-4)' }}><Loader2 size={18} className="mf-spin" /></div>}
          {!carregando && !itens.length && conta && !erro && (
            <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)', textAlign: 'center', padding: 'var(--mf-6)' }}>Esta conta ainda não publicou nada.</div>
          )}
          {depois && !carregando && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--mf-3)' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => carregar(true)}>Carregar mais</button>
            </div>
          )}
        </section>}

        {/* Opções */}
        <section className="mf-card" style={{ padding: 'var(--mf-4)', minWidth: 0 }}>
          {rotulo('Qualidade')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 'var(--mf-4)' }}>
            {QUALIDADES.map(([id, t, s]) => (
              <Opcao key={id} ativo={qualidade === id} onClick={() => setQualidade(id)} titulo={t} sub={s} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-micro)', fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--mf-text-3)', margin: '0 0 8px' }}>
            <Sparkles size={13} style={{ color: 'var(--mf-primary-500)' }} /> Renderizar em resolução maior (upscale)
          </div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-2)' }}>
            {UPSCALE.map(([id, t, s]) => (
              <Opcao key={id} ativo={qualidade === id} onClick={() => setQualidade(id)} titulo={t} sub={s} />
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 'var(--mf-4)', lineHeight: 1.5 }}>
            Re-renderiza em resolução maior (escala Lanczos + nitidez). Aumenta a resolução e o tamanho do arquivo, mas não recria detalhe que não existe no original. 4K e 8K levam alguns minutos.
          </div>

          {rotulo('Formato de saída')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-2)' }}>
            {FORMATOS.map(([id, t, s, I]) => (
              <Opcao key={id} ativo={formato === id} onClick={() => setFormato(id)} titulo={t} sub={s} icone={I} />
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 'var(--mf-4)', lineHeight: 1.5 }}>
            O formato vale para vídeos (MP3 extrai só o áudio). Fotos saem em JPG, na qualidade escolhida.{aba === 'contas' && !temVideo && marcados.size ? ' Nenhum vídeo selecionado.' : ''}
          </div>

          {rotulo('Destino')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-4)' }}>
            {DESTINOS.map(([id, t, s, I]) => (
              <Opcao key={id} ativo={destino === id} onClick={() => setDestino(id)} titulo={t} sub={s} icone={I} />
            ))}
          </div>

          {destino !== 'baixar' && <>
            {rotulo('Pasta na Biblioteca')}
            <input className="inp" value={pasta} onChange={e => setPasta(e.target.value)} placeholder="Importados" style={{ marginBottom: 'var(--mf-4)' }} />
          </>}

          {progresso && (
            <div style={{ marginBottom: 'var(--mf-3)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
              {progresso.fim
                ? <>Pronto: <strong style={{ color: 'var(--mf-text)' }}>{progresso.importados}</strong> arquivo(s)
                    {progresso.destino === 'baixar' ? ' baixados' : ' na Biblioteca'}{progresso.erros ? `, ${progresso.erros} com erro` : ''}.{' '}
                    {progresso.destino !== 'baixar' && (
                      <a href="/biblioteca" style={{ color: 'var(--mf-primary-500)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>Abrir <ExternalLink size={11} /></a>
                    )}
                    {progresso.destino !== 'baixar' && progresso.arquivos?.length > 0 && (
                      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                        {progresso.arquivos.map(a => (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 10px',
                            borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
                            {a.tipo === 'video' ? <Film size={13} /> : a.tipo === 'image' ? <ImageIcon size={13} /> : <Music size={13} />}
                            <span className="mf-trunc" style={{ flex: 1, minWidth: 0 }} title={a.nome}>{a.nome}</span>
                            <span style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)' }}>{tamanhoDe(a.tamanho)}</span>
                            <a href={linkDeDownload(a.id, false)} className="btn btn-ghost btn-sm" style={{ gap: 4 }} aria-label={`Baixar ${a.nome}`}>
                              <Download size={13} /> Baixar
                            </a>
                          </div>
                        ))}
                        {progresso.arquivos.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => baixarTodos(progresso.arquivos, false)} style={{ justifySelf: 'start' }}>
                            <Download size={13} /> Baixar todos
                          </button>
                        )}
                      </div>
                    )}</>
                : <>Importando… {progresso.feitas} de {progresso.total}
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--mf-surface-3)', marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progresso.total ? (progresso.feitas / progresso.total) * 100 : 0}%`, background: 'var(--mf-primary-500)', transition: 'width .3s' }} />
                    </div></>}
            </div>
          )}

          {progresso?.fim && progresso.detalhe && !progresso.importados && (
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-danger-500)', marginBottom: 'var(--mf-3)' }}>
              {String(progresso.detalhe).replace(/^[^:]*: /, '')}
            </div>
          )}
          <button type="button" className="btn-primary" onClick={importar} disabled={!quantos || importando}
            style={{ width: '100%', height: 44, fontSize: 'var(--mf-t-body)' }}>
            {importando ? <Loader2 size={16} className="mf-spin" /> : <Download size={16} />}
            {importando ? 'Processando…' : rotuloDoBotao}
          </button>
        </section>
      </div>
    </PageShell>
  );
}

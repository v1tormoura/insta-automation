import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Film, Image as ImageIcon, Layers, Music, Check, Loader2, ExternalLink, Link2, Upload, FolderOpen, User, Sparkles } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { avisar } from '../services/avisos';
import { useTarefa, iniciar, progredir, concluir, falhar, consumir, obter } from '../services/tarefas';
import { linkDeDownload, baixarTodos } from '../services/downloads';

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
const FORMATOS_FOTO = [
  ['jpg', 'JPG', 'Compatível', ImageIcon],
  ['png', 'PNG', 'Sem perdas', ImageIcon],
  ['webp', 'WEBP', 'Leve', ImageIcon],
];
/* O que buscar no perfil: [id, rótulo do seletor, singular, plural]. */
const TIPOS_DO_PERFIL = [
  ['reels', 'Reels', 'Reel', 'Reels'],
  ['fotos', 'Fotos', 'foto', 'fotos'],
  ['tudo', 'Tudo', 'publicação', 'publicações'],
];

const MODOS_IA = [
  ['', 'Desligada', 'Só o filtro'],
  ['rapida', 'IA rápida', 'Segundos por foto'],
  ['maxima', 'IA máxima', 'Minutos por foto'],
];

const DESTINOS = [
  ['biblioteca', 'Biblioteca', 'Numa pasta', FolderOpen],
  ['baixar', 'Baixar', 'No computador', Download],
  ['ambos', 'Os dois', 'Salva e baixa', Layers],
];

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
  /* A importação roda fora da tela (services/tarefas + IndicadorDeTarefas, que
     escuta o SSE sempre): sair do Importar não perde o progresso nem o fim. */
  const tarefa = useTarefa('importar');
  const [resultado, setResultado] = useState(null); // o último fim, já entregue a esta tela
  const progresso = tarefa?.fase === 'rodando'
    ? { feitas: tarefa.feitas, total: tarefa.total, pct: tarefa.pct, etapa: tarefa.etapa }
    : resultado;
  const setProgresso = setResultado;
  const [aba, setAba] = useState('contas');
  const [url, setUrl] = useState('');
  const [arquivos, setArquivos] = useState([]);
  const [biblioteca, setBiblioteca] = useState(null);
  const [marcadosBib, setMarcadosBib] = useState(() => new Set());
  const [destino, setDestino] = useState('biblioteca');
  /* Buscar Reels pela URL do perfil: só escolhe a conta e liga o filtro de
     Reels — a lista, o grid, a seleção e o download são os da aba "Minhas contas". */
  const [perfilUrl, setPerfilUrl] = useState('');
  const [somenteReels, setSomenteReels] = useState(false); // busca pelo perfil ativa
  const [tipoPerfil, setTipoPerfil] = useState('reels');
  const [formatoFoto, setFormatoFoto] = useState('jpg');
  const [ia, setIa] = useState('');
  const [iaDisponivel, setIaDisponivel] = useState(null);
  useEffect(() => {
    api.get('/importar/ia').then(r => setIaDisponivel(!!r.data?.disponivel)).catch(() => setIaDisponivel(false));
  }, []);
  const paramsDoPerfil = somenteReels && tipoPerfil !== 'tudo' ? { so: tipoPerfil } : {};
  const [, rotuloDoTipo, nomeUm, nomeVarios] = TIPOS_DO_PERFIL.find(t => t[0] === tipoPerfil);
  const [busca, setBusca] = useState({ estado: 'inicial' }); // inicial | buscando | ok | vazio | erro | indisponivel
  const [recarga, setRecarga] = useState(0);

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
      const { data } = await api.get(`/importar/${conta}`, { params: { ...(mais && depois ? { depois } : {}), ...paramsDoPerfil } });
      setItens(v => {
        if (!mais) return data.itens;
        const ja = new Set(v.map(i => i.id));
        return [...v, ...data.itens.filter(i => !ja.has(i.id))];
      });
      setDepois(data.depois);
    } catch (e) {
      setErro(e.response?.data?.error || 'Não foi possível listar as publicações.');
    } finally { setCarregando(false); }
  }, [conta, depois, somenteReels, tipoPerfil]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conta) return;
    let vivo = true;
    api.get(`/importar/${conta}`, { params: paramsDoPerfil })
      .then(({ data }) => {
        if (!vivo) return;
        setItens(data.itens); setDepois(data.depois); setErro('');
        if (somenteReels) setBusca(b => ({ ...b, estado: data.itens.length ? 'ok' : 'vazio' }));
      })
      .catch(e => {
        if (!vivo) return;
        setErro(e.response?.data?.error || 'Não foi possível listar as publicações.');
        if (somenteReels) setBusca(b => ({ ...b, estado: 'erro' }));
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [conta, somenteReels, recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  async function buscarReels() {
    const entrada = perfilUrl.trim();
    if (!entrada || busca.estado === 'buscando') return;
    setBusca({ estado: 'buscando' });
    try {
      const { data } = await api.get('/importar/perfil', { params: { url: entrada } });
      setAba('contas'); if (progresso?.fim) setProgresso(null);
      setCarregando(true); setItens([]); setMarcados(new Set()); setDepois(null); setErro('');
      setBusca({ estado: 'buscando', username: data.username });
      setSomenteReels(true); setConta(data.accountId); setRecarga(n => n + 1);
    } catch (e) {
      const d = e.response?.data || {};
      setBusca(d.codigo === 'INDISPONIVEL'
        ? { estado: 'indisponivel', username: d.username }
        : { estado: 'erro', msg: d.codigo === 'URL_INVALIDA' ? d.error : '' });
    }
  }

  /* O fim da importação — com a tela aberta ou ao voltar para ela: mostra o
     resultado, avisa, e limpa o que foi selecionado para este envio. */
  useEffect(() => {
    if (!tarefa || tarefa.fase === 'rodando') return;
    const d = tarefa.dados || {};
    const dest = d.destino || 'biblioteca';
    const fim = tarefa.fase === 'erro'
      ? { fim: true, importados: 0, erros: 1, detalhe: tarefa.mensagem, arquivos: [], destino: dest }
      : { fim: true, importados: d.importados || 0, erros: d.erros || 0, detalhe: d.detalhes?.[0] || '', arquivos: d.arquivos || [], destino: dest };
    /* eslint-disable react-hooks/set-state-in-effect */
    setResultado(fim);
    if (fim.importados) { setMarcados(new Set()); setMarcadosBib(new Set()); setArquivos([]); setUrl(''); }
    /* eslint-enable react-hooks/set-state-in-effect */
    const onde = dest === 'baixar' ? 'baixando no seu computador' : dest === 'ambos' ? 'na Biblioteca e baixando' : 'na Biblioteca';
    avisar(fim.erros ? (fim.importados ? 'warning' : 'error') : 'success', fim.importados ? 'Pronto' : 'Não deu certo',
      fim.importados
        ? `${fim.importados} arquivo(s) ${onde}${fim.erros ? `, ${fim.erros} com erro` : ''}.`
        : String(fim.detalhe || 'Falhou.').replace(/^[^:]*: /, ''));
    if (aba === 'biblioteca' || biblioteca !== null) carregarBiblioteca();
    consumir('importar');
  }, [tarefa]); // eslint-disable-line react-hooks/exhaustive-deps

  const escolherConta = id => {
    if (somenteReels) { setSomenteReels(false); setBusca({ estado: 'inicial' }); }
    else if (id === conta) return;
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

  const semConversao = qualidade === 'original' && formato === 'mp4' && formatoFoto === 'jpg' && !ia;
  const quantos = aba === 'contas' ? marcados.size : aba === 'url' ? (url.trim() ? 1 : 0) : aba === 'upload' ? arquivos.length : marcadosBib.size;

  async function importar() {
    if (!quantos || importando) return;
    setResultado(null);
    const dados = { destino, servidor: aba !== 'upload' };
    const rotulo = aba === 'upload' ? `Enviando ${arquivos.length} arquivo(s)` : `Importando ${quantos} item(ns)`;
    iniciar('importar', { rotulo, rota: '/importar', total: aba === 'upload' ? 0 : quantos, etapa: aba === 'upload' ? 'Subindo os arquivos' : 'Na fila', dados });
    try {
      if (aba === 'contas') {
        await api.post('/importar', { accountId: conta, ids: [...marcados], qualidade, formato, formatoFoto, ia: ia || null, pasta });
      } else if (aba === 'url') {
        await api.post('/importar/url', { url: url.trim(), qualidade, formato, formatoFoto, ia: ia || null, pasta });
      } else if (aba === 'upload') {
        /* O upload sai do navegador: segue mesmo trocando de tela (só não
           fechando a aba) — por isso `local`, que faz o navegador perguntar. */
        progredir('importar', { dados: { ...dados, local: true } });
        const form = new FormData();
        form.append('folder', pasta || 'Importados');
        for (const f of arquivos) form.append('files', f);
        const { data } = await api.post('/media/upload', form, {
          onUploadProgress: e => { if (e.total) progredir('importar', { pct: Math.min(99, Math.round((e.loaded / e.total) * 100)) }); },
        });
        const enviados = data?.media || [];
        const ids = enviados.map(m => m.id);
        if (semConversao) {
          const lista = enviados.map(m => ({ id: m.id, nome: m.originalName, url: m.url, tipo: m.type, tamanho: m.size }));
          concluir('importar', { dados: { importados: ids.length, erros: 0, arquivos: lista } });
          if (destino !== 'biblioteca' && lista.length) baixarTodos(lista, destino === 'baixar');
          return;
        }
        // O convertido substitui o que acabou de subir — não fica o antigo na Biblioteca.
        await api.post('/importar/converter', { ids, qualidade, formato, formatoFoto, ia: ia || null, pasta, substituir: true });
        // Daqui em diante o progresso vem do servidor (SSE).
        progredir('importar', { pct: null, feitas: 0, total: ids.length, etapa: 'Convertendo', dados: { ...obter('importar')?.dados, local: false, servidor: true } });
      } else {
        await api.post('/importar/converter', { ids: [...marcadosBib], qualidade, formato, formatoFoto, ia: ia || null, pasta });
      }
    } catch (e) {
      falhar('importar', e.response?.data?.error || e.message);
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

      {/* Buscar Reels pela URL do perfil — alimenta o grid de "Minhas contas" */}
      <section className="mf-card" style={{ padding: 'var(--mf-4)', marginBottom: 'var(--mf-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Film size={15} style={{ color: 'var(--mf-primary-500)' }} />
          <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>Importar de perfil</span>
          <span style={{ flex: 1 }} />
          <div role="group" aria-label="O que buscar" style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--mf-r-md)',
            background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
            {TIPOS_DO_PERFIL.map(([id, rot]) => {
              const ativo = id === tipoPerfil;
              return (
                <button key={id} type="button" aria-pressed={ativo} disabled={busca.estado === 'buscando'}
                  onClick={() => {
                    if (ativo) return;
                    setTipoPerfil(id);
                    if (somenteReels) { setCarregando(true); setItens([]); setMarcados(new Set()); setDepois(null); setBusca(b => ({ ...b, estado: 'buscando' })); setRecarga(n => n + 1); }
                  }}
                  style={{ height: 26, padding: '0 12px', border: 'none', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer',
                    fontSize: 'var(--mf-t-micro)', fontWeight: 700,
                    background: ativo ? 'var(--mf-primary-500)' : 'transparent', color: ativo ? 'var(--mf-bg)' : 'var(--mf-text-3)' }}>
                  {rot}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 44,
            borderRadius: 'var(--mf-r-md)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)' }}>
            <Link2 size={15} style={{ color: 'var(--mf-text-3)', flexShrink: 0 }} />
            <input value={perfilUrl} onChange={e => setPerfilUrl(e.target.value)} aria-label="URL do perfil do Instagram"
              placeholder="Cole o link do perfil do Instagram… (https://www.instagram.com/usuario/)"
              onKeyDown={e => { if (e.key === 'Enter') buscarReels(); }}
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)' }} />
          </div>
          <button type="button" className="btn-primary" onClick={buscarReels} disabled={!perfilUrl.trim() || busca.estado === 'buscando'} style={{ height: 44 }}>
            {busca.estado === 'buscando' ? <Loader2 size={16} className="mf-spin" /> : tipoPerfil === 'fotos' ? <ImageIcon size={16} /> : <Film size={16} />}
            {busca.estado === 'buscando' ? `Buscando ${nomeVarios}…` : `Buscar ${tipoPerfil === 'tudo' ? 'tudo' : nomeVarios}`}
          </button>
        </div>
        <div aria-live="polite" data-busca-status style={{ fontSize: 'var(--mf-t-micro)', marginTop: 10, lineHeight: 1.6,
          color: ['erro', 'indisponivel'].includes(busca.estado) ? 'var(--mf-danger-500)' : 'var(--mf-text-3)' }}>
          {busca.estado === 'inicial' && 'Nenhum perfil importado. Funciona com os perfis conectados ao Nexora pela API oficial (os seus e os de quem autorizou pelo link guiado).'}
          {busca.estado === 'buscando' && `Buscando ${nomeVarios}…`}
          {busca.estado === 'ok' && <>
            <strong style={{ color: 'var(--mf-text)' }}>@{busca.username}</strong> · {itens.length}{depois ? '+' : ''} {itens.length === 1 ? nomeUm : nomeVarios} encontrad{tipoPerfil === 'reels' ? 'o' : 'a'}{itens.length === 1 ? '' : 's'}
            {depois ? ' — use "Carregar mais" no fim da lista.' : '.'}
          </>}
          {busca.estado === 'vazio' && <><strong style={{ color: 'var(--mf-text)' }}>@{busca.username}</strong> · Nenhum{tipoPerfil === 'reels' ? '' : 'a'} {nomeUm} encontrad{tipoPerfil === 'reels' ? 'o' : 'a'} neste perfil.</>}
          {busca.estado === 'erro' && (busca.msg || `Não foi possível obter ${tipoPerfil === 'reels' ? 'os' : 'as'} ${nomeVarios} deste perfil.`)}
          {busca.estado === 'indisponivel' && <>Este perfil{busca.username ? <> (@{busca.username})</> : ''} não está disponível para importação. Só perfis conectados ao Nexora podem ser importados.</>}
        </div>
      </section>

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
            <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{somenteReels && busca.username ? `${tipoPerfil === 'tudo' ? 'Publicações' : rotuloDoTipo} de @${busca.username}` : 'Publicações'}</span>
            {somenteReels && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSomenteReels(false); setBusca({ estado: 'inicial' }); setCarregando(true); setItens([]); setMarcados(new Set()); setDepois(null); }}>
                Ver todas as publicações
              </button>
            )}
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
            Limpa o ruído da compressão, amplia (Lanczos) e aplica nitidez adaptativa com um leve realce de cor. Fica mais limpo e definido, mas não cria detalhe que não existe no original. Em vídeo já 1080p, "Full HD" só realça. 4K e 8K levam alguns minutos e servem para baixar — o Reels aceita até 1920 px, então ao postar o Nexora reduz para 1080×1920 sozinho.
          </div>

          {rotulo('Formato dos vídeos')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-2)' }}>
            {FORMATOS.map(([id, t, s, I]) => (
              <Opcao key={id} ativo={formato === id} onClick={() => setFormato(id)} titulo={t} sub={s} icone={I} />
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 'var(--mf-4)', lineHeight: 1.5 }}>
            Vale para os vídeos (MP3 extrai só o áudio).{aba === 'contas' && !temVideo && marcados.size ? ' Nenhum vídeo selecionado.' : ''}
          </div>

          {rotulo('Formato das fotos')}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-2)' }}>
            {FORMATOS_FOTO.map(([id, t, s, I]) => (
              <Opcao key={id} ativo={formatoFoto === id} onClick={() => setFormatoFoto(id)} titulo={t} sub={s} icone={I} />
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginBottom: 'var(--mf-4)', lineHeight: 1.5 }}>
            Vale para as fotos, com a qualidade e o upscale escolhidos acima.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-micro)', fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--mf-text-3)', margin: '0 0 8px' }}>
            <Sparkles size={13} style={{ color: 'var(--mf-primary-500)' }} /> Melhorar fotos com IA
          </div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 'var(--mf-2)',
            opacity: iaDisponivel === false ? .5 : 1, pointerEvents: iaDisponivel === false ? 'none' : 'auto' }}>
            {MODOS_IA.map(([id, t, s]) => (
              <Opcao key={id || 'off'} ativo={ia === id} onClick={() => setIa(id)} titulo={t} sub={s} />
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: iaDisponivel === false ? 'var(--mf-warning-500)' : 'var(--mf-text-3)', marginBottom: 'var(--mf-4)', lineHeight: 1.5 }}>
            {iaDisponivel === false
              ? 'O upscale com IA não está instalado neste servidor — atualize com o deploy.'
              : 'Real-ESRGAN: tira os blocos da compressão e reconstrói bordas e texturas. Só para fotos (em vídeo levaria horas); máximo 50 por vez. A IA máxima é um pouco melhor, mas bem mais lenta.'}
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
                : <>{progresso.pct != null ? `${progresso.etapa || 'Enviando'}… ${progresso.pct}%` : `${progresso.etapa === 'Na fila' ? 'Na fila' : 'Processando'}… ${progresso.feitas} de ${progresso.total}`}
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--mf-surface-3)', marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progresso.pct != null ? progresso.pct : progresso.total ? (progresso.feitas / progresso.total) * 100 : 0}%`, background: 'var(--mf-primary-500)', transition: 'width .3s' }} />
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

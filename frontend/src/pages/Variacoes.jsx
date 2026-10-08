import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers, Upload, X, Download, FolderDown, Film, Image as ImageIcon, ChevronDown, ChevronRight,
  Trash2, Ban, RotateCcw, AlertTriangle, Check, Clock,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import Segmentado from '../components/Segmentado';
import ConfirmModal from '../components/ConfirmModal';
import PortalModal from '../components/PortalModal';
import api from '../services/api';
import { getToken } from '../services/auth';
import { avisar } from '../services/avisos';
import { useServerEvents } from '../services/useServerEvents';
import { useTarefa, consumir } from '../services/tarefas';
import { enviar, cancelar as cancelarEnvio, cancelarTodos, limparFinalizados, useEnvios } from '../services/envioDeVariacoes';
import {
  FORMATOS, CONFIG_PADRAO, tipoLocal, problemaLocal, estimarSegundos, tempoLegivel, tamanho,
  resumoDaConfig, filtroCss, selecionarIntervalo, validadeRestante,
} from '../services/variacoes';

/**
 * Variações de Mídia — converter e preparar vídeos e fotos para os formatos do
 * Instagram, em lote. Cada formato escolhido vira um arquivo; tudo o que muda
 * é escolhido aqui e escrito no resumo antes de começar. Nada entra na
 * Biblioteca: os resultados são baixados e expiram.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const comToken = caminho => `${API_URL}${caminho}${caminho.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken() || '')}`;
const linkSaida = id => comToken(`/preparos/saidas/${id}`);
const CONFIG_KEY = 'mf_variacoes_config';
const POR_PAGINA = 20;

function lerConfig() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return salvo ? { ...CONFIG_PADRAO, ...salvo, trecho: { ...CONFIG_PADRAO.trecho, ...salvo.trecho }, ajustes: { ...CONFIG_PADRAO.ajustes, ...salvo.ajustes } } : CONFIG_PADRAO;
  } catch { return CONFIG_PADRAO; }
}

function baixarArquivo(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function baixarZip(saidas) {
  const { data } = await api.post('/preparos/zip', { saidas });
  baixarArquivo(comToken(data.url));
  return data.arquivos;
}

const rotulo = { fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', marginBottom: 6 };
const nota = { fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6 };
const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight: 650, color: 'var(--mf-text-2)' };

export default function Variacoes() {
  const [config, setConfig] = useState(lerConfig);
  const [servidor, setServidor] = useState(null);
  const [pendentes, setPendentes] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const entradaRef = useRef(null);
  const envios = useEnvios();
  const tarefa = useTarefa('variacoes');

  const [aba, setAba] = useState('seus');
  const [dados, setDados] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [selecao, setSelecao] = useState(() => new Set());
  const ancoraRef = useRef(null);
  const [abertos, setAbertos] = useState(() => new Set());
  const [historico, setHistorico] = useState(null);
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [ocupado, setOcupado] = useState('');
  const [verSaida, setVerSaida] = useState(null);

  useEffect(() => { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* sem armazenamento: segue */ } }, [config]);
  useEffect(() => { api.get('/preparos/config').then(r => setServidor(r.data)).catch(() => setServidor({ ffmpeg: true, limites: {} })); }, []);

  const carregar = useCallback(() => api.get('/preparos', { params: { pagina, porPagina: POR_PAGINA } })
    .then(r => setDados(r.data)).catch(() => {}), [pagina]);
  const carregarHistorico = useCallback(() => api.get('/preparos/historico').then(r => setHistorico(r.data)).catch(() => {}), []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (aba === 'historico') carregarHistorico(); }, [aba, carregarHistorico]);

  const recarregarRef = useRef(null);
  useServerEvents(['preparos'], () => {
    clearTimeout(recarregarRef.current);
    recarregarRef.current = setTimeout(() => { carregar(); if (aba === 'historico') carregarHistorico(); }, 350);
  });
  /* Reserva para quando o SSE cai: enquanto algo processa, confere a cada 5 s. */
  const emAndamento = (dados?.itens || []).some(i => ['aguardando', 'processando'].includes(i.status));
  useEffect(() => {
    if (!emAndamento) return undefined;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [emAndamento, carregar]);

  /* O fim do envio é avisado uma vez, aqui ou pelo indicador flutuante. */
  useEffect(() => {
    if (tarefa && tarefa.fase !== 'rodando') {
      avisar(tarefa.fase === 'ok' ? 'success' : 'error', tarefa.fase === 'ok' ? 'Envio concluído' : 'Envio falhou', tarefa.mensagem);
      consumir('variacoes');
      carregar();
    }
  }, [tarefa, carregar]);

  const limites = servidor?.limites || {};
  const muda = parcial => setConfig(c => ({ ...c, ...parcial }));
  const mudaAjuste = (k, v) => setConfig(c => ({ ...c, ajustes: { ...c.ajustes, [k]: v } }));
  const avancado = config.modo === 'avancado';

  /* ── Arquivos escolhidos (antes de enviar) ── */
  const pendentesRef = useRef(pendentes);
  pendentesRef.current = pendentes;
  useEffect(() => () => pendentesRef.current.forEach(p => URL.revokeObjectURL(p.url)), []);

  function adicionar(lista) {
    const novos = [...lista].map(file => ({
      chave: crypto.randomUUID(), file, tipo: tipoLocal(file), url: URL.createObjectURL(file), duracao: null, largura: 0, altura: 0,
    }));
    setPendentes(p => [...p, ...novos]);
    if (!previa && novos[0]) setPrevia(novos[0].chave);
    for (const n of novos) {
      if (n.tipo === 'video') {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => setPendentes(p => p.map(x => (x.chave === n.chave ? { ...x, duracao: v.duration, largura: v.videoWidth, altura: v.videoHeight } : x)));
        v.src = n.url;
      } else if (n.tipo === 'imagem') {
        const img = new Image();
        img.onload = () => setPendentes(p => p.map(x => (x.chave === n.chave ? { ...x, largura: img.naturalWidth, altura: img.naturalHeight } : x)));
        img.src = n.url;
      }
    }
  }
  function remover(chave) {
    const alvo = pendentes.find(x => x.chave === chave);
    if (alvo) URL.revokeObjectURL(alvo.url);
    const resto = pendentes.filter(x => x.chave !== chave);
    setPendentes(resto);
    if (previa === chave) setPrevia(resto[0]?.chave || null);
  }
  function limparPendentes() {
    pendentes.forEach(p => URL.revokeObjectURL(p.url));
    setPendentes([]);
    setPrevia(null);
  }

  const comProblema = pendentes.map(p => ({ ...p, problema: problemaLocal(p.file, { aplicarEm: config.aplicarEm, limites, duracao: p.duracao }) }));
  const validos = comProblema.filter(p => !p.problema);
  const estimativa = estimarSegundos(validos, config);
  const itemPrevia = comProblema.find(p => p.chave === previa) || comProblema[0] || null;

  function gerar() {
    if (!validos.length) return;
    enviar(validos.map(p => ({ file: p.file, tipo: p.tipo })), config);
    /* Os URLs locais dos enviados podem sair: o envio guarda o próprio File. */
    limparPendentes();
    setPagina(1);
  }

  const aceitar = config.aplicarEm === 'video' ? 'video/mp4,video/quicktime,.mp4,.mov'
    : config.aplicarEm === 'imagem' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime,.mp4,.mov,image/jpeg,image/png,image/webp';

  /* ── Resultados ── */
  const itens = useMemo(() => dados?.itens || [], [dados]);
  const ordem = itens.map(i => i.id);
  const saidasProntas = i => i.saidas.filter(s => !s.erro);
  const selecionados = itens.filter(i => selecao.has(i.id));
  const saidasSelecionadas = selecionados.flatMap(saidasProntas);
  const ultimo = dados?.ultimoLote;

  function marcar(id, e) {
    const marcarSim = !selecao.has(id);
    const ancora = ancoraRef.current; // lida agora: o atualizador roda depois da linha que troca a âncora
    if (e?.shiftKey && ancora) setSelecao(s => selecionarIntervalo(s, ordem, ancora, id, marcarSim));
    else setSelecao(s => { const n = new Set(s); if (marcarSim) n.add(id); else n.delete(id); return n; });
    ancoraRef.current = id;
  }
  const todosMarcados = itens.length > 0 && itens.every(i => selecao.has(i.id));

  async function acao(nome, fn) {
    setOcupado(nome);
    try { await fn(); } catch (e) { avisar('error', 'Não deu certo', e.response?.data?.error || e.message); } finally { setOcupado(''); }
  }

  const baixarSaidas = ids => acao('baixar', async () => {
    if (!ids.length) return;
    if (ids.length === 1) baixarArquivo(linkSaida(ids[0]));
    else {
      const n = await baixarZip(ids);
      avisar('success', `Baixando ${n} arquivo(s) em .zip`, '');
    }
    setTimeout(carregar, 1500);
  });

  /* Um por um, sem .zip. Navegador costuma pedir permissão para vários downloads. */
  const baixarUmPorUm = ids => acao('baixar', async () => {
    if (ids.length > 10) { await baixarZip(ids); avisar('info', 'Muitos arquivos', 'Mais de 10 de uma vez: baixando como .zip.'); return; }
    for (const id of ids) { baixarArquivo(linkSaida(id)); await new Promise(r => setTimeout(r, 400)); }
    setTimeout(carregar, 1500);
  });

  const podePasta = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const salvarNaPasta = ids => acao('pasta', async () => {
    if (!ids.length) return;
    let pasta;
    try { pasta = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return; } // cancelou a escolha
    const porId = new Map(itens.flatMap(i => i.saidas.map(s => [s.id, s])));
    let feitos = 0;
    for (const id of ids) {
      const s = porId.get(id);
      const r = await fetch(linkSaida(id));
      if (!r.ok) continue;
      const arq = await pasta.getFileHandle(s?.nome || `${id}.bin`, { create: true });
      await r.body.pipeTo(await arq.createWritable());
      feitos++;
    }
    avisar('success', `${feitos} arquivo(s) salvos na pasta`, pasta.name);
    carregar();
  });

  const cancelarSelecionados = () => acao('cancelar', async () => {
    const ids = selecionados.filter(i => ['aguardando', 'processando'].includes(i.status)).map(i => i.id);
    const { data } = await api.post('/preparos/cancelar', { ids });
    avisar('success', `${data.cancelados} cancelado(s)`, '');
    carregar();
  });
  const excluirSelecionados = () => acao('excluir', async () => {
    const { data } = await api.delete('/preparos', { data: { ids: [...selecao] } });
    avisar('success', `${data.excluidos} excluído(s)`, '');
    setSelecao(new Set());
    setConfirmarExcluir(false);
    carregar();
  });

  const totalPaginas = Math.max(1, Math.ceil((dados?.total || 0) / POR_PAGINA));
  const enviosAtivos = envios.filter(e => e.fase === 'esperando' || e.fase === 'enviando');

  return (
    <PageShell icon={<Layers size={18} />} title="Variações de Mídia" subtitle="Converta seus vídeos e fotos para os formatos do Instagram, em lote" accent="cyan">
      {servidor && !servidor.ffmpeg && (
        <div className="mf-card" style={{ padding: 'var(--mf-3) var(--mf-4)', marginBottom: 'var(--mf-4)', color: 'var(--mf-warning-500)', fontSize: 'var(--mf-t-sm)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={16} /> O processador de mídia (ffmpeg) não está instalado no servidor — nada será processado até ele existir.
        </div>
      )}

      {/* ── Configuração e envio ── */}
      <section className="mf-card" data-variacoes-config style={{ padding: 'var(--mf-4)', marginBottom: 'var(--mf-5)' }}>
        <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 750, color: 'var(--mf-text)' }}>Gerar variações</div>
        <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 4, lineHeight: 1.6, maxWidth: 760 }}>
          Solte vídeos, fotos ou os dois juntos. Cada <b>formato</b> escolhido vira um arquivo pronto para o Instagram, com as mudanças que você definir abaixo.
          {' '}<b>Nada entra na Biblioteca</b> — você baixa os prontos, e eles somem em {limites.validadeH || 24} horas.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--mf-4)', marginTop: 'var(--mf-4)' }}>
          <div>
            <div style={rotulo}>Modo</div>
            <Segmentado rotulo="Modo" valor={config.modo} onChange={v => muda({ modo: v })}
              opcoes={[{ value: 'rapido', label: 'Rápido' }, { value: 'avancado', label: 'Avançado' }]} />
          </div>
          <div>
            <div style={rotulo}>Processar</div>
            <Segmentado rotulo="Processar" valor={config.aplicarEm} onChange={v => muda({ aplicarEm: v })}
              opcoes={[{ value: 'tudo', label: 'Vídeos e fotos' }, { value: 'video', label: 'Só vídeos' }, { value: 'imagem', label: 'Só fotos' }]} />
          </div>
          <div>
            <div style={rotulo}>Qualidade</div>
            <Segmentado rotulo="Qualidade" valor={config.qualidade} onChange={v => muda({ qualidade: v })}
              opcoes={[{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Média' }, { value: 'leve', label: 'Leve' }]} />
          </div>
        </div>

        <div style={{ marginTop: 'var(--mf-4)' }}>
          <div style={rotulo}>Formatos · {config.formatos.length} variação(ões) por arquivo</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} data-formatos>
            {FORMATOS.map(f => {
              const ativo = config.formatos.includes(f.id);
              return (
                <button key={f.id} type="button" aria-pressed={ativo}
                  onClick={() => muda({ formatos: ativo ? (config.formatos.length > 1 ? config.formatos.filter(x => x !== f.id) : config.formatos) : [...config.formatos, f.id] })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
                    border: `1px solid ${ativo ? 'var(--mf-primary-500)' : 'var(--mf-border)'}`,
                    background: ativo ? 'color-mix(in oklch, var(--mf-primary-500) 12%, transparent)' : 'var(--mf-surface-2)', color: 'var(--mf-text)' }}>
                  <span style={{ border: '1.5px solid currentColor', borderRadius: 2, opacity: 0.8, display: 'inline-block',
                    ...(f.largura ? { width: Math.round(18 * f.largura / f.altura), height: 18 } : { width: 18, height: 12, borderStyle: 'dashed' }) }} />
                  <span style={{ textAlign: 'left' }}>
                    <span style={{ display: 'block', fontSize: 'var(--mf-t-xs)', fontWeight: 700 }}>{f.rotulo} {f.largura ? f.proporcao : ''}</span>
                    <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{f.largura ? `${f.largura}×${f.altura}` : 'mesma proporção'}</span>
                  </span>
                  {ativo && <Check size={14} style={{ color: 'var(--mf-primary-500)' }} />}
                </button>
              );
            })}
          </div>
        </div>

        {config.formatos.some(f => f !== 'original') && (
          <div style={{ marginTop: 'var(--mf-4)' }}>
            <div style={rotulo}>Quando a proporção não bate</div>
            <div style={{ display: 'flex' }}>
              <Segmentado rotulo="Enquadramento" valor={config.enquadramento} onChange={v => muda({ enquadramento: v })}
                opcoes={[{ value: 'cortar', label: 'Cortar' }, { value: 'barras', label: 'Barras' }, { value: 'desfoque', label: 'Desfoque' }]} />
            </div>
            <div style={{ ...nota, marginTop: 4 }}>
              {{ cortar: 'Amplia até preencher e corta o que sobra nas bordas.',
                barras: 'Mostra a imagem inteira, com barras pretas no espaço que falta.',
                desfoque: 'Mostra a imagem inteira sobre uma cópia dela ampliada e desfocada.' }[config.enquadramento]}
            </div>
          </div>
        )}

        {avancado && (
          <div data-avancado style={{ marginTop: 'var(--mf-4)', padding: 'var(--mf-3)', borderRadius: 'var(--mf-r-lg)', background: 'var(--mf-surface-2)', display: 'grid', gap: 'var(--mf-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
            <div>
              <div style={rotulo}>Ajustes de imagem</div>
              {[['brilho', 'Brilho', -20, 20], ['contraste', 'Contraste', -20, 20], ['saturacao', 'Saturação', -50, 50], ['nitidez', 'Nitidez', 0, 100]].map(([k, nome, min, max]) => (
                <label key={k} style={{ display: 'grid', gridTemplateColumns: '78px 1fr 44px', alignItems: 'center', gap: 8, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginBottom: 6 }}>
                  {nome}
                  <input type="range" min={min} max={max} step={1} value={config.ajustes[k]} onChange={e => mudaAjuste(k, Number(e.target.value))} aria-label={nome} />
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: config.ajustes[k] ? 'var(--mf-text)' : 'var(--mf-text-3)' }}>
                    {config.ajustes[k] > 0 && k !== 'nitidez' ? '+' : ''}{config.ajustes[k]}%
                  </span>
                </label>
              ))}
              <button type="button" style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setConfig(c => ({ ...c, ajustes: CONFIG_PADRAO.ajustes }))}>
                <RotateCcw size={11} /> Zerar ajustes
              </button>
            </div>
            <div style={{ display: 'grid', gap: 'var(--mf-3)', alignContent: 'start' }}>
              <div>
                <div style={rotulo}>Trecho do vídeo (segundos)</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="inp" type="number" min={0} step={0.5} value={config.trecho.inicio} aria-label="Início do trecho"
                    onChange={e => muda({ trecho: { ...config.trecho, inicio: Math.max(0, Number(e.target.value) || 0) } })} style={{ width: 90 }} />
                  <span style={nota}>até</span>
                  <input className="inp" type="number" min={0} step={0.5} placeholder="fim" value={config.trecho.fim ?? ''} aria-label="Fim do trecho"
                    onChange={e => muda({ trecho: { ...config.trecho, fim: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) } })} style={{ width: 90 }} />
                </div>
                <div style={nota}>Vazio no fim = até o final do vídeo. Vale para todos os vídeos deste envio.</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={config.semAudio} onChange={e => muda({ semAudio: e.target.checked })} /> Remover o áudio dos vídeos
              </label>
              <div style={{ display: 'flex', gap: 'var(--mf-4)', flexWrap: 'wrap' }}>
                <div>
                  <div style={rotulo}>Fotos em</div>
                  <Segmentado rotulo="Formato das fotos" valor={config.formatoFoto} onChange={v => muda({ formatoFoto: v })}
                    opcoes={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WEBP' }]} />
                </div>
                {config.formatos.includes('original') && (
                  <div>
                    <div style={rotulo}>Largura no "Original"</div>
                    <Segmentado rotulo="Largura máxima" valor={config.larguraOriginal} onChange={v => muda({ larguraOriginal: v })}
                      opcoes={[{ value: 1080, label: '1080' }, { value: 1440, label: '1440' }, { value: 0, label: 'Manter' }]} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div data-resumo style={{ marginTop: 'var(--mf-4)', padding: '10px 12px', borderRadius: 'var(--mf-r-md)', border: '1px dashed var(--mf-border)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--mf-text)' }}>Cada arquivo vira:</b> {resumoDaConfig(config)}.
          <span style={{ display: 'block', ...nota }}>Sem localização nem dados do aparelho nos arquivos gerados. Vídeos saem em MP4 (H.264 + AAC).</span>
        </div>

        {/* Área de envio */}
        <div role="button" tabIndex={0} data-soltar
          onClick={() => entradaRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entradaRef.current?.click(); } }}
          onDragOver={e => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={e => { e.preventDefault(); setArrastando(false); adicionar(e.dataTransfer.files); }}
          style={{ marginTop: 'var(--mf-4)', padding: '28px 16px', borderRadius: 'var(--mf-r-lg)', textAlign: 'center', cursor: 'pointer',
            border: `1.5px dashed ${arrastando ? 'var(--mf-primary-500)' : 'var(--mf-border-strong, var(--mf-border))'}`,
            background: arrastando ? 'color-mix(in oklch, var(--mf-primary-500) 8%, transparent)' : 'transparent', color: 'var(--mf-text-2)' }}>
          <Upload size={20} style={{ color: 'var(--mf-text-3)' }} />
          <div style={{ fontSize: 'var(--mf-t-sm)', marginTop: 6 }}>Clique ou solte vários arquivos ({config.aplicarEm === 'video' ? 'MP4, MOV' : config.aplicarEm === 'imagem' ? 'JPG, PNG, WEBP' : 'MP4, MOV, JPG, PNG, WEBP'})</div>
          <div style={nota}>Até {limites.videoMb || 500} MB por vídeo ({Math.round((limites.duracaoS || 600) / 60)} min) e {limites.imagemMb || 40} MB por foto.</div>
          <input ref={entradaRef} type="file" multiple accept={aceitar} hidden onChange={e => { adicionar(e.target.files); e.target.value = ''; }} />
        </div>

        {/* Escolhidos: pré-visualização e estimativa antes de começar */}
        {comProblema.length > 0 && (
          <div data-pendentes style={{ marginTop: 'var(--mf-4)', display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ ...rotulo, marginBottom: 0, flex: 1 }}>{comProblema.length} arquivo(s) escolhido(s)</div>
                <button type="button" style={linkBtn} onClick={limparPendentes}>Limpar</button>
              </div>
              <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                {comProblema.map(p => (
                  <div key={p.chave} onClick={() => setPrevia(p.chave)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--mf-r-sm)', cursor: 'pointer',
                    background: itemPrevia?.chave === p.chave ? 'color-mix(in oklch, var(--mf-primary-500) 10%, var(--mf-surface-2))' : 'var(--mf-surface-2)' }}>
                    {p.tipo === 'video' ? <Film size={14} style={{ color: 'var(--mf-text-3)' }} /> : <ImageIcon size={14} style={{ color: 'var(--mf-text-3)' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>{p.file.name}</div>
                      <div style={{ fontSize: 'var(--mf-t-nano)', color: p.problema ? 'var(--mf-danger-500)' : 'var(--mf-text-3)' }}>
                        {p.problema || [tamanho(p.file.size), p.largura ? `${p.largura}×${p.altura}` : '', p.duracao ? `${Math.round(p.duracao)} s` : ''].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button type="button" aria-label={`Tirar ${p.file.name}`} onClick={e => { e.stopPropagation(); remover(p.chave); }} style={{ ...linkBtn, display: 'grid', placeItems: 'center' }}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 'var(--mf-3)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
                {validos.length} arquivo(s) × {config.formatos.length} formato(s) = <b>{validos.length * config.formatos.length} resultado(s)</b>
                {validos.length > 0 && <span style={nota}> · processamento ≈ {tempoLegivel(estimativa)} (estimativa)</span>}
              </div>
              <button type="button" className="btn-primary" data-gerar disabled={!validos.length || (servidor && !servidor.ffmpeg)} onClick={gerar}
                style={{ marginTop: 'var(--mf-3)', width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} /> Gerar {validos.length * config.formatos.length} resultado(s)
              </button>
            </div>
            {itemPrevia && !itemPrevia.problema && <Previa key={itemPrevia.chave} item={itemPrevia} config={config} />}
          </div>
        )}

        {/* Envios em andamento (continuam se você trocar de tela) */}
        {envios.length > 0 && (
          <div data-envios style={{ marginTop: 'var(--mf-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 10 }}>
              <div style={{ ...rotulo, marginBottom: 0, flex: 1 }}>Enviando · {envios.filter(e => e.fase === 'ok').length} de {envios.length}</div>
              {enviosAtivos.length > 0
                ? <button type="button" style={{ ...linkBtn, color: 'var(--mf-danger-500)' }} onClick={cancelarTodos}>Cancelar todos</button>
                : <button type="button" style={linkBtn} onClick={limparFinalizados}>Limpar</button>}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {envios.map(e => (
                <div key={e.chave} style={{ padding: '6px 8px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mf-trunc" style={{ flex: 1, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)' }}>{e.nome}</span>
                    <span style={{ fontSize: 'var(--mf-t-nano)', color: e.fase === 'erro' ? 'var(--mf-danger-500)' : 'var(--mf-text-3)' }}>
                      {{ esperando: 'na fila', enviando: `${e.pct}%`, ok: 'enviado ✓', cancelado: 'cancelado', erro: e.erro }[e.fase]}
                    </span>
                    {(e.fase === 'esperando' || e.fase === 'enviando') && (
                      <button type="button" aria-label={`Cancelar ${e.nome}`} onClick={() => cancelarEnvio(e.chave)} style={{ ...linkBtn, display: 'grid', placeItems: 'center' }}><X size={13} /></button>
                    )}
                  </div>
                  {e.fase === 'enviando' && (
                    <div style={{ height: 3, borderRadius: 2, background: 'var(--mf-border)', marginTop: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${e.pct}%`, height: '100%', background: 'var(--mf-primary-500)', transition: 'width .2s' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Resultados ── */}
      <div style={{ display: 'flex', gap: 'var(--mf-4)', borderBottom: '1px solid var(--mf-border)', marginBottom: 'var(--mf-3)' }}>
        {[['seus', `Seus ${dados?.total ?? ''}`], ['historico', 'Histórico']].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setAba(k)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 2px', fontSize: 'var(--mf-t-sm)', fontWeight: 700,
            color: aba === k ? 'var(--mf-text)' : 'var(--mf-text-3)', borderBottom: `2px solid ${aba === k ? 'var(--mf-text)' : 'transparent'}`, marginBottom: -1 }}>{t}</button>
        ))}
      </div>

      {aba === 'seus' && (
        <section className="mf-card" data-resultados style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 'var(--mf-3) var(--mf-4)' }}>
            <input type="checkbox" aria-label="Selecionar todos desta página" checked={todosMarcados}
              onChange={() => setSelecao(todosMarcados ? new Set() : new Set(ordem))} />
            <button type="button" className="btn-primary" data-ultimo-envio disabled={!ultimo?.saidas?.length || !!ocupado}
              onClick={() => baixarSaidas(ultimo.saidas)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Download size={14} /> Baixar o último envio ({ultimo?.saidas?.length || 0})
            </button>
            <button type="button" className="btn-ghost" disabled={!saidasSelecionadas.length || !!ocupado}
              onClick={() => baixarUmPorUm(saidasSelecionadas.map(s => s.id))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Baixar selecionados ({saidasSelecionadas.length})
            </button>
            <span style={{ flex: 1 }} />
            {podePasta && (
              <button type="button" style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--mf-t-xs)' }}
                disabled={!saidasSelecionadas.length || !!ocupado} onClick={() => salvarNaPasta(saidasSelecionadas.map(s => s.id))}
                title="Escolha uma pasta do computador e os selecionados são gravados nela">
                <FolderDown size={14} /> Salvar numa pasta
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '0 var(--mf-4) var(--mf-3)', borderBottom: '1px solid var(--mf-border)' }}>
            <span style={{ ...nota, flex: '1 1 260px' }}>Shift+clique nas caixas seleciona um intervalo. Os resultados somem em {dados?.validadeH || 24} h.</span>
            <button type="button" style={{ ...linkBtn, color: 'var(--mf-text)' }} disabled={!saidasSelecionadas.length} onClick={() => baixarSaidas(saidasSelecionadas.map(s => s.id))}>baixar como .zip</button>
            <button type="button" style={linkBtn} onClick={() => setSelecao(new Set(itens.filter(i => saidasProntas(i).some(s => !s.baixadoEm)).map(i => i.id)))}>Selecionar não baixados</button>
            <button type="button" style={linkBtn} onClick={() => setSelecao(new Set())}>Limpar seleção</button>
            {selecionados.some(i => ['aguardando', 'processando'].includes(i.status)) && (
              <button type="button" style={{ ...linkBtn, color: 'var(--mf-warning-500)' }} onClick={cancelarSelecionados}><Ban size={11} style={{ verticalAlign: -1 }} /> Cancelar</button>
            )}
            {selecao.size > 0 && (
              <button type="button" style={{ ...linkBtn, color: 'var(--mf-danger-500)' }} onClick={() => setConfirmarExcluir(true)}><Trash2 size={11} style={{ verticalAlign: -1 }} /> Excluir ({selecao.size})</button>
            )}
          </div>

          {dados && !itens.length && (
            <div style={{ padding: 'var(--mf-5)', textAlign: 'center', ...nota }}>Nada por aqui ainda. Os arquivos que você enviar aparecem nesta lista.</div>
          )}
          {itens.map(i => (
            <LinhaResultado key={i.id} item={i} marcado={selecao.has(i.id)} onMarcar={e => marcar(i.id, e)}
              aberto={abertos.has(i.id)} onAbrir={() => setAbertos(s => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}
              onBaixar={() => baixarSaidas(saidasProntas(i).map(s => s.id))} onVer={s => setVerSaida({ ...s, tipo: i.tipo })} ocupado={!!ocupado} />
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--mf-3) var(--mf-4)', ...nota }}>
            <span style={{ flex: 1 }}>
              {dados?.total ? `${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, dados.total)} de ${dados.total}` : '0'} · página {pagina} de {totalPaginas}
            </span>
            <button type="button" className="btn-ghost btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
            <button type="button" className="btn-ghost btn-sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima</button>
          </div>
        </section>
      )}

      {aba === 'historico' && (
        <section className="mf-card" data-historico style={{ padding: 'var(--mf-3) var(--mf-4)' }}>
          {!historico?.lotes?.length && <div style={{ ...nota, padding: 'var(--mf-3) 0' }}>Nenhum envio nos últimos {historico?.historicoDias || 30} dias.</div>}
          {(historico?.lotes || []).map(l => (
            <div key={l.lote} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--mf-border)' }}>
              <Clock size={14} style={{ color: 'var(--mf-text-3)' }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: 'var(--mf-text)' }}>
                  {new Date(l.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {l.arquivos} arquivo(s) · {l.saidas} resultado(s)
                </div>
                <div style={nota}>
                  {[l.concluidos && `${l.concluidos} pronto(s)`, l.emAndamento && `${l.emAndamento} em andamento`, l.erros && `${l.erros} com erro`,
                    l.cancelados && `${l.cancelados} cancelado(s)`, l.expirados && `${l.expirados} expirado(s)`].filter(Boolean).join(' · ')} · {tamanho(l.bytes)} enviados
                </div>
              </div>
              <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                {l.expirados === l.arquivos ? 'arquivos apagados' : validadeRestante(l.expira)}
              </span>
            </div>
          ))}
        </section>
      )}

      <ConfirmModal open={confirmarExcluir} title={`Excluir ${selecao.size} item(ns)?`}
        message="Os arquivos gerados são apagados do servidor agora. Os que ainda estão processando são cancelados."
        confirmLabel="Excluir" carregando={ocupado === 'excluir'} onConfirm={excluirSelecionados} onCancel={() => setConfirmarExcluir(false)} />

      {verSaida && (
        <PortalModal>
          <div onClick={() => setVerSaida(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', padding: 16,
            background: 'color-mix(in oklch, var(--mf-bg) 85%, transparent)', backdropFilter: 'blur(6px)' }}>
            <div onClick={e => e.stopPropagation()} className="mf-card" style={{ padding: 'var(--mf-3)', maxWidth: 'min(92vw, 520px)', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="mf-trunc" style={{ flex: 1, fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{verSaida.nome}</span>
                <button type="button" aria-label="Fechar" onClick={() => setVerSaida(null)} style={{ ...linkBtn, display: 'grid', placeItems: 'center' }}><X size={16} /></button>
              </div>
              <div style={{ background: '#000', borderRadius: 'var(--mf-r-md)', overflow: 'hidden', display: 'grid', placeItems: 'center', maxHeight: '70vh' }}>
                {verSaida.tipo === 'video'
                  ? <video src={comToken(`/preparos/saidas/${verSaida.id}?inline=1`)} controls playsInline style={{ maxWidth: '100%', maxHeight: '70vh' }} />
                  : <img src={comToken(`/preparos/saidas/${verSaida.id}?inline=1`)} alt={verSaida.nome} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ flex: 1, ...nota }}>{verSaida.rotulo} · {verSaida.largura}×{verSaida.altura} · {tamanho(verSaida.bytes)}</span>
                <a className="btn-primary" href={linkSaida(verSaida.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Baixar</a>
              </div>
            </div>
          </div>
        </PortalModal>
      )}
    </PageShell>
  );
}

/* ── Pré-visualização aproximada (no navegador, antes de enviar) ── */
function Previa({ item, config }) {
  const [semVideo, setSemVideo] = useState(false);
  const filtro = filtroCss(config);
  const proporcaoOriginal = item.largura && item.altura ? item.largura / item.altura : 9 / 16;
  const midia = estilo => (item.tipo === 'video'
    ? <video src={`${item.url}#t=1`} muted playsInline preload="metadata" style={estilo} onError={() => setSemVideo(true)} />
    : <img src={item.url} alt="" style={estilo} />);
  if (semVideo) {
    return <div data-previa style={nota}>Este navegador não consegue mostrar a prévia deste vídeo — o servidor processa normalmente.</div>;
  }
  return (
    <div data-previa>
      <div style={rotulo}>Pré-visualização aproximada · {item.file.name}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {config.formatos.map(id => {
          const f = FORMATOS.find(x => x.id === id);
          const proporcao = f.largura ? f.largura / f.altura : proporcaoOriginal;
          const altura = 170;
          const largura = Math.round(Math.min(220, altura * proporcao));
          const cheio = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
          return (
            <div key={id} style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: largura, height: Math.round(largura / proporcao), borderRadius: 6, overflow: 'hidden', background: '#000', filter: filtro, border: '1px solid var(--mf-border)' }}>
                {!f.largura || config.enquadramento === 'cortar'
                  ? midia({ ...cheio, objectFit: f.largura ? 'cover' : 'contain' })
                  : (<>
                    {config.enquadramento === 'desfoque' && midia({ ...cheio, objectFit: 'cover', filter: 'blur(8px)', transform: 'scale(1.1)' })}
                    {midia({ ...cheio, objectFit: 'contain' })}
                  </>)}
              </div>
              <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 4 }}>{f.largura ? f.proporcao : 'original'}</div>
            </div>
          );
        })}
      </div>
      <div style={{ ...nota, marginTop: 6 }}>A imagem final é gerada no servidor; o trecho e a nitidez não aparecem aqui.</div>
    </div>
  );
}

/* ── Uma linha da lista de resultados ── */
const COR = { concluido: 'var(--mf-success-500)', processando: 'var(--mf-primary-500)', aguardando: 'var(--mf-text-3)', erro: 'var(--mf-danger-500)', cancelado: 'var(--mf-warning-500)' };

function LinhaResultado({ item, marcado, onMarcar, aberto, onAbrir, onBaixar, onVer, ocupado }) {
  const prontas = item.saidas.filter(s => !s.erro);
  const total = item.config?.formatos?.length || prontas.length;
  const todasBaixadas = prontas.length > 0 && prontas.every(s => s.baixadoEm);
  const capa = prontas[0];
  const estado = {
    aguardando: 'Na fila',
    processando: `Processando ${item.saidas.length + 1 > total ? total : item.saidas.length + 1} de ${total}`,
    concluido: 'Pronto',
    erro: 'Erro',
    cancelado: 'Cancelado',
  }[item.status] || item.status;
  const meta = [
    estado,
    item.status === 'concluido' || prontas.length ? `${prontas.length} variação(ões)` : '',
    prontas.length ? `${tamanho(item.bytes)} → ${tamanho(prontas.reduce((s, x) => s + x.bytes, 0))}` : tamanho(item.bytes),
    item.status === 'concluido' ? validadeRestante(item.expiraEm) : '',
    item.config?.modo === 'avancado' ? 'Avançado' : 'Rápido',
  ].filter(Boolean).join(' · ');

  return (
    <div data-linha style={{ borderBottom: '1px solid var(--mf-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px var(--mf-4)' }}>
        <input type="checkbox" checked={marcado} onChange={() => {}} onClick={onMarcar} aria-label={`Selecionar ${item.nomeOriginal}`} />
        <button type="button" onClick={onAbrir} aria-label={aberto ? 'Esconder variações' : 'Mostrar variações'} style={{ ...linkBtn, display: 'grid', placeItems: 'center' }}>
          {aberto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', background: 'var(--mf-surface-2)', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
          {capa && (capa.miniatura || item.tipo === 'imagem')
            ? <img src={comToken(`/preparos/saidas/${capa.id}/miniatura`)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : item.tipo === 'video' ? <Film size={16} style={{ color: 'var(--mf-text-3)' }} /> : <ImageIcon size={16} style={{ color: 'var(--mf-text-3)' }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{item.nomeOriginal}</div>
          <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {item.status === 'processando'
              ? <span className="mf-spin" style={{ width: 8, height: 8 }} />
              : <span style={{ width: 7, height: 7, borderRadius: '50%', background: COR[item.status] || 'var(--mf-text-3)', flexShrink: 0 }} />}
            <span style={{ minWidth: 0 }}>{meta}</span>
          </div>
          {item.erro && <div style={{ fontSize: 'var(--mf-t-nano)', color: item.status === 'erro' ? 'var(--mf-danger-500)' : 'var(--mf-warning-500)' }}>{item.erro}</div>}
        </div>
        {prontas.length > 0 && (
          <button type="button" className="btn-ghost" disabled={ocupado} onClick={onBaixar} style={{ minWidth: 110, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {todasBaixadas ? <>Baixado <Check size={13} /></> : <><Download size={13} /> Baixar</>}
          </button>
        )}
      </div>
      {aberto && (
        <div style={{ padding: '0 var(--mf-4) 12px 74px', display: 'grid', gap: 6 }}>
          {!item.saidas.length && <div style={nota}>{item.status === 'aguardando' || item.status === 'processando' ? 'As variações aparecem aqui conforme ficam prontas.' : 'Nenhuma variação gerada.'}</div>}
          {item.saidas.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)', minWidth: 150 }}>{s.rotulo}</span>
              {s.erro
                ? <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-danger-500)' }}>{s.erro}</span>
                : (<>
                  <span style={nota}>{s.largura}×{s.altura} · {tamanho(s.bytes)}{item.tipo === 'video' && s.duracao ? ` · ${Math.round(s.duracao)} s` : ''}</span>
                  <button type="button" style={linkBtn} onClick={() => onVer(s)}>ver</button>
                  <a href={linkSaida(s.id)} style={{ ...linkBtn, color: 'var(--mf-primary-500)', textDecoration: 'none' }}>{s.baixadoEm ? 'baixado ✓' : 'baixar'}</a>
                </>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

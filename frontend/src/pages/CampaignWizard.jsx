import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import CaptionEditor from '../components/campaign/CaptionEditor';
import CommentEditor from '../components/campaign/CommentEditor';
import CampaignPreview from '../components/campaign/CampaignPreview';

/**
 * Wizard de criação de campanha (fase 5).
 *
 * A campanha só é criada no último passo: o backend materializa o plano inteiro
 * numa transação lógica, então enviar antes deixaria rascunhos órfãos no banco.
 * Até lá o estado vive aqui e num rascunho no localStorage.
 *
 * Legendas e comentários suportam os quatro modos (global, por conta, por
 * conteúdo e por conta+conteúdo), com inserção de variáveis.
 *
 * Ordem das etapas: estratégia e agenda vêm ANTES dos textos. Quem escreve a
 * legenda precisa saber quantas publicações existem e quando saem — decidir a
 * distribuição depois de escrever 12 textos obriga a reescrever tudo.
 */

const RASCUNHO = 'campanha_rascunho_v1';

const LIMITE_TEXTO = 2200;   // limite do Instagram, igual ao do backend

const ETAPAS = [
  { id: 'basico',     titulo: 'Informações',  desc: 'Nome e descrição' },
  { id: 'contas',     titulo: 'Contas',       desc: 'Quem publica' },
  { id: 'conteudos',  titulo: 'Conteúdos',    desc: 'O que publicar' },
  { id: 'estrategia', titulo: 'Estratégia',   desc: 'Como distribuir' },
  { id: 'agenda',     titulo: 'Agendamento',  desc: 'Intervalos e janela' },
  { id: 'legendas',   titulo: 'Legendas',     desc: 'Texto de cada publicação' },
  { id: 'comentarios',titulo: 'Comentários',  desc: 'Comentário após o post' },
  { id: 'revisao',    titulo: 'Revisão',      desc: 'Confira e publique' },
];

const ESTRATEGIAS = [
  { id: 'interleaved_random', nome: 'Distribuição intercalada',
    desc: 'Alterna contas e conteúdos com ordem semeada. Evita blocos rígidos e nunca repete a mesma conta em sequência.' },
  { id: 'round_robin', nome: 'Round robin',
    desc: 'Percorre as contas em rodadas iguais, sem aleatoriedade. Previsível e equilibrado.' },
  { id: 'account_first', nome: 'Conta por conta',
    desc: 'Termina todos os conteúdos de uma conta antes de passar para a próxima.' },
  { id: 'sequential', nome: 'Sequencial',
    desc: 'Ordem literal das listas — é o comportamento que o Postar usa hoje.' },
];

const DIAS = [
  { n: 1, r: 'Seg' }, { n: 2, r: 'Ter' }, { n: 3, r: 'Qua' }, { n: 4, r: 'Qui' },
  { n: 5, r: 'Sex' }, { n: 6, r: 'Sáb' }, { n: 0, r: 'Dom' },
];

const estadoInicial = {
  name: '', description: '',
  accountIds: [], contentIds: [],
  captionMode: 'global',
  captions: { global: '', byAccount: {}, byContent: {}, byAccountContent: {} },
  commentMode: 'disabled', comments: { global: '', delayMinutes: 2, delayMaxMinutes: 6 },
  strategy: { mode: 'interleaved_random' },
  schedule: {
    startAt: '',
    intervalMinMinutes: 12, intervalMaxMinutes: 28,
    useFixedInterval: false,
    windowStart: '', windowEnd: '', weekdays: [],
  },
  settings: { respectDailyLimit: true, postType: 'reel' },
};

export default function CampaignWizard() {
  const navigate = useNavigate();

  const [etapa, setEtapa]   = useState(0);
  const [form, setForm]     = useState(estadoInicial);
  const [contas, setContas] = useState([]);
  const [midias, setMidias] = useState([]);
  const [buscaConta, setBuscaConta]   = useState('');
  const [filtroConta, setFiltroConta] = useState('todas');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro]     = useState(null);
  const [toast, setToast]   = useState(null);

  // null enquanto a prévia carrega; o botão de criar espera o veredito.
  const [previaValida, setPreviaValida] = useState(null);

  const aviso = (type, title, message) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 4000);
  };

  /* ── Rascunho: sobrevive a recarregar a página ─────────────────────────── */
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(RASCUNHO);
      if (salvo) setForm(f => ({ ...f, ...JSON.parse(salvo) }));
    } catch { /* rascunho corrompido é descartado em silêncio */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(RASCUNHO, JSON.stringify(form)); } catch { /* cota cheia */ }
  }, [form]);

  /* ── Carrega contas e mídias ───────────────────────────────────────────── */
  useEffect(() => {
    api.get('/accounts?limit=200')
      .then(({ data }) => setContas(Array.isArray(data.accounts) ? data.accounts : []))
      .catch(() => aviso('error', 'Erro', 'Não foi possível carregar as contas.'));

    api.get('/media')
      .then(({ data }) => {
        const lista = Array.isArray(data) ? data : (data.medias || data.files || []);
        setMidias(lista);
      })
      .catch(() => aviso('error', 'Erro', 'Não foi possível carregar a biblioteca.'));
  }, []);

  const mudar  = (campo, valor) => setForm(f => ({ ...f, [campo]: valor }));
  const mudarEm = (grupo, campo, valor) =>
    setForm(f => ({ ...f, [grupo]: { ...f[grupo], [campo]: valor } }));

  /* ── Derivados ─────────────────────────────────────────────────────────── */

  const contasFiltradas = useMemo(() => {
    const termo = buscaConta.trim().toLowerCase();
    return contas.filter(c => {
      if (termo && !String(c.username || '').toLowerCase().includes(termo)) return false;
      if (filtroConta === 'mobile')   return c.provider === 'instagrapi';
      if (filtroConta === 'oficial')  return c.provider !== 'instagrapi';
      if (filtroConta === 'saudavel') return !c.healthStatus || c.healthStatus === 'ativa';
      return true;
    });
  }, [contas, buscaConta, filtroConta]);

  const totalPublicacoes = form.accountIds.length * form.contentIds.length;

  // Rótulos legíveis das seleções — usados pelos editores de legenda e comentário.
  const rotulosContas = useMemo(() => form.accountIds.map(id => {
    const c = contas.find(x => x._id === id);
    return { id, label: c ? `@${c.username}` : id };
  }), [form.accountIds, contas]);

  const rotulosConteudos = useMemo(() => form.contentIds.map(id => {
    const m = midias.find(x => x._id === id);
    return { id, label: m ? (m.originalName || m.filename) : id };
  }), [form.contentIds, midias]);

  /* ── Validação por etapa ───────────────────────────────────────────────── */

  /**
   * Percorre todos os textos de um bloco (global + os três mapas) e devolve o
   * primeiro que passa do limite.
   *
   * A checagem é feita sobre o texto BRUTO. As variáveis quase sempre crescem ao
   * serem resolvidas ({username} → um usuário mais longo), então o bruto dentro
   * do limite não garante o resolvido dentro do limite — quem confere isso é o
   * backend, na prévia da revisão, com o texto já materializado.
   */
  function textoLongoDemais(bloco) {
    const campos = [
      ['geral', bloco?.global || ''],
      ...['byAccount', 'byContent', 'byAccountContent'].flatMap(mapa =>
        Object.entries(bloco?.[mapa] || {}).map(([chave, texto]) => [chave, texto || ''])),
    ];
    const estourado = campos.find(([, texto]) => texto.length > LIMITE_TEXTO);
    return estourado ? estourado[1].length : null;
  }

  function validar(indice) {
    const id = ETAPAS[indice].id;
    if (id === 'basico'    && !form.name.trim())        return 'Dê um nome à campanha.';
    if (id === 'contas'    && !form.accountIds.length)  return 'Selecione ao menos uma conta.';
    if (id === 'conteudos' && !form.contentIds.length)  return 'Selecione ao menos um conteúdo.';

    if (id === 'legendas') {
      const n = textoLongoDemais(form.captions);
      if (n) return `Uma legenda tem ${n} caracteres — o limite é ${LIMITE_TEXTO}.`;
    }
    if (id === 'comentarios' && form.commentMode !== 'disabled') {
      const n = textoLongoDemais(form.comments);
      if (n) return `Um comentário tem ${n} caracteres — o limite é ${LIMITE_TEXTO}.`;
    }

    if (id === 'agenda') {
      const { intervalMinMinutes: min, intervalMaxMinutes: max, windowStart, windowEnd } = form.schedule;
      if (Number(max) < Number(min)) return 'O intervalo máximo não pode ser menor que o mínimo.';
      if (windowStart && windowEnd && windowEnd <= windowStart) {
        return 'O fim da janela precisa ser depois do início.';
      }
    }
    return null;
  }

  /**
   * Payload enviado ao backend.
   *
   * A prévia e a criação usam esta mesma função — se cada uma montasse o seu, a
   * tela poderia mostrar um plano e o servidor gravar outro.
   */
  function montarPayload() {
    return {
      ...form,
      schedule: {
        ...form.schedule,
        startAt: form.schedule.startAt || undefined,
        intervalMinMinutes: Number(form.schedule.intervalMinMinutes),
        intervalMaxMinutes: Number(form.schedule.intervalMaxMinutes),
      },
    };
  }

  function avancar() {
    const problema = validar(etapa);
    if (problema) return aviso('warning', 'Falta pouco', problema);
    setEtapa(e => Math.min(e + 1, ETAPAS.length - 1));
  }

  /* ── Envio ─────────────────────────────────────────────────────────────── */

  async function publicar() {
    // Revalida tudo: o usuário pode ter voltado e esvaziado uma etapa anterior.
    for (let i = 0; i < ETAPAS.length; i++) {
      const problema = validar(i);
      if (problema) { setEtapa(i); return aviso('warning', 'Revise', problema); }
    }

    if (previaValida === false) {
      return aviso('warning', 'Revise', 'Há publicações com erro no plano. Corrija antes de criar.');
    }

    setEnviando(true);
    setErro(null);
    try {
      const payload = montarPayload();

      // Idempotency-Key: um reenvio por timeout de rede não cria duas campanhas.
      const { data } = await api.post('/campaigns', payload, {
        headers: { 'Idempotency-Key': `wizard-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
      });

      localStorage.removeItem(RASCUNHO);
      aviso('success', 'Campanha criada', `${data.campaign?.totalPublications || 0} publicações planejadas.`);
      // Volta para a listagem: a página de detalhe da campanha é da fase 9.
      setTimeout(() => navigate('/campaigns'), 900);
    } catch (err) {
      const d = err.response?.data;
      setErro({
        code:    d?.code || 'ERRO',
        message: d?.message || err.message,
        ids:     d?.missingIds || [],
      });
    } finally {
      setEnviando(false);
    }
  }

  /* ── Blocos de UI ──────────────────────────────────────────────────────── */

  const rotulo = t => (
    <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:6, letterSpacing:'.04em' }}>{t}</label>
  );

  const painel = (titulo, filhos, extra = {}) => (
    <div style={{ background:'oklch(0.16 0.05 235 / 0.55)', border:'1px solid oklch(1 0 0 / 0.08)',
      borderRadius:14, padding:16, marginBottom:14, ...extra }}>
      {titulo && <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700 }}>{titulo}</h3>}
      {filhos}
    </div>
  );

  function Stepper() {
    return (
      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        padding: '6px 2px 14px',
        marginBottom: 16,
        alignItems: 'stretch',
        scrollbarWidth: 'thin',
      }}>
        {ETAPAS.map((e, i) => {
          const atual = i === etapa;
          const feito = i < etapa;
          return (
            <button key={e.id} onClick={() => i <= etapa && setEtapa(i)}
              title={e.desc}
              style={{
                flex: '1 1 0', minWidth: 102, textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                cursor: i <= etapa ? 'pointer' : 'default', transition: 'all .18s',
                background: atual ? 'rgba(0,212,255,.14)' : feito ? 'rgba(16,185,129,.10)' : 'oklch(0.12 0.04 235)',
                border: `1px solid ${atual ? 'rgba(0,212,255,.45)' : feito ? 'rgba(16,185,129,.3)' : 'oklch(1 0 0 / 0.09)'}`,
                color: atual ? 'var(--cyan)' : feito ? '#34d399' : 'var(--text3)',
                boxShadow: atual ? '0 0 14px rgba(0,212,255,.18)' : 'none',
              }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 750, opacity: .9 }}>
                {feito ? '✓ FEITO' : `ETAPA ${String(i + 1).padStart(2, '0')}`}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.titulo}</div>
            </button>
          );
        })}
      </div>
    );
  }

  function EtapaBasico() {
    return painel('Informações da campanha', <>
      <div style={{ marginBottom:12 }}>
        {rotulo('NOME')}
        <input className="input" style={{ width:'100%' }} autoFocus
          placeholder="Campanha Reels Agosto"
          value={form.name} onChange={e => mudar('name', e.target.value)} />
      </div>
      <div>
        {rotulo('DESCRIÇÃO (OPCIONAL)')}
        <textarea className="input" rows={3} style={{ width:'100%', resize:'vertical' }}
          placeholder="Distribuição de vídeos para as contas selecionadas"
          value={form.description} onChange={e => mudar('description', e.target.value)} />
      </div>
    </>);
  }

  function EtapaContas() {
    const alternar = id => setForm(f => ({
      ...f,
      accountIds: f.accountIds.includes(id)
        ? f.accountIds.filter(x => x !== id)
        : [...f.accountIds, id],
    }));

    const visiveis = contasFiltradas.map(c => c._id);
    const todasMarcadas = visiveis.length > 0 && visiveis.every(id => form.accountIds.includes(id));

    return painel(null, <>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <input className="input" style={{ flex:1, minWidth:180 }} placeholder="Buscar @conta..."
          value={buscaConta} onChange={e => setBuscaConta(e.target.value)} />
        {[['todas','Todas'], ['mobile','API Mobile'], ['oficial','Oficial'], ['saudavel','Saudáveis']].map(([id, r]) => (
          <button key={id} onClick={() => setFiltroConta(id)} style={{
            padding:'7px 12px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
            background: filtroConta === id ? 'rgba(0,212,255,.12)' : 'oklch(1 0 0 / 0.04)',
            color:      filtroConta === id ? 'var(--cyan)' : 'var(--text3)',
            border:     `1px solid ${filtroConta === id ? 'rgba(0,212,255,.3)' : 'oklch(1 0 0 / 0.08)'}`,
          }}>{r}</button>
        ))}
        <button onClick={() => setForm(f => ({
          ...f,
          accountIds: todasMarcadas
            ? f.accountIds.filter(id => !visiveis.includes(id))
            : [...new Set([...f.accountIds, ...visiveis])],
        }))} style={{
          padding:'7px 12px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
          background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.28)',
        }}>{todasMarcadas ? 'Desmarcar' : 'Selecionar todas'}</button>
      </div>

      <div style={{ fontSize:12, color:'var(--cyan)', fontWeight:700, marginBottom:10 }}>
        {form.accountIds.length} conta(s) selecionada(s)
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(230px,100%),1fr))', gap:8 }}>
        {contasFiltradas.map(c => {
          const marcada = form.accountIds.includes(c._id);
          const saudavel = !c.healthStatus || c.healthStatus === 'ativa';
          return (
            <button key={c._id} onClick={() => alternar(c._id)} style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 11px', borderRadius:10,
              textAlign:'left', cursor:'pointer', transition:'all .15s',
              background: marcada ? 'rgba(0,212,255,.09)' : 'oklch(1 0 0 / 0.03)',
              border: `1px solid ${marcada ? 'rgba(0,212,255,.35)' : 'oklch(1 0 0 / 0.07)'}`,
            }}>
              <div style={{ width:16, height:16, borderRadius:5, flexShrink:0, display:'grid', placeItems:'center',
                background: marcada ? 'var(--cyan)' : 'transparent',
                border: `1.5px solid ${marcada ? 'var(--cyan)' : 'oklch(1 0 0 / 0.22)'}` }}>
                {marcada && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#04121c" strokeWidth="4" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontSize:12, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  @{c.username}
                </div>
                <div style={{ display:'flex', gap:5, marginTop:3, flexWrap:'wrap' }}>
                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:20,
                    background:'rgba(139,92,246,.12)', color:'#a78bfa' }}>
                    {c.provider === 'instagrapi' ? 'API Mobile' : 'Oficial'}
                  </span>
                  <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:20,
                    background: saudavel ? 'rgba(16,185,129,.12)' : 'rgba(244,63,94,.12)',
                    color: saudavel ? '#34d399' : '#f87171' }}>
                    {saudavel ? 'Saudável' : c.healthStatus}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {!contasFiltradas.length && (
          <div style={{ gridColumn:'1/-1', padding:'26px 0', textAlign:'center', color:'var(--text3)', fontSize:12 }}>
            Nenhuma conta encontrada com esse filtro.
          </div>
        )}
      </div>
    </>);
  }

  function EtapaConteudos() {
    const alternar = id => setForm(f => ({
      ...f,
      contentIds: f.contentIds.includes(id)
        ? f.contentIds.filter(x => x !== id)
        : [...f.contentIds, id],
    }));

    // Fase 16: Função de upload direto no Wizard
    const [uploadingMedia, setUploadingMedia] = useState(false);
    const handleUpload = async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      setUploadingMedia(true);
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      try {
        const { data } = await api.post('/media/upload', formData);
        const novosIds = data.files.map(f => f._id);
        // Recarrega mídias
        const res = await api.get('/media');
        const lista = Array.isArray(res.data) ? res.data : (res.data.medias || res.data.files || []);
        setMidias(lista);
        // Auto-seleciona os que acabaram de subir
        setForm(f => ({ ...f, contentIds: [...new Set([...f.contentIds, ...novosIds])] }));
        aviso('success', 'Upload concluído', `${files.length} arquivo(s) enviado(s) e selecionado(s).`);
      } catch (err) {
        aviso('error', 'Erro no upload', 'Não foi possível enviar os arquivos.');
      } finally {
        setUploadingMedia(false);
      }
    };

    return painel(null, <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
        <div style={{ fontSize:12, color:'var(--cyan)', fontWeight:700 }}>
          {form.contentIds.length} conteúdo(s) selecionado(s)
        </div>
        
        <div style={{ display:'flex', gap:8 }}>
          <label style={{
            padding:'7px 12px', borderRadius:8, fontSize:11, fontWeight:700, cursor: uploadingMedia ? 'default' : 'pointer',
            background:'rgba(16,185,129,.12)', color:'#34d399', border:'1px solid rgba(16,185,129,.28)',
            display:'flex', alignItems:'center', gap:5
          }}>
            {uploadingMedia ? 'Enviando...' : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload na hora
              </>
            )}
            <input type="file" multiple accept="video/*,image/*" style={{ display:'none' }} disabled={uploadingMedia} onChange={handleUpload} />
          </label>

          <button onClick={() => setForm(f => ({
            ...f,
            contentIds: f.contentIds.length === midias.length ? [] : midias.map(m => m._id),
          }))} style={{
            padding:'7px 12px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
            background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.28)',
          }}>{form.contentIds.length === midias.length ? 'Desmarcar todos' : 'Selecionar todos'}</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:10 }}>
        {midias.map(m => {
          const marcado = form.contentIds.includes(m._id);
          const ordem   = form.contentIds.indexOf(m._id) + 1;
          const video   = m.type === 'video' || /\.(mp4|mov|webm|m4v)$/i.test(m.filename || '');
          return (
            <button key={m._id} onClick={() => alternar(m._id)} style={{
              position:'relative', padding:0, borderRadius:12, overflow:'hidden', cursor:'pointer',
              aspectRatio:'3/4', textAlign:'left', transition:'all .2s cubic-bezier(0.4, 0, 0.2, 1)',
              background:'oklch(0.16 0.05 235)',
              border: `2px solid ${marcado ? 'var(--cyan)' : 'transparent'}`,
              boxShadow: marcado ? '0 4px 14px rgba(0,212,255,0.2)' : 'none',
              transform: marcado ? 'translateY(-2px)' : 'none'
            }}>
              {m.url && !video && (
                <img src={m.url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', filter: marcado ? 'brightness(1.1)' : 'brightness(0.8)' }} />
              )}
              {m.url && video && (
                <video src={m.url} muted playsInline style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', filter: marcado ? 'brightness(1.1)' : 'brightness(0.8)' }} />
              )}
              <div style={{ position:'absolute', inset:0, background: marcado ? 'linear-gradient(to top, rgba(0,212,255,0.2), transparent)' : 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }} />
              
              {marcado && (
                <span style={{ position:'absolute', top:8, left:8, width:24, height:24, borderRadius:'50%',
                  background:'var(--cyan)', color:'#04121c', display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:12, fontWeight:800, boxShadow:'0 2px 5px rgba(0,0,0,0.3)' }}>{ordem}</span>
              )}
              <div style={{ position:'absolute', left:0, right:0, bottom:0, padding:'20px 10px 8px',
                background:'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                fontSize:10, fontWeight:600, color:'#fff',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textShadow:'0 1px 2px rgba(0,0,0,0.8)' }}>
                {video ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ display:'inline-block', verticalAlign:'-1px', marginRight:4 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
                ) : ''}{m.originalName || m.filename}
              </div>
            </button>
          );
        })}
        {!midias.length && (
          <div style={{ gridColumn:'1/-1', padding:'30px 0', textAlign:'center', color:'var(--text3)', fontSize:13, background:'rgba(255,255,255,0.02)', borderRadius:12 }}>
            Nenhuma mídia encontrada.<br/>Clique em <strong>Upload na hora</strong> acima para enviar seus vídeos.
          </div>
        )}
      </div>
    </>);
  }

  function EtapaLegendas() {
    return (<>
      <CaptionEditor
        titulo="Legenda das publicações"
        mode={form.captionMode}
        onModeChange={m => mudar('captionMode', m)}
        captions={form.captions}
        onChange={c => mudar('captions', c)}
        accounts={rotulosContas}
        contents={rotulosConteudos}
      />

      <div style={{ fontSize:11, color:'var(--text3)', background:'oklch(1 0 0 / 0.03)',
        border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:'11px 13px', lineHeight:1.65 }}>
        A prioridade na hora de publicar é <strong>conta + conteúdo</strong> → <strong>conta</strong> →
        <strong> conteúdo</strong> → <strong>geral</strong>. Campo vazio cai para o nível seguinte, então
        dá para preencher só as exceções e deixar o resto na legenda geral.
        <div style={{ marginTop:6 }}>
          Use <strong>Inserir variável</strong> para marcações como <code>{'{username}'}</code> ou
          <code> {'{campaign}'}</code> — elas ficam guardadas assim e só são substituídas no momento
          da publicação. O texto final de cada publicação aparece na revisão.
        </div>
      </div>
    </>);
  }

  function EtapaComentarios() {
    return (<>
      <CommentEditor
        mode={form.commentMode}
        onModeChange={m => mudar('commentMode', m)}
        comments={form.comments}
        onChange={c => mudar('comments', c)}
        accounts={rotulosContas}
        contents={rotulosConteudos}
      />

      {form.commentMode !== 'disabled' && (
        <div style={{ fontSize:11, color:'var(--text3)', background:'oklch(1 0 0 / 0.03)',
          border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:9, padding:'11px 13px',
          lineHeight:1.65, marginTop:14 }}>
          O comentário é agendado como tarefa própria — não trava o processamento das
          outras publicações enquanto espera o atraso.
        </div>
      )}
    </>);
  }

  function EtapaEstrategia() {
    return painel('Como distribuir as publicações', (
      <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
        {ESTRATEGIAS.map(e => {
          const ativa = form.strategy.mode === e.id;
          return (
            <button key={e.id} onClick={() => mudarEm('strategy', 'mode', e.id)} style={{
              textAlign:'left', padding:'12px 14px', borderRadius:11, cursor:'pointer', transition:'all .15s',
              background: ativa ? 'rgba(0,212,255,.09)' : 'oklch(1 0 0 / 0.03)',
              border: `1px solid ${ativa ? 'rgba(0,212,255,.38)' : 'oklch(1 0 0 / 0.07)'}`,
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                <span style={{ width:14, height:14, borderRadius:'50%', flexShrink:0,
                  border:`2px solid ${ativa ? 'var(--cyan)' : 'oklch(1 0 0 / 0.25)'}`,
                  background: ativa ? 'var(--cyan)' : 'transparent' }} />
                <span style={{ fontSize:12.5, fontWeight:700, color: ativa ? 'var(--cyan)' : 'var(--text)' }}>{e.nome}</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:5, lineHeight:1.55, paddingLeft:23 }}>{e.desc}</div>
            </button>
          );
        })}
      </div>
    ));
  }

  function EtapaAgenda() {
    const s = form.schedule;
    const alternarDia = n => mudarEm('schedule', 'weekdays',
      s.weekdays.includes(n) ? s.weekdays.filter(d => d !== n) : [...s.weekdays, n]);

    return (<>
      {painel('Intervalo entre publicações', <>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginBottom:12 }}>
          <input type="checkbox" checked={s.useFixedInterval}
            onChange={e => mudarEm('schedule', 'useFixedInterval', e.target.checked)} />
          <span style={{ fontSize:12, fontWeight:600 }}>Usar intervalo fixo</span>
        </label>

        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <div>
            {rotulo(s.useFixedInterval ? 'INTERVALO (MIN)' : 'MÍNIMO (MIN)')}
            <input className="input" type="number" min={0} style={{ width:120 }}
              value={s.intervalMinMinutes}
              onChange={e => mudarEm('schedule', 'intervalMinMinutes', Number(e.target.value))} />
          </div>
          {!s.useFixedInterval && (
            <div>
              {rotulo('MÁXIMO (MIN)')}
              <input className="input" type="number" min={0} style={{ width:120 }}
                value={s.intervalMaxMinutes}
                onChange={e => mudarEm('schedule', 'intervalMaxMinutes', Number(e.target.value))} />
            </div>
          )}
        </div>
      </>)}

      {painel('Janela de publicação', <>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            {rotulo('INÍCIO')}
            <input className="input" type="time" style={{ width:130 }}
              value={s.windowStart} onChange={e => mudarEm('schedule', 'windowStart', e.target.value)} />
          </div>
          <div>
            {rotulo('FIM')}
            <input className="input" type="time" style={{ width:130 }}
              value={s.windowEnd} onChange={e => mudarEm('schedule', 'windowEnd', e.target.value)} />
          </div>
          <div>
            {rotulo('COMEÇAR EM (OPCIONAL)')}
            <input className="input" type="datetime-local" style={{ width:210 }}
              value={s.startAt} onChange={e => mudarEm('schedule', 'startAt', e.target.value)} />
          </div>
        </div>

        {rotulo('DIAS PERMITIDOS')}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {DIAS.map(d => {
            const ativo = s.weekdays.includes(d.n);
            return (
              <button key={d.n} onClick={() => alternarDia(d.n)} style={{
                padding:'7px 12px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
                background: ativo ? 'rgba(0,212,255,.12)' : 'oklch(1 0 0 / 0.04)',
                color:      ativo ? 'var(--cyan)' : 'var(--text3)',
                border:     `1px solid ${ativo ? 'rgba(0,212,255,.3)' : 'oklch(1 0 0 / 0.08)'}`,
              }}>{d.r}</button>
            );
          })}
        </div>
        <div style={{ fontSize:10.5, color:'var(--text3)', marginTop:9 }}>
          Nenhum dia marcado = todos os dias. Horários no fuso de Brasília.
        </div>
      </>)}

      {painel('Limite diário', (
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
          <input type="checkbox" checked={form.settings.respectDailyLimit}
            onChange={e => mudarEm('settings', 'respectDailyLimit', e.target.checked)} />
          <span style={{ fontSize:12, lineHeight:1.6 }}>
            Não agendar além do limite diário de cada conta
            <span style={{ display:'block', fontSize:10.5, color:'var(--text3)', marginTop:2 }}>
              A verificação na hora de publicar continua ativa de qualquer forma.
            </span>
          </span>
        </label>
      ))}
    </>);
  }

  function EtapaRevisao() {
    const estrategia = ESTRATEGIAS.find(e => e.id === form.strategy.mode);
    const s = form.schedule;

    const linha = (rot, valor) => (
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'7px 0',
        borderBottom:'1px solid oklch(1 0 0 / 0.05)' }}>
        <span style={{ fontSize:11.5, color:'var(--text3)' }}>{rot}</span>
        <span style={{ fontSize:11.5, fontWeight:700, textAlign:'right' }}>{valor}</span>
      </div>
    );

    return (<>
      {/* O plano real, vindo do servidor. Não há contagem estimada aqui de
          propósito: com o limite diário ligado o planner pode gerar menos
          publicações que contas × conteúdos, e mostrar o produto das listas
          seria um número que não corresponde ao que será criado. */}
      {painel('Plano gerado', (
        <CampaignPreview payload={montarPayload()} onValidChange={setPreviaValida} />
      ))}

      {painel('Configuração', <>
        {linha('Campanha', form.name || '—')}
        {linha('Estratégia', estrategia?.nome || form.strategy.mode)}
        {linha('Intervalo', s.useFixedInterval
          ? `${s.intervalMinMinutes} min (fixo)`
          : `${s.intervalMinMinutes}–${s.intervalMaxMinutes} min`)}
        {linha('Janela', s.windowStart && s.windowEnd ? `${s.windowStart} às ${s.windowEnd}` : 'Sem restrição')}
        {linha('Dias', s.weekdays.length ? DIAS.filter(d => s.weekdays.includes(d.n)).map(d => d.r).join(', ') : 'Todos')}
        {linha('Tipo', form.settings.postType)}
        {linha('Limite diário', form.settings.respectDailyLimit ? 'Respeitado no plano' : 'Ignorado no plano')}
        {linha('Comentário', form.commentMode === 'disabled'
          ? 'Desativado'
          : (form.comments.delayMaxMinutes ?? 6) > (form.comments.delayMinutes ?? 2)
            ? `${form.comments.delayMinutes ?? 2} a ${form.comments.delayMaxMinutes ?? 6} min após o post`
            : `${form.comments.delayMinutes ?? 2} min após o post`)}
      </>)}

      <div style={{ fontSize:11.5, lineHeight:1.7, color:'var(--text3)', background:'rgba(0,212,255,.05)',
        border:'1px solid rgba(0,212,255,.2)', borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
        Ao publicar, o servidor grava exatamente o plano acima. A campanha fica visível na página
        dela antes de qualquer publicação sair — <strong>nada é enviado ao Instagram agora</strong>.
      </div>

      {erro && (
        <div style={{ fontSize:12, color:'#f87171', background:'rgba(244,63,94,.08)',
          border:'1px solid rgba(244,63,94,.25)', borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
          <strong>{erro.code}</strong>
          <div style={{ marginTop:4, lineHeight:1.6 }}>{erro.message}</div>
          {!!erro.ids?.length && (
            <div style={{ marginTop:6, fontFamily:'var(--font-mono)', fontSize:10, opacity:.85 }}>
              {erro.ids.join(', ')}
            </div>
          )}
        </div>
      )}
    </>);
  }

  const CONTEUDO = {
    basico:      EtapaBasico,
    contas:      EtapaContas,
    conteudos:   EtapaConteudos,
    estrategia:  EtapaEstrategia,
    agenda:      EtapaAgenda,
    legendas:    EtapaLegendas,
    comentarios: EtapaComentarios,
    revisao:     EtapaRevisao,
  };
  const Atual = CONTEUDO[ETAPAS[etapa].id];
  const ultima = etapa === ETAPAS.length - 1;

  return (
    <PageShell
      icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>}
      title="Nova campanha"
      subtitle={ETAPAS[etapa].desc}
      accent="cyan"
      actions={
        <button onClick={() => navigate('/campaigns')} className="btn btn-ghost" style={{ fontSize:12 }}>
          Sair do wizard
        </button>
      }
    >
      <div style={{ padding: '8px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Stepper />

        <AnimatePresence mode="wait">
          <motion.div key={ETAPAS[etapa].id}
            initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
            transition={{ duration:.18, ease:[.4,0,.2,1] }}>
            {/* Chamada, não `<Atual />`: como as funções de etapa são recriadas a
                cada render, usá-las como componente daria a elas uma identidade
                nova toda vez e o React remontaria a subárvore inteira — a prévia
                refaria o POST em laço e os filtros seriam zerados a cada tecla.
                Nenhuma etapa usa hooks, então chamá-las direto é seguro. */}
            {Atual()}
          </motion.div>
        </AnimatePresence>

        {/* ── Navegação ── */}
        <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:6, flexWrap:'wrap' }}>
          <button className="btn btn-ghost" disabled={etapa === 0 || enviando}
            onClick={() => setEtapa(e => Math.max(0, e - 1))}>Voltar</button>

          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {/* Na revisão o número real vem da prévia; repetir a estimativa aqui
                mostraria dois totais diferentes na mesma tela. */}
            {totalPublicacoes > 0 && !ultima && (
              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text3)' }}>
                até {totalPublicacoes} publicações
              </span>
            )}
            {ultima ? (
              <button className="btn btn-primary" onClick={publicar}
                disabled={enviando || previaValida !== true}
                title={previaValida === false ? 'Corrija as publicações com erro' : undefined}>
                {enviando ? 'Criando...' : previaValida === null ? 'Gerando plano...' : 'Publicar campanha'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={avancar} disabled={enviando}>Continuar</button>
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}

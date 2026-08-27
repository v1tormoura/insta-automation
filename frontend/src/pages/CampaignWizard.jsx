import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';
import CaptionEditor from '../components/campaign/CaptionEditor';
import CommentEditor from '../components/campaign/CommentEditor';
import CampaignPreview from '../components/campaign/CampaignPreview';
import ContentPicker from '../components/campaign/ContentPicker';
import { urlDoAvatar, iniciaisDe } from '../utils/avatar';
import { EsqueletoLista } from '../components/Estados';

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

/**
 * Trilha de progresso.
 *
 * Antes eram oito cartões de dois andares lado a lado: não cabiam na
 * largura, então a barra rolava na horizontal e as últimas etapas ficavam
 * fora de vista — justamente as que dizem quanto falta. A trilha troca
 * altura por densidade: nós numerados sobre um trilho que se preenche
 * conforme se avança, e a etapa atual em destaque.
 *
 * O trilho preenchido fica ATRÁS dos nós, medido em porcentagem entre o
 * primeiro e o último centro — daí o `left`/`right` de meia coluna.
 *
 * Fica FORA do wizard pelo mesmo motivo do Avatar: declarada lá dentro,
 * ganharia identidade nova a cada render e o React remontaria a trilha
 * inteira. O elemento do preenchimento nasceria já na largura final e a
 * transição nunca chegaria a rodar — a barra saltaria em vez de avançar.
 */
function Trilha({ etapa, setEtapa }) {
  const total = ETAPAS.length;
  const progresso = total > 1 ? (etapa / (total - 1)) * 100 : 0;

  return (
    <div style={{ padding:'2px 0 6px', overflowX:'auto', scrollbarWidth:'thin' }}>
      <div style={{ position:'relative', display:'grid',
        gridTemplateColumns:`repeat(${total}, minmax(74px, 1fr))`, minWidth:'min(100%, 620px)' }}>

        {/* trilho de fundo + preenchimento */}
        <div aria-hidden style={{ position:'absolute', top:15, height:2, borderRadius: 'var(--mf-r-xs)',
          left:`calc(50% / ${total})`, right:`calc(50% / ${total})`,
          background:'var(--mf-border)' }} />
        <div aria-hidden style={{ position:'absolute', top:15, height:2, borderRadius: 'var(--mf-r-xs)',
          left:`calc(50% / ${total})`, width:`calc((100% - 100% / ${total}) * ${progresso / 100})`,
          background:'linear-gradient(90deg, var(--mf-success-500), var(--mf-mod-campanhas, var(--mf-accent-500)))',
          transition:'width .32s cubic-bezier(.4,0,.2,1)' }} />

        {ETAPAS.map((e, i) => {
          const atual = i === etapa;
          const feito = i < etapa;
          const cor = atual ? 'var(--mf-mod-campanhas, var(--mf-accent-500))'
                    : feito ? 'var(--mf-success-500)'
                    : 'var(--mf-text-3)';
          return (
            <button key={e.id} onClick={() => i <= etapa && setEtapa(i)}
              title={`${e.titulo} — ${e.desc}`}
              aria-current={atual ? 'step' : undefined}
              disabled={i > etapa}
              style={{
                position:'relative', display:'flex', flexDirection:'column', alignItems:'center',
                gap:6, padding:'0 2px', background:'none', border:'none',
                cursor: i <= etapa ? 'pointer' : 'default',
              }}>
              <span style={{
                width:30, height:30, borderRadius: 'var(--mf-r-full)', display:'grid', placeItems:'center',
                fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', fontWeight:750, lineHeight:1,
                color: atual ? 'var(--mf-bg)' : cor,
                background: atual ? 'var(--mf-mod-campanhas, var(--mf-accent-500))'
                          : feito ? 'color-mix(in oklch, var(--mf-success-500) 16%, var(--mf-surface-2))'
                          : 'var(--mf-surface-2)',
                border:`1.5px solid ${atual || feito ? cor : 'var(--mf-border)'}`,
                boxShadow: atual ? '0 0 0 4px color-mix(in oklch, var(--mf-mod-campanhas, var(--mf-accent-500)) 16%, transparent)' : 'none',
                transition:'all .2s cubic-bezier(.4,0,.2,1)',
              }}>
                {feito
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : String(i + 1).padStart(2, '0')}
              </span>
              <span style={{
                fontSize: 'var(--mf-t-nano)', fontWeight: atual ? 750 : 600, color: atual ? 'var(--mf-text)' : cor,
                maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                transition:'color .2s',
              }}>{e.titulo}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Foto de perfil da conta, com iniciais quando não há foto e quando a foto
 * falha ao carregar. Os dois casos acontecem: conta recém-conectada ainda
 * não sincronizou o avatar, e o CDN do Instagram às vezes expira a URL.
 * Sem o segundo caso, um avatar quebrado deixava um buraco no cartão.
 *
 * Fica FORA do wizard de propósito. Declarado lá dentro, ganharia identidade
 * nova a cada render, e o React trataria cada render como um componente
 * diferente: desmontaria e remontaria a <img> toda vez, fazendo a foto
 * piscar a cada tecla digitada na busca. É a mesma armadilha que o comentário
 * do `Atual()` descreve mais abaixo.
 */
function Avatar({ conta, marcada }) {
  const src = urlDoAvatar(conta.avatar);
  const [falhou, setFalhou] = useState(false);
  const anel = marcada
    ? 'var(--mf-mod-contas)'
    : 'var(--mf-border-strong)';

  return (
    <span style={{
      width:34, height:34, borderRadius: 'var(--mf-r-full)', flexShrink:0, position:'relative',
      display:'grid', placeItems:'center', overflow:'hidden',
      background:'var(--mf-surface-3)',
      boxShadow:`0 0 0 2px ${anel}`,
      transition:'box-shadow .15s',
    }}>
      {src && !falhou ? (
        <img src={src} alt="" onError={() => setFalhou(true)}
          style={{ width:'100%', height:'100%', objectFit:'cover' }} />
      ) : (
        <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight:750, color:'var(--mf-text-3)', letterSpacing:'.02em' }}>
          {iniciaisDe(conta.username)}
        </span>
      )}
      {marcada && (
        <span style={{
          position:'absolute', right:-1, bottom:-1, width:14, height:14, borderRadius: 'var(--mf-r-full)',
          display:'grid', placeItems:'center',
          background:'var(--mf-mod-contas)', border:'2px solid var(--mf-surface-2)',
        }}>
          <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="var(--mf-bg)"
            strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
      )}
    </span>
  );
}

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
  // contentId -> mediaId da imagem usada como capa do Reel
  covers: { byContent: {} },
};

export default function CampaignWizard() {
  const navigate = useNavigate();

  const [etapa, setEtapa]   = useState(0);
  const [form, setForm]     = useState(estadoInicial);
  const [contas, setContas] = useState([]);
  /* Quantas contas do rascunho não existiam mais. Vira aviso assim que a lista
     chega — silenciar seria pior: a pessoa montou a campanha contando com elas. */
  const [contasPodadas, setContasPodadas] = useState(0);
  const [contasCarregando, setContasCarregando] = useState(true);
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

  useEffect(() => {
    if (!contasPodadas) return;
    aviso('warning', 'Contas removidas da seleção',
      `${contasPodadas} conta(s) do rascunho não existem mais e foram tiradas. ` +
      'Confira a etapa Contas antes de seguir.');
    setContasPodadas(0);
  }, [contasPodadas]);

  /* ── Carrega contas e mídias ───────────────────────────────────────────── */
  useEffect(() => {
    api.get('/accounts?limit=200')
      .then(({ data }) => {
        const lista = Array.isArray(data.accounts) ? data.accounts : [];
        setContas(lista);

        /* O rascunho guarda IDs de conta e sobrevive a tudo — inclusive à conta
           ser removida e reconectada, o que gera um _id novo. Os IDs mortos
           ficavam selecionados e INVISÍVEIS: o seletor só desenha conta que
           existe, então a tela dizia "5 conta(s) selecionada(s)" com uma conta
           marcada, e a prévia só falhava lá na revisão com ACCOUNT_NOT_FOUND.

           Só podamos com a lista COMPLETA em mãos. Com paginação parcial, um
           ID ausente pode estar na página seguinte, e podar apagaria escolha
           boa. */
        const total = Number(data?.pagination?.total ?? lista.length);
        if (lista.length < total) return;

        const vivos = new Set(lista.map(c => String(c._id)));
        setForm(f => {
          const mantidos = f.accountIds.filter(id => vivos.has(String(id)));
          if (mantidos.length === f.accountIds.length) return f;
          setContasPodadas(f.accountIds.length - mantidos.length);
          return { ...f, accountIds: mantidos };
        });
      })
      .catch(() => aviso('error', 'Erro', 'Não foi possível carregar as contas.'))
      .finally(() => setContasCarregando(false));

    api.get('/media')
      .then(({ data }) => {
        const lista = Array.isArray(data) ? data : (data.medias || data.files || []);
        setMidias(lista);
      })
      .catch(() => aviso('error', 'Erro', 'Não foi possível carregar a biblioteca.'));
  }, []);

  /* Mescla, não substitui: o wizard carrega a biblioteca uma vez para conseguir
     rotular os conteúdos de um rascunho, e o ContentPicker devolve só o que ele
     próprio já viu. Trocar a lista perderia o rótulo do que veio do rascunho.
     useCallback porque a função é dependência de efeito lá dentro. */
  const registrarMidias = useCallback((lista) => {
    setMidias(prev => {
      const mapa = new Map(prev.map(m => [String(m._id), m]));
      for (const m of lista) mapa.set(String(m._id), m);
      return [...mapa.values()];
    });
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
    <label style={{ display:'block', fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-2)', marginBottom:6, letterSpacing:'.04em' }}>{t}</label>
  );

  const painel = (titulo, filhos, extra = {}) => (
    <div style={{ background:'var(--mf-surface-1)', border:'1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', padding:18, marginBottom:14,
      boxShadow:'0 1px 2px oklch(0 0 0 / .28)', ...extra }}>
      {titulo && (
        <h3 style={{ margin:'0 0 14px', fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-text)' }}>
          {titulo}
        </h3>
      )}
      {filhos}
    </div>
  );

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
            padding:'7px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700, cursor:'pointer',
            background: filtroConta === id ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-border-subtle)',
            color:      filtroConta === id ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)',
            border:     `1px solid ${filtroConta === id ? 'color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : 'var(--mf-border)'}`,
          }}>{r}</button>
        ))}
        <button onClick={() => setForm(f => ({
          ...f,
          accountIds: todasMarcadas
            ? f.accountIds.filter(id => !visiveis.includes(id))
            : [...new Set([...f.accountIds, ...visiveis])],
        }))} style={{
          padding:'7px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700, cursor:'pointer',
          background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)',
        }}>{todasMarcadas ? 'Desmarcar' : 'Selecionar todas'}</button>
      </div>

      <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-mod, var(--mf-accent-500))', fontWeight:700, marginBottom:10 }}>
        {form.accountIds.length} conta(s) selecionada(s)
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(230px,100%),1fr))', gap:8 }}>
        {contasCarregando && !contasFiltradas.length && (
          <div style={{ gridColumn: '1 / -1' }}><EsqueletoLista itens={4} /></div>
        )}
        {contasFiltradas.map(c => {
          const marcada = form.accountIds.includes(c._id);
          const saudavel = !c.healthStatus || c.healthStatus === 'ativa';
          return (
            <button key={c._id} onClick={() => alternar(c._id)} style={{
              display:'flex', alignItems:'center', gap:10, padding:'9px 11px', borderRadius: 'var(--mf-r-md)',
              textAlign:'left', cursor:'pointer', transition:'all .15s cubic-bezier(.4,0,.2,1)',
              background: marcada ? 'color-mix(in oklch, var(--mf-mod-contas) 10%, var(--mf-surface-2))' : 'var(--mf-surface-2)',
              border: `1px solid ${marcada ? 'color-mix(in oklch, var(--mf-mod-contas) 42%, transparent)' : 'var(--mf-border)'}`,
              boxShadow: marcada ? '0 2px 10px color-mix(in oklch, var(--mf-mod-contas) 14%, transparent)' : 'none',
            }}>
              {/* Foto de perfil: reconhecer a conta pela cara é mais rápido que
                  ler oito @nomes parecidos. O anel marca a seleção, então a
                  caixinha separada de marcar deixou de ser necessária. */}
              <Avatar conta={c} marcada={marcada} />

              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis',
                  whiteSpace:'nowrap', color: marcada ? 'var(--mf-text)' : 'var(--mf-text-2)' }}>
                  @{c.username}
                </div>
                <div style={{ display:'flex', gap:5, marginTop:3, flexWrap:'wrap' }}>
                  <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'1px 6px', borderRadius: 'var(--mf-r-xl)',
                    background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)' }}>
                    {c.provider === 'instagrapi' ? 'API Mobile' : 'Oficial'}
                  </span>
                  <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'1px 6px', borderRadius: 'var(--mf-r-xl)',
                    background: saudavel ? 'color-mix(in oklch, var(--mf-success-500) 12%, transparent)' : 'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)',
                    color: saudavel ? 'var(--mf-success-500)' : 'var(--mf-danger-500)' }}>
                    {saudavel ? 'Saudável' : c.healthStatus}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {!contasFiltradas.length && (
          <div style={{ gridColumn:'1/-1', padding:'26px 0', textAlign:'center', color:'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)' }}>
            Nenhuma conta encontrada com esse filtro.
          </div>
        )}
      </div>
    </>);
  }

  // A etapa de conteúdos é um componente de verdade (ContentPicker), não uma
  // função chamada no render como as demais: ela precisa de estado próprio
  // (busca, filtro, upload, capa) e hooks só são legais dentro de um componente.
  function EtapaConteudos() {
    return painel(null, (
      <ContentPicker
        selecionados={form.contentIds}
        onSelecionar={ids => mudar('contentIds', ids)}
        capas={form.covers?.byContent || {}}
        onCapa={(contentId, mediaId) => setForm(f => {
          const byContent = { ...(f.covers?.byContent || {}) };
          if (mediaId) byContent[contentId] = mediaId;
          else delete byContent[contentId];
          return { ...f, covers: { byContent } };
        })}
        /* Em lote. O ContentPicker sabe quais dos selecionados são vídeo, então
           manda a lista pronta — aqui só se grava. Capa em imagem não existe:
           o Instagram usa a própria imagem como miniatura. */
        onCapaTodos={(mediaId, idsDeVideo) => setForm(f => {
          const byContent = { ...(f.covers?.byContent || {}) };
          for (const id of idsDeVideo || []) {
            if (mediaId) byContent[id] = mediaId;
            else delete byContent[id];
          }
          return { ...f, covers: { byContent } };
        })}
        onMidiasConhecidas={registrarMidias}
        aviso={aviso}
      />
    ));
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

      <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', background:'var(--mf-border-subtle)',
        border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:'11px 13px', lineHeight:1.65 }}>
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
        <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', background:'var(--mf-border-subtle)',
          border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:'11px 13px',
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
              textAlign:'left', padding:'12px 14px', borderRadius: 'var(--mf-r-md)', cursor:'pointer', transition:'all .15s',
              background: ativa ? 'color-mix(in oklch, var(--mf-mod-contas) 9%, transparent)' : 'var(--mf-border-subtle)',
              border: `1px solid ${ativa ? 'color-mix(in oklch, var(--mf-mod-contas) 38%, transparent)' : 'var(--mf-border)'}`,
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                <span style={{ width:14, height:14, borderRadius: 'var(--mf-r-full)', flexShrink:0,
                  border:`2px solid ${ativa ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-border-strong)'}`,
                  background: ativa ? 'var(--mf-mod, var(--mf-accent-500))' : 'transparent' }} />
                <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color: ativa ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text)' }}>{e.nome}</span>
              </div>
              <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:5, lineHeight:1.55, paddingLeft:23 }}>{e.desc}</div>
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
          <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight:600 }}>Usar intervalo fixo</span>
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
                padding:'7px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700, cursor:'pointer',
                background: ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-border-subtle)',
                color:      ativo ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)',
                border:     `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : 'var(--mf-border)'}`,
              }}>{d.r}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:9 }}>
          Nenhum dia marcado = todos os dias. Horários no fuso de Brasília.
        </div>
      </>)}

      {painel('Limite diário', (
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
          <input type="checkbox" checked={form.settings.respectDailyLimit}
            onChange={e => mudarEm('settings', 'respectDailyLimit', e.target.checked)} />
          <span style={{ fontSize: 'var(--mf-t-xs)', lineHeight:1.6 }}>
            Não agendar além do limite diário de cada conta
            <span style={{ display:'block', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2 }}>
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

    /* Duas colunas: são oito linhas curtas, e empilhadas elas ocupavam a
       altura toda do painel com metade da largura vazia. */
    const linha = (rot, valor) => (
      <div key={rot} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
        gap:12, padding:'8px 0', borderBottom:'1px solid var(--mf-border-subtle)' }}>
        <span style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', whiteSpace:'nowrap' }}>{rot}</span>
        <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, textAlign:'right', color:'var(--mf-text)',
          fontVariantNumeric:'tabular-nums' }}>{valor}</span>
      </div>
    );

    /* Resumo antes do detalhe: são os três números que decidem se o plano está
       certo, e estavam perdidos no meio de oito linhas de igual peso. */
    const resumo = (n, rot, cor) => (
      <div key={rot} style={{ flex:'1 1 110px', padding:'11px 13px', borderRadius: 'var(--mf-r-md)',
        background:'var(--mf-surface-2)', border:'1px solid var(--mf-border)' }}>
        <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-h1)', fontWeight:750, color:cor,
          lineHeight:1.1, fontVariantNumeric:'tabular-nums' }}>{n}</div>
        <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:3, letterSpacing:'.04em' }}>{rot}</div>
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
        <div style={{ display:'flex', gap:9, flexWrap:'wrap', marginBottom:14 }}>
          {resumo(form.accountIds.length,  'CONTAS',    'var(--mf-mod-contas)')}
          {resumo(form.contentIds.length,  'CONTEÚDOS', 'var(--mf-mod-publicar)')}
          {resumo(form.settings.postType.toUpperCase(), 'FORMATO', 'var(--mf-mod-campanhas, var(--mf-accent-500))')}
        </div>

        <div style={{ display:'grid', gap:'0 26px',
          gridTemplateColumns:'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
          {linha('Campanha', form.name || '—')}
          {linha('Estratégia', estrategia?.nome || form.strategy.mode)}
          {linha('Intervalo', s.useFixedInterval
            ? `${s.intervalMinMinutes} min (fixo)`
            : `${s.intervalMinMinutes}–${s.intervalMaxMinutes} min`)}
          {linha('Janela', s.windowStart && s.windowEnd ? `${s.windowStart} às ${s.windowEnd}` : 'Sem restrição')}
          {linha('Dias', s.weekdays.length ? DIAS.filter(d => s.weekdays.includes(d.n)).map(d => d.r).join(', ') : 'Todos')}
          {linha('Limite diário', form.settings.respectDailyLimit ? 'Respeitado no plano' : 'Ignorado no plano')}
          {linha('Comentário', form.commentMode === 'disabled'
            ? 'Desativado'
            : (form.comments.delayMaxMinutes ?? 6) > (form.comments.delayMinutes ?? 2)
              ? `${form.comments.delayMinutes ?? 2} a ${form.comments.delayMaxMinutes ?? 6} min após o post`
              : `${form.comments.delayMinutes ?? 2} min após o post`)}
        </div>
      </>)}

      <div style={{ fontSize: 'var(--mf-t-micro)', lineHeight:1.7, color:'var(--mf-text-3)', background:'color-mix(in oklch, var(--mf-mod-contas) 5%, transparent)',
        border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'12px 14px', marginBottom:14 }}>
        Ao publicar, o servidor grava exatamente o plano acima. A campanha fica visível na página
        dela antes de qualquer publicação sair — <strong>nada é enviado ao Instagram agora</strong>.
      </div>

      {erro && (
        <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-danger-500)', background:'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)',
          border:'1px solid color-mix(in oklch, var(--mf-danger-500) 25%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'12px 14px', marginBottom:14 }}>
          <strong>{erro.code}</strong>
          <div style={{ marginTop:4, lineHeight:1.6 }}>{erro.message}</div>
          {!!erro.ids?.length && (
            <div style={{ marginTop:6, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', opacity:.85 }}>
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
        <button onClick={() => navigate('/campaigns')} className="btn btn-ghost" style={{ fontSize: 'var(--mf-t-xs)' }}>
          Sair do wizard
        </button>
      }
    >
      <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Trilha etapa={etapa} setEtapa={setEtapa} />

        <AnimatePresence mode="wait">
          <motion.div key={ETAPAS[etapa].id}
            initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }}
            transition={{ duration:.18, ease:[.4,0,.2,1] }}>
            {/* Chamada, não `<Atual />`: como as funções de etapa são recriadas a
                cada render, usá-las como componente daria a elas uma identidade
                nova toda vez e o React remontaria a subárvore inteira — a prévia
                refaria o POST em laço e os filtros seriam zerados a cada tecla.

                ⚠️ NENHUMA função Etapa* pode chamar hook. Elas são executadas
                dentro do render DESTE componente, então um useState lá dentro
                vira hook do wizard e a contagem muda ao trocar de etapa — o
                React derruba a tela inteira. Já aconteceu com o upload da etapa
                de conteúdos. Etapa que precisa de estado próprio vira componente
                de verdade, como ContentPicker. */}
            {Atual()}
          </motion.div>
        </AnimatePresence>

        {/* ── Navegação ────────────────────────────────────────────────────
            Presa ao fim da janela. A etapa de conteúdos passa de dois mil
            pixels com a biblioteca aberta, e o botão de avançar ficava lá
            embaixo: escolher uma mídia no topo e ter que rolar a página
            inteira para seguir era o caminho normal, não a exceção.

            `position: sticky` e não `fixed` — assim ele respeita a largura da
            coluna e some junto quando a etapa é curta, em vez de flutuar
            sobre o conteúdo. */}
        <div style={{
          position:'sticky', bottom:0, zIndex:20,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:10,
          flexWrap:'wrap', marginTop:4,
          padding:'12px 14px',
          borderRadius: 'var(--mf-r-lg)',
          border:'1px solid var(--mf-border)',
          background:'color-mix(in oklch, var(--mf-surface-1) 88%, transparent)',
          backdropFilter:'blur(12px)',
          WebkitBackdropFilter:'blur(12px)',
          boxShadow:'0 -6px 22px oklch(0 0 0 / .30)',
        }}>
          <button className="btn btn-ghost" disabled={etapa === 0 || enviando}
            onClick={() => setEtapa(e => Math.max(0, e - 1))}>Voltar</button>

          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            {/* Na revisão o número real vem da prévia; repetir a estimativa aqui
                mostraria dois totais diferentes na mesma tela. */}
            {totalPublicacoes > 0 && !ultima && (
              <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
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
              <button className="btn btn-primary" onClick={avancar} disabled={enviando}>
                Continuar
              </button>
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}

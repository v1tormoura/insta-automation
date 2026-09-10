import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../design/tokens.css';
import '../design/sistema.css';
import '../design/avancado.css';
import '../design/ponte.css';
import { removeToken } from '../services/auth';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import { pushNotification } from '../services/useNotifications';
import { SmartActivityProvider, SinoDeNotificacoes, PilhaDeAvisos } from '../components/SmartActivity';
import FundoCiber from '../components/FundoCiber';
import { lidas as lerPreferencias, salvar as salvarPreferencias } from '../services/preferencias';

/**
 * Alterna o tema, no topo.
 *
 * O tema claro existia no CSS desde sempre e nao tinha como ser ligado. Agora
 * ele tem uma tela (Minha Conta) e este botao — e os dois escrevem no MESMO
 * lugar, `services/preferencias`, que aplica no `<html>` e grava no navegador.
 * Um segundo caminho com estado proprio faria os dois discordarem no primeiro
 * clique.
 *
 * Grava no servidor sem esperar: a troca ja aconteceu na tela, e travar o
 * botao por uma ida a rede para confirmar o que se esta vendo seria pedir
 * confirmacao do obvio. Se a gravacao falhar, a preferencia vale neste
 * aparelho — que e o que o recado em Minha Conta explica.
 */
function BotaoDeTema() {
  const [tema, setTema] = useState(() => lerPreferencias().tema);

  const alternar = () => {
    const novo = tema === 'claro' ? 'escuro' : 'claro';
    setTema(novo);
    salvarPreferencias({ tema: novo });
    api.put('/conta/preferencias', { preferencias: { tema: novo } }).catch(() => {});
  };

  const claro = tema === 'claro';
  return (
    <button className="mf-pilula" onClick={alternar}
      title={claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}
      aria-label={claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}>
      {claro ? ICONS.sol : ICONS.lua}
    </button>
  );
}

/**
 * O relogio do topo.
 *
 * A referencia tem um seletor de PERIODO aqui. Nao coloquei: o periodo filtra
 * os dados do painel, e um controle na casca — visivel em todas as trinta
 * telas — que so mudasse uma delas prometeria mais do que faz. O periodo
 * continua no painel, ao lado do que ele filtra.
 *
 * O relogio fica porque e verdade em qualquer tela.
 */
function RelogioDoTopo() {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    /* Alinhado ao proximo minuto cheio, e nao a cada 1000 ms: um relogio sem
       segundos que atualiza a cada segundo faz 59 renders inuteis por minuto. */
    let id;
    const agendar = () => {
      const restam = 60000 - (Date.now() % 60000);
      id = setTimeout(() => { setAgora(new Date()); agendar(); }, restam + 50);
    };
    agendar();
    return () => clearTimeout(id);
  }, []);

  return (
    <span className="mf-pilula mf-pilula--larga" title="Data e hora deste aparelho">
      {ICONS.calendario}
      <span className="mf-mono" style={{ fontSize: 'var(--mf-t-micro)' }}>
        {agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        {' · '}
        {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </span>
  );
}

/**
 * O circulo do usuario na barra do topo.
 *
 * Era um `<div>` com "VM" e "Vitor Marcelo Moura" escritos no codigo. Agora le
 * `/conta` e leva para a pagina — o lugar onde o nome e a foto sao trocados e
 * o lugar onde eles aparecem tem de ser o mesmo dado.
 *
 * Falha em silencio: se a rota nao responder, sobra o circulo com iniciais. Um
 * erro na barra do topo apareceria em toda tela do painel, por causa de um
 * enfeite.
 */
function AvatarDoUsuario() {
  const navigate = useNavigate();
  const [conta, setConta] = useState(null);

  useEffect(() => {
    let ignorar = false;
    api.get('/conta')
      .then(({ data }) => { if (!ignorar) setConta(data); })
      .catch(() => {});
    return () => { ignorar = true; };
  }, []);

  const nome = conta?.nome || '';
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'EU';
  const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  return (
    <button className="mf-usuario" onClick={() => navigate('/minha-conta')}
      title={nome ? `${nome} — minha conta` : 'Minha conta'}>
      <span className="mf-usuario__foto">
        {conta?.avatar
          ? <img src={`${API}${conta.avatar}`} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : iniciais}
      </span>
      {/* Nome e papel, como na referencia. O papel e "Administrador" e nao um
          campo do banco: o sistema tem um usuario so, o dono, e inventar um
          campo de cargo para exibir sempre o mesmo valor seria guardar uma
          constante no Mongo. */}
      <span className="mf-usuario__txt">
        <span className="mf-usuario__n">{nome || 'Minha conta'}</span>
        <span className="mf-usuario__p">Administrador</span>
      </span>
    </button>
  );
}

const ic = (children, w = 18) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);

const ICONS = {
  dashboard: ic(<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>),
  posts:     ic(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>),
  accounts:  ic(<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>),
  media:     ic(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>),
  scheduler: ic(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>),
  stories:   ic(<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>),
  warmup:    ic(<><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></>),
  sessions:  ic(<><rect x="5" y="11" width="14" height="11" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></>),
  health:    ic(<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>),
  proxies:   ic(<><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></>),
  legends:   ic(<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>),
  loop:      ic(<><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>),
  jobs:      ic(<><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3h-4a2 2 0 00-2 2v2h8V5a2 2 0 00-2-2z"/><path d="M12 12v4M10 14h4"/></>),
  topposts:  ic(<><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 3z"/></>),
  logs:      ic(<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></>),
  settings:  ic(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>),
  menu:      ic(<><path d="M3 12h18M3 6h18M3 18h18"/></>),
  search:    ic(<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>, 15),
  chevron:   ic(<><path d="m15 18-6-6 6-6"/></>),
  logout:    ic(<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>),
  besttimes: ic(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
  audio:     ic(<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>),
  abtest:    ic(<><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/></>),
  repost:    ic(<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>),
  hunter:    ic(<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>),
  promo:      ic(<><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></>),
  downloader:  ic(<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>),
  bell:        ic(<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>),
  ranking:     ic(<><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></>),
  faturamento: ic(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>),
  limpador:    ic(<><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/><path d="M10 11v6M14 11v6"/></>),
  performance: ic(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>),
  videotpl:    ic(<><path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.9L15 14"/><rect x="1" y="8" width="14" height="13" rx="2"/></>),
  videobatch:  ic(<><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></>),
  videoeditor: ic(<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M10 10l2-2 2 2"/><path d="M12 8v5"/></>),
  apimeta:     ic(<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/></>),
  lua:         ic(<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>, 15),
  sol:         ic(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>, 15),
  calendario:  ic(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>, 14),
  usuario:     ic(<><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></>),
  perfis:      ic(<><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M18 14v-3M21 14V8"/></>),
  oauth:       ic(<><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></>),
};

const NAV_GROUPS = [
  {
    title: 'VISÃO GERAL',
    items: [
      { to: '/', mod: 'metricas',            label: 'Dashboard',   sub: 'Visão geral',          icon: ICONS.dashboard   },
      { to: '/metricas-perfis', mod: 'metricas', label: 'Métricas dos Perfis', sub: 'Seguidores e curtidas', icon: ICONS.perfis },
      { to: '/ranking', mod: 'metricas',     label: 'Ranking',     sub: 'Posts do mês',         icon: ICONS.ranking     },
      { to: '/faturamento', mod: 'metricas', label: 'Faturamento', sub: 'Meta de vendas',       icon: ICONS.faturamento },
    ],
  },
  {
    title: 'PUBLICAÇÃO',
    items: [
      { to: '/posts', mod: 'publicar',        label: 'Postar',       sub: 'Criar e agendar',    icon: ICONS.posts     },
      { to: '/loop', mod: 'publicar',         label: 'Loop',         sub: 'Ciclos contínuos',   icon: ICONS.loop      },
      { to: '/jobs', mod: 'jobs',         label: 'Jobs',         sub: 'Gerenciar execuções', icon: ICONS.jobs      },
      { to: '/campaigns', mod: 'campanhas',    label: 'Campanhas',    sub: 'Distribuição planejada', icon: ICONS.ranking  },
      { to: '/stories', mod: 'publicar',      label: 'Stories',      sub: 'Publicar em massa',  icon: ICONS.stories   },
      { to: '/scheduler', mod: 'jobs',    label: 'Agendamentos', sub: 'Fila e calendário',  icon: ICONS.scheduler },
      { to: '/smart-repost', mod: 'jobs', label: 'Automatizar',  sub: 'Regras automáticas', icon: ICONS.repost    },
    ],
  },
  {
    title: 'CONTEÚDO',
    items: [
      { to: '/biblioteca', mod: 'publicar',  label: 'Biblioteca',  sub: 'Mídias e pastas',       icon: ICONS.media       },
      { to: '/legends', mod: 'publicar',     label: 'Legendas',    sub: 'Textos salvos',         icon: ICONS.legends     },
      { to: '/limpador', mod: 'sistema',    label: 'Limpador',    sub: 'Remover metadados',     icon: ICONS.limpador    },
      { to: '/performance', mod: 'metricas', label: 'Performance', sub: 'Insights gerais',       icon: ICONS.performance },
      { to: '/warmup', mod: 'contas',      label: 'Engajamento', sub: 'Interações por conta',  icon: ICONS.warmup      },
      { to: '/top-posts', mod: 'metricas',   label: 'Top Posts',   sub: 'Republique os melhores',icon: ICONS.topposts    },
    ],
  },
  {
    title: 'VÍDEO',
    items: [
      { to: '/video-editor', mod: 'publicar',    label: 'Editor',        sub: 'Editor de vídeos',      icon: ICONS.videoeditor },
      { to: '/video-templates', mod: 'publicar', label: 'Templates',     sub: 'Modelos de vídeo',      icon: ICONS.videotpl    },
      { to: '/video-batches', mod: 'publicar',   label: 'Processamentos', sub: 'Lotes e resultados',   icon: ICONS.videobatch  },
    ],
  },
  {
    title: 'CONFIGURAÇÃO',
    items: [
      { to: '/accounts', mod: 'contas',  label: 'Contas',   sub: 'Gerenciar contas',  icon: ICONS.accounts },
      { to: '/health', mod: 'contas',    label: 'Saúde',    sub: 'Status das contas', icon: ICONS.health   },
      { to: '/proxies', mod: 'contas',   label: 'Proxies',  sub: 'Gerenciar proxies', icon: ICONS.proxies  },
      { to: '/api-meta', mod: 'sistema',    label: 'API Meta',  sub: 'Apps Meta / OAuth',  icon: ICONS.apimeta },
      { to: '/oauth-contas', mod: 'contas', label: 'OAuth',    sub: 'Conexões por conta', icon: ICONS.oauth   },
      { to: '/settings/notificacoes', mod: 'sistema', label: 'Notificações', sub: 'Avisos de marco', icon: ICONS.bell },
      { to: '/minha-conta', mod: 'sistema', label: 'Minha Conta', sub: 'Perfil, senha e aparência', icon: ICONS.usuario },
    ],
  },
  {
    title: 'MAIS',
    items: [
      { to: '/best-times', mod: 'metricas', label: 'Melhores Horários', sub: 'Quando postar',        icon: ICONS.besttimes },
      { to: '/promo', mod: 'campanhas',      label: 'Divulgação',        sub: 'Captação de clientes', icon: ICONS.promo     },
      { to: '/logs', mod: 'sistema',       label: 'Histórico',         sub: 'Logs de atividade',    icon: ICONS.logs      },
    ],
  },
];

/* ── build notification from SSE event ── */
function buildNotif(data, event) {
  const a = data?.action || '';
  if (event === 'posts') {
    if (a === 'post_completed' || data?.status === 'concluido')
      return { type: 'success', msg: `Post publicado${data.username ? ` @${data.username}` : ''}${data.caption ? ` — "${String(data.caption).slice(0,40)}"` : ''}` };
    if (a === 'post_failed' || data?.status === 'erro')
      return { type: 'error', msg: `Falha ao publicar${data.username ? ` @${data.username}` : ''}${data.error ? `: ${String(data.error).slice(0,60)}` : ''}` };
    if (a === 'post_started')
      return { type: 'info', msg: `Publicação iniciada${data.username ? ` @${data.username}` : ''}` };
    if (data?.status) return null;
  }
  if (event === 'accounts') {
    if (a === 'oauth_connected')   return { type: 'success', msg: `${data.username || 'Conta'} conectada via OAuth` };
    if (a === 'token_recovered')   return { type: 'success', msg: `Token renovado: @${data.username || ''}` };
    if (a === 'tokens_refreshed' && (data.refreshed || 0) > 0)
      return { type: 'success', msg: `${data.refreshed} token(s) renovado(s)` };
    if (a === 'health_update' && data.healthStatus && data.healthStatus !== 'ativa')
      return { type: data.healthStatus === 'banida' ? 'error' : 'warn', msg: `Atenção @${data.username || ''}: ${data.error || data.healthStatus}` };
    if (a === 'sync_done') return { type: 'info', msg: `Sincronização concluída${data.count ? ` — ${data.count} contas` : ''}` };
  }
  if (event === 'loop') {
    if (a === 'loop_started') return { type: 'info',    msg: 'Loop de postagens iniciado' };
    if (a === 'loop_stopped') return { type: 'info',    msg: 'Loop pausado' };
    if (a === 'loop_error')   return { type: 'error',   msg: `Erro no loop${data.error ? `: ${String(data.error).slice(0,60)}` : ''}` };
    if (a === 'post_sent')    return { type: 'success', msg: `Loop publicou${data.username ? ` @${data.username}` : ''}` };
  }
  if (event === 'insights' && a === 'sync_done')
    return { type: 'info', msg: `Insights sincronizados${data.count ? ` (${data.count} posts)` : ''}` };
  if (event === 'warmup') {
    if (a === 'warmup_started') return { type: 'info',    msg: `Aquecimento iniciado${data.username ? ` — @${data.username}` : ''}` };
    if (a === 'warmup_stopped') return { type: 'info',    msg: `Aquecimento parado${data.username ? ` — @${data.username}` : ''}` };
    if (a === 'warmup_action')  return { type: 'success', msg: `Ação de aquecimento: ${data.actionType || ''}${data.username ? ` @${data.username}` : ''}` };
  }
  return null;
}

/* ── Paleta de comandos ────────────────────────────────────────────────────
   Navega para as rotas REAIS do NAV_GROUPS — não é uma lista paralela que
   precisaria ser mantida em sincronia com a barra lateral. */
function PaletaComandos({ aberta, aoFechar }) {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const campoRef = useRef(null);

  const itens = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const todos = NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, grupo: g.title })));
    return termo
      ? todos.filter(i => `${i.label} ${i.sub || ''}`.toLowerCase().includes(termo))
      : todos;
  }, [busca]);

  useEffect(() => { if (aberta) { setBusca(''); setAtivo(0); campoRef.current?.focus(); } }, [aberta]);
  useEffect(() => { setAtivo(0); }, [busca]);

  if (!aberta) return null;

  const escolher = (item) => { navigate(item.to); aoFechar(); };

  const aoTeclar = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo(i => Math.min(itens.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setAtivo(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter' && itens[ativo]) escolher(itens[ativo]);
  };

  return (
    <div className="mf-cmd-backdrop" onClick={e => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="mf-cmd" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <input ref={campoRef} className="mf-cmd__input" autoComplete="off"
          placeholder="Ir para uma página…"
          value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={aoTeclar} />
        <div className="mf-cmd__list">
          {itens.length === 0 && (
            <div style={{ padding: 'var(--mf-6)', textAlign: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>
              Nada encontrado para “{busca}”.
            </div>
          )}
          {itens.map((i, idx) => (
            <button key={i.to} className="mf-cmd__item" data-active={idx === ativo}
              style={{ '--mf-mod': `var(--mf-mod-${i.mod || 'sistema'})` }}
              onMouseEnter={() => setAtivo(idx)} onClick={() => escolher(i)}>
              <span className="mf-nav-item__ico">{i.icon}</span>
              <span className="mf-trunc" style={{ flex: 1 }}>{i.label}</span>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>{i.grupo}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MainLayout({ children }) {
  const [gaveta, setGaveta]       = useState(false);
  /* Rail por padrão. A queixa era a sidebar ocupar espaço demais: 264px
     presos com 28 itens de duas alturas cada. Quem prefere expandida clica
     uma vez e a escolha fica gravada — o padrão serve a maioria sem tirar a
     opção de ninguém.

     A leitura tolera localStorage indisponível (janela anônima, storage
     bloqueado): ali o acesso LANÇA, e um `try` ausente derrubaria o layout
     inteiro em vez de só perder uma preferência. */
  /* Chave nova de propósito. A anterior (`mf-sidebar-aberta`) guardava escolhas
     feitas com o botão que dizia "Recolher" enquanto expandia — quem clicou
     ficou com "fixar aberta" gravado sem ter pedido isso, e o hover parava de
     funcionar para sempre. Reaproveitar a chave preservaria justamente o
     engano; com uma nova, todo mundo volta ao rail e quem realmente quer a
     barra presa aberta clica uma vez, agora lendo o que o botão faz. */
  /* ── O padrão é o RAIL ────────────────────────────────────────────────

     A barra nasce recolhida — só a coluna de ícones — e abre quando o cursor
     passa por cima: ela SOBREPÕE o conteúdo em vez de empurrá-lo, com 140ms de
     atraso para abrir e nenhum para fechar (ver a media query do rail em
     ponte.css para o porquê de cada um).

     Cheguei a inverter isto quando as descrições dos itens passaram a
     aparecer, achando que a forma completa devia ser o padrão. Não devia: o
     ganho da descrição acontece no hover, que é quando se está olhando o
     item — e nos outros noventa por cento do tempo a barra aberta é só 232px
     a menos de conteúdo.

     Quem preferir a barra presa aberta clica uma vez e a escolha fica gravada.

     ── Por que a chave mudou de novo

     Terceira chave, e o motivo é o mesmo das duas anteriores: o valor gravado
     sobrevive à mudança de padrão, e quem clicou uma vez fica preso no estado
     antigo sem ligar uma coisa à outra.

     Aqui o caso concreto: por dois commits o padrão foi a barra ABERTA. Quem
     usou o produto nesse intervalo e clicou "Recolher" ou "Fixar aberta"
     gravou uma escolha feita sobre um padrão que já não existe — e continuaria
     com a barra presa aberta depois de a correção sair, achando que ela não
     saiu. Uma chave nova devolve todo mundo ao rail; quem realmente quer a
     barra presa clica uma vez, agora sobre o padrão certo.

     A leitura tolera localStorage indisponível (janela anônima, storage
     bloqueado): ali o acesso LANÇA, e um `try` ausente derrubaria o layout
     inteiro em vez de só perder uma preferência. */
  const [recolhida, setRecolhida] = useState(() => {
    /* ABERTA por padrão. Era o contrário: o rail nascia recolhido e abria ao
       passar o cursor. A referência do redesenho tem a barra fixa em 220px, e
       essa passou a ser a escolha — a chave guarda o DESVIO do padrão, que
       agora é recolher, e por isso a comparação virou `=== '1'`.

       O hover-para-abrir continua existindo no estado recolhido: quem recolher
       de propósito ainda ganha a barra ao aproximar o cursor. */
    try { return localStorage.getItem('mf-sidebar-rail') === '1'; }
    catch { return false; }   /* aba privada: cai no padrão, que agora é aberta */
  });

  const alternarSidebar = () => setRecolhida(r => {
    const nova = !r;
    /* '1' guarda "recolhida", que é o desvio do padrão desde que a barra
       passou a nascer aberta. Gravar o estado que FOGE do padrão deixa o padrão livre para
       mudar sem arrastar ninguém — foi o que faltou nas duas chaves antes. */
    try { localStorage.setItem('mf-sidebar-rail', nova ? '1' : '0'); } catch { /* sem preferência */ }
    return nova;
  });
  const [paleta, setPaleta]       = useState(false);
  const location   = useLocation();
  const navigate   = useNavigate();

  useEffect(() => { setGaveta(false); }, [location]);

  /* SSE → notificações globais. Lógica preservada integralmente do layout
     anterior: só a apresentação foi trocada nesta migração. */
  useServerEvents(
    ['posts', 'accounts', 'loop', 'insights', 'warmup'],
    (data, event) => {
      const n = buildNotif(data, event);
      if (n) pushNotification(n);
    }
  );

  useEffect(() => {
    const aoTeclar = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaleta(p => !p);
      }
      if (e.key === 'Escape') { setPaleta(false); setGaveta(false); }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  function logout() { removeToken(); navigate('/login'); }

  return (
    /* O provider envolve a casca inteira: o sino fica na barra superior e a
       pilha de avisos flutua sobre o conteúdo, e os dois precisam ler o mesmo
       estado. Fora daqui, o aviso não teria onde aparecer. */
    <SmartActivityProvider>
    <div data-mf>
      {/* O fundo vivo. Dentro do `[data-mf]` para herdar a paleta do tema, e
          antes da casca porque ele fica em `z-index: -1` — atrás de tudo. */}
      <FundoCiber />
      <div className="mf-app" data-collapsed={recolhida} data-drawer={gaveta}>

        {gaveta && <div className="mf-scrim" onClick={() => setGaveta(false)} aria-hidden="true" />}

        <aside className="mf-side" aria-label="Navegação principal">
          <div className="mf-side__brand">
            <button onClick={() => navigate('/')}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0 }}>
              <img src="/nexora-icon.png?v=1" alt="" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
              <span className="mf-side__name">Nexora</span>
            </button>
          </div>

          <nav className="mf-side__nav">
            {NAV_GROUPS.map(grupo => (
              <div className="mf-side__group" key={grupo.title}>
                <div className="mf-side__label">{grupo.title}</div>
                {grupo.items.map(item => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/'}
                    className="mf-nav-item"
                    data-dica={item.label}
                    style={{ '--mf-mod': `var(--mf-mod-${item.mod || 'sistema'})`, textDecoration: 'none' }}>
                    <span className="mf-nav-item__ico">{item.icon}</span>
                    <span className="mf-nav-item__txt">
                      <span className="mf-nav-item__t">{item.label}</span>
                      {/* A descrição SEMPRE existiu em `NAV_GROUPS` como `sub`,
                          e o render a jogava fora — vinte e oito itens com uma
                          linha de explicação escrita e nenhuma aparecendo. O
                          CSS já falava dela ("o rótulo e a descrição são dois
                          spans"), então a intenção estava nos dois lados e só
                          o JSX faltava. */}
                      {item.sub && <span className="mf-nav-item__s">{item.sub}</span>}
                    </span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div style={{ padding: 'var(--mf-3)', borderTop: '1px solid var(--mf-border)', display: 'flex', flexDirection: 'column', gap: 'var(--mf-1)' }}>
            {/* O rótulo segue o ESTADO, não o botão.

                Antes dizia "Recolher" sempre, e a armadilha era esta: no rail,
                passar o cursor abre a barra e revela este botão ainda dizendo
                "Recolher" — clicá-lo FIXA a barra aberta e grava a preferência.
                A partir daí o cursor não abre mais nada, porque não há mais o
                que abrir, e o produto fica com a barra presa aberta sem
                caminho visível de volta. Foi o que aconteceu.

                Com o rótulo honesto, o mesmo clique continua fazendo o mesmo,
                mas a pessoa lê antes o que vai acontecer. */}
            <button className="mf-nav-item" onClick={alternarSidebar}
              data-dica={recolhida ? 'Fixar aberta' : 'Recolher'}
              title={recolhida ? 'Fixar a barra aberta' : 'Recolher — depois basta passar o cursor para abrir'}
              aria-label={recolhida ? 'Fixar a barra aberta' : 'Recolher a barra'}>
              <span className="mf-nav-item__ico"
                style={{ transform: recolhida ? 'rotate(180deg)' : 'none', transition: 'transform var(--mf-normal) var(--mf-ease-out)' }}>
                {ICONS.chevron}
              </span>
              <span className="mf-nav-item__txt">
                <span className="mf-nav-item__t">{recolhida ? 'Fixar aberta' : 'Recolher'}</span>
              </span>
            </button>
            {/* Sair no tom de perigo: é a única ação da barra que desfaz
                algo, e nas outras vinte e oito o cinza significa "navegar". */}
            <button className="mf-nav-item mf-nav-item--sair" onClick={logout}>
              <span className="mf-nav-item__ico">{ICONS.logout}</span>
              <span className="mf-nav-item__txt">
                <span className="mf-nav-item__t">Sair</span>
                <span className="mf-nav-item__s">Encerrar sessão</span>
              </span>
            </button>
          </div>
        </aside>

        <div className="mf-main">
          <header className="mf-top">
            <button className="mf-btn mf-btn--ghost mf-btn--icon mf-only-mobile"
              onClick={() => setGaveta(v => !v)} aria-label="Abrir menu">
              {ICONS.menu}
            </button>

            <button className="mf-cmd-trigger" onClick={() => setPaleta(true)}>
              {ICONS.search}
              <span className="mf-trunc" style={{ flex: 1, textAlign: 'left' }}>Buscar página…</span>
              <kbd className="mf-kbd">Ctrl K</kbd>
            </button>

            <div className="mf-top__spacer" />

            <BotaoDeTema />
            <RelogioDoTopo />

            <SinoDeNotificacoes />

            <AvatarDoUsuario />
          </header>

          {/* `mf-container` centraliza e limita a largura; as páginas ainda não
              migradas continuam com o próprio espaçamento interno, então a
              migração pode seguir uma tela por vez sem quebrar as demais. */}
          <main className="mf-container" style={{ flex: 1, minWidth: 0, paddingBottom: 'var(--mf-10)' }}>
            {children}
          </main>
        </div>
      </div>

      <PaletaComandos aberta={paleta} aoFechar={() => setPaleta(false)} />
      <PilhaDeAvisos />
    </div>
    </SmartActivityProvider>
  );
}

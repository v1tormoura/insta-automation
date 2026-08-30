import { useState, useId, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  LayoutGrid, TrendingUp, Wallet, Send, RefreshCw, Briefcase, Target,
  Clapperboard, Calendar, Zap, Image, MessageSquare, Users, Settings2,
  Search, Bell, PanelLeft, ChevronDown, Check, AlertTriangle, XCircle,
  Plus, MoreHorizontal, Inbox, ExternalLink, Shield,
} from 'lucide-react';

import '../design/v2/tokens.css';
import '../design/v2/padroes.css';

/**
 * Protótipo da direção nova — rota isolada, não toca no produto atual.
 *
 * Tudo aqui vive dentro de [data-mf2], e as duas folhas de estilo são
 * escopadas nesse atributo. Abrir esta página não muda uma linha do que está
 * no ar; fechar a aba desfaz tudo.
 *
 * A direção veio de quatro escolhas: escuro profundo (L 0.17), ciano com
 * violeta como segunda voz, brilho contido e densidade compacta. Elas se
 * reforçam — é território Linear, não dashboard administrativo.
 *
 * O que este arquivo demonstra é a CAMADA 3 do sistema: os padrões nomeados
 * que o produto não tem. Note que quase nada aqui é um cartão. Métricas são
 * blocos separados por régua; o feed é uma linha temporal; a tabela não tem
 * moldura própria. Moldura só onde existe interação ou fronteira real.
 */

/* ── Dados ────────────────────────────────────────────────────────────────
   Números e nomes reais do produto. Dado inventado esconde justamente os
   problemas de layout que a gente quer ver: nome comprido, número grande,
   coluna que estoura. */

const SERIE = [
  { d: '01/08', alcance: 182_400, anterior: 141_200 },
  { d: '05/08', alcance: 219_800, anterior: 158_900 },
  { d: '09/08', alcance: 198_300, anterior: 167_400 },
  { d: '13/08', alcance: 274_100, anterior: 172_800 },
  { d: '17/08', alcance: 311_600, anterior: 189_300 },
  { d: '21/08', alcance: 289_400, anterior: 201_700 },
  { d: '25/08', alcance: 386_200, anterior: 214_500 },
  { d: '29/08', alcance: 428_900, anterior: 236_100 },
];

const METRICAS = [
  { l: 'Contas',         v: '11',    d: '+2',     dir: 'up',   spark: [4,5,6,6,8,9,11,11] },
  { l: 'Publicações',    v: '8.429', d: '+18,2%', dir: 'up',   spark: [3,4,4,6,7,7,9,10] },
  { l: 'Alcance',        v: '2,4M',  d: '+24,8%', dir: 'up',   spark: [2,3,5,4,6,8,9,11] },
  { l: 'Visualizações',  v: '8,7M',  d: '−3,1%',  dir: 'down', spark: [9,10,8,9,7,6,6,5] },
];

const CONTAS = [
  { u: 'julianatonelotto725',  seg: '8',    posts: 3,  alc: '184K', est: 'ok',   estL: 'Ativa' },
  { u: 'veronicapoletto72',    seg: '1',    posts: 3,  alc: '92K',  est: 'ok',   estL: 'Ativa' },
  { u: 'giovannapoletto_2802', seg: '412',  posts: 12, alc: '318K', est: 'ok',   estL: 'Ativa' },
  { u: 'kethlyncarmina7597',   seg: '1.2K', posts: 18, alc: '506K', est: 'warn', estL: 'Limite' },
  { u: 'marinapiccinin_572',   seg: '834',  posts: 9,  alc: '241K', est: 'ok',   estL: 'Ativa' },
  { u: 'nataliabaseggio_336',  seg: '2.1K', posts: 21, alc: '712K', est: 'crit', estL: 'Sessão' },
  { u: 'leticiazordan46',      seg: '96',   posts: 6,  alc: '128K', est: 'ok',   estL: 'Ativa' },
];

const EVENTOS = [
  { tom: 'rare', ic: Zap,           t: '@nataliabaseggio_336 passou de 500 mil visualizações', s: 'Story · marco de 500K', h: '14:02' },
  { tom: 'ok',   ic: Check,         t: 'Campanha Agosto publicou 4 de 12',                     s: 'Próxima às 18:20',      h: '13:47' },
  { tom: 'warn', ic: AlertTriangle, t: '@kethlyncarmina7597 atingiu o limite diário',          s: 'Libera em 6 h',         h: '12:15' },
  { tom: 'ok',   ic: Send,          t: '@giovannapoletto_2802 publicou um reel',               s: '12,4 mil em 1 h',       h: '11:30' },
  { tom: 'crit', ic: XCircle,       t: 'Proxy do pool sem resposta',                           s: '3 entradas afetadas',   h: '09:58' },
];

const NAV = [
  { g: 'Visão geral', itens: [
    { id: 'dashboard', l: 'Dashboard',  ic: LayoutGrid,  mod: 'metricas' },
    { id: 'ranking',   l: 'Ranking',    ic: TrendingUp,  mod: 'metricas' },
    { id: 'fat',       l: 'Faturamento',ic: Wallet,      mod: 'metricas' },
  ]},
  { g: 'Publicação', itens: [
    { id: 'postar',    l: 'Postar',     ic: Send,        mod: 'publicar' },
    { id: 'loop',      l: 'Loop',       ic: RefreshCw,   mod: 'publicar' },
    { id: 'jobs',      l: 'Jobs',       ic: Briefcase,   mod: 'jobs' },
    { id: 'camp',      l: 'Campanhas',  ic: Target,      mod: 'campanhas' },
    { id: 'stories',   l: 'Stories',    ic: Clapperboard,mod: 'publicar' },
    { id: 'agenda',    l: 'Agendamentos',ic: Calendar,   mod: 'jobs' },
  ]},
  { g: 'Conteúdo', itens: [
    { id: 'bib',       l: 'Biblioteca', ic: Image,       mod: 'publicar' },
    { id: 'leg',       l: 'Legendas',   ic: MessageSquare, mod: 'publicar' },
  ]},
  { g: 'Sistema', itens: [
    { id: 'comp',      l: 'Componentes',ic: Users,       mod: 'contas' },
    { id: 'cfg',       l: 'Configuração',ic: Settings2,  mod: 'sistema' },
  ]},
];

/* ── Sparkline ────────────────────────────────────────────────────────────
   Desenhada à mão em SVG: recharts para oito pontos numa área de 64px seria
   peso sem retorno. O `useId` não é preciosismo — dois gradientes com o mesmo
   id fazem `url(#x)` resolver sempre no primeiro do documento, e a segunda
   métrica renderiza sem preenchimento. */

function Spark({ pontos, cor }) {
  const id = useId();
  const w = 64, h = 20;
  const max = Math.max(...pontos), min = Math.min(...pontos);
  const faixa = max - min || 1;
  const d = pontos.map((p, i) => {
    const x = (i / (pontos.length - 1)) * w;
    const y = h - ((p - min) / faixa) * (h - 3) - 1.5;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true" className="p-metric__spark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={cor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={cor} stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DicaGrafico({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}K` : String(n);
  return (
    <div className="p-tip">
      <div className="p-tip__l">{label}</div>
      {payload.map(p => (
        <div className="p-tip__r" key={p.dataKey}>
          <span className="p-tip__d" style={{ background: p.stroke }} />
          <span style={{ color: 'var(--g-ink-2)' }}>
            {p.dataKey === 'alcance' ? 'Este mês' : 'Mês anterior'}
          </span>
          <span className="p-tip__v">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Telas ───────────────────────────────────────────────────────────────── */

function Dashboard({ onAbrirModal, onToast }) {
  const gid = useId();
  const [carregando, setCarregando] = useState(false);

  const recarregar = () => {
    setCarregando(true);
    setTimeout(() => { setCarregando(false); onToast('ok', 'Métricas atualizadas', '11 contas · há instantes'); }, 1300);
  };

  return (
    <>
      {/* Faixa de estado: some quando está tudo bem. A ausência dela é o que
          fez uma falha de proxy virar "as contas foram sinalizadas". */}
      <div className="p-status" data-tom="crit">
        <span className="p-status__d" />
        <b>Proxy do pool sem resposta</b>
        <span>3 entradas afetadas · as contas estão saindo pelo proxy global</span>
        <button className="p-btn p-btn--ghost" style={{ marginLeft: 'auto' }}
                onClick={() => onToast('ok', 'Diagnóstico iniciado', 'Testando as 3 entradas')}>
          Diagnosticar
        </button>
      </div>

      <section className="p-sec">
        <div className="p-sec__h">
          <h2 className="p-sec__t">Agosto de 2026</h2>
          <span className="p-sec__s">comparado a julho</span>
          <div className="p-sec__a">
            <button className="p-btn p-btn--ghost" onClick={recarregar} disabled={carregando}>
              <RefreshCw size={14} style={carregando ? { animation: 'p-shine 1s linear infinite' } : undefined} />
              {carregando ? 'Atualizando' : 'Atualizar'}
            </button>
            <button className="p-btn p-btn--primary" onClick={onAbrirModal}>
              <Plus size={14} /> Nova campanha
            </button>
          </div>
        </div>

        <div className="p-metrics">
          {METRICAS.map(m => (
            <div className="p-metric" key={m.l}>
              <span className="p-metric__l">{m.l}</span>
              {carregando
                ? <span className="p-skel" style={{ height: 30, width: '62%' }} />
                : <span className="p-metric__v">{m.v}</span>}
              <div className="p-metric__f">
                <span className="p-metric__d" data-dir={m.dir}>{m.d}</span>
                <Spark pontos={m.spark} cor={m.dir === 'up' ? 'var(--g-ok)' : 'var(--g-crit)'} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="p-grid2">
        <section className="p-sec">
          <div className="p-sec__h">
            <h2 className="p-sec__t">Alcance</h2>
            <span className="p-sec__s">últimos 30 dias</span>
          </div>
          <div className="p-chart" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={SERIE} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#00d4ff" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="d" axisLine={false} tickLine={false} dy={6} />
                <YAxis axisLine={false} tickLine={false}
                       tickFormatter={v => `${Math.round(v / 1000)}K`} width={46} />
                <Tooltip content={<DicaGrafico />} cursor={{ stroke: 'var(--g-line-strong)' }} />
                {/* O período anterior entra como referência silenciosa:
                    tracejado, sem preenchimento, sem competir. */}
                <Area type="monotone" dataKey="anterior" stroke="var(--g-ink-3)"
                      strokeWidth={1} strokeDasharray="3 3" fill="none" dot={false} />
                <Area type="monotone" dataKey="alcance" stroke="#00d4ff" strokeWidth={2}
                      fill={`url(#${gid}-a)`} dot={false}
                      activeDot={{ r: 3, strokeWidth: 2, stroke: 'var(--g-ground)' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="p-sec">
          <div className="p-sec__h">
            <h2 className="p-sec__t">Atividade</h2>
            <button className="p-btn p-btn--quiet p-sec__a">Ver tudo</button>
          </div>
          <div className="p-feed">
            {EVENTOS.map(e => {
              const Ic = e.ic;
              return (
                <div className="p-ev" data-tom={e.tom} key={e.t}>
                  <span className="p-ev__d"><Ic /></span>
                  <div>
                    <div className="p-ev__t">{e.t}</div>
                    <div className="p-ev__s">{e.s}</div>
                  </div>
                  <span className="p-ev__h">{e.h}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="p-sec">
        <div className="p-sec__h">
          <h2 className="p-sec__t">Contas</h2>
          <span className="p-sec__s">11 conectadas</span>
          <div className="p-sec__a">
            <button className="p-btn p-btn--ghost"><ExternalLink size={14} /> Exportar</button>
          </div>
        </div>
        <div className="p-panel">
          <div className="p-tw">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Conta</th><th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Seguidores</th>
                  <th style={{ textAlign: 'right' }}>Posts</th>
                  <th style={{ textAlign: 'right' }}>Alcance</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {CONTAS.map(c => (
                  <tr key={c.u}>
                    <td>
                      <span className="p-conta">
                        <span className="p-av">{c.u.slice(0, 2).toUpperCase()}</span>
                        @{c.u}
                      </span>
                    </td>
                    <td><span className="p-chip" data-tom={c.est}>{c.estL}</span></td>
                    <td className="num">{c.seg}</td>
                    <td className="num">{c.posts}</td>
                    <td className="num">{c.alc}</td>
                    <td>
                      <button className="p-btn p-btn--quiet p-btn--icon" aria-label={`Ações de ${c.u}`}>
                        <MoreHorizontal size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function Componentes({ onAbrirModal, onToast }) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <>
      <section className="p-sec">
        <div className="p-sec__h">
          <h2 className="p-sec__t">Componentes</h2>
          <span className="p-sec__s">a camada que o produto não tem</span>
        </div>

        <div className="p-panel">
          <div className="p-panel__h"><h3 className="p-panel__t">Ações</h3></div>
          <div className="p-panel__b" style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="p-btn p-btn--primary"><Plus size={14} /> Primária</button>
            <button className="p-btn p-btn--ghost">Secundária</button>
            <button className="p-btn p-btn--quiet">Discreta</button>
            <button className="p-btn p-btn--ghost" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>Desabilitada</button>
            <div style={{ position: 'relative' }}>
              <button className="p-btn p-btn--ghost" onClick={() => setMenuAberto(v => !v)}>
                Menu <ChevronDown size={14} />
              </button>
              <AnimatePresence>
                {menuAberto && (
                  <motion.div className="p-menu"
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
                    <button className="p-menu__i" onClick={() => { setMenuAberto(false); onToast('ok', 'Duplicado', 'Campanha Agosto (cópia)'); }}>
                      <Plus size={14} /> Duplicar
                    </button>
                    <button className="p-menu__i"><ExternalLink size={14} /> Abrir no Instagram</button>
                    <div className="p-menu__sep" />
                    <button className="p-menu__i" style={{ color: 'var(--g-crit)' }}
                            onClick={() => { setMenuAberto(false); onAbrirModal(); }}>
                      <XCircle size={14} /> Excluir
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="p-panel">
          <div className="p-panel__h"><h3 className="p-panel__t">Entrada e estado</h3></div>
          <div className="p-panel__b" style={{ display: 'grid', gap: 'var(--s5)', maxWidth: 420 }}>
            <input className="p-field" placeholder="Nome da campanha" />
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <span className="p-chip" data-tom="ok">Ativa</span>
              <span className="p-chip" data-tom="warn">Limite</span>
              <span className="p-chip" data-tom="crit">Sessão</span>
              <span className="p-chip" data-tom="info">Agendada</span>
              <span className="p-chip">Rascunho</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)' }}>
              <button className="p-btn p-btn--ghost" onClick={() => onToast('ok', 'Campanha publicada', '4 contas · 12 publicações')}>
                Aviso de sucesso
              </button>
              <button className="p-btn p-btn--ghost" onClick={() => onToast('crit', 'Falha ao publicar', '@kethlyncarmina7597 · limite diário')}>
                Aviso de erro
              </button>
            </div>
          </div>
        </div>

        <div className="p-grid2">
          <div className="p-panel">
            <div className="p-panel__h"><h3 className="p-panel__t">Carregando</h3></div>
            <div className="p-panel__b" style={{ display: 'grid', gap: 'var(--s4)' }}>
              <span className="p-skel" style={{ height: 12, width: '38%' }} />
              <span className="p-skel" style={{ height: 30, width: '62%' }} />
              <span className="p-skel" style={{ height: 12, width: '86%' }} />
              <span className="p-skel" style={{ height: 12, width: '54%' }} />
            </div>
          </div>
          <div className="p-panel">
            <div className="p-panel__h"><h3 className="p-panel__t">Vazio</h3></div>
            <div className="p-empty">
              <span className="p-empty__i"><Inbox size={18} /></span>
              <h4 className="p-empty__t">Nenhuma campanha ainda</h4>
              <p className="p-empty__d">Campanhas distribuem publicações entre contas ao longo de dias, respeitando o limite de cada uma.</p>
              <button className="p-btn p-btn--primary"><Plus size={14} /> Criar a primeira</button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ── Casca ────────────────────────────────────────────────────────────────── */

export default function DesignPreview() {
  const [aberta, setAberta] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const [tela, setTela] = useState('dashboard');
  const [modal, setModal] = useState(false);
  const [avisos, setAvisos] = useState([]);

  const mostrar = (tom, titulo, texto) => {
    const id = Date.now() + Math.random();
    setAvisos(a => [...a, { id, tom, titulo, texto }]);
    setTimeout(() => setAvisos(a => a.filter(x => x.id !== id)), 4200);
  };

  const modAtivo = useMemo(
    () => NAV.flatMap(g => g.itens).find(i => i.id === tela)?.mod ?? 'sistema',
    [tela]
  );
  const nomeTela = useMemo(
    () => NAV.flatMap(g => g.itens).find(i => i.id === tela)?.l ?? '',
    [tela]
  );

  return (
    <div data-mf2>
      <div className="p-app" data-aberta={aberta} data-gaveta={gaveta}>

        <aside className="p-side">
          <div className="p-brand">
            <span className="p-brand__m">M</span>
            <span className="p-brand__n">MouraFlow</span>
          </div>

          <nav className="p-nav">
            {NAV.map(grupo => (
              <div key={grupo.g}>
                <div className="p-nav__g">{grupo.g}</div>
                {grupo.itens.map(item => {
                  const Ic = item.ic;
                  return (
                    <button key={item.id} className="p-nav__i" data-mod={item.mod}
                            data-ativo={tela === item.id} data-dica={item.l}
                            onClick={() => { setTela(item.id); setGaveta(false); }}>
                      <Ic /><span>{item.l}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="p-side__pe">
            <button className="p-nav__i" data-dica={aberta ? 'Recolher' : 'Expandir'}
                    onClick={() => setAberta(v => !v)}>
              <PanelLeft /><span>{aberta ? 'Recolher' : 'Expandir'}</span>
            </button>
          </div>
        </aside>

        <div className="p-main">
          <header className="p-top">
            <button className="p-btn p-btn--quiet p-btn--icon p-so-gaveta" aria-label="Abrir menu"
                    onClick={() => setGaveta(v => !v)}>
              <PanelLeft size={16} />
            </button>
            <div className="p-crumb" data-mod={modAtivo}>
              <span className="p-crumb__pai">MouraFlow</span>
              <span className="p-crumb__pai">/</span>
              <b>{nomeTela}</b>
            </div>

            <button className="p-cmd" onClick={() => mostrar('ok', 'Busca de comando', 'Ctrl K abriria a paleta aqui')}>
              <Search /><span>Buscar ou executar</span><kbd className="p-kbd">Ctrl K</kbd>
            </button>
            <button className="p-btn p-btn--quiet p-btn--icon" aria-label="Notificações"
                    onClick={() => mostrar('ok', '3 marcos atingidos hoje', 'Toque para ver a central')}>
              <Bell size={16} />
            </button>
            <span className="p-av" title="Conta">VM</span>
          </header>

          <main className="p-page">
            {tela === 'comp'
              ? <Componentes onAbrirModal={() => setModal(true)} onToast={mostrar} />
              : tela === 'dashboard'
                ? <Dashboard onAbrirModal={() => setModal(true)} onToast={mostrar} />
                : (
                  <div className="p-empty" style={{ paddingBlock: 'var(--s8)' }}>
                    <span className="p-empty__i"><Shield size={18} /></span>
                    <h4 className="p-empty__t">{nomeTela}</h4>
                    <p className="p-empty__d">
                      O protótipo demonstra a casca, o Dashboard e os componentes.
                      As demais telas entram na migração, depois da sua aprovação.
                    </p>
                    <button className="p-btn p-btn--ghost" onClick={() => setTela('dashboard')}>
                      Voltar ao Dashboard
                    </button>
                  </div>
                )}
          </main>
        </div>
      </div>

      <AnimatePresence>
        {gaveta && (
          <motion.div className="p-scrim" style={{ zIndex: 25 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={() => setGaveta(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal && (
          <motion.div className="p-scrim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={() => setModal(false)}>
            <motion.div className="p-modal" onClick={e => e.stopPropagation()}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
              role="dialog" aria-modal="true" aria-labelledby="ttl">
              <div className="p-modal__h">
                <h3 className="p-modal__t" id="ttl">Nova campanha</h3>
                <p className="p-modal__d">
                  As publicações são distribuídas entre as contas escolhidas ao longo dos
                  dias, respeitando o limite diário de cada uma.
                </p>
              </div>
              <div className="p-panel__b" style={{ display: 'grid', gap: 'var(--s4)' }}>
                <input className="p-field" placeholder="Nome da campanha" autoFocus />
              </div>
              <div className="p-modal__f">
                <button className="p-btn p-btn--ghost" onClick={() => setModal(false)}>Cancelar</button>
                <button className="p-btn p-btn--primary"
                        onClick={() => { setModal(false); mostrar('ok', 'Campanha criada', '4 contas · 12 publicações'); }}>
                  Criar campanha
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-toasts">
        <AnimatePresence>
          {avisos.map(a => (
            <motion.div key={a.id} className="p-toast" data-tom={a.tom}
              initial={{ opacity: 0, x: 20, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
              {a.tom === 'crit' ? <XCircle /> : <Check />}
              <div><b>{a.titulo}</b><span>{a.texto}</span></div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

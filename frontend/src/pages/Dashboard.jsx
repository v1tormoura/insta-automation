import '../dashboard.css';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Activity, AlertTriangle, Bell, Bot, ChevronDown, ChevronRight,
  Clock3, FileText, FolderOpen, HeartPulse, Layers3, ListVideo,
  MoreHorizontal, Pause, Play, Plus, Radar, RefreshCw, Send,
  Settings, ShieldCheck, Sparkles, UserRound, WandSparkles, X,
} from 'lucide-react';
import {
  Area, AreaChart, Cell, Line, LineChart as RechartLineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

/* ── helpers ── */
const fmt  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtK = v => { const n = Number(v||0); return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); };

const tooltipStyle = {
  background: 'rgba(4,18,39,.96)',
  border: '1px solid rgba(55,190,255,.42)',
  borderRadius: 10,
  color: '#d9f4ff',
  boxShadow: '0 10px 35px rgba(0,0,0,.35)',
};

/* ── Quick actions ── */
const quickActions = [
  { title: 'POSTAR AGORA',  subtitle: 'Nova publicação manual',           icon: Send },
  { title: 'LOOP',          subtitle: 'Ciclo contínuo de filas',          icon: RefreshCw },
  { title: 'STORIES',       subtitle: 'Publicar para todos os stories',   icon: Plus },
  { title: 'SAÚDE',         subtitle: 'Diagnóstico das contas',           icon: HeartPulse },
];

/* ── Components ── */

function MetricCard({ title, value, meta, kind, tone, spark = [] }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="card-grid" aria-hidden="true" />
      <div className="metric-head">
        <span>{title}</span>
        <button aria-label={`Mais opções de ${title}`}><MoreHorizontal size={18} /></button>
      </div>
      <div className="metric-value">{value}</div>
      <div className={`metric-meta ${tone}`}>{meta}</div>
      <div className="metric-line">
        <ResponsiveContainer width="100%" height="100%">
          <RechartLineChart data={spark.map((y, i) => ({ i, y }))}>
            <Line type="monotone" dataKey="y" stroke={tone === 'amber' ? '#ffae35' : '#24caff'} strokeWidth={2} dot={false} />
          </RechartLineChart>
        </ResponsiveContainer>
      </div>
      <Visual kind={kind} />
    </article>
  );
}

function WideMetric({ title, value, subtitle, kind, action, chip, tone = 'cyan', spark = [] }) {
  return (
    <article className={`wide-metric tone-${tone}`}>
      <div className="card-grid" aria-hidden="true" />
      <div className="wide-top">
        <div>
          <span className="metric-label">{title}</span>
          <div className="wide-value">{value}</div>
          <small>{subtitle}</small>
        </div>
        <div className="wide-actions">
          <button>{action}</button>
          <button aria-label="Mais opções"><MoreHorizontal size={16} /></button>
          <span className={`delta-chip ${chip?.startsWith('-') ? 'negative' : ''}`}>{chip}</span>
        </div>
      </div>
      <div className="wide-line">
        <ResponsiveContainer width="100%" height="100%">
          <RechartLineChart data={spark.map((y,i) => ({ i, y }))}>
            <Line type="monotone" dataKey="y" stroke={tone === 'muted' ? '#92b6d9' : '#22c8ff'} strokeWidth={2} dot={false} />
          </RechartLineChart>
        </ResponsiveContainer>
      </div>
      <Visual kind={kind} compact />
    </article>
  );
}

function Visual({ kind, compact = false }) {
  return (
    <div className={`visual visual-${kind} ${compact ? 'compact' : ''}`} aria-hidden="true">
      {kind === 'orb' && <div className="orb">
        <span className="orb-core" />
        <span className="orb-ring ring-one" />
        <span className="orb-ring ring-two" />
        <span className="orb-latitude lat-a" />
        <span className="orb-latitude lat-b" />
      </div>}
      {kind === 'crystal' && <div className="crystal">
        <span className="facet facet-a" />
        <span className="facet facet-b" />
        <span className="facet facet-c" />
        <span className="crystal-core" />
      </div>}
      {kind === 'ice' && <div className="ice">
        <span className="ice-shard shard-a" />
        <span className="ice-shard shard-b" />
        <span className="ice-shard shard-c" />
        <span className="ice-shard shard-d" />
      </div>}
      {kind === 'hourglass' && <Hourglass />}
    </div>
  );
}

function Hourglass() {
  return (
    <div className="hourglass">
      <span className="hg-top" />
      <span className="hg-middle" />
      <span className="hg-bottom" />
      <span className="hg-sand" />
    </div>
  );
}

function PanelHeader({ title, icon: Icon, right }) {
  return (
    <div className="panel-header">
      <div className="panel-title">
        {Icon && <Icon size={17} />}
        <h2>{title}</h2>
      </div>
      {right}
    </div>
  );
}

function SelectLabel({ label }) {
  return (
    <button className="select-label">{label}<ChevronDown size={14} /></button>
  );
}

function ViewAll({ onClick }) {
  return <button className="view-all" onClick={onClick}>Ver todos <ChevronRight size={14} /></button>;
}

function Toggle({ checked, onChange }) {
  return (
    <button className={`toggle ${checked ? 'on' : ''}`} onClick={onChange} aria-pressed={checked}>
      <span />
    </button>
  );
}

/* ── Clock ── */
function LiveClock() {
  const [t, setT] = useState(() => new Date().toLocaleTimeString('pt-BR'));
  useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString('pt-BR')), 1000);
    return () => clearInterval(id);
  }, []);
  return <strong>{t}</strong>;
}

/* ── Dashboard ── */
export default function Dashboard() {
  const [data, setData]         = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast]       = useState('');
  const [automationOn, setAutomationOn] = useState(true);
  const [period, setPeriod]     = useState(7);

  const loadRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(window.__ifToast);
    window.__ifToast = setTimeout(() => setToast(''), 2600);
  };

  const load = useCallback(async () => {
    try {
      const res = await api.get('/dashboard');
      setData(res.data);
    } catch {}
  }, []);

  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Auto-refresh 15s
  useEffect(() => {
    const id = setInterval(() => loadRef.current?.(), 15_000);
    return () => clearInterval(id);
  }, []);

  // SSE push
  useServerEvents(['posts', 'accounts', 'sessions', 'health'], () => loadRef.current?.());

  const handleRefresh = () => {
    setRefreshing(true);
    load().finally(() => {
      setTimeout(() => setRefreshing(false), 600);
      showToast('Dados sincronizados com sucesso.');
    });
  };

  /* ── derived ── */
  const d = data || {};

  const sparkDaily = useMemo(() => {
    const arr = d.dailyPosts || [];
    return arr.slice(-period).map(x => x.count || 0);
  }, [d.dailyPosts, period]);

  const forecastData = useMemo(() => {
    const arr = d.dailyPosts || [];
    return arr.slice(-8).map(x => ({ day: x.date || '', value: x.count || 0 }));
  }, [d.dailyPosts]);

  const donutData = useMemo(() => [
    { name: 'Online',    value: d.activeAccounts  || 0, color: '#15c6ff' },
    { name: 'Inativas',  value: (d.totalAccounts  || 0) - (d.activeAccounts || 0) - (d.bannedAccounts || 0), color: '#869bb9' },
    { name: 'Com erro',  value: d.restrictedAccounts || 0, color: '#ff9353' },
    { name: 'Banidas',   value: d.bannedAccounts   || 0, color: '#e14872' },
  ], [d]);

  const proxyData = useMemo(() => [
    { name: 'Funcionando', value: d.proxiesOnline  || 0 },
    { name: 'Com erro',    value: d.proxiesOffline || 0 },
  ], [d]);

  const queueItems = [
    { label: 'Postados hoje',      value: d.postsToday     || 0, color: '#20b7ff' },
    { label: 'Erros hoje',         value: d.errorsToday    || 0, color: '#ff5f5f' },
    { label: 'Na fila',            value: d.pendingPosts   || 0, color: '#ffb034' },
    { label: 'Processando',        value: d.processingPosts|| 0, color: '#43cf76' },
    { label: 'Agendados',          value: d.scheduledPosts || 0, color: '#a86cff' },
    { label: 'Taxa de sucesso',    value: `${d.successRate || 0}%`, color: '#22d7ff' },
  ];

  const logs = useMemo(() => {
    const acts = d.activities || [];
    return acts.slice(0, 5).map(a => ({
      time:   new Date(a.createdAt || Date.now()).toLocaleTimeString('pt-BR'),
      type:   a.status === 'concluido' ? 'success' : a.status === 'erro' ? 'warning' : 'info',
      text:   a.action || a.type || 'Atividade',
      detail: a.account ? `@${a.account}` : '',
    }));
  }, [d.activities]);

  const topAccounts = useMemo(() => (d.topAccounts || []).slice(0, 4), [d.topAccounts]);

  const activities = useMemo(() => {
    const acts = d.activities || [];
    return acts.slice(0, 5).map(a => ({
      icon: a.status === 'erro' ? AlertTriangle : a.type === 'story' ? Clock3 : Send,
      text: a.action || 'Atividade',
      time: new Date(a.createdAt || Date.now()).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
      tone: a.status === 'concluido' ? 'cyan' : a.status === 'erro' ? 'danger' : 'amber',
    }));
  }, [d.activities]);

  const sysOk = d.system?.backend && d.system?.mongo;

  return (
    <div style={{ display: 'contents' }}>
      <div className="ambient-glow glow-one" aria-hidden="true" />
      <div className="ambient-glow glow-two" aria-hidden="true" />

      <main className="dashboard">
        {/* ── Topbar ── */}
        <header className="topbar">
          <div className="header-left">
            <div>
              <div className="eyebrow">DASHBOARD</div>
              <div className="title-line">
                <h1>Visão geral</h1>
                <span className="live-status">
                  <span style={{ background: sysOk ? '#2bdc94' : '#ff5f5f', boxShadow: `0 0 10px ${sysOk ? '#2bdc94' : '#ff5f5f'}` }} />
                  {sysOk ? 'Todos os sistemas operacionais' : 'Verificar sistemas'}
                </span>
              </div>
              <p>Acompanhe contas, filas e atividade do seu bot em tempo real.</p>
            </div>
          </div>

          <div className="toolbar">
            <div className="clock-chip">
              <Clock3 size={16} />
              <LiveClock />
            </div>

            <button className="toolbar-button" onClick={() => setPeriod(p => p === 7 ? 14 : p === 14 ? 30 : 7)}>
              <span>Atualizar: {period}d</span>
              <ChevronDown size={15} />
            </button>

            <button className="icon-button" onClick={() => showToast('Nenhuma nova notificação.')} aria-label="Notificações">
              <Bell size={17} />
              {(d.errorsToday || 0) > 0 && <span className="notification-pip">{d.errorsToday}</span>}
            </button>

            <button className={`refresh-button ${refreshing ? 'is-refreshing' : ''}`} onClick={handleRefresh}>
              <RefreshCw size={17} />
              Atualizar
            </button>
          </div>
        </header>

        {/* ── KPI Cards ── */}
        <section className="metric-grid" aria-label="Métricas principais">
          <MetricCard
            title="CONTAS ATIVAS"
            value={fmt(d.activeAccounts)}
            meta={`${d.totalAccounts || 0} total`}
            kind="orb" tone="cyan"
            spark={sparkDaily}
          />
          <MetricCard
            title="POSTAGENS HOJE"
            value={fmt(d.postsToday)}
            meta={`Meta: ${d.dailyPostLimit || '—'}`}
            kind="crystal" tone="amber"
            spark={sparkDaily}
          />
          <MetricCard
            title="ERROS HOJE"
            value={fmt(d.errorsToday)}
            meta={d.errorsToday > 0 ? `${d.errorsToday} erro(s)` : 'Nenhum erro'}
            kind="ice" tone="cyan"
            spark={sparkDaily}
          />
          <MetricCard
            title="FILA"
            value={fmt((d.pendingPosts || 0) + (d.processingPosts || 0))}
            meta={`${d.processingPosts || 0} processando`}
            kind="hourglass" tone="amber"
            spark={sparkDaily}
          />
        </section>

        {/* ── Wide metrics ── */}
        <section className="wide-metric-row">
          <WideMetric
            title="CONTAS ADICIONADAS"
            value={fmt(d.totalAccounts)}
            subtitle="contas conectadas"
            kind="orb" action="Total"
            chip={`+${d.totalAccounts || 0}`}
            spark={sparkDaily}
          />
          <WideMetric
            title="CONTAS COM PROBLEMA"
            value={fmt((d.bannedAccounts || 0) + (d.expiredSessions || 0))}
            subtitle="banidas ou sessão expirada"
            kind="ice" action="Hoje"
            chip={`-${(d.bannedAccounts || 0) + (d.expiredSessions || 0)}`}
            tone="muted"
            spark={sparkDaily}
          />
        </section>

        {/* ── Quick actions ── */}
        <section className="quick-grid" aria-label="Ações rápidas">
          {quickActions.map(({ title, subtitle, icon: Icon }) => (
            <button key={title} className="quick-action" onClick={() => showToast(`${title}: painel de ação aberto.`)}>
              <span className="quick-icon"><Icon size={24} /></span>
              <span className="quick-copy">
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </span>
              <ChevronRight className="quick-chevron" size={20} />
            </button>
          ))}
        </section>

        {/* ── Operations grid ── */}
        <section className="operations-grid">
          {/* Previsão / gráfico de postagens */}
          <div className="panel forecast-panel">
            <PanelHeader title="PREVISÃO DE POSTAGENS" icon={FolderOpen} right={
              <div style={{ display:'flex', gap:6 }}>
                {[7,14,30].map(p => (
                  <button key={p} className="select-label" style={{ background: period===p ? 'rgba(36,201,255,.18)' : '' }} onClick={() => setPeriod(p)}>
                    {p}d
                  </button>
                ))}
              </div>
            } />
            <div className="forecast-content">
              {forecastData.length === 0 ? (
                <>
                  <div className="forecast-graphic">
                    <div className="folder-holo"><FolderOpen size={58} strokeWidth={1.15} /></div>
                    <div className="holo-floor" />
                  </div>
                  <div className="empty-copy">
                    <h2>Nenhuma postagem no período.</h2>
                    <p>Adicione publicações às filas para visualizar a previsão de execução.</p>
                  </div>
                </>
              ) : null}
              <div className="forecast-chart" style={{ opacity: forecastData.length ? 1 : 0.33 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastData} margin={{ top: 18, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#26c7ff" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#26c7ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#d8efff' }} />
                    <Area type="monotone" dataKey="value" stroke="#27c6ff" strokeWidth={2} fill="url(#forecastGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Resumo da fila */}
          <div className="panel queue-panel">
            <PanelHeader title="RESUMO DA FILA" icon={Layers3} right={<SelectLabel label="Todos" />} />
            <div className="queue-body">
              <div className="queue-hourglass-wrap">
                <div className="queue-orbit orbit-1" />
                <div className="queue-orbit orbit-2" />
                <Hourglass />
              </div>
              <ul className="queue-list">
                {queueItems.map(item => (
                  <li key={item.label}>
                    <span className="queue-dot" style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Bottom grid ── */}
        <section className="bottom-grid">
          {/* Logs */}
          <div className="panel compact-panel logs-panel">
            <PanelHeader title="LOGS RECENTES" right={<ViewAll onClick={() => showToast('Abrindo todos os logs.')} />} />
            <ul className="logs-list">
              {logs.length === 0 ? (
                <li style={{ color:'#566e89', fontSize:11, padding:'12px 0' }}>Nenhum log ainda.</li>
              ) : logs.map((log, i) => (
                <li key={i}>
                  <time>{log.time}</time>
                  <span className={`log-status ${log.type}`}>
                    {log.type === 'success' && <ShieldCheck size={15} />}
                    {log.type === 'info'    && <Activity size={15} />}
                    {log.type === 'warning' && <AlertTriangle size={15} />}
                  </span>
                  <strong>{log.text}</strong>
                  <small>{log.detail}</small>
                </li>
              ))}
            </ul>
          </div>

          {/* Contas em destaque */}
          <div className="panel compact-panel accounts-panel">
            <PanelHeader title="CONTAS EM DESTAQUE" right={<ViewAll onClick={() => showToast('Abrindo ranking completo.')} />} />
            <ul className="accounts-list">
              {topAccounts.length === 0 ? (
                <li style={{ color:'#566e89', fontSize:11 }}>Nenhuma conta conectada.</li>
              ) : topAccounts.map((acc, index) => {
                const score = acc.healthScore || (acc.healthStatus === 'ativa' ? 95 : acc.healthStatus === 'restrita' ? 45 : 10);
                const isErr = acc.healthStatus !== 'ativa';
                return (
                  <li key={acc.username || index}>
                    <span className={`avatar avatar-${(index % 4) + 1}`}>{(acc.username || '??').slice(-2)}</span>
                    <div className="account-name">
                      <strong>@{acc.username}</strong>
                      <small className={isErr ? 'error' : ''}>{isErr ? acc.healthStatus : 'Online'}</small>
                    </div>
                    <div className="posts-count">
                      <strong>{fmtK(acc.postsToday || 0)}</strong>
                      <small>Posts hoje</small>
                    </div>
                    <span className={`score-ring ${isErr ? 'low' : ''}`} style={{ '--score': `${score}%` }}>
                      {score}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Atividades recentes */}
          <div className="panel compact-panel activity-panel">
            <PanelHeader title="ATIVIDADES RECENTES" right={<ViewAll onClick={() => showToast('Abrindo todas as atividades.')} />} />
            <ul className="activity-list">
              {activities.length === 0 ? (
                <li style={{ color:'#566e89', fontSize:11 }}>Nenhuma atividade ainda.</li>
              ) : activities.map((act, i) => {
                const Icon = act.icon;
                return (
                  <li key={i}>
                    <span className={`activity-icon ${act.tone}`}><Icon size={15} /></span>
                    <strong>{act.text}</strong>
                    <time>{act.time}</time>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Proxies */}
          <div className="panel compact-panel proxies-panel">
            <PanelHeader title="PROXIES" right={<ViewAll onClick={() => showToast('Abrindo gerenciamento de proxies.')} />} />
            <div className="proxy-content">
              <div className="donut-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={proxyData.some(p => p.value > 0) ? proxyData : [{ name: 'Sem proxies', value: 1 }]}
                      dataKey="value"
                      innerRadius={45} outerRadius={63}
                      startAngle={90} endAngle={-270}
                      stroke="none" paddingAngle={3}
                    >
                      <Cell fill="#20d785" />
                      <Cell fill="#ff5c5c" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <strong>{(d.proxiesOnline || 0) + (d.proxiesOffline || 0)}</strong>
                  <span>Total</span>
                </div>
              </div>
              <div className="proxy-details">
                <p><span className="queue-dot green" />{d.proxiesOnline || 0} <small>Funcionando</small></p>
                <p><span className="queue-dot red" />{d.proxiesOffline || 0} <small>Com erro</small></p>
              </div>
            </div>
            <div className="toggle-row">
              <span><Radar size={14} /> Rotação automática</span>
              <Toggle checked={automationOn} onChange={() => setAutomationOn(v => !v)} />
            </div>
          </div>

          {/* Automações */}
          <div className="panel compact-panel automations-panel">
            <PanelHeader title="AUTOMAÇÕES" right={<ViewAll onClick={() => showToast('Abrindo todas as automações.')} />} />
            <div className="automation-gauge">
              <div className="half-gauge">
                <span className="gauge-arc" />
                <strong>{d.activeAccounts || 0}</strong>
                <small>Ativas</small>
              </div>
              <div className="automation-meta"><Pause size={13} /> <b>{d.bannedAccounts || 0}</b> Com problema</div>
            </div>
            <div className="toggle-row">
              <span><Bot size={14} /> Execução contínua</span>
              <Toggle checked={automationOn} onChange={() => setAutomationOn(v => !v)} />
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="system-footer">
          <span><ShieldCheck size={14} /> {sysOk ? 'Sistema operacional' : 'Verificar sistemas'}</span>
          <span><i style={{ background: sysOk ? '#2add90' : '#ff5f5f', boxShadow: `0 0 8px ${sysOk ? '#2add90' : '#ff5f5f'}` }} /> {sysOk ? 'Online' : 'Offline'}</span>
          <span>MongoDB <b style={{ color: d.system?.mongo ? '#2add90' : '#ff5f5f' }}>{d.system?.mongo ? 'OK' : 'Erro'}</b></span>
          <span>Redis <b style={{ color: d.system?.redis ? '#2add90' : '#ff5f5f' }}>{d.system?.redis ? 'OK' : 'Erro'}</b></span>
          <span>Worker <b style={{ color: d.system?.worker ? '#2add90' : '#ff5f5f' }}>{d.system?.worker ? 'Ativo' : 'Parado'}</b></span>
          <span>Contas <b>{fmt(d.totalAccounts)}</b></span>
          <span>Posts <b>{fmt(d.totalPosts)}</b></span>
          <button onClick={() => showToast('Versão 2.4.7 — InstaFlow Pulse')}>Novidades</button>
        </footer>
      </main>

      {toast && (
        <div className="toast">
          <ShieldCheck size={18} /> {toast}
        </div>
      )}
    </div>
  );
}

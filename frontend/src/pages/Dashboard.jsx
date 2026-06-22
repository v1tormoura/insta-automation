import { useEffect, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

// Sparkline SVG puro — sem ResponsiveContainer
function SparkLine({ values = [] }) {
  const max = Math.max(...values, 1);
  const w = 260; const h = 70; const pad = 8;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  const fill = `${d} L${pts[pts.length-1][0]},${h-pad} L${pts[0][0]},${h-pad} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', marginTop: 4 }}>
      <path d={fill} fill="rgba(99,102,241,.15)" />
      <path d={d} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill="#6366f1" />)}
    </svg>
  );
}

// Donut simples sem ResponsiveContainer (evita bug de width=0 em flex)
function Donut({ data, colors }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  if (!total) return (
    <svg width={120} height={120}>
      <circle cx={60} cy={60} r={46} fill="none" stroke="rgba(148,163,184,.1)" strokeWidth={14} />
    </svg>
  );
  const r = 46; const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={120} height={120} style={{ flexShrink: 0 }}>
      <circle cx={60} cy={60} r={r} fill="none" stroke="rgba(148,163,184,.06)" strokeWidth={14} />
      {data.map((d, i) => {
        const pct   = d.value / total;
        const dash  = circ * pct;
        const gap   = circ - dash;
        const rot   = offset * 360 - 90;
        offset += pct;
        if (!d.value) return null;
        return (
          <circle key={i} cx={60} cy={60} r={r} fill="none"
            stroke={colors[i % colors.length]} strokeWidth={14}
            strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(${rot} 60 60)`}
            style={{ transition: 'stroke-dasharray .4s' }} />
        );
      })}
    </svg>
  );
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];

export default function Dashboard() {
  const [data, setData] = useState(null);

  async function load() {
    const res = await api.get('/dashboard');
    setData(res.data);
  }

  useServerEvents(['posts', 'accounts'], load);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  function fmt(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function fmtDate(d) { if (!d) return 'Agora'; return new Date(d).toLocaleString('pt-BR'); }
  function accountsText(post) {
    if (!post.accounts?.length) return 'Sem conta';
    return post.accounts.map(a => `@${a.username}`).join(', ');
  }

  if (!data) {
    return <div className="loading-box">Carregando painel...</div>;
  }

  const postsChartData = [
    { name: 'Hoje', posts: data.postsToday || 0 },
    { name: '7 dias', posts: data.posts7Days || 0 },
    { name: '30 dias', posts: data.posts30Days || 0 },
  ];

  const postStatusData = [
    { name: 'Concluidos', value: data.completedPosts || 0 },
    { name: 'Agendados',  value: data.scheduledPosts || 0 },
    { name: 'Pendentes',  value: data.pendingPosts   || 0 },
    { name: 'Erros',      value: data.errorPosts     || 0 },
  ];

  const accountStatusData = [
    { name: 'Ativas', value: data.activeAccounts || 0 },
    { name: 'Restritas', value: data.restrictedAccounts || 0 },
    { name: 'Erro login', value: data.loginErrorAccounts || 0 },
    { name: 'Banidas', value: data.bannedAccounts || 0 },
  ];

  const successRate = data.successRate ?? 100;
  const score = data.operationalScore ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Painel operacional</div>
          <h1>Visão geral</h1>
          <p>Acompanhe contas, fila, publicações e estabilidade em tempo real.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot"></span>Sistema Online</span>
          <span className="badge badge-purple"><span className="dot"></span>Worker Ativo</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="s-icon">👥</div>
          <div className="s-label">Contas Ativas</div>
          <div className="s-value">{fmt(data.activeAccounts)}</div>
          <div className="s-sub">{fmt(data.totalAccounts)} conectadas</div>
        </div>
        <div className="stat-card purple">
          <div className="s-icon">🔄</div>
          <div className="s-label">Contas em Uso</div>
          <div className="s-value">{fmt(data.busyAccounts)}</div>
          <div className="s-sub">Publicando agora</div>
        </div>
        <div className="stat-card green">
          <div className="s-icon">📤</div>
          <div className="s-label">Posts Hoje</div>
          <div className="s-value">{fmt(data.postsToday)}</div>
          <div className="s-sub">{fmt(data.completedToday)} ok · {fmt(data.errorsToday)} erros</div>
        </div>
        <div className="stat-card amber">
          <div className="s-icon">⏳</div>
          <div className="s-label">Agendados</div>
          <div className="s-value">{fmt(data.scheduledPosts)}</div>
          <div className="s-sub">{fmt(data.pendingPosts)} pend. · {fmt(data.processingPosts)} proc.</div>
        </div>
        <div className="stat-card red">
          <div className="s-icon">⚡</div>
          <div className="s-label">Falhas</div>
          <div className="s-value">{fmt(data.errorPosts)}</div>
          <div className="s-sub">Taxa: {fmt(data.errorRate)}%</div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid" style={{ marginBottom: 14 }}>
        {/* Volume — barras largas, número em cima, label embaixo */}
        <div className="card">
          <div className="card-header">
            <h3>Volume de Postagens</h3>
            <span>Hoje · 7d · 30d</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            {[
              { label: 'Hoje',    value: data.postsToday,  color: '#6366f1' },
              { label: '7 dias',  value: data.posts7Days,  color: '#8b5cf6' },
              { label: '30 dias', value: data.posts30Days, color: '#06b6d4' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', letterSpacing: -1, marginBottom: 8 }}>
                  {Number(s.value || 0) >= 1000
                    ? (s.value / 1000).toFixed(1).replace('.0','') + 'k'
                    : (s.value || 0)}
                </div>
                <div style={{ height: 4, background: s.color, borderRadius: 2, marginBottom: 6 }} />
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Status dos posts — donut próprio */}
        <div className="card">
          <div className="card-header">
            <h3>Status dos Posts</h3>
            <span>Operação geral</span>
          </div>
          <div className="chart-donut-wrap">
            <Donut data={postStatusData} colors={COLORS} />
            <div className="chart-legend">
              {postStatusData.map((item, i) => (
                <div className="chart-legend-item" key={item.name}>
                  <span className="cl-dot" style={{ background: COLORS[i] }}></span>
                  <span className="cl-name">{item.name}</span>
                  <span className="cl-val">{fmt(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Saúde das contas — donut próprio */}
        <div className="card">
          <div className="card-header">
            <h3>Saúde das Contas</h3>
            <span>Status dos perfis</span>
          </div>
          <div className="chart-donut-wrap">
            <Donut data={accountStatusData} colors={COLORS} />
            <div className="chart-legend">
              {accountStatusData.map((item, i) => (
                <div className="chart-legend-item" key={item.name}>
                  <span className="cl-dot" style={{ background: COLORS[i] }}></span>
                  <span className="cl-name">{item.name}</span>
                  <span className="cl-val">{fmt(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Operational row */}
      <div className="grid-3" style={{ marginBottom: 14 }}>
        {/* Score */}
        <div className="card">
          <div className="card-header">
            <h3>Score Operacional</h3>
            <span>Contas + Sessões + Proxy</span>
          </div>
          <div className="ring-wrap">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(148,163,184,.08)" strokeWidth="10"/>
              <circle cx="55" cy="55" r="46" fill="none"
                stroke={score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'}
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 46 * score / 100} ${2 * Math.PI * 46}`}
                transform="rotate(-90 55 55)"
              />
              <text x="55" y="51" textAnchor="middle" fill="#f1f5f9" fontSize="20" fontWeight="800" fontFamily="var(--font)">{score}%</text>
              <text x="55" y="66" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="var(--font)">operação</text>
            </svg>
            <div className="ring-stats">
              <div className="ring-stat">
                <strong style={{ color: '#10b981' }}>{fmt(data.healthyAccounts)}</strong>
                <span>Saudáveis</span>
              </div>
              <div className="ring-stat">
                <strong style={{ color: '#f59e0b' }}>{fmt(data.attentionAccounts)}</strong>
                <span>Atenção</span>
              </div>
              <div className="ring-stat">
                <strong style={{ color: '#ef4444' }}>{fmt(data.riskAccounts)}</strong>
                <span>Risco</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sessões */}
        <div className="card">
          <div className="card-header">
            <h3>Sessões</h3>
            <span>Cookies salvos</span>
          </div>
          <div className="op-list">
            <div className="op-row">
              <span>✅ Sessões OK</span>
              <strong>{fmt(data.sessionsOk)}</strong>
            </div>
            <div className="op-row">
              <span>⚠️ Sem sessão</span>
              <strong>{fmt(data.sessionsMissing)}</strong>
            </div>
            <div className="op-row">
              <span>🟠 Expiradas</span>
              <strong>{fmt(data.expiredSessions)}</strong>
            </div>
          </div>
        </div>

        {/* Proxies */}
        <div className="card">
          <div className="card-header">
            <h3>Proxies</h3>
            <span>Status por conta</span>
          </div>
          <div className="op-list">
            <div className="op-row">
              <span>🌐 Configurados</span>
              <strong>{fmt(data.proxiesConfigured)}</strong>
            </div>
            <div className="op-row">
              <span>🟢 Online</span>
              <strong>{fmt(data.proxiesOnline)}</strong>
            </div>
            <div className="op-row">
              <span>🔴 Offline</span>
              <strong>{fmt(data.proxiesOffline)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Mini stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Restritas', value: data.restrictedAccounts, color: '#f59e0b' },
          { label: 'Sess. expiradas', value: data.expiredSessions, color: '#f59e0b' },
          { label: 'Erro login', value: data.loginErrorAccounts, color: '#ef4444' },
          { label: 'Banidas', value: data.bannedAccounts, color: '#ef4444' },
          { label: 'Posts 7 dias', value: data.posts7Days, color: '#6366f1' },
          { label: 'Posts 30 dias', value: data.posts30Days, color: '#6366f1' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '12px 10px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{fmt(s.value)}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Queue + In use */}
      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Próximos posts</h3>
            <span>Fila agendada</span>
          </div>
          <div className="queue-list">
            {data.upcomingPosts?.length ? data.upcomingPosts.map(post => (
              <div className="queue-row" key={post._id}>
                <div className="queue-icon" style={{ background: post.postType === 'reel' ? 'var(--indigo-dim)' : 'var(--cyan-dim)' }}>
                  {post.postType === 'reel' ? '🎬' : '📸'}
                </div>
                <div className="queue-info">
                  <strong>{post.postType === 'reel' ? 'Reel' : 'Post'}</strong>
                  <span>{accountsText(post)}</span>
                </div>
                <span className="queue-time">{fmtDate(post.scheduledAt)}</span>
              </div>
            )) : <div className="empty-state">Nenhum post agendado</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Contas em uso</h3>
            <span>Tempo real</span>
          </div>
          <div className="queue-list">
            {data.accountsInUse?.length ? data.accountsInUse.map(acc => (
              <div className="queue-row" key={acc._id}>
                <div className="queue-icon" style={{ background: 'var(--purple-dim)' }}>🔒</div>
                <div className="queue-info">
                  <strong>@{acc.username}</strong>
                  <span>{acc.busyReason || 'Processando'}</span>
                </div>
                <span className="queue-time">{fmtDate(acc.busySince)}</span>
              </div>
            )) : <div className="empty-state">Nenhuma conta em uso</div>}
          </div>
        </div>
      </div>

      {/* Success rate + general stats */}
      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Taxa de sucesso</h3>
            <span>Operação</span>
          </div>
          <div className="ring-wrap">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(148,163,184,.08)" strokeWidth="10"/>
              <circle cx="55" cy="55" r="46" fill="none"
                stroke={successRate >= 80 ? '#10b981' : successRate >= 50 ? '#f59e0b' : '#ef4444'}
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 46 * successRate / 100} ${2 * Math.PI * 46}`}
                transform="rotate(-90 55 55)"
              />
              <text x="55" y="51" textAnchor="middle" fill="#f1f5f9" fontSize="20" fontWeight="800" fontFamily="var(--font)">{successRate}%</text>
              <text x="55" y="66" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="var(--font)">sucesso</text>
            </svg>
            <div className="ring-stats">
              <div className="ring-stat">
                <strong style={{ color: '#10b981' }}>{fmt(data.completedPosts)}</strong>
                <span>Concluídos</span>
              </div>
              <div className="ring-stat">
                <strong style={{ color: '#f59e0b' }}>{fmt(data.partialPosts)}</strong>
                <span>Parciais</span>
              </div>
              <div className="ring-stat">
                <strong style={{ color: '#ef4444' }}>{fmt(data.errorPosts)}</strong>
                <span>Falhas</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Estatísticas Gerais</h3>
            <span>Resumo operacional</span>
          </div>
          <div className="op-list">
            <div className="op-row">
              <span>👥 Seguidores totais</span>
              <strong>{fmt(data.totalFollowers)}</strong>
            </div>
            <div className="op-row">
              <span>📅 Posts 7 dias</span>
              <strong>{fmt(data.posts7Days)}</strong>
            </div>
            <div className="op-row">
              <span>🗓️ Posts 30 dias</span>
              <strong>{fmt(data.posts30Days)}</strong>
            </div>
            <div className="op-row">
              <span>📊 Total de posts</span>
              <strong>{fmt(data.totalPosts)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Top + Worst accounts */}
      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Top contas</h3>
            <span>Por seguidores</span>
          </div>
          <div className="queue-list">
            {data.topAccounts?.length ? data.topAccounts.map(acc => (
              <div className="queue-row" key={acc._id}>
                <div className="queue-icon" style={{ background: 'var(--indigo-dim)' }}>📈</div>
                <div className="queue-info">
                  <strong>@{acc.username}</strong>
                  <span>{fmt(acc.followers)} seguidores</span>
                </div>
                <span className={`badge badge-${acc.healthStatus === 'saudavel' ? 'green' : acc.healthStatus === 'atencao' ? 'amber' : 'red'}`}>{acc.healthStatus}</span>
              </div>
            )) : <div className="empty-state">Nenhuma conta encontrada</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Contas em risco</h3>
            <span>Menor score</span>
          </div>
          <div className="queue-list">
            {data.worstAccounts?.length ? data.worstAccounts.map(acc => (
              <div className="queue-row" key={acc._id}>
                <div className="queue-icon" style={{ background: 'var(--red-dim)' }}>⚠️</div>
                <div className="queue-info">
                  <strong>@{acc.username}</strong>
                  <span>{acc.lastError || acc.healthStatus || 'Sem erro'}</span>
                </div>
                <span className="badge badge-red">{acc.score}%</span>
              </div>
            )) : <div className="empty-state">Nenhuma conta em risco</div>}
          </div>
        </div>
      </div>

      {/* Growth + Most active + Last error */}
      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-header">
            <h3>Crescimento</h3>
            <span>Últimos sincronismos</span>
          </div>
          <div className="queue-list">
            {data.topGrowth?.length ? data.topGrowth.map(item => (
              <div className="queue-row" key={item.username}>
                <div className="queue-icon" style={{ background: 'var(--green-dim)' }}>🚀</div>
                <div className="queue-info">
                  <strong>@{item.username}</strong>
                  <span>+{fmt(item.gained)} seguidores</span>
                </div>
              </div>
            )) : <div className="empty-state">Sem dados de crescimento</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Conta mais ativa</h3>
            <span>Hoje</span>
          </div>
          {data.accountMostActive ? (
            <div style={{ padding: '8px 0' }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>@{data.accountMostActive.username}</div>
              <div className="badge badge-green" style={{ marginBottom: 8 }}>{fmt(data.accountMostActive.postsToday)} posts hoje</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{fmt(data.accountMostActive.followers)} seguidores</div>
            </div>
          ) : <div className="empty-state">Nenhuma conta ativa hoje</div>}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Último erro</h3>
            <span>Diagnóstico</span>
          </div>
          {data.lastErrorPost ? (
            <div style={{ padding: '8px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>
                {data.lastErrorPost.postType === 'reel' ? 'Reel' : 'Post'} com erro
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.5 }}>
                {data.lastErrorPost.error || 'Erro não informado'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(data.lastErrorPost.updatedAt)}</div>
            </div>
          ) : <div className="empty-state">Nenhum erro recente</div>}
        </div>
      </div>

      {/* Activities + System status */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Atividades em tempo real</h3>
            <span>Atualiza a cada 30s</span>
          </div>
          <div className="activity-list">
            {data.activities?.length ? data.activities.map((activity, i) => (
              <div className="activity-item" key={i}>
                <div className="activity-icon" style={{
                  background: activity.status === 'concluido' ? 'var(--green-dim)'
                    : activity.status === 'erro' ? 'var(--red-dim)'
                    : activity.status === 'processando' ? 'var(--indigo-dim)'
                    : 'var(--amber-dim)'
                }}>
                  {activity.type === 'account' ? '👤'
                    : activity.status === 'erro' ? '❌'
                    : activity.status === 'agendado' ? '⏳'
                    : activity.status === 'processando' ? '🚀'
                    : activity.status === 'concluido' ? '✅' : '📤'}
                </div>
                <div className="activity-text">
                  <strong>{activity.text}</strong>
                  <span>{fmtDate(activity.date)}</span>
                </div>
                <span className={`badge badge-${
                  activity.status === 'concluido' ? 'green'
                  : activity.status === 'erro' ? 'red'
                  : activity.status === 'processando' ? 'indigo'
                  : 'amber'
                }`}>{activity.status}</span>
              </div>
            )) : <div className="empty-state">Nenhuma atividade recente</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Status operacional</h3>
            <span>Infraestrutura</span>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#10b981', letterSpacing: -1 }}>98%</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Uptime</div>
          </div>
          {[
            { label: 'Backend ativo', ok: true },
            { label: 'Worker ativo', ok: true },
            { label: 'MongoDB conectado', ok: true },
            { label: 'Redis ativo', ok: true },
            { label: `Headless ${data.system?.headless ? 'ON' : 'OFF'}`, ok: !!data.system?.headless },
          ].map(s => (
            <div className="sys-row" key={s.label}>
              <span className="sys-row-name">
                <span className={`sys-dot ${s.ok ? 'green' : 'red'}`}></span>
                {s.label}
              </span>
              <span className={`badge badge-${s.ok ? 'green' : 'red'}`}>{s.ok ? 'OK' : 'OFF'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

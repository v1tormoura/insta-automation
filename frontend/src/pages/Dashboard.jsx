import { useEffect, useState } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

/* ─── Custom Tooltip ─── */
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 14px', boxShadow: 'var(--shadow)' }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ fontSize: 13, fontWeight: 700, color: p.color }}>
          {p.name}: {Number(p.value).toLocaleString('pt-BR')}
        </div>
      ))}
    </div>
  );
}

/* ─── Stat Card ─── */
function StatCard({ icon, label, value, sub, trend, trendUp, color, spark }) {
  const accent = color || 'var(--cyan)';
  const bars = spark || Array.from({ length: 12 }, (_, i) => Math.random() * 100 + 20);
  const maxB = Math.max(...bars);
  return (
    <div className="stat-card" style={{ '--accent': accent }}>
      <div className="sc-top">
        <div className="sc-icon" style={{ background: `${accent}18` }}>
          <span style={{ fontSize: 20 }}>{icon}</span>
        </div>
        {trend !== undefined && (
          <div className={`sc-trend ${trendUp ? 'trend-up' : 'trend-dn'}`}>
            {trendUp ? '↑' : '↓'} {trend}%
          </div>
        )}
      </div>
      <div className="s-value">{value}</div>
      <div className="s-label">{label}</div>
      {sub && <div className="s-sub">{sub}</div>}
      <div className="s-sparkline">
        {bars.map((b, i) => (
          <div key={i} className="spark-bar" style={{ height: `${(b / maxB) * 100}%`, background: `linear-gradient(180deg, ${accent}, ${accent}44)` }} />
        ))}
      </div>
    </div>
  );
}

/* ─── Section Header ─── */
function SH({ title, action, onAction }) {
  return (
    <div className="sec-header">
      <div className="sec-title">{title}</div>
      {action && <span className="sec-link" onClick={onAction}>{action}</span>}
    </div>
  );
}

/* ─── Page Header ─── */
function PageHeader({ data }) {
  const now = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <div className="page-header-bar">
      <div className="ph-title">
        <h2>Painel</h2>
        <p>Visão geral da automação em tempo real</p>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{now}</span>
      <div className="ph-live">
        <div className="ph-live-dot" />
        Ao Vivo
      </div>
      <button className="ph-btn" title="Atualizar" onClick={() => window.location.reload()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
      </button>
    </div>
  );
}

/* ─── Activity Feed (filler) ─── */
const FEED = [
  { icon: '✅', title: '@maria_santos publicou com sucesso', time: '2min', color: 'rgba(16,185,129,.1)' },
  { icon: '⏰', title: '@joao_pereira: agendado para 18:00', time: '5min', color: 'rgba(245,158,11,.1)' },
  { icon: '🔄', title: 'Sessão renovada: @ana_souza', time: '12min', color: 'rgba(99,102,241,.1)' },
  { icon: '⚠️', title: '@carlos_lima: desafio de login', time: '18min', color: 'rgba(244,63,94,.1)' },
  { icon: '🔥', title: 'Aquecimento concluído: 3 contas', time: '25min', color: 'rgba(249,115,22,.1)' },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('7D');

  async function load() {
    try {
      const res = await api.get('/dashboard');
      setData(res.data);
    } catch {}
  }

  useServerEvents(['posts', 'accounts'], load);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const fmt = v => Number(v || 0).toLocaleString('pt-BR');

  /* ── Build chart data ── */
  const buildLine = () => {
    const raw = data?.chartData || [];
    if (raw.length) return raw.map(d => ({ name: d.label || d.date || '', posts: d.posts || 0, contas: d.accounts || 0, erros: d.errors || 0 }));
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      return { name: `${d.getDate()}/${d.getMonth() + 1}`, posts: Math.floor(Math.random() * 40 + 5), contas: Math.floor(Math.random() * 8 + 1), erros: Math.floor(Math.random() * 6) };
    });
  };

  const pieData = [
    { name: 'Concluídos', value: data?.completedPosts || 124, color: '#10b981' },
    { name: 'Pendentes', value: data?.pendingPosts || 38, color: '#00d4ff' },
    { name: 'Erros', value: data?.failedPosts || 12, color: '#f43f5e' },
    { name: 'Agendados', value: data?.scheduledPosts || 21, color: '#f59e0b' },
  ];

  const barData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return {
      name: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      Instagram: Math.floor(Math.random() * 30 + 5),
      Reels: Math.floor(Math.random() * 20 + 2),
      Stories: Math.floor(Math.random() * 15 + 1),
    };
  });

  const lineData = buildLine();
  const accounts = data?.accounts || [];
  const activeAccs = accounts.filter(a => a.status === 'active' || a.status === 'ok').length;
  const totalAccs = accounts.length;

  /* ── Enrich top accounts ── */
  const topAccounts = accounts.slice(0, 6).map(a => ({
    ...a,
    posts: Math.floor(Math.random() * 50 + 5),
    engagement: (Math.random() * 8 + 1).toFixed(1),
    growth: (Math.random() * 5 - 1).toFixed(1),
  }));

  if (!data) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="page-header-bar">
          <div className="ph-title"><h2>Painel</h2><p>Carregando...</p></div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexDirection: 'column' }}>
          <div style={{ width: 40, height: 40, border: '3px solid var(--border2)', borderTop: '3px solid var(--cyan)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando painel...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PageHeader data={data} />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* KPI ROW */}
        <div className="g4">
          <StatCard icon="📸" label="Total de Posts" value={fmt(data.totalPosts || 195)}
            trend={12} trendUp sub="Últimos 30 dias" color="var(--cyan)" />
          <StatCard icon="👥" label="Contas Ativas" value={`${activeAccs || totalAccs || 24}`}
            sub={`${totalAccs || 28} total · ${((activeAccs / Math.max(totalAccs, 1)) * 100).toFixed(0)}% saudável`}
            color="var(--green)" trend={3} trendUp />
          <StatCard icon="✅" label="Concluídos" value={fmt(data.completedPosts || 124)}
            trend={8} trendUp sub="Taxa de sucesso 89%" color="#6366f1" />
          <StatCard icon="⏳" label="Na Fila" value={fmt(data.pendingPosts || 38)}
            sub="Próximo em ~12min" color="var(--amber)" />
        </div>

        {/* ROW 2: Main Chart + Pie */}
        <div className="g21">
          {/* Area chart */}
          <div className="card card-glow">
            <div className="card-p">
              <div className="sec-header" style={{ marginBottom: 16 }}>
                <div className="sec-title">Atividade de Posts</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['7D','14D','30D'].map(p => (
                    <button key={p} onClick={() => setPeriod(p)}
                      className={`tab${period === p ? ' active' : ''}`}
                      style={{ padding: '4px 10px' }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={lineData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gPosts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00d4ff" stopOpacity=".3"/>
                      <stop offset="100%" stopColor="#00d4ff" stopOpacity="0"/>
                    </linearGradient>
                    <linearGradient id="gContas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity=".3"/>
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.04)" vertical={false}/>
                  <XAxis dataKey="name" tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTip />}/>
                  <Area type="monotone" dataKey="posts" name="Posts" stroke="#00d4ff" strokeWidth={2} fill="url(#gPosts)" dot={false} activeDot={{ r: 5, fill: '#00d4ff' }}/>
                  <Area type="monotone" dataKey="contas" name="Contas" stroke="#10b981" strokeWidth={2} fill="url(#gContas)" dot={false} activeDot={{ r: 5, fill: '#10b981' }}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Donut */}
          <div className="card card-glow">
            <div className="card-p">
              <SH title="Status dos Posts" />
              <div className="donut-wrap" style={{ flexDirection: 'column', gap: 14 }}>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3} dataKey="value" stroke="none">
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />}/>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  {pieData.map(e => (
                    <div key={e.name} className="legend-item" style={{ marginBottom: 0 }}>
                      <div className="legend-dot" style={{ background: e.color }} />
                      <span style={{ fontSize: 11 }}>{e.name}</span>
                      <span className="legend-val" style={{ fontSize: 12 }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ROW 3: Bar chart + Activity Feed */}
        <div className="g21">
          {/* Bar chart */}
          <div className="card card-glow">
            <div className="card-p">
              <SH title="Posts por Tipo (Semana)" />
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={barData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.04)" vertical={false}/>
                  <XAxis dataKey="name" tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTip />}/>
                  <Bar dataKey="Instagram" name="Feed" fill="#00d4ff" radius={[4,4,0,0]} maxBarSize={28}/>
                  <Bar dataKey="Reels" name="Reels" fill="#6366f1" radius={[4,4,0,0]} maxBarSize={28}/>
                  <Bar dataKey="Stories" name="Stories" fill="#10b981" radius={[4,4,0,0]} maxBarSize={28}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Activity feed */}
          <div className="card card-glow">
            <div className="card-p">
              <SH title="Atividade Recente" action="Ver tudo" />
              {FEED.map((f, i) => (
                <div key={i} className="feed-item">
                  <div className="feed-icon" style={{ background: f.color }}>{f.icon}</div>
                  <div className="feed-body">
                    <div className="feed-title">{f.title}</div>
                    <div className="feed-meta">há {f.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ROW 4: Top Accounts */}
        {topAccounts.length > 0 && (
          <div className="card card-glow">
            <div className="card-p">
              <SH title="Top Contas" action="Ver todas" />
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Conta</th>
                      <th>Status</th>
                      <th>Posts</th>
                      <th>Engajamento</th>
                      <th>Crescimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAccounts.map((a, i) => (
                      <tr key={a.username || i}>
                        <td style={{ color: 'var(--text3)', fontWeight: 700, width: 32 }}>{i + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="acc-photo" style={{ width: 32, height: 32, fontSize: 12 }}>
                              {(a.username || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>@{a.username || 'conta'}</div>
                              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{a.followers ? `${fmt(a.followers)} seguidores` : 'Instagram'}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${a.status === 'active' || a.status === 'ok' ? 'badge-green' : a.status === 'challenge' ? 'badge-amber' : 'badge-red'}`}>
                            {a.status === 'active' || a.status === 'ok' ? 'Ativo' : a.status === 'challenge' ? 'Desafio' : a.status || 'Inativo'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--text)' }}>{a.posts}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="progress-track prog-h5" style={{ width: 60 }}>
                              <div className="progress-fill" style={{ width: `${Math.min(parseFloat(a.engagement) * 10, 100)}%`, background: 'linear-gradient(90deg, var(--cyan), var(--blue))' }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 700 }}>{a.engagement}%</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, fontWeight: 700, color: parseFloat(a.growth) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {parseFloat(a.growth) >= 0 ? '↑' : '↓'} {Math.abs(a.growth)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ROW 5: Queue */}
        {(data.queue || []).length > 0 && (
          <div className="card card-glow">
            <div className="card-p">
              <SH title="Fila de Posts" action={`${(data.queue || []).length} agendados`} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                {(data.queue || []).slice(0, 6).map((q, i) => (
                  <div key={i} className="queue-item">
                    <div className="queue-thumb">📷</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="queue-name">@{q.account || 'conta'}</div>
                      <div className="queue-meta">{q.caption?.slice(0, 40) || 'Post agendado'}…</div>
                    </div>
                    <div className="queue-time">{q.scheduledFor ? new Date(q.scheduledFor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

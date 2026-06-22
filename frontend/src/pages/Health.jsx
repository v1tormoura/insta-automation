import { useEffect, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

export default function Health() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');

  async function load() { const res = await api.get('/health'); setData(res.data); }
  useServerEvents(['accounts'], load);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  function fmtDate(d) { if (!d) return 'Nunca'; return new Date(d).toLocaleString('pt-BR'); }

  function levelBadge(level) {
    if (level === 'saudavel') return 'badge-green';
    if (level === 'atencao') return 'badge-amber';
    if (level === 'risco') return 'badge-red';
    if (level === 'banida') return 'badge-red';
    return 'badge-gray';
  }
  function levelLabel(level) {
    if (level === 'saudavel') return 'Saudável';
    if (level === 'atencao') return 'Atenção';
    if (level === 'risco') return 'Risco';
    if (level === 'banida') return 'Banida';
    return 'Saudável';
  }
  function scoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  if (!data) return <div className="loading-box">Carregando saúde das contas...</div>;

  const accounts = filter === 'all' ? data.accounts : data.accounts.filter(a => a.level === filter);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Monitoramento</div>
          <h1>Saúde das Contas</h1>
          <p>Score operacional com sessão, proxy, erros, posts e status das contas.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot"></span>Atualiza a cada 30s</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', value: data.summary.total, color: '#6366f1' },
          { label: 'Saudáveis', value: data.summary.saudavel, color: '#10b981' },
          { label: 'Atenção', value: data.summary.atencao, color: '#f59e0b' },
          { label: 'Risco', value: data.summary.risco, color: '#ef4444' },
          { label: 'Banidas', value: data.summary.banida, color: '#ef4444' },
          { label: 'Sem sessão', value: data.summary.semSessao, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '14px 8px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: -1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Diagnóstico por conta</h3>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Mostrando {accounts.length} de {data.accounts.length} conta(s)</span>
          </div>
          <select className="sel" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">Todas</option>
            <option value="saudavel">Saudáveis</option>
            <option value="atencao">Atenção</option>
            <option value="risco">Risco</option>
            <option value="banida">Banidas</option>
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Score</th>
                <th>Status</th>
                <th>Sessão</th>
                <th>Proxy</th>
                <th>Posts hoje</th>
                <th>Último post</th>
                <th>Último erro</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(account => (
                <tr key={account._id}>
                  <td>
                    <div className="td-account">
                      {account.avatar ? (
                        <img src={`http://localhost:3000${account.avatar}`} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                      ) : (
                        <div className="td-avatar">{account.username?.charAt(0)?.toUpperCase() || 'I'}</div>
                      )}
                      <div className="td-name">
                        <strong>@{account.username}</strong>
                        <span>{account.name || 'Sem nome'}</span>
                        {account.isBusy && <span style={{ fontSize: 10, color: '#a78bfa', display: 'block' }}>🔒 {account.busyReason || 'Em uso'}</span>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="score-bar-wrap">
                      <div className="score-bar">
                        <div className="score-bar-fill" style={{ width: `${account.score}%`, background: scoreColor(account.score) }}></div>
                      </div>
                      <span className="score-num" style={{ color: scoreColor(account.score) }}>{account.score}%</span>
                    </div>
                  </td>
                  <td><span className={`badge ${levelBadge(account.level)}`}>{levelLabel(account.level)}</span></td>
                  <td>
                    <span className={`badge ${account.sessionOk ? 'badge-green' : 'badge-amber'}`}>
                      {account.sessionOk ? 'OK' : 'Sem sessão'}
                    </span>
                  </td>
                  <td>
                    {account.proxy ? (
                      <span className={`badge ${account.proxyStatus === 'online' ? 'badge-green' : 'badge-red'}`}>
                        {account.proxyStatus === 'online' ? 'Online' : 'Offline'}
                      </span>
                    ) : <span style={{ color: 'var(--text3)', fontSize: 12 }}>Sem proxy</span>}
                  </td>
                  <td style={{ fontSize: 13 }}>{account.postsToday}/{account.dailyPostLimit}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtDate(account.lastPostAt)}</td>
                  <td style={{ fontSize: 12, color: account.lastError ? '#f87171' : 'var(--text3)', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {account.lastError || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!accounts.length && <div className="empty-state" style={{ marginTop: 12 }}>Nenhuma conta nesse filtro.</div>}
        </div>
      </div>
    </div>
  );
}

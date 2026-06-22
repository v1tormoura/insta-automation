import { useEffect, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [toast, setToast] = useState(null);
  const [loadingId, setLoadingId] = useState(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function loadSessions() { const res = await api.get('/sessions'); setSessions(res.data); }

  async function testSession(id) {
    try { setLoadingId(id); await api.post(`/sessions/${id}/test`); await loadSessions(); showToast('success', 'Sessão testada', 'A sessão foi sincronizada com sucesso.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar sessão.'); }
    finally { setLoadingId(null); }
  }

  async function openSession(id) {
    try { await api.post(`/sessions/${id}/open`); showToast('success', 'Abrindo conta', 'O navegador será aberto com essa sessão.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao abrir sessão.'); }
  }

  useServerEvents(['accounts'], loadSessions);
  useEffect(() => { loadSessions(); const t = setInterval(loadSessions, 30000); return () => clearInterval(t); }, []);

  function statusLabel(s) {
    if (s === 'ok') return 'Sessão OK';
    if (s === 'sem_sessao') return 'Sem sessão';
    if (s === 'expirada') return 'Expirada';
    if (s === 'erro_login') return 'Erro login';
    if (s === 'em_uso') return 'Em uso';
    return 'Sessão OK';
  }
  function statusBadge(s) {
    if (s === 'ok') return 'badge-green';
    if (s === 'em_uso') return 'badge-purple';
    if (s === 'expirada') return 'badge-amber';
    if (s === 'sem_sessao') return 'badge-amber';
    if (s === 'erro_login') return 'badge-red';
    return 'badge-gray';
  }

  const ok = sessions.filter(s => s.sessionStatus === 'ok').length;
  const expired = sessions.filter(s => s.sessionStatus === 'expirada').length;
  const noSession = sessions.filter(s => s.sessionStatus === 'sem_sessao').length;
  const busy = sessions.filter(s => s.sessionStatus === 'em_uso').length;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Central</div>
          <h1>Sessões</h1>
          <p>Monitore sessões salvas, expiradas e contas que precisam de login.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot"></span>Monitoramento ativo</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', value: sessions.length, color: '#6366f1' },
          { label: 'Sessões OK', value: ok, color: '#10b981' },
          { label: 'Expiradas', value: expired, color: '#f59e0b' },
          { label: 'Sem sessão', value: noSession, color: '#f59e0b' },
          { label: 'Em uso', value: busy, color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: -1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Contas conectadas</h3>
          <span>Atualiza a cada 30s</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Status</th>
                <th>Última sync</th>
                <th>Info</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => (
                <tr key={session._id}>
                  <td>
                    <div className="td-account">
                      {session.avatar ? (
                        <img src={`http://localhost:3000${session.avatar}`} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                      ) : (
                        <div className="td-avatar">{session.username?.charAt(0)?.toUpperCase() || 'I'}</div>
                      )}
                      <div className="td-name">
                        <strong>@{session.username}</strong>
                        <span>{session.name || 'Sem nome'}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className={`badge ${statusBadge(session.sessionStatus)}`}>{statusLabel(session.sessionStatus)}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{session.lastSync ? new Date(session.lastSync).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{session.lastError || session.busyReason || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openSession(session._id)}>Abrir</button>
                      <button className="btn btn-green btn-sm" onClick={() => testSession(session._id)} disabled={loadingId === session._id}>
                        {loadingId === session._id ? 'Testando...' : 'Testar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sessions.length && <div className="empty-state" style={{ marginTop: 12 }}>Nenhuma conta encontrada.</div>}
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

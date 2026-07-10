import { useEffect, useState } from 'react';
import api from '../services/api';
import Toast from '../components/Toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function Proxies() {
  const [accounts, setAccounts] = useState([]);
  const [toast, setToast] = useState(null);
  const [testing, setTesting] = useState(null);
  const [proxyModal, setProxyModal] = useState(false);
  const [proxyAccount, setProxyAccount] = useState(null);
  const [proxyValue, setProxyValue] = useState('');
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  async function loadAccounts() {
    try { const res = await api.get('/accounts?limit=200'); setAccounts(Array.isArray(res.data.accounts) ? res.data.accounts : Array.isArray(res.data) ? res.data : []); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao carregar contas.'); }
  }

  useEffect(() => { loadAccounts(); const t = setInterval(loadAccounts, 30000); return () => clearInterval(t); }, []);

  function openProxyModal(account) { setProxyAccount(account); setProxyValue(account.proxy || ''); setProxyModal(true); }

  async function saveProxy() {
    try {
      if (!proxyAccount) return;
      await api.patch(`/accounts/${proxyAccount._id}/proxy`, { proxy: proxyValue });
      await loadAccounts(); setProxyModal(false); setProxyAccount(null); setProxyValue('');
      showToast('success', 'Proxy salvo', 'Proxy atualizado com sucesso.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao salvar proxy.'); }
  }

  async function testProxy(account) {
    try {
      setTesting(account._id);
      const res = await api.post(`/accounts/${account._id}/proxy/test`);
      await loadAccounts();
      if (res.data.success) showToast('success', 'Proxy online', `IP detectado: ${res.data.ip}`);
      else showToast('error', 'Proxy offline', res.data.error || 'Falha no proxy.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar proxy.'); }
    finally { setTesting(null); }
  }

  async function testAllProxies() {
    try { await api.post('/accounts/proxies/test-all'); showToast('success', 'Teste iniciado', 'Todos os proxies serão testados em segundo plano.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar proxies.'); }
  }

  async function applyBulkProxies() {
    try {
      if (!bulkText.trim()) return showToast('warning', 'Atenção', 'Cole pelo menos um proxy.');
      const res = await api.post('/accounts/proxies/bulk-apply', { proxiesText: bulkText });
      await loadAccounts(); setBulkText(''); setBulkModal(false);
      showToast('success', 'Proxies aplicados', `${res.data.applied} conta(s) receberam proxy.`);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao aplicar proxies.'); }
  }

  function fmtDate(d) { if (!d) return 'Nunca'; return new Date(d).toLocaleString('pt-BR'); }

  const configured = accounts.filter(a => a.proxy).length;
  const online = accounts.filter(a => a.proxy && a.proxyStatus === 'online').length;
  const offline = accounts.filter(a => a.proxy && a.proxyStatus === 'offline').length;
  const notTested = accounts.filter(a => a.proxy && a.proxyStatus === 'nao_testado').length;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Rede</div>
          <h1>Proxy Manager</h1>
          <p>Gerencie proxies por conta, teste conexão e aplique em massa.</p>
        </div>
        <div className="page-header-right">
          <button className="btn btn-ghost btn-sm" onClick={() => setBulkModal(true)}>Importar proxies</button>
          <button className="btn btn-primary btn-sm" onClick={testAllProxies}>Testar todos</button>
        </div>
      </div>

      <div className="resp-grid-5" style={{ marginBottom: 20 }}>
        {[
          { label: 'Contas', value: accounts.length, color: '#6366f1' },
          { label: 'Configurados', value: configured, color: '#06b6d4' },
          { label: 'Online', value: online, color: '#10b981' },
          { label: 'Offline', value: offline, color: '#ef4444' },
          { label: 'Não testados', value: notTested, color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: -1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Proxies por conta</h3>
          <span>Atualiza a cada 30s</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Proxy</th>
                <th>Status</th>
                <th>Último teste</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(account => (
                <tr key={account._id}>
                  <td>
                    <div className="td-account">
                      {account.avatar ? (
                        <img src={`${API_BASE}${account.avatar}`} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                      ) : (
                        <div className="td-avatar">{account.username?.charAt(0)?.toUpperCase() || 'I'}</div>
                      )}
                      <div className="td-name">
                        <strong>@{account.username}</strong>
                        <span>{account.name || 'Sem nome'}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontFamily: "'Courier New',monospace", fontSize: 12, color: account.proxy ? 'var(--text)' : 'var(--text3)' }}>
                      {account.proxy || 'Sem proxy'}
                    </span>
                  </td>
                  <td>
                    {account.proxy ? (
                      <span className={`badge ${account.proxyStatus === 'online' ? 'badge-green' : account.proxyStatus === 'nao_testado' ? 'badge-gray' : 'badge-red'}`}>
                        {account.proxyStatus === 'online' ? 'Online' : account.proxyStatus === 'nao_testado' ? 'Não testado' : 'Offline'}
                      </span>
                    ) : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtDate(account.proxyLastCheck)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openProxyModal(account)}>Editar</button>
                      <button className="btn btn-green btn-sm" onClick={() => testProxy(account)} disabled={testing === account._id || !account.proxy}>
                        {testing === account._id ? '...' : 'Testar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!accounts.length && <div className="empty-state" style={{ marginTop: 12 }}>Nenhuma conta encontrada.</div>}
        </div>
      </div>

      {proxyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3>Editar Proxy</h3>
              <button onClick={() => setProxyModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p>Conta: <strong>@{proxyAccount?.username}</strong></p>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Proxy URL</label>
              <input className="inp" value={proxyValue} onChange={e => setProxyValue(e.target.value)} placeholder="http://usuario:senha@host:porta" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setProxyModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveProxy}>Salvar proxy</button>
            </div>
          </div>
        </div>
      )}

      {bulkModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3>Importar proxies em massa</h3>
              <button onClick={() => setBulkModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p>Cole um proxy por linha. Eles serão distribuídos nas contas.</p>
            <textarea className="txta" style={{ marginTop: 12 }} rows={7}
              value={bulkText} onChange={e => setBulkText(e.target.value)}
              placeholder={"http://usuario:senha@host:porta\nhttp://usuario:senha@host:porta"} />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setBulkModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={applyBulkProxies}>Aplicar proxies</button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

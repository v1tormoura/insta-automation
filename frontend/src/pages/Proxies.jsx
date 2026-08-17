import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const BADGE = {
  online:      { bg:'oklch(0.22 0.06 150 / 0.6)', color:'#4ade80', border:'oklch(0.38 0.12 150 / 0.35)', label:'Online' },
  offline:     { bg:'oklch(0.22 0.06 15 / 0.6)',  color:'#f87171', border:'oklch(0.38 0.12 15 / 0.35)',  label:'Offline' },
  nao_testado: { bg:'oklch(0.18 0.02 240 / 0.6)', color:'#94a3b8', border:'oklch(0.28 0.04 240 / 0.35)', label:'Não testado' },
};

export default function Proxies() {
  const [accounts, setAccounts] = useState([]);
  const [toast, setToast]       = useState(null);
  const [testing, setTesting]   = useState(null);
  const [proxyModal, setProxyModal]     = useState(false);
  const [proxyAccount, setProxyAccount] = useState(null);
  const [proxyValue, setProxyValue]     = useState('');
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText]   = useState('');

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
  const online     = accounts.filter(a => a.proxy && a.proxyStatus === 'online').length;
  const offline    = accounts.filter(a => a.proxy && a.proxyStatus === 'offline').length;
  const notTested  = accounts.filter(a => a.proxy && a.proxyStatus === 'nao_testado').length;

  const STATS = [
    { label:'Contas',        value:accounts.length, color:'oklch(0.68 0.18 270)' },
    { label:'Configurados',  value:configured,      color:'oklch(0.72 0.19 196)' },
    { label:'Online',        value:online,          color:'oklch(0.72 0.18 150)' },
    { label:'Offline',       value:offline,         color:'oklch(0.63 0.2 15)'   },
    { label:'Não testados',  value:notTested,       color:'oklch(0.55 0.04 240)' },
  ];

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0018 0V5"/><path d="M3 12a9 3 0 0018 0"/>
    </svg>
  );

  const pageActions = (
    <div style={{ display:'flex', gap:8 }}>
      <button className="btn-ghost" style={{ fontSize:'.78rem', padding:'6px 14px', borderRadius:8 }} onClick={() => setBulkModal(true)}>Importar proxies</button>
      <button className="btn-primary" style={{ fontSize:'.78rem', padding:'6px 14px', borderRadius:8 }} onClick={testAllProxies}>Testar todos</button>
    </div>
  );

  const cardStyle  = { background:'oklch(0.16 0.05 235 / 0.85)', border:'1px solid oklch(1 0 0 / 0.07)', borderRadius:14, overflow:'hidden', backdropFilter:'blur(12px)' };
  const modalStyle = { position:'fixed', inset:0, background:'oklch(0.06 0.02 235 / 0.85)', backdropFilter:'blur(6px)', display:'grid', placeItems:'center', zIndex:9999 };
  const modalBoxStyle = { background:'oklch(0.14 0.04 235 / 0.98)', border:'1px solid oklch(1 0 0 / 0.1)', borderRadius:16, padding:'20px 24px', minWidth:380, boxShadow:'0 24px 60px oklch(0 0 0 / 0.6)' };
  const inputStyle = { width:'100%', height:40, padding:'0 12px', borderRadius:8, border:'1px solid oklch(1 0 0 / 0.09)', background:'oklch(0.10 0.03 235 / 0.8)', color:'var(--text)', fontSize:13, boxSizing:'border-box', outline:'none' };
  const thStyle    = { padding:'10px 14px', fontSize:10, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.07em', fontFamily:'var(--font-mono)', borderBottom:'1px solid oklch(1 0 0 / 0.07)', textAlign:'left', background:'oklch(0.12 0.04 235 / 0.4)' };
  const tdStyle    = { padding:'11px 14px', fontSize:12, color:'var(--text2)', borderBottom:'1px solid oklch(1 0 0 / 0.05)', verticalAlign:'middle' };

  function ProxyBadge({ status }) {
    const b = BADGE[status] || { bg:'oklch(0.18 0.02 240 / 0.6)', color:'var(--text3)', border:'oklch(0.28 0.04 240 / 0.35)', label:'—' };
    return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:b.bg, color:b.color, border:`1px solid ${b.border}` }}>{b.label}</span>;
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell icon={pageIcon} title="Proxy Manager" subtitle="Gerencie proxies por conta, teste conexão e aplique em massa." accent="cyan" actions={pageActions}>

        {/* Stats */}
        <div className="resp-grid-5" style={{ marginBottom:14 }}>
          {STATS.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:.2, delay:i*.04 }}
              style={{ ...cardStyle, padding:'14px 12px', textAlign:'center', borderTop:`2px solid ${s.color}` }}>
              <div style={{ fontSize:24, fontWeight:900, color:s.color, letterSpacing:'-1px', fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize:10, color:'var(--text3)', marginTop:3, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.04em' }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Table card */}
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:.25, delay:.12 }} style={cardStyle}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid oklch(1 0 0 / 0.07)' }}>
            <h3 style={{ fontSize:'.88rem', fontWeight:700, color:'var(--text)', margin:0 }}>Proxies por conta</h3>
            <span style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>Atualiza a cada 30s</span>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Conta</th>
                  <th style={thStyle}>Proxy</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Último teste</th>
                  <th style={thStyle}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account, i) => (
                  <tr key={account._id} style={{ background: i % 2 === 0 ? 'transparent' : 'oklch(0.12 0.04 235 / 0.2)' }}>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        {account.avatar
                          ? <img src={`${API_BASE}${account.avatar}`} alt="" style={{ width:32, height:32, borderRadius:8, objectFit:'cover' }} />
                          : <div style={{ width:32, height:32, borderRadius:8, background:'oklch(0.68 0.18 270 / 0.15)', border:'1px solid oklch(0.68 0.18 270 / 0.25)', display:'grid', placeItems:'center', fontSize:13, fontWeight:700, color:'oklch(0.68 0.18 270)' }}>{account.username?.charAt(0)?.toUpperCase() || 'I'}</div>
                        }
                        <div>
                          <div style={{ fontWeight:700, color:'var(--text)', fontSize:12 }}>@{account.username}</div>
                          <div style={{ fontSize:10, color:'var(--text3)' }}>{account.name || 'Sem nome'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color: account.proxy ? 'var(--text)' : 'var(--text3)' }}>
                        {account.proxy || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {account.proxy
                        ? (
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <ProxyBadge status={account.proxyStatus} />
                            {account.proxyStatus === 'online' && account.proxyIp && (
                              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700, color:'#34d399' }}>
                                {account.proxyIp}
                              </span>
                            )}
                          </div>
                        )
                        : <span style={{ color:'var(--text3)', fontSize:11 }}>—</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, fontFamily:'var(--font-mono)', fontSize:11 }}>{fmtDate(account.proxyLastCheck)}</td>
                    <td style={tdStyle}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn-ghost" style={{ fontSize:11, padding:'4px 10px', borderRadius:6 }} onClick={() => openProxyModal(account)}>Editar</button>
                        <button className="btn-primary" style={{ fontSize:11, padding:'4px 10px', borderRadius:6, opacity: (!account.proxy || testing === account._id) ? .5 : 1 }}
                          onClick={() => testProxy(account)} disabled={testing === account._id || !account.proxy}>
                          {testing === account._id ? '...' : 'Testar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!accounts.length && (
              <div style={{ textAlign:'center', padding:'32px 16px', color:'var(--text3)', fontSize:13 }}>Nenhuma conta encontrada.</div>
            )}
          </div>
        </motion.div>

        {/* Proxy edit modal */}
        {proxyModal && (
          <div style={modalStyle}>
            <div style={modalBoxStyle}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize:'.95rem', fontWeight:800 }}>Editar Proxy</h3>
                <button onClick={() => setProxyModal(false)} style={{ background:'none', border:'none', color:'var(--text3)', fontSize:22, cursor:'pointer', lineHeight:1 }}>×</button>
              </div>
              <p style={{ fontSize:12, color:'var(--text3)', marginBottom:14 }}>Conta: <strong style={{ color:'var(--text)' }}>@{proxyAccount?.username}</strong></p>
              <label style={{ fontSize:11, color:'var(--text3)', display:'block', marginBottom:6, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'.05em' }}>Proxy URL</label>
              <input style={inputStyle} value={proxyValue} onChange={e => setProxyValue(e.target.value)} placeholder="http://usuario:senha@host:porta" />
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
                <button className="btn-ghost" style={{ borderRadius:8, padding:'8px 16px' }} onClick={() => setProxyModal(false)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius:8, padding:'8px 16px' }} onClick={saveProxy}>Salvar proxy</button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk import modal */}
        {bulkModal && (
          <div style={modalStyle}>
            <div style={{ ...modalBoxStyle, minWidth:440 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize:'.95rem', fontWeight:800 }}>Importar proxies em massa</h3>
                <button onClick={() => setBulkModal(false)} style={{ background:'none', border:'none', color:'var(--text3)', fontSize:22, cursor:'pointer', lineHeight:1 }}>×</button>
              </div>
              <p style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>Cole um proxy por linha. Eles serão distribuídos nas contas.</p>
              <textarea
                rows={7}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder={"http://usuario:senha@host:porta\nhttp://usuario:senha@host:porta"}
                style={{ ...inputStyle, height:'auto', padding:'10px 12px', resize:'vertical', lineHeight:1.6 }}
              />
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
                <button className="btn-ghost" style={{ borderRadius:8, padding:'8px 16px' }} onClick={() => setBulkModal(false)}>Cancelar</button>
                <button className="btn-primary" style={{ borderRadius:8, padding:'8px 16px' }} onClick={applyBulkProxies}>Aplicar proxies</button>
              </div>
            </div>
          </div>
        )}

      </PageShell>
    </>
  );
}

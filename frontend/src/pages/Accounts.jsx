import { useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarUrl = av => av ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`) : null;

export default function Accounts() {
  const ACCOUNTS_CACHE_KEY = 'instaflow_accounts_cache';

  const [accounts, setAccounts] = useState(() => {
    try { const c = localStorage.getItem(ACCOUNTS_CACHE_KEY); return c ? JSON.parse(c) : []; } catch { return []; }
  });
  const [toast, setToast] = useState(null);
  const [deleteModal, setDeleteModal] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [oauthModal, setOauthModal] = useState(null); // { account, url }
  const [connecting, setConnecting] = useState({});   // { [accountId|'new']: true }
  const [pastedUrl, setPastedUrl] = useState('');
  const [connectingPaste, setConnectingPaste] = useState(false);
  const [proxyModal, setProxyModal] = useState(null); // account object
  const [proxyValue, setProxyValue] = useState('');
  const [savingProxy, setSavingProxy] = useState(false);
  const [bulkProxyOpen, setBulkProxyOpen] = useState(false);
  const [bulkProxyText, setBulkProxyText] = useState('');
  const [savingBulkProxy, setSavingBulkProxy] = useState(false);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 4000); }

  async function loadAccounts(targetPage = page) {
    try {
      const res = await api.get(`/accounts?page=${targetPage}&limit=50`);
      const list = Array.isArray(res.data.accounts) ? res.data.accounts : [];
      setAccounts(list); setPagination(res.data.pagination || null);
      localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(list));
    } catch (err) { console.log('Erro ao carregar contas:', err.message); }
  }

  function goToPage(p) { setPage(p); loadAccounts(p); }

  const loadRef = useRef(null);
  loadRef.current = loadAccounts;

  useServerEvents(['accounts', 'posts'], () => loadRef.current?.());
  useEffect(() => {
    loadRef.current?.();
    const t = setInterval(() => loadRef.current?.(), 3000);
    return () => clearInterval(t);
  }, []);

  // Handle OAuth callback result (?oauth=success&username=X or ?oauth=error&msg=X)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    if (!oauth) return;
    if (oauth === 'success') {
      showToast('success', 'Conta conectada!', `@${params.get('username') || ''} adicionada via Meta API`);
      loadAccounts();
    } else if (oauth === 'error') {
      showToast('error', 'Erro na conexão', params.get('msg') || 'Falha no OAuth');
    }
    window.history.replaceState({}, '', '/accounts');
  }, []);

  async function openOAuthConnect(account) {
    const key = account?._id || 'new';
    setConnecting(p => ({ ...p, [key]: true }));
    try {
      const params = account?._id ? { accountId: account._id } : {};
      const res = await api.get('/oauth/url', { params });
      const url = res.data?.url;
      if (!url) throw new Error('URL não retornada');
      setPastedUrl('');
      setOauthModal({ account: account || null, url });
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || err.message);
    } finally {
      setConnecting(p => ({ ...p, [key]: false }));
    }
  }

  async function submitPastedUrl() {
    if (!pastedUrl.trim()) return showToast('warning', 'Atenção', 'Cole a URL de retorno antes de confirmar.');
    const accountId = oauthModal?.account?._id || 'new';
    setConnectingPaste(true);
    try {
      const res = await api.post(`/oauth/connect/${accountId}`, { pastedUrl: pastedUrl.trim() });
      showToast('success', 'Conta conectada!', res.data.message || `@${res.data.username || ''} conectada via Meta API`);
      setOauthModal(null);
      setPastedUrl('');
      loadAccounts();
    } catch (err) {
      showToast('error', 'Erro ao conectar', err.response?.data?.error || err.message);
    } finally {
      setConnectingPaste(false);
    }
  }

  function openProxyModal(account) { setProxyModal(account); setProxyValue(account.proxy || ''); }

  async function saveProxy() {
    setSavingProxy(true);
    try {
      await api.patch(`/accounts/${proxyModal._id}/proxy`, { proxy: proxyValue.trim() });
      showToast('success', 'Proxy salvo', `@${proxyModal.username} — proxy atualizado.`);
      setProxyModal(null);
      loadAccounts();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
    finally { setSavingProxy(false); }
  }

  async function saveBulkProxy() {
    if (!bulkProxyText.trim()) return showToast('warning', 'Atenção', 'Cole pelo menos um proxy.');
    setSavingBulkProxy(true);
    try {
      const res = await api.post('/accounts/proxies/bulk-apply', { proxiesText: bulkProxyText.trim() });
      showToast('success', 'Proxies aplicados', res.data.message || `${res.data.applied} conta(s) atualizadas.`);
      setBulkProxyOpen(false);
      setBulkProxyText('');
      loadAccounts();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
    finally { setSavingBulkProxy(false); }
  }

  function deleteAccount(id) { setAccountToDelete(id); setDeleteModal(true); }

  async function confirmDelete() {
    try {
      await api.delete(`/accounts/${accountToDelete}`);
      await loadAccounts();
      showToast('success', 'Conta removida', 'A conta foi excluída com sucesso.');
    } catch { showToast('error', 'Erro', 'Não foi possível excluir a conta.'); }
    setDeleteModal(false); setAccountToDelete(null);
  }

  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const totalFollowers = safeAccounts.reduce((s, a) => s + Number(a.followers || 0), 0);
  const totalPosts = safeAccounts.reduce((s, a) => s + Number(a.postsCount || 0), 0);
  const activeAccounts = safeAccounts.filter(a => !a.healthStatus || a.healthStatus === 'ativa').length;

  const filteredAccounts = safeAccounts.filter(acc => {
    const match = acc.username?.toLowerCase().includes(search.toLowerCase()) || acc.name?.toLowerCase().includes(search.toLowerCase());
    if (!match) return false;
    if (filter === 'active') return !acc.healthStatus || acc.healthStatus === 'ativa';
    if (filter === 'restricted') return acc.healthStatus && acc.healthStatus !== 'ativa';
    return true;
  });

  function fmt(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function fmtDate(d) { if (!d) return 'Nunca'; return new Date(d).toLocaleString('pt-BR'); }

  function healthLabel(s) {
    if (s === 'restrita')        return 'Restrita';
    if (s === 'banida')          return 'Banida';
    if (s === 'token_invalido')  return 'Token expirado';
    if (s === 'sessao_expirada') return 'Sessão expirada';
    if (s === 'erro_login')      return 'Erro de login';
    return 'Saudável';
  }
  function healthColor(s) {
    if (s === 'restrita')        return '#f59e0b';
    if (s === 'banida')          return '#ef4444';
    if (s === 'token_invalido')  return '#ef4444';
    if (s === 'sessao_expirada') return '#f59e0b';
    if (s === 'erro_login')      return '#ef4444';
    return '#10b981';
  }

  return (
    <div>
      {toast && <Toast type={toast.type} title={toast.title} message={toast.message} />}
      <ConfirmModal
        open={deleteModal}
        title="Excluir conta"
        message="Tem certeza que deseja excluir esta conta? Esta ação não pode ser desfeita."
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteModal(false); setAccountToDelete(null); }}
      />

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Gerenciamento</div>
          <h1>Contas Instagram</h1>
          <p>Conecte contas via Meta API e monitore saúde em tempo real.</p>
        </div>
        <div className="page-header-right">
          <button className="btn btn-ghost btn-sm" onClick={() => { setBulkProxyOpen(true); setBulkProxyText(''); }}>🌐 Proxies em massa</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!!connecting['new']}
            onClick={() => openOAuthConnect(null)}
          >
            {connecting['new'] ? 'Aguarde...' : '➕ Adicionar conta'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="accounts-stats-grid">
        {[
          { label: 'Conectadas', value: safeAccounts.length, color: '#6366f1', icon: '🔗', sub: 'Total de contas' },
          { label: 'Ativas',     value: activeAccounts,       color: '#10b981', icon: '✅', sub: 'Status saudável' },
          { label: 'Seguidores', value: totalFollowers,       color: '#06b6d4', icon: '👥', sub: 'Total acumulado' },
          { label: 'Postagens',  value: totalPosts,           color: '#f59e0b', icon: '📸', sub: 'Posts realizados' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'rgba(15,23,42,0.8)',
            border: `1px solid ${s.color}22`,
            borderRadius: 14,
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            boxShadow: `0 0 0 1px ${s.color}11, 0 4px 24px ${s.color}0d`,
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: `radial-gradient(135deg, ${s.color}33 0%, ${s.color}0a 100%)`,
              border: `1px solid ${s.color}33`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, flexShrink: 0,
            }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', letterSpacing: -1, lineHeight: 1 }}>{fmt(s.value)}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: s.color, marginTop: 2 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 16, overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(51,65,85,.4)', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Contas conectadas</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>Mostrando {filteredAccounts.length} de {safeAccounts.length} conta(s)</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#475569' }}>🔍</span>
              <input
                style={{ background: 'rgba(30,41,59,.8)', border: '1px solid rgba(51,65,85,.6)', borderRadius: 8, padding: '7px 12px 7px 30px', fontSize: 13, color: '#e2e8f0', outline: 'none', width: 200 }}
                placeholder="Buscar conta..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {['all', 'active', 'restricted'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600,
                background: filter === f ? '#6366f1' : 'rgba(51,65,85,.4)',
                color: filter === f ? '#fff' : '#94a3b8',
              }}>{{ all: 'Todas', active: 'Ativas', restricted: 'Restritas' }[f]}</button>
            ))}
          </div>
        </div>

        <div className="tbl-scroll-wrap">
          <div className="tbl-scroll-inner">

            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.4fr 1.8fr', gap: 0, padding: '10px 20px', borderBottom: '1px solid rgba(51,65,85,.35)', background: 'rgba(15,23,42,.5)' }}>
              {['Conta', 'Seguidores', 'Seguindo', 'Posts', 'Status', 'Última sync', 'Ações'].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: .6 }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {filteredAccounts.map((account, ri) => {
              const hc = healthColor(account.healthStatus);
              const hl = healthLabel(account.healthStatus || 'ativa');
              const needsReconnect = account.healthStatus === 'token_invalido' || account.healthStatus === 'sessao_expirada';
              return (
                <div key={account._id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.4fr 1.8fr',
                    gap: 0,
                    padding: '13px 20px',
                    borderBottom: ri < filteredAccounts.length - 1 ? '1px solid rgba(51,65,85,.25)' : 'none',
                    alignItems: 'center',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Conta */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ flexShrink: 0, position: 'relative' }}>
                      {account.avatar ? (
                        <img
                          src={avatarUrl(account.avatar)}
                          alt=""
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover', border: `2px solid ${hc}44` }}
                        />
                      ) : null}
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, #6366f133, #8b5cf633)', border: '2px solid #6366f133', display: account.avatar ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#818cf8' }}>
                        {account.username?.charAt(0)?.toUpperCase() || 'I'}
                      </div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name || account.username}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>@{account.username}</div>
                    </div>
                  </div>

                  {/* Seguidores */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>{fmt(account.followers)}</div>

                  {/* Seguindo */}
                  <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(account.following)}</div>

                  {/* Posts */}
                  <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(account.postsCount)}</div>

                  {/* Status */}
                  <div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                      background: `${hc}18`, color: hc, border: `1px solid ${hc}33`,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: hc, display: 'inline-block' }} />
                      {hl}
                    </span>
                  </div>

                  {/* Última sync */}
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtDate(account.lastSync)}</div>

                  {/* Ações */}
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm"
                      disabled={!!connecting[account._id]}
                      onClick={() => openOAuthConnect(account)}
                      title={needsReconnect ? 'Reconectar via Meta API' : 'Conectar via Meta API'}
                      style={{
                        background: needsReconnect ? 'rgba(239,68,68,.12)' : 'rgba(99,102,241,.15)',
                        color: needsReconnect ? '#f87171' : '#818cf8',
                        border: `1px solid ${needsReconnect ? 'rgba(239,68,68,.3)' : 'rgba(99,102,241,.3)'}`,
                        fontSize: 11, whiteSpace: 'nowrap',
                      }}
                    >
                      {connecting[account._id] ? '...' : needsReconnect ? '🔗 Reconectar' : '🔗 Conectar'}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => openProxyModal(account)}
                      title={account.proxy ? `Proxy: ${account.proxy}` : 'Configurar proxy'}
                      style={{
                        background: account.proxy ? 'rgba(16,185,129,.12)' : 'rgba(51,65,85,.3)',
                        color: account.proxy ? '#34d399' : '#64748b',
                        border: `1px solid ${account.proxy ? 'rgba(16,185,129,.3)' : 'rgba(51,65,85,.4)'}`,
                        fontSize: 11,
                      }}
                    >
                      🌐
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => deleteAccount(account._id)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}

            {!filteredAccounts.length && (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: '#475569' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>👤</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>Nenhuma conta encontrada</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {safeAccounts.length === 0
                    ? 'Clique em "Adicionar conta" para conectar sua primeira conta via Meta API.'
                    : 'Tente ajustar o filtro ou a busca.'}
                </div>
              </div>
            )}

          </div>
        </div>

        {pagination && pagination.pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid rgba(51,65,85,.35)' }}>
            <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(51,65,85,.5)', background: 'transparent', color: '#94a3b8', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? .4 : 1 }} disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Anterior</button>
            <span style={{ fontSize: 12, color: '#64748b' }}>Página {pagination.page} de {pagination.pages} · {pagination.total} contas</span>
            <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(51,65,85,.5)', background: 'transparent', color: '#94a3b8', cursor: page >= pagination.pages ? 'default' : 'pointer', opacity: page >= pagination.pages ? .4 : 1 }} disabled={page >= pagination.pages} onClick={() => goToPage(page + 1)}>Próxima →</button>
          </div>
        )}
      </div>

      {/* OAuth Connect Modal */}
      {oauthModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>🔗 Conectar via Meta API</h3>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                  {oauthModal.account ? `@${oauthModal.account.username}` : 'Nova conta Instagram Business/Creator'}
                </div>
              </div>
              <button onClick={() => setOauthModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {/* Step 1 */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</span>
                Copie o link de autorização
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <div style={{ flex: 1, background: 'rgba(15,23,42,.8)', border: '1px solid rgba(51,65,85,.6)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#64748b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {oauthModal.url}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(oauthModal.url); showToast('success', 'Copiado!', 'Link de autorização copiado.'); }}
                  style={{ padding: '0 14px', borderRadius: 8, border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.15)', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📋 Copiar
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                Cole esse link no seu <strong style={{ color: '#94a3b8' }}>navegador isolado</strong> (Multilogin, Dolphin Anty, AdsPower, etc.) e autorize o aplicativo.
              </div>
            </div>

            {/* Step 2 */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
                Cole a URL de retorno
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                Após autorizar, a barra de endereços vai mostrar uma URL começando com <code style={{ background: 'rgba(51,65,85,.5)', padding: '1px 5px', borderRadius: 3 }}>localhost:3000</code>. Copie inteira e cole aqui:
              </div>
              <textarea
                value={pastedUrl}
                onChange={e => setPastedUrl(e.target.value)}
                placeholder="https://localhost:3000/api/oauth/callback?code=..."
                rows={3}
                style={{ width: '100%', background: 'rgba(15,23,42,.8)', border: `1px solid ${pastedUrl ? 'rgba(99,102,241,.5)' : 'rgba(51,65,85,.6)'}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#e2e8f0', outline: 'none', resize: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
                onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,.6)'}
                onBlur={e => e.target.style.borderColor = pastedUrl ? 'rgba(99,102,241,.5)' : 'rgba(51,65,85,.6)'}
              />
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => { setOauthModal(null); setPastedUrl(''); }}>Cancelar</button>
              <button
                className="btn btn-primary"
                onClick={submitPastedUrl}
                disabled={connectingPaste || !pastedUrl.trim()}
              >
                {connectingPaste ? 'Conectando...' : '✓ Conectar conta'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Proxy por conta */}
      {proxyModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(460px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>🌐 Proxy da conta</h3>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>@{proxyModal.username}</div>
              </div>
              <button onClick={() => setProxyModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
              As chamadas de API desta conta (health check, sync) sairão por este proxy — IP diferente por conta.
            </div>
            <input
              className="input"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
              placeholder="http://usuario:senha@host:porta"
              value={proxyValue}
              onChange={e => setProxyValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveProxy()}
              autoFocus
            />
            {proxyModal.proxy && (
              <div style={{ fontSize: 11, color: '#34d399', marginTop: 6 }}>✅ Proxy atual: {proxyModal.proxy}</div>
            )}
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => { setProxyValue(''); saveProxy(); }} disabled={savingProxy}>Remover proxy</button>
              <button className="btn btn-ghost" onClick={() => setProxyModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveProxy} disabled={savingProxy}>
                {savingProxy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proxies em massa */}
      {bulkProxyOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>🌐 Proxies em massa</h3>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>Distribui um proxy diferente por conta</div>
              </div>
              <button onClick={() => setBulkProxyOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ background: 'var(--card2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>Formato — um proxy por linha:</div>
              <pre style={{ margin: 0, fontSize: 12, color: 'var(--text1)', lineHeight: 1.6, fontFamily: 'monospace' }}>{`http://user1:pass1@host1:porta\nhttp://user2:pass2@host2:porta\nhttp://user3:pass3@host3:porta`}</pre>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
                Se tiver menos proxies que contas, eles são rotacionados. Se tiver o mesmo número, cada conta fica com o seu proxy exclusivo.
              </div>
            </div>

            <textarea
              className="txta"
              rows={8}
              style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 0 }}
              placeholder={'http://user1:pass1@host1:3128\nhttp://user2:pass2@host2:3128\n...'}
              value={bulkProxyText}
              onChange={e => setBulkProxyText(e.target.value)}
            />
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
              {bulkProxyText.trim()
                ? `${bulkProxyText.trim().split('\n').filter(Boolean).length} proxy(ies) · ${safeAccounts.length} conta(s)`
                : 'Cole os proxies acima.'}
            </div>

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setBulkProxyOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveBulkProxy} disabled={savingBulkProxy || !bulkProxyText.trim()}>
                {savingBulkProxy ? 'Aplicando...' : '✅ Aplicar proxies'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

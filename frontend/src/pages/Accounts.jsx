import { useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const avatarUrl = av => av ? (av.startsWith('http') ? `${API_BASE}/image-proxy?url=${encodeURIComponent(av)}` : `${API_BASE}${av}`) : null;

/* ── SVG icons ─────────────────────────────────────────────────────── */
const IcoUsers   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IcoShield  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>;
const IcoWarn    = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IcoTrend   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
const IcoGrid    = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
const IcoEye     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IcoPerson  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IcoSignal  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M10.28 16.17a6 6 0 0 1 3.44 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>;
const IcoCheck   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcoTrash   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const IcoSync    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const IcoLink    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
const IcoWave    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
const IcoWifi    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M10.28 16.17a6 6 0 0 1 3.44 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>;

export default function Accounts() {
  const ACCOUNTS_CACHE_KEY = 'instaflow_accounts_cache';

  const [accounts, setAccounts] = useState(() => {
    try { const c = localStorage.getItem(ACCOUNTS_CACHE_KEY); return c ? JSON.parse(c) : []; } catch { return []; }
  });
  const [toast,          setToast]          = useState(null);
  const [deleteModal,    setDeleteModal]    = useState(false);
  const [accountToDelete,setAccountToDelete]= useState(null);
  const [search,         setSearch]         = useState('');
  const [filter,         setFilter]         = useState('all');
  const [page,           setPage]           = useState(1);
  const [pagination,     setPagination]     = useState(null);
  const [oauthModal,     setOauthModal]     = useState(null);
  const [oauthWaiting,   setOauthWaiting]   = useState(false);
  const [callbackUrl,    setCallbackUrl]    = useState('');
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthError,     setOauthError]     = useState('');
  const [urlCopied,      setUrlCopied]      = useState(false);
  const [connecting,     setConnecting]     = useState({});
  const [proxyModal,     setProxyModal]     = useState(null);
  const [syncing,        setSyncing]        = useState(false);
  const oauthModalRef   = useRef(null);
  const oauthWaitingRef = useRef(false);
  oauthModalRef.current   = oauthModal;
  oauthWaitingRef.current = oauthWaiting;
  const [proxyValue,     setProxyValue]     = useState('');
  const [savingProxy,    setSavingProxy]    = useState(false);
  const [bulkProxyOpen,  setBulkProxyOpen]  = useState(false);
  const [bulkProxyText,  setBulkProxyText]  = useState('');
  const [savingBulkProxy,setSavingBulkProxy]= useState(false);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 4000); }

  async function loadAccounts(targetPage = page) {
    try {
      const res = await api.get(`/accounts?page=${targetPage}&limit=50`);
      const list = Array.isArray(res.data.accounts) ? res.data.accounts : [];
      setAccounts(list); setPagination(res.data.pagination || null);
      localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(list));
    } catch (err) { console.log('Erro ao carregar contas:', err.message); }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      await api.post('/accounts/sync-all').catch(() => {});
      await loadAccounts();
      showToast('success', 'Sincronizado!', 'Todas as contas foram sincronizadas.');
    } finally { setSyncing(false); }
  }

  function goToPage(p) { setPage(p); loadAccounts(p); }

  const loadRef = useRef(null);
  loadRef.current = loadAccounts;

  useServerEvents(['accounts', 'posts'], (data) => {
    loadRef.current?.();
    if (data?.action === 'oauth_connected' && oauthWaitingRef.current) {
      const modal = oauthModalRef.current;
      const isMatch = !modal?.account || modal?.account?._id === data.accountId;
      if (isMatch) {
        setOauthModal(null); setOauthWaiting(false);
        showToast('success', 'Conta conectada!', `@${data.username || ''} conectada via Meta API`);
      }
    }
  });
  useEffect(() => {
    loadRef.current?.();
    const t = setInterval(() => loadRef.current?.(), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    if (!oauth) return;
    if (oauth === 'success') { showToast('success', 'Conta conectada!', `@${params.get('username') || ''} adicionada via Meta API`); loadAccounts(); }
    else if (oauth === 'error') { showToast('error', 'Erro na conexão', params.get('msg') || 'Falha no OAuth'); }
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
      setOauthWaiting(false);
      setOauthModal({ account: account || null, url });
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
    finally { setConnecting(p => ({ ...p, [key]: false })); }
  }

  async function handleManualConnect() {
    if (!callbackUrl.trim()) return;
    setOauthConnecting(true);
    setOauthError('');
    try {
      const urlObj  = new URL(callbackUrl.trim());
      const state   = urlObj.searchParams.get('state') || oauthModal?.state || 'new';
      const res     = await api.post(`/oauth/connect/${state}`, { pastedUrl: callbackUrl.trim() });
      const username = res.data?.username || '';
      setOauthModal(null); setCallbackUrl(''); setOauthWaiting(false);
      showToast('success', 'Conta conectada!', `@${username} conectada via Meta API`);
      loadAccounts();
    } catch (err) {
      setOauthError(err.response?.data?.error || err.message || 'Falha ao conectar');
    } finally {
      setOauthConnecting(false);
    }
  }

  function openProxyModal(account) { setProxyModal(account); setProxyValue(account.proxy || ''); }

  async function saveProxy() {
    setSavingProxy(true);
    try {
      await api.patch(`/accounts/${proxyModal._id}/proxy`, { proxy: proxyValue.trim() });
      showToast('success', 'Proxy salvo', `@${proxyModal.username} — proxy atualizado.`);
      setProxyModal(null); loadAccounts();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
    finally { setSavingProxy(false); }
  }

  async function saveBulkProxy() {
    if (!bulkProxyText.trim()) return showToast('warning', 'Atenção', 'Cole pelo menos um proxy.');
    setSavingBulkProxy(true);
    try {
      const res = await api.post('/accounts/proxies/bulk-apply', { proxiesText: bulkProxyText.trim() });
      showToast('success', 'Proxies aplicados', res.data.message || `${res.data.applied} conta(s) atualizadas.`);
      setBulkProxyOpen(false); setBulkProxyText(''); loadAccounts();
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
    finally { setSavingBulkProxy(false); }
  }

  function deleteAccount(id) { setAccountToDelete(id); setDeleteModal(true); }
  async function confirmDelete() {
    try { await api.delete(`/accounts/${accountToDelete}`); await loadAccounts(); showToast('success', 'Conta removida', 'A conta foi excluída com sucesso.'); }
    catch { showToast('error', 'Erro', 'Não foi possível excluir a conta.'); }
    setDeleteModal(false); setAccountToDelete(null);
  }

  const safeAccounts    = Array.isArray(accounts) ? accounts : [];
  const totalFollowers  = safeAccounts.reduce((s, a) => s + Number(a.followers  || 0), 0);
  const totalPosts      = safeAccounts.reduce((s, a) => s + Number(a.postsCount || 0), 0);
  const activeAccounts  = safeAccounts.filter(a => !a.healthStatus || a.healthStatus === 'ativa').length;
  const errorAccounts   = safeAccounts.filter(a => ['restrita','banida','token_invalido','sessao_expirada','erro_login'].includes(a.healthStatus)).length;

  const countBy = s => safeAccounts.filter(a => a.healthStatus === s).length;
  const FILTERS = [
    { key: 'all',         label: 'Todas',          count: safeAccounts.length },
    { key: 'active',      label: 'Ativas',          count: activeAccounts },
    { key: 'restricted',  label: 'Restritas',       count: countBy('restrita') },
    { key: 'token',       label: 'Token expirado',  count: countBy('token_invalido') },
    { key: 'banned',      label: 'Banidas',         count: countBy('banida') },
    { key: 'error',       label: 'Com erro',        count: safeAccounts.filter(a => a.healthStatus === 'erro_login' || a.healthStatus === 'sessao_expirada').length },
    { key: 'offline',     label: 'Desconectadas',   count: countBy('desconectada') },
  ];

  const filteredAccounts = safeAccounts.filter(acc => {
    const q = search.toLowerCase();
    const match = acc.username?.toLowerCase().includes(q) || acc.name?.toLowerCase().includes(q);
    if (!match) return false;
    if (filter === 'active')     return !acc.healthStatus || acc.healthStatus === 'ativa';
    if (filter === 'restricted') return acc.healthStatus === 'restrita';
    if (filter === 'token')      return acc.healthStatus === 'token_invalido';
    if (filter === 'banned')     return acc.healthStatus === 'banida';
    if (filter === 'error')      return acc.healthStatus === 'erro_login' || acc.healthStatus === 'sessao_expirada';
    if (filter === 'offline')    return acc.healthStatus === 'desconectada';
    return true;
  });

  function fmt(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function fmtDateCompact(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function healthLabel(s) {
    if (s === 'restrita')        return 'Restrita';
    if (s === 'banida')          return 'Banida';
    if (s === 'token_invalido')  return 'Token expirado';
    if (s === 'sessao_expirada') return 'Sessão expirada';
    if (s === 'erro_login')      return 'Erro de login';
    if (s === 'desconectada')    return 'Desconectada';
    return 'Saudável';
  }
  function healthColor(s) {
    if (s === 'restrita')        return '#f59e0b';
    if (s === 'banida')          return '#ef4444';
    if (s === 'token_invalido')  return '#ef4444';
    if (s === 'sessao_expirada') return '#f59e0b';
    if (s === 'erro_login')      return '#ef4444';
    if (s === 'desconectada')    return '#64748b';
    return '#10b981';
  }

  /* ── stat cards config ────────────────────────────────────────────── */
  const STATS = [
    { label: 'CONECTADAS',  value: fmt(safeAccounts.length), color: '#6366f1', Icon: IcoUsers,  numColor: '#f1f5f9' },
    { label: 'SAUDÁVEIS',   value: fmt(activeAccounts),      color: '#06b6d4', Icon: IcoShield, numColor: '#f1f5f9' },
    { label: 'COM ERRO',    value: fmt(errorAccounts),       color: '#ef4444', Icon: IcoWarn,   numColor: '#f1f5f9' },
    { label: 'SEGUIDORES',  value: fmt(totalFollowers),      color: '#f59e0b', Icon: IcoTrend,  numColor: '#f59e0b' },
    { label: 'PUBLICAÇÕES', value: fmt(totalPosts),          color: '#f97316', Icon: IcoGrid,   numColor: '#f59e0b' },
  ];

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

      {/* ── Page header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#f1f5f9', letterSpacing: -0.5 }}>Contas Instagram</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Monitore perfis, sessões, saúde da conta e automações em tempo real.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={syncAll}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 9, border: '1px solid rgba(51,65,85,.55)', background: 'rgba(30,41,59,.6)', color: '#94a3b8', cursor: 'pointer' }}
          >
            <IcoSync /> {syncing ? 'Sincronizando...' : 'Sincronizar tudo'}
          </button>
          <button
            onClick={() => openOAuthConnect(null)}
            disabled={!!connecting['new']}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#06b6d4,#3b82f6)', color: '#fff', cursor: 'pointer', boxShadow: '0 0 18px rgba(6,182,212,.25)' }}
          >
            <IcoLink /> {connecting['new'] ? 'Aguarde...' : 'Conectar via API'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setBulkProxyOpen(true); setBulkProxyText(''); }} title="Proxies em massa">🌐</button>
        </div>
      </div>

      {/* ── 5 Stats ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {STATS.map(s => (
          <div key={s.label} style={{
            flex: '1 1 160px',
            background: 'rgba(15,22,36,.75)',
            border: `1px solid ${s.color}22`,
            borderRadius: 13,
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: `0 0 0 1px ${s.color}0d, 0 4px 20px ${s.color}0a`,
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '.8px', marginBottom: 6, textTransform: 'uppercase' }}>{s.label}</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: s.numColor, letterSpacing: -1, lineHeight: 1, fontFamily: 'var(--font-display,inherit)' }}>{s.value}</div>
            </div>
            <div style={{
              width: 42, height: 42, borderRadius: 11, flexShrink: 0,
              background: `color-mix(in srgb,${s.color} 14%,transparent)`,
              border: `1px solid color-mix(in srgb,${s.color} 28%,transparent)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: s.color,
            }}>
              <s.Icon />
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter tabs + search ──────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{
                fontSize: 12, fontWeight: 600,
                padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                background: active ? 'rgba(6,182,212,.15)' : 'rgba(30,41,59,.6)',
                color: active ? '#06b6d4' : '#64748b',
                outline: active ? '1px solid rgba(6,182,212,.4)' : '1px solid rgba(51,65,85,.4)',
                display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
              }}>
                {f.label}
                <span style={{
                  fontSize: 10, fontWeight: 800, minWidth: 16, textAlign: 'center',
                  background: active ? 'rgba(6,182,212,.25)' : 'rgba(255,255,255,.08)',
                  color: active ? '#06b6d4' : '#475569',
                  borderRadius: 20, padding: '1px 5px',
                }}>{f.count}</span>
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: 13 }}>🔍</span>
          <input
            style={{ background: 'rgba(20,30,50,.7)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 9, padding: '7px 13px 7px 30px', fontSize: 13, color: '#e2e8f0', outline: 'none', width: 210 }}
            placeholder="Buscar por @user ou nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Cards grid ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {filteredAccounts.map(account => {
          const hc          = healthColor(account.healthStatus);
          const hl          = healthLabel(account.healthStatus || 'ativa');
          const isConnecting = !!connecting[account._id];
          const needsRecon  = account.healthStatus === 'token_invalido' || account.healthStatus === 'sessao_expirada';
          const isHealthy   = !account.healthStatus || account.healthStatus === 'ativa';
          const compact     = fmtDateCompact(account.lastSync);
          const accType     = account.accountType?.toUpperCase() || 'CREATOR';

          return (
            <div key={account._id} style={{
              background: 'rgba(13,18,30,.9)',
              border: '1px solid rgba(51,65,85,.45)',
              borderRadius: 13,
              overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              transition: 'border-color .2s',
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(51,65,85,.8)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(51,65,85,.45)'}
            >
              {/* ── Card body ── */}
              <div style={{ padding: '13px 15px 11px' }}>
                {/* Avatar + name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  {/* Avatar */}
                  <div style={{ flexShrink: 0, position: 'relative' }}>
                    {account.avatar ? (
                      <img
                        src={avatarUrl(account.avatar)}
                        alt=""
                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${hc}55`, display: 'block' }}
                      />
                    ) : null}
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: 'linear-gradient(135deg,#6366f133,#8b5cf633)',
                      border: '2px solid #6366f133',
                      display: account.avatar ? 'none' : 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 17, fontWeight: 800, color: '#818cf8',
                    }}>
                      {account.username?.charAt(0)?.toUpperCase() || 'I'}
                    </div>
                  </div>

                  {/* Name / username / badges */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                        {account.name || account.username}
                      </span>
                      <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer" style={{ color: '#475569', fontSize: 11, textDecoration: 'none', lineHeight: 1, flexShrink: 0 }}>↗</a>
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>@{account.username}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px 2px 5px', borderRadius: 20,
                        background: `${hc}18`, color: hc, border: `1px solid ${hc}30`,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: hc, boxShadow: `0 0 4px ${hc}` }} />
                        {hl}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                        background: 'rgba(51,65,85,.5)', color: '#64748b', letterSpacing: '.4px',
                      }}>
                        {accType}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', paddingTop: 8, borderTop: '1px solid rgba(51,65,85,.3)' }}>
                  {[
                    { label: 'SEGUIDORES',  value: fmt(account.followers)  },
                    { label: 'SEGUINDO',    value: fmt(account.following)  },
                    { label: 'PUBLICAÇÕES', value: fmt(account.postsCount) },
                  ].map((s, i) => (
                    <div key={s.label} style={{
                      textAlign: 'center', padding: '8px 4px',
                      borderRight: i < 2 ? '1px solid rgba(51,65,85,.3)' : 'none',
                    }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#3d4f6a', letterSpacing: '.7px', marginBottom: 4, textTransform: 'uppercase' }}>{s.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0', letterSpacing: -0.5 }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Meta row ── */}
              <div style={{ height: 1, background: 'rgba(51,65,85,.3)' }} />
              <div style={{ padding: '7px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: isHealthy ? '#10b981' : '#f87171', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <IcoWifi />
                  {isHealthy ? 'API conectada' : 'API desconectada'}
                </span>
                <span style={{ fontSize: 11, color: '#3d4f6a', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <IcoWave />
                  {compact}
                </span>
              </div>

              {/* ── Actions ── */}
              <div style={{ height: 1, background: 'rgba(51,65,85,.3)' }} />
              <div style={{ padding: '8px 12px', display: 'flex', gap: 5, alignItems: 'center' }}>
                {/* Ver */}
                <a
                  href={`https://instagram.com/${account.username}`}
                  target="_blank" rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                    border: '1px solid rgba(51,65,85,.5)', color: '#64748b',
                    background: 'transparent', textDecoration: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  <IcoEye /> Ver
                </a>

                {/* Editar perfil */}
                <button
                  onClick={() => openOAuthConnect(account)}
                  disabled={isConnecting}
                  style={{
                    flex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8,
                    background: 'linear-gradient(135deg,rgba(6,182,212,.18),rgba(59,130,246,.18))',
                    color: '#06b6d4', border: '1px solid rgba(6,182,212,.35)',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  <IcoPerson /> {isConnecting ? '...' : 'Editar perfil'}
                </button>

                {/* HQ / Proxy */}
                <button
                  onClick={() => openProxyModal(account)}
                  title={account.proxy ? `Proxy: ${account.proxy}` : 'Configurar proxy'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                    background: account.proxy ? 'rgba(99,102,241,.12)' : 'rgba(30,41,59,.6)',
                    color: account.proxy ? '#818cf8' : '#475569',
                    border: `1px solid ${account.proxy ? 'rgba(99,102,241,.35)' : 'rgba(51,65,85,.4)'}`,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  <IcoSignal /> HQ ?
                </button>

                {/* API status */}
                <button
                  onClick={() => openOAuthConnect(account)}
                  disabled={isConnecting}
                  title={needsRecon ? 'Reconectar' : 'API conectada'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8,
                    background: needsRecon ? 'rgba(239,68,68,.12)' : 'rgba(16,185,129,.12)',
                    color: needsRecon ? '#f87171' : '#10b981',
                    border: `1px solid ${needsRecon ? 'rgba(239,68,68,.3)' : 'rgba(16,185,129,.3)'}`,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  <IcoCheck /> API
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteAccount(account._id)}
                  title="Excluir conta"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '6px 10px', borderRadius: 8, flexShrink: 0,
                    background: 'rgba(239,68,68,.1)', color: '#f87171',
                    border: '1px solid rgba(239,68,68,.25)', cursor: 'pointer',
                  }}
                >
                  <IcoTrash />
                </button>
              </div>
            </div>
          );
        })}

        {!filteredAccounts.length && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px', color: '#475569' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>👤</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>Nenhuma conta encontrada</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {safeAccounts.length === 0
                ? 'Clique em "Conectar via API" para adicionar sua primeira conta.'
                : 'Tente ajustar o filtro ou a busca.'}
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', marginTop: 6 }}>
          <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(51,65,85,.5)', background: 'transparent', color: '#94a3b8', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? .4 : 1 }} disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Anterior</button>
          <span style={{ fontSize: 12, color: '#64748b' }}>Página {pagination.page} de {pagination.pages} · {pagination.total} contas</span>
          <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(51,65,85,.5)', background: 'transparent', color: '#94a3b8', cursor: page >= pagination.pages ? 'default' : 'pointer', opacity: page >= pagination.pages ? .4 : 1 }} disabled={page >= pagination.pages} onClick={() => goToPage(page + 1)}>Próxima →</button>
        </div>
      )}

      {/* ── OAuth Modal ──────────────────────────────────────────── */}
      {oauthModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🔗</span> Conectar via Meta API
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                  {oauthModal.account ? `Reconectar @${oauthModal.account.username}` : 'Nova conta Instagram Business/Creator'}
                </div>
              </div>
              <button onClick={() => { setOauthModal(null); setOauthWaiting(false); setCallbackUrl(''); setOauthError(''); setUrlCopied(false); }} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* Step 1 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--cyan)', color: '#000', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</div>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Copie o link de autorização</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {oauthModal.url}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(oauthModal.url);
                    setUrlCopied(true);
                    setTimeout(() => setUrlCopied(false), 2500);
                  }}
                  style={{
                    padding: '0 16px', borderRadius: 9, border: `1px solid ${urlCopied ? 'rgba(52,211,153,.5)' : 'rgba(0,212,255,.35)'}`,
                    background: urlCopied ? 'rgba(52,211,153,.15)' : 'rgba(0,212,255,.1)',
                    color: urlCopied ? '#34d399' : 'var(--cyan)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'all .2s',
                  }}
                >
                  {urlCopied ? '✓ Copiado!' : '📋 Copiar'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8, lineHeight: 1.6 }}>
                Cole esse link no seu <strong style={{ color: 'var(--text2)' }}>navegador isolado</strong> (Dolphin Anty, AdsPower, etc.) e autorize o aplicativo.
              </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)', marginBottom: 20 }} />

            {/* Step 2 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,212,255,.15)', border: '1px solid rgba(0,212,255,.3)', color: 'var(--cyan)', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</div>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Cole a URL de retorno</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.6 }}>
                Após autorizar, a barra de endereços vai mostrar uma URL começando com{' '}
                <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4, color: 'var(--cyan)', fontSize: 11 }}>localhost:3000</code>.
                Copie inteira e cole aqui:
              </div>
              <textarea
                value={callbackUrl}
                onChange={e => { setCallbackUrl(e.target.value); setOauthError(''); }}
                placeholder="https://localhost:3000/api/oauth/callback?code=..."
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                  borderRadius: 9, border: `1px solid ${oauthError ? 'rgba(239,68,68,.5)' : 'var(--border)'}`,
                  background: 'var(--bg3)', color: 'var(--text)', fontSize: 12,
                  fontFamily: 'monospace', resize: 'none', lineHeight: 1.5, outline: 'none',
                }}
              />
              {oauthError && <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>⚠️ {oauthError}</div>}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => { setOauthModal(null); setOauthWaiting(false); setCallbackUrl(''); setOauthError(''); setUrlCopied(false); }}
                style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleManualConnect}
                disabled={!callbackUrl.trim() || oauthConnecting}
                style={{ padding: '9px 22px', borderRadius: 9, border: 'none', background: callbackUrl.trim() ? 'var(--cyan)' : 'var(--bg3)', color: callbackUrl.trim() ? '#000' : 'var(--text3)', fontSize: 13, fontWeight: 700, cursor: callbackUrl.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7 }}
              >
                {oauthConnecting
                  ? <><span style={{ width:14, height:14, border:'2px solid rgba(0,0,0,.3)', borderTopColor:'#000', borderRadius:'50%', display:'inline-block', animation:'spin .7s linear infinite' }} /> Conectando...</>
                  : '✓ Conectar conta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Proxy Modal ──────────────────────────────────────────── */}
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
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>As chamadas de API desta conta sairão por este proxy — IP diferente por conta.</div>
            <input className="input" style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} placeholder="http://usuario:senha@host:porta" value={proxyValue} onChange={e => setProxyValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveProxy()} autoFocus />
            {proxyModal.proxy && <div style={{ fontSize: 11, color: '#34d399', marginTop: 6 }}>✅ Proxy atual: {proxyModal.proxy}</div>}
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => { setProxyValue(''); saveProxy(); }} disabled={savingProxy}>Remover proxy</button>
              <button className="btn btn-ghost" onClick={() => setProxyModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveProxy} disabled={savingProxy}>{savingProxy ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Proxy Modal ─────────────────────────────────────── */}
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
              <pre style={{ margin: 0, fontSize: 12, color: 'var(--text1)', lineHeight: 1.6, fontFamily: 'monospace' }}>{`http://user1:pass1@host1:porta\nhttp://user2:pass2@host2:porta`}</pre>
            </div>
            <textarea className="txta" rows={8} style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 0 }} placeholder={'http://user1:pass1@host1:3128\n...'} value={bulkProxyText} onChange={e => setBulkProxyText(e.target.value)} />
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{bulkProxyText.trim() ? `${bulkProxyText.trim().split('\n').filter(Boolean).length} proxy(ies) · ${safeAccounts.length} conta(s)` : 'Cole os proxies acima.'}</div>
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setBulkProxyOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveBulkProxy} disabled={savingBulkProxy || !bulkProxyText.trim()}>{savingBulkProxy ? 'Aplicando...' : '✅ Aplicar proxies'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

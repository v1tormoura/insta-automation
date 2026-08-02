import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import PageShell from '../components/PageShell';


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
  const [tokenValue,     setTokenValue]     = useState('');
  const [tokenConnecting,setTokenConnecting]= useState(false);
  const [tokenError,     setTokenError]     = useState('');
  const [metaApps,       setMetaApps]       = useState([]);
  const [selectedAppId,  setSelectedAppId]  = useState('');
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

  async function loadMetaApps() {
    try {
      const res = await api.get('/meta-apps');
      setMetaApps(res.data || []);
      const def = res.data?.find(a => a.isDefault);
      if (def) setSelectedAppId(def._id);
    } catch { /* silencioso — apps opcionais */ }
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
    loadMetaApps();
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
      const params = { ...(account?._id ? { accountId: account._id } : {}), ...(selectedAppId ? { metaAppId: selectedAppId } : {}) };
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

  async function handleTokenConnect() {
    if (!tokenValue.trim()) return;
    setTokenConnecting(true);
    setTokenError('');
    try {
      const res = await api.post('/oauth/connect-by-token', {
        token: tokenValue.trim(),
        accountId: oauthModal?.account?._id || 'new',
      });
      const username = res.data?.username || '';
      setOauthModal(null); setTokenValue(''); setCallbackUrl(''); setOauthWaiting(false);
      showToast('success', 'Conta conectada!', `@${username} conectada via token`);
      loadAccounts();
    } catch (err) {
      setTokenError(err.response?.data?.error || err.message || 'Token inválido');
    } finally {
      setTokenConnecting(false);
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

  /* ── health helpers ── */
  const hBg    = s => ({ ativa:'rgba(16,185,129,.09)', restrita:'rgba(245,158,11,.09)', banida:'rgba(244,63,94,.09)', token_invalido:'rgba(244,63,94,.09)', sessao_expirada:'rgba(245,158,11,.09)', erro_login:'rgba(244,63,94,.09)', desconectada:'rgba(100,116,139,.09)' }[s] || 'rgba(16,185,129,.09)');
  const hBorder= s => ({ ativa:'rgba(16,185,129,.25)', restrita:'rgba(245,158,11,.25)', banida:'rgba(244,63,94,.25)', token_invalido:'rgba(244,63,94,.25)', sessao_expirada:'rgba(245,158,11,.25)', erro_login:'rgba(244,63,94,.25)', desconectada:'rgba(100,116,139,.2)' }[s] || 'rgba(16,185,129,.25)');

  const STAT_DEFS = [
    { label:'CONECTADAS',  value:fmt(safeAccounts.length), color:'var(--purple)',  bg:'rgba(139,92,246,.09)',  border:'rgba(139,92,246,.18)',  Icon:IcoUsers  },
    { label:'SAUDÁVEIS',   value:fmt(activeAccounts),      color:'var(--cyan)',    bg:'rgba(0,212,255,.09)',   border:'rgba(0,212,255,.18)',   Icon:IcoShield },
    { label:'COM ERRO',    value:fmt(errorAccounts),       color:'var(--red)',     bg:'rgba(244,63,94,.09)',   border:'rgba(244,63,94,.18)',   Icon:IcoWarn   },
    { label:'SEGUIDORES',  value:fmt(totalFollowers),      color:'var(--amber)',   bg:'rgba(245,158,11,.09)',  border:'rgba(245,158,11,.18)',  Icon:IcoTrend  },
    { label:'PUBLICAÇÕES', value:fmt(totalPosts),          color:'var(--orange)',  bg:'rgba(249,115,22,.09)',  border:'rgba(249,115,22,.18)',  Icon:IcoGrid   },
  ];

  const PageIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );

  return (
    <>
      {toast && <Toast type={toast.type} title={toast.title} message={toast.message} />}
      <ConfirmModal
        open={deleteModal}
        title="Excluir conta"
        message="Tem certeza que deseja excluir esta conta? Esta ação não pode ser desfeita."
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteModal(false); setAccountToDelete(null); }}
      />

      <PageShell
        icon={<PageIcon />}
        title="Contas Instagram"
        subtitle="Monitore perfis, sessões, saúde e automações em tempo real"
        accent="cyan"
        actions={
          <>
            <button onClick={() => { setBulkProxyOpen(true); setBulkProxyText(''); }} className="btn-ghost" style={{ padding:'7px 12px', fontSize:12 }}>
              <IcoSignal /> Proxies em massa
            </button>
            <button onClick={syncAll} disabled={syncing} className="btn-ghost" style={{ padding:'7px 14px', fontSize:12 }}>
              <IcoSync /> {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
            <button onClick={() => openOAuthConnect(null)} disabled={!!connecting['new']} className="btn-primary" style={{ fontSize:13 }}>
              <IcoLink /> {connecting['new'] ? 'Aguarde...' : 'Conectar via API'}
            </button>
          </>
        }
      >
        {/* ── 5 stat cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
          {STAT_DEFS.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*.05, duration:.28 }}
              style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:14, padding:'14px 16px', position:'relative', overflow:'hidden' }}
            >
              <div style={{ position:'absolute', bottom:-12, right:-8, width:52, height:52, borderRadius:'50%', background:`${s.bg}`, boxShadow:`0 0 24px ${s.border}` }} />
              <s.Icon />
              <div style={{ fontSize:28, fontWeight:800, color:s.color, lineHeight:1, letterSpacing:'-1.5px', fontVariantNumeric:'tabular-nums', marginTop:10 }}>{s.value}</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:`${s.color}`, opacity:.65, marginTop:5, letterSpacing:'.07em', textTransform:'uppercase' }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* ── Filters + search ── */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            {FILTERS.map(f => {
              const active = filter === f.key;
              return (
                <button key={f.key} onClick={() => setFilter(f.key)} style={{
                  fontSize:12, fontWeight:600, padding:'6px 13px', borderRadius:20, cursor:'pointer', whiteSpace:'nowrap',
                  display:'flex', alignItems:'center', gap:6, transition:'all .15s',
                  background: active ? 'rgba(0,212,255,.12)' : 'oklch(1 0 0 / 0.04)',
                  color:       active ? 'var(--cyan)'        : 'var(--text3)',
                  border:      active ? '1px solid rgba(0,212,255,.3)' : '1px solid oklch(1 0 0 / 0.08)',
                }}>
                  {f.label}
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:20,
                    background: active ? 'rgba(0,212,255,.2)' : 'oklch(1 0 0 / 0.06)',
                    color: active ? 'var(--cyan)' : 'var(--text3)',
                  }}>{f.count}</span>
                </button>
              );
            })}
          </div>
          <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position:'absolute', left:10, color:'var(--text3)', pointerEvents:'none' }}>
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              style={{ background:'oklch(1 0 0 / 0.04)', border:'1px solid oklch(1 0 0 / 0.09)', borderRadius:9, padding:'7px 13px 7px 30px', fontSize:13, color:'var(--text)', outline:'none', width:220, transition:'border-color .18s', fontFamily:'var(--font)' }}
              placeholder="Buscar conta..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={e => e.target.style.borderColor='rgba(0,212,255,.35)'}
              onBlur={e => e.target.style.borderColor='oklch(1 0 0 / 0.09)'}
            />
          </div>
        </div>

        {/* ── Account cards grid ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(290px,1fr))', gap:12 }}>
          {filteredAccounts.map((account, idx) => {
            const hc          = healthColor(account.healthStatus);
            const hl          = healthLabel(account.healthStatus || 'ativa');
            const isConnecting = !!connecting[account._id];
            const needsRecon  = account.healthStatus === 'token_invalido' || account.healthStatus === 'sessao_expirada';
            const isHealthy   = !account.healthStatus || account.healthStatus === 'ativa';
            const compact     = fmtDateCompact(account.lastSync);
            const accType     = account.accountType?.toUpperCase() || 'CREATOR';
            const cardBg      = hBg(account.healthStatus);
            const cardBorder  = hBorder(account.healthStatus);

            return (
              <motion.div key={account._id} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:idx*.03, duration:.25 }}
                style={{
                  background:`oklch(0.16 0.05 235 / 0.92)`,
                  border:`1px solid oklch(1 0 0 / 0.09)`,
                  borderLeft:`3px solid ${hc}`,
                  borderRadius:14, overflow:'hidden',
                  display:'flex', flexDirection:'column',
                  transition:'transform .2s, box-shadow .2s, border-color .2s',
                }}
                whileHover={{ y:-2, boxShadow:`0 8px 32px rgba(0,0,0,.4), 0 0 0 1px ${hc}22` }}
              >
                {/* top line */}
                <div style={{ position:'absolute', top:0, left:16, right:16, height:1, background:`linear-gradient(90deg,transparent,${hc}30,transparent)` }} />

                {/* body */}
                <div style={{ padding:'13px 14px 11px' }}>
                  {/* avatar + name */}
                  <div style={{ display:'flex', alignItems:'center', gap:11, marginBottom:11 }}>
                    <div style={{ flexShrink:0, position:'relative' }}>
                      {account.avatar
                        ? <img src={avatarUrl(account.avatar)} alt="" onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}
                            style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover', border:`2px solid ${hc}55`, display:'block' }} />
                        : null}
                      <div style={{ width:44, height:44, borderRadius:'50%', background:`linear-gradient(135deg,${hc}22,${hc}11)`, border:`2px solid ${hc}33`,
                        display:account.avatar?'none':'flex', alignItems:'center', justifyContent:'center', fontSize:17, fontWeight:800, color:hc }}>
                        {account.username?.charAt(0)?.toUpperCase() || 'I'}
                      </div>
                      {/* status dot */}
                      <span style={{ position:'absolute', bottom:1, right:1, width:9, height:9, borderRadius:'50%', background:hc, border:'2px solid oklch(0.16 0.05 235)', boxShadow:`0 0 6px ${hc}` }} />
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span style={{ fontWeight:700, fontSize:13, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:140 }}>{account.name || account.username}</span>
                        <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer" style={{ color:'var(--text3)', fontSize:10, textDecoration:'none', flexShrink:0, lineHeight:1 }}>↗</a>
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', marginTop:1 }}>@{account.username}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:5 }}>
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px 2px 5px', borderRadius:20,
                          background:`${hc}15`, color:hc, border:`1px solid ${hc}28`,
                          display:'inline-flex', alignItems:'center', gap:4 }}>
                          <span style={{ width:5, height:5, borderRadius:'50%', background:hc, boxShadow:`0 0 5px ${hc}` }} />
                          {hl}
                        </span>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'oklch(1 0 0 / 0.05)', color:'var(--text3)', letterSpacing:'.5px' }}>{accType}</span>
                      </div>
                    </div>
                  </div>

                  {/* mini stats */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', borderTop:'1px solid oklch(1 0 0 / 0.06)', paddingTop:9 }}>
                    {[
                      { label:'SEGUIDORES',  value:fmt(account.followers)  },
                      { label:'SEGUINDO',    value:fmt(account.following)  },
                      { label:'POSTS',       value:fmt(account.postsCount) },
                    ].map((s, i) => (
                      <div key={s.label} style={{ textAlign:'center', padding:'6px 4px', borderRight:i<2?'1px solid oklch(1 0 0 / 0.06)':'none' }}>
                        <div style={{ fontFamily:'var(--font-mono)', fontSize:8, fontWeight:700, color:'var(--text3)', letterSpacing:'.8px', marginBottom:3, textTransform:'uppercase' }}>{s.label}</div>
                        <div style={{ fontSize:16, fontWeight:800, color:'var(--text)', letterSpacing:'-0.5px', fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* meta row */}
                <div style={{ height:1, background:'oklch(1 0 0 / 0.06)' }} />
                <div style={{ padding:'6px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:isHealthy?'var(--green)':'#f87171', display:'flex', alignItems:'center', gap:5 }}>
                    <IcoWifi /> {isHealthy ? 'API conectada' : 'API desconectada'}
                  </span>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', display:'flex', alignItems:'center', gap:4 }}>
                    <IcoWave /> {compact}
                  </span>
                </div>

                {/* actions */}
                <div style={{ height:1, background:'oklch(1 0 0 / 0.06)' }} />
                <div style={{ padding:'8px 10px', display:'flex', gap:5, alignItems:'center' }}>
                  <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, padding:'6px 10px', borderRadius:8, border:'1px solid oklch(1 0 0 / 0.09)', color:'var(--text3)', background:'transparent', textDecoration:'none', whiteSpace:'nowrap', transition:'all .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.color='var(--text)'; e.currentTarget.style.borderColor='oklch(1 0 0 / 0.16)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='oklch(1 0 0 / 0.09)'; }}
                  ><IcoEye /> Ver</a>

                  <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                    style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:12, fontWeight:700, padding:'6px 10px', borderRadius:8,
                      background:'rgba(0,212,255,.1)', color:'var(--cyan)', border:'1px solid rgba(0,212,255,.25)', cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(0,212,255,.16)'}
                    onMouseLeave={e => e.currentTarget.style.background='rgba(0,212,255,.1)'}
                  ><IcoPerson /> {isConnecting ? '...' : 'Editar perfil'}</button>

                  <button onClick={() => openProxyModal(account)} title={account.proxy ? `Proxy: ${account.proxy}` : 'Configurar proxy'}
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, padding:'6px 10px', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s',
                      background: account.proxy ? 'rgba(139,92,246,.12)' : 'oklch(1 0 0 / 0.04)',
                      color:      account.proxy ? 'var(--purple)'         : 'var(--text3)',
                      border:     account.proxy ? '1px solid rgba(139,92,246,.28)' : '1px solid oklch(1 0 0 / 0.08)',
                    }}
                  ><IcoSignal /> Proxy</button>

                  <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                    title={needsRecon ? 'Reconectar' : 'API ok'}
                    style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, fontWeight:700, padding:'6px 10px', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s',
                      background: needsRecon ? 'rgba(244,63,94,.12)' : 'rgba(16,185,129,.1)',
                      color:      needsRecon ? 'var(--red)'           : 'var(--green)',
                      border:     needsRecon ? '1px solid rgba(244,63,94,.28)' : '1px solid rgba(16,185,129,.25)',
                    }}
                  ><IcoCheck /> API</button>

                  <button onClick={() => deleteAccount(account._id)} title="Excluir conta"
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'6px 10px', borderRadius:8, flexShrink:0,
                      background:'rgba(244,63,94,.08)', color:'var(--red)', border:'1px solid rgba(244,63,94,.2)', cursor:'pointer', transition:'all .15s' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(244,63,94,.16)'}
                    onMouseLeave={e => e.currentTarget.style.background='rgba(244,63,94,.08)'}
                  ><IcoTrash /></button>
                </div>
              </motion.div>
            );
          })}

          {!filteredAccounts.length && (
            <div style={{ gridColumn:'1 / -1', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 20px', color:'var(--text3)', gap:12 }}>
              <div style={{ width:56, height:56, borderRadius:16, background:'oklch(1 0 0 / 0.04)', border:'1px solid oklch(1 0 0 / 0.08)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <IcoUsers />
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--text2)' }}>Nenhuma conta encontrada</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text3)', textAlign:'center' }}>
                {safeAccounts.length === 0 ? 'Clique em "Conectar via API" para adicionar sua primeira conta.' : 'Ajuste o filtro ou a busca.'}
              </div>
              {safeAccounts.length === 0 && (
                <button onClick={() => openOAuthConnect(null)} className="btn-primary" style={{ marginTop:4 }}>
                  <IcoLink /> Conectar primeira conta
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 0' }}>
            <button className="btn-ghost" style={{ fontSize:12, padding:'6px 14px', opacity:page<=1?.4:1 }} disabled={page<=1} onClick={() => goToPage(page-1)}>← Anterior</button>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text3)' }}>Página {pagination.page} de {pagination.pages} · {pagination.total} contas</span>
            <button className="btn-ghost" style={{ fontSize:12, padding:'6px 14px', opacity:page>=pagination.pages?.4:1 }} disabled={page>=pagination.pages} onClick={() => goToPage(page+1)}>Próxima →</button>
          </div>
        )}

      </PageShell>

      {/* ── OAuth Modal ──────────────────────────────────────────── */}
      {oauthModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Conectar via Meta API
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                  {oauthModal.account ? `Reconectar @${oauthModal.account.username}` : 'Nova conta Instagram Business/Creator'}
                </div>
              </div>
              <button onClick={() => { setOauthModal(null); setOauthWaiting(false); setCallbackUrl(''); setOauthError(''); setUrlCopied(false); setTokenValue(''); setTokenError(''); }} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* ── Seletor de App Meta (só aparece se há >1 app) ── */}
            {metaApps.length > 1 && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: .5, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>App Meta a usar</label>
                <select
                  value={selectedAppId}
                  onChange={e => setSelectedAppId(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">— Padrão do servidor (env vars) —</option>
                  {metaApps.map(a => (
                    <option key={a._id} value={a._id}>{a.name}{a.isDefault ? ' ★' : ''} — {a.appId}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Conexão rápida por token ── */}
            <div style={{ background:'rgba(0,212,255,.05)', border:'1px solid rgba(0,212,255,.18)', borderRadius:12, padding:'16px 18px', marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>Conexão rápida por token</span>
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'rgba(0,212,255,.12)', color:'var(--cyan)', letterSpacing:.5 }}>RECOMENDADO</span>
              </div>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10, lineHeight:1.6 }}>
                Cole seu token <strong style={{ color:'var(--text2)' }}>IGAA</strong> abaixo. Obtenha-o em{' '}
                <strong style={{ color:'var(--text2)' }}>Meta → Instagram → Gerar tokens de acesso</strong>.
              </div>
              <textarea
                value={tokenValue}
                onChange={e => { setTokenValue(e.target.value); setTokenError(''); }}
                placeholder="IGAA_xxx..."
                rows={2}
                style={{
                  width:'100%', boxSizing:'border-box', padding:'10px 12px',
                  borderRadius:9, border:`1px solid ${tokenError ? 'rgba(239,68,68,.5)' : 'rgba(0,212,255,.2)'}`,
                  background:'var(--bg3)', color:'var(--text)', fontSize:12,
                  fontFamily:'monospace', resize:'none', lineHeight:1.5, outline:'none',
                }}
              />
              {tokenError && <div style={{ fontSize:12, color:'#f87171', marginTop:6 }}>{tokenError}</div>}
              <button
                onClick={handleTokenConnect}
                disabled={!tokenValue.trim() || tokenConnecting}
                style={{
                  marginTop:10, width:'100%', padding:'10px', borderRadius:9, border:'none',
                  background: tokenValue.trim() ? 'var(--cyan)' : 'var(--bg3)',
                  color: tokenValue.trim() ? '#000' : 'var(--text3)',
                  fontSize:13, fontWeight:700, cursor: tokenValue.trim() ? 'pointer' : 'not-allowed',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                  transition:'all .2s',
                }}
              >
                {tokenConnecting
                  ? <><span style={{ width:14, height:14, border:'2px solid rgba(0,0,0,.3)', borderTopColor:'#000', borderRadius:'50%', display:'inline-block', animation:'spin .7s linear infinite' }} /> Verificando token...</>
                  : '⚡ Conectar com token'}
              </button>
            </div>

            {/* OU VIA LINK OAUTH */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <div style={{ flex:1, height:1, background:'var(--border)' }} />
              <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', letterSpacing:1 }}>OU VIA LINK OAUTH</span>
              <div style={{ flex:1, height:1, background:'var(--border)' }} />
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
                  {urlCopied
                    ? '✓ Copiado!'
                    : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar</>
                  }
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
              {oauthError && <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{oauthError}</div>}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => { setOauthModal(null); setOauthWaiting(false); setCallbackUrl(''); setOauthError(''); setUrlCopied(false); setTokenValue(''); setTokenError(''); }}
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
            {proxyModal.proxy && <div style={{ fontSize: 11, color: '#34d399', marginTop: 6 }}>Proxy atual: {proxyModal.proxy}</div>}
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
              <button className="btn btn-primary" onClick={saveBulkProxy} disabled={savingBulkProxy || !bulkProxyText.trim()}>{savingBulkProxy ? 'Aplicando...' : 'Aplicar proxies'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

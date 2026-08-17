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
const IcoPhone   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>;
const IcoGlobe   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;

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
  const [proxyUrl,       setProxyUrl]       = useState('');
  // Estado do proxy global — `ok` e `ip` vêm do monitoramento contínuo do servidor.
  const [proxyStatus,    setProxyStatus]    = useState({
    ativo: false, ok: false, ip: null, erro: null, lastCheck: null, testando: false, salvando: false,
  });
  const [ipDireto,       setIpDireto]       = useState(null);
  // Teste do proxy dentro do modal de uma conta específica.
  const [proxyTest,      setProxyTest]      = useState({ testando: false, ip: null, erro: null });
  const oauthModalRef   = useRef(null);
  const oauthWaitingRef = useRef(false);
  oauthModalRef.current   = oauthModal;
  oauthWaitingRef.current = oauthWaiting;
  const [proxyValue,     setProxyValue]     = useState('');
  const [savingProxy,    setSavingProxy]    = useState(false);
  const [bulkProxyOpen,  setBulkProxyOpen]  = useState(false);
  const [bulkProxyText,  setBulkProxyText]  = useState('');
  const [savingBulkProxy,setSavingBulkProxy]= useState(false);
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [selectMode,     setSelectMode]     = useState(false);
  const [bulkDeleteModal,setBulkDeleteModal]= useState(false);
  const [bulkDeleting,   setBulkDeleting]   = useState(false);
  const [instaModal,     setInstaModal]     = useState(null);
  const [rateLimitExpiry, setRateLimitExpiry] = useState(null);
  const [cooldownSecs,    setCooldownSecs]    = useState(0);

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

  /* ── Proxy global ─────────────────────────────────────────────────────
     O status vem do servidor, que testa o proxy continuamente em background
     (job proxyHealthCheck). A página só espelha o resultado — assim o card
     mostra o mesmo estado em qualquer navegador, mesmo com a aba fechada. */

  async function carregarStatusProxy({ silencioso = true } = {}) {
    try {
      const { data } = await api.get('/proxy/status');
      setProxyStatus(s => ({
        ...s,
        ativo:     !!data.ativo,
        ok:        !!data.ok,
        ip:        data.ip || null,
        erro:      data.error || null,
        lastCheck: data.lastCheck || null,
      }));
      if (data.proxy_url) setProxyUrl(prev => (prev.trim() ? prev : data.proxy_url));
    } catch (err) {
      if (!silencioso) showToast('error', 'Erro', 'Não foi possível ler o status do proxy');
    }
  }

  const testarProxyGlobal = async () => {
    if (!proxyUrl.trim()) return showToast('error', 'Erro', 'URL de proxy obrigatória');
    setProxyStatus(s => ({ ...s, testando: true, erro: null }));
    try {
      const { data } = await api.post('/proxy/test', { proxy_url: proxyUrl.trim() });
      setProxyStatus(s => ({ ...s, ip: data.ip, ok: true, erro: null, lastCheck: new Date().toISOString() }));
      showToast('success', 'Proxy OK', `IP de saída: ${data.ip} (${data.latencyMs} ms)`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setProxyStatus(s => ({ ...s, ok: false, erro: msg }));
      showToast('error', 'Proxy falhou', msg);
    } finally {
      setProxyStatus(s => ({ ...s, testando: false }));
    }
  };

  const ativarProxyGlobal = async () => {
    if (!proxyUrl.trim()) return showToast('error', 'Erro', 'URL obrigatória');
    setProxyStatus(s => ({ ...s, salvando: true }));
    try {
      const { data } = await api.post('/proxy/configure', { proxy_url: proxyUrl.trim() });
      setProxyStatus(s => ({ ...s, ativo: true, ok: true, ip: data.ip, erro: null, lastCheck: new Date().toISOString() }));
      showToast('success', 'Proxy ativado', `Toda a automação sai por ${data.ip}`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setProxyStatus(s => ({ ...s, erro: msg }));
      showToast('error', 'Não foi possível ativar', msg);
    } finally {
      setProxyStatus(s => ({ ...s, salvando: false }));
    }
  };

  const desativarProxyGlobal = async () => {
    setProxyStatus(s => ({ ...s, salvando: true }));
    try {
      await api.post('/proxy/configure', { action: 'desativar' });
      setProxyStatus(s => ({ ...s, ativo: false, ok: false, ip: null, erro: null }));
      setProxyUrl('');
      showToast('success', 'Proxy desativado', 'A automação voltou a sair pelo IP do servidor');
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || err.message);
    } finally {
      setProxyStatus(s => ({ ...s, salvando: false }));
    }
  };

  /* ── Proxy por conta ──────────────────────────────────────────────── */

  async function testarProxyConta() {
    if (!proxyModal) return;
    const url = proxyValue.trim();
    if (!url) return setProxyTest({ testando: false, ip: null, erro: 'Informe a URL do proxy' });

    setProxyTest({ testando: true, ip: null, erro: null });
    try {
      // Salva antes de testar para que o teste rode contra o proxy que a conta
      // vai realmente usar — e o resultado já fique gravado no card.
      await api.patch(`/accounts/${proxyModal._id}/proxy`, { proxy: url });
      const { data } = await api.post(`/accounts/${proxyModal._id}/proxy/test`);
      if (data.ok) {
        setProxyTest({ testando: false, ip: data.ip, erro: null });
        setProxyModal(m => (m ? { ...m, proxy: url } : m));
        showToast('success', 'Proxy OK', `@${proxyModal.username} sai por ${data.ip}`);
      } else {
        setProxyTest({ testando: false, ip: null, erro: data.error || 'Proxy não respondeu' });
      }
      loadAccounts();
    } catch (err) {
      setProxyTest({ testando: false, ip: null, erro: err.response?.data?.error || err.message });
    }
  }

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

  // Status do proxy global ao vivo — espelha o monitoramento do servidor.
  useEffect(() => {
    carregarStatusProxy();
    api.get('/proxy/ip-direto').then(({ data }) => setIpDireto(data.ip || null)).catch(() => {});
    const t = setInterval(carregarStatusProxy, 15_000);
    return () => clearInterval(t);
  }, []);

  // Countdown tick for rate-limit cooldown
  useEffect(() => {
    if (!rateLimitExpiry) return;
    const tick = () => {
      const rem = Math.ceil((rateLimitExpiry - Date.now()) / 1000);
      if (rem <= 0) {
        setCooldownSecs(0);
        setRateLimitExpiry(null);
      } else {
        setCooldownSecs(rem);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [rateLimitExpiry]);

  // Restore cooldown from localStorage when username changes in modal
  useEffect(() => {
    const uname = instaModal?.username?.trim().replace(/^@/, '') || '';
    if (!uname) { setCooldownSecs(0); setRateLimitExpiry(null); return; }
    try {
      const exp = Number(localStorage.getItem(`ig_rl_${uname}`) || '0');
      if (exp > Date.now()) setRateLimitExpiry(exp);
      else { setRateLimitExpiry(null); setCooldownSecs(0); }
    } catch { /* localStorage unavailable */ }
  }, [instaModal?.username]);

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

  function openProxyModal(account) {
    setProxyModal(account);
    setProxyValue(account.proxy || '');
    setProxyTest({ testando: false, ip: null, erro: null });
  }

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

  // instaModal state shape:
  // { step: 'credentials'|'two_factor', loginMethod: 'password'|'sessionid',
  //   accountId, username, password, sessionid, totp, loading, error, status }

  function openInstaModal(account) {
    setInstaModal({
      step:        'credentials',
      loginMethod: 'password',
      accountId:   account?._id || account?.id || null,
      username:    account?.username || '',
      password:    '',
      sessionid:   '',
      totp:        '',
      loading:     false,
      error:       '',
      status:      null,
    });
  }

  const INSTA_MESSAGES = {
    RATE_LIMITED:                   'Instagram bloqueou temporariamente este IP. Aguarde antes de tentar novamente.',
    CHALLENGE_REQUIRED:             'O Instagram requer verificação adicional. Acesse o app oficial e resolva o desafio, depois tente novamente.',
    TWO_FACTOR_REQUIRED:            'Digite o código enviado pelo seu método de autenticação.',
    BAD_PASSWORD:                   'Usuário ou senha incorretos.',
    USER_NOT_FOUND:                 'O Instagram não encontrou nenhuma conta com esse @. Confira o nome de usuário exatamente como aparece no perfil — ou tente o e-mail cadastrado.',
    SESSION_EXPIRED:                'Sessão expirada — faça login novamente.',
    FEEDBACK_REQUIRED:              'Instagram bloqueou temporariamente esta ação. Tente mais tarde.',
    INSTAGRAPI_SERVICE_UNAVAILABLE: 'Serviço temporariamente indisponível. Tente em instantes.',
    SESSION_LOCKED:                 'Já existe uma operação em andamento para esta conta. Aguarde.',
    NO_PENDING_2FA:                 'Sessão 2FA expirada. Faça o login novamente.',
    TIMEOUT:                        'Tempo de conexão esgotado. Tente novamente.',
    PROXY_ERROR:                    'Erro de proxy — verifique se o proxy está ativo e funcionando.',
    NETWORK_ERROR:                  'Erro de rede entre o servidor e o Instagram. Tente em instantes.',
    LOGIN_IN_PROGRESS:              'Já existe um login em andamento para esta conta. Aguarde.',
  };

  function _igMessage(code, fallback) {
    return INSTA_MESSAGES[code] || fallback || 'Não foi possível autenticar. Verifique suas credenciais.';
  }

  async function connectInstagrapi() {
    const uname = instaModal.username.trim().replace(/^@/, '');
    if (!uname || !instaModal.password.trim() || cooldownSecs > 0) return;
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      const r = await api.post('/accounts/instagrapi-direct', {
        username:  uname,
        password:  instaModal.password.trim(),
        ...(instaModal.accountId ? { accountId: instaModal.accountId } : {}),
        // 2FA code is collected in step 'two_factor' after Instagram requests it — not here
      });
      // 202 — desafio de verificação: o Instagram já enviou o código
      if (r.data?.status === 'CHALLENGE_REQUIRED') {
        setInstaModal(m => ({
          ...m,
          loading:  false,
          step:     'challenge',
          totp:     '',
          channel:  r.data?.channel || null,
          status:   'CHALLENGE_REQUIRED',
          error:    '',
        }));
        return;
      }
      // 202 — 2FA required (axios doesn't throw on 2xx)
      if (r.status === 202 || r.data?.status === 'TWO_FACTOR_REQUIRED') {
        setInstaModal(m => ({
          ...m,
          loading: false,
          step:    'two_factor',
          totp:    '',
          status:  'TWO_FACTOR_REQUIRED',
          error:   '',
        }));
        return;
      }
      showToast('success', 'Conectada!', `@${uname} conectada via API Mobile`);
      setInstaModal(null);
      loadAccounts();
    } catch (err) {
      const code = err.response?.data?.code || '';
      if (code === 'RATE_LIMITED') {
        const expiry = Date.now() + 5 * 60 * 1000; // 5-minute cooldown
        setRateLimitExpiry(expiry);
        try { localStorage.setItem(`ig_rl_${uname}`, String(expiry)); } catch {}
      }
      setInstaModal(m => ({
        ...m,
        loading: false,
        status:  code || 'AUTH_FAILED',
        error:   _igMessage(code, err.response?.data?.error),
      }));
    }
  }

  /**
   * Envia o código do desafio de verificação (checkpoint por e-mail/SMS).
   * Código recusado mantém o usuário no mesmo passo — o desafio continua aberto
   * no serviço Python por 10 min, então não é preciso refazer o login.
   */
  async function submitChallengeCode() {
    const uname = instaModal.username.trim().replace(/^@/, '');
    const code  = instaModal.totp.trim();
    if (!uname || !code) return;
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      await api.post('/accounts/instagrapi-challenge-code', { username: uname, code });
      showToast('success', 'Conectada!', `@${uname} conectada via API Mobile`);
      setInstaModal(null);
      loadAccounts();
    } catch (err) {
      const errCode = err.response?.data?.code || '';
      const expirou = errCode === 'NO_PENDING_CHALLENGE' || errCode === 'CHALLENGE_FAILED';
      setInstaModal(m => ({
        ...m,
        loading: false,
        // Prazo expirado ou fluxo abortado: volta ao início; código errado fica no passo.
        step:    expirou ? 'credentials' : 'challenge',
        totp:    '',
        status:  errCode || 'AUTH_FAILED',
        error:   _igMessage(errCode, err.response?.data?.error),
      }));
    }
  }

  async function verify2fa() {
    const uname = instaModal.username.trim().replace(/^@/, '');
    const code  = instaModal.totp.trim();
    if (!uname || !code) return;
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      await api.post('/accounts/instagrapi-verify-2fa', { username: uname, code });
      showToast('success', 'Conectada!', `@${uname} conectada via API Mobile`);
      setInstaModal(null);
      loadAccounts();
    } catch (err) {
      const errCode = err.response?.data?.code || '';
      setInstaModal(m => ({
        ...m,
        loading: false,
        status:  errCode || 'AUTH_FAILED',
        error:   _igMessage(errCode, err.response?.data?.error),
      }));
    }
  }

  async function connectBySessionId() {
    const accountId = instaModal.accountId;
    const sid = instaModal.sessionid.trim();
    if (!accountId || !sid) return;
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      await api.post(`/accounts/${accountId}/instagrapi-sessionid`, { sessionid: sid });
      const uname = instaModal.username.trim().replace(/^@/, '');
      showToast('success', 'Conectada!', `@${uname} conectada via Session ID`);
      setInstaModal(null);
      loadAccounts();
    } catch (err) {
      const code = err.response?.data?.code || '';
      setInstaModal(m => ({
        ...m,
        loading: false,
        status:  code || 'AUTH_FAILED',
        error:   _igMessage(code, err.response?.data?.error),
      }));
    }
  }

  async function connectBySessionIdNew() {
    const username = instaModal.username.trim().replace(/^@/, '');
    const sid = instaModal.sessionid.trim();
    if (!username || !sid) return;
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      await api.post('/accounts/instagrapi-sessionid-new', { username, sessionid: sid });
      showToast('success', 'Conectada!', `@${username} conectada via Session ID`);
      setInstaModal(null);
      loadAccounts();
    } catch (err) {
      const code = err.response?.data?.code || '';
      setInstaModal(m => ({
        ...m,
        loading: false,
        status:  code || 'AUTH_FAILED',
        error:   _igMessage(code, err.response?.data?.error),
      }));
    }
  }

  async function disconnectInstagrapi(account) {
    try {
      await api.post(`/accounts/${account._id}/instagrapi-disconnect`);
      showToast('success', 'Desconectada', `@${account.username} voltou ao modo oficial`);
      setInstaModal(null);
      loadAccounts();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || err.message);
    }
  }

  function deleteAccount(id) { setAccountToDelete(id); setDeleteModal(true); }
  async function confirmDelete() {
    try { await api.delete(`/accounts/${accountToDelete}`); await loadAccounts(); showToast('success', 'Conta removida', 'A conta foi excluída com sucesso.'); }
    catch { showToast('error', 'Erro', 'Não foi possível excluir a conta.'); }
    setDeleteModal(false); setAccountToDelete(null);
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectMode() {
    setSelectMode(m => {
      if (m) setSelectedIds(new Set());
      return !m;
    });
  }

  async function bulkDelete() {
    const count = selectedIds.size;
    setBulkDeleting(true);
    try {
      await Promise.all([...selectedIds].map(id => api.delete(`/accounts/${id}`)));
      setSelectedIds(new Set()); setBulkDeleteModal(false);
      await loadAccounts();
      showToast('success', 'Contas removidas', `${count} conta(s) excluída(s) com sucesso.`);
    } catch { showToast('error', 'Erro', 'Falha ao excluir uma ou mais contas.'); }
    finally { setBulkDeleting(false); }
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
  function sessionStatusLabel(s) {
    const MAP = {
      VALID:            'Sessão ativa',
      EXPIRING:         'Expirando',
      INVALID:          'Inválida',
      RECOVERING:       'Recuperando',
      AUTH_REQUIRED:    'Login necessário',
      REAUTH_REQUIRED:  'Re-login necessário',
      CHALLENGE_REQUIRED: 'Desafio pendente',
      FAILED:           'Falha',
      DISABLED:         'Desativada',
      RATE_LIMITED:     'Rate limited',
      NETWORK_ERROR:    'Erro de rede',
      UNKNOWN:          'Desconhecida',
    };
    return MAP[s] || s || 'Desconhecida';
  }
  function sessionStatusColor(s) {
    if (s === 'VALID')                         return '#10b981';
    if (s === 'EXPIRING' || s === 'RECOVERING') return '#f59e0b';
    if (s === 'RATE_LIMITED')                  return '#f59e0b';
    if (s === 'NETWORK_ERROR')                 return '#64748b';
    if (s === 'UNKNOWN')                       return '#64748b';
    return '#ef4444';
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
      <ConfirmModal
        open={bulkDeleteModal}
        title={`Excluir ${selectedIds.size} conta(s)`}
        message={`Tem certeza que deseja excluir ${selectedIds.size} conta(s) selecionada(s)? Esta ação não pode ser desfeita.`}
        onConfirm={bulkDelete}
        onCancel={() => setBulkDeleteModal(false)}
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
            <button onClick={() => openInstaModal(null)} className="btn-ghost" style={{ padding:'7px 14px', fontSize:12, background:'rgba(139,92,246,.1)', color:'#a78bfa', borderColor:'rgba(139,92,246,.3)' }}>
              <IcoPhone /> Conectar Instagram
            </button>
            <button onClick={() => openOAuthConnect(null)} disabled={!!connecting['new']} className="btn-primary" style={{ fontSize:13 }}>
              <IcoLink /> {connecting['new'] ? 'Aguarde...' : 'Conectar via API'}
            </button>
          </>
        }
      >
        {/* ── 5 stat cards ── */}
        <div className="accounts-stats-grid" style={{ gap:10 }}>
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

        {/* ── Card de Proxy Global ── */}
        {(() => {
          const online  = proxyStatus.ativo && proxyStatus.ok;
          const caiu    = proxyStatus.ativo && !proxyStatus.ok;
          const accent  = online ? '#34d399' : caiu ? '#f87171' : 'var(--cyan)';
          const accentBg = online ? '16,185,129' : caiu ? '244,63,94' : '0,212,255';

          return (
        <motion.div initial={{ opacity:0, y:-10 }} animate={{ opacity:1, y:0 }} style={{
          background: `linear-gradient(135deg, rgba(${accentBg},.07) 0%, oklch(0.16 0.05 235 / 0.6) 100%)`,
          border: `1px solid rgba(${accentBg},${proxyStatus.ativo ? '.35' : '.18'})`,
          borderLeft: `3px solid ${accent}`,
          borderRadius: 14, padding: 16, marginBottom: 20,
          boxShadow: online ? `0 0 24px rgba(${accentBg},.10)` : 'none',
          transition: 'border-color .3s, box-shadow .3s',
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap', marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:11 }}>
              <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, display:'grid', placeItems:'center',
                background:`rgba(${accentBg},.12)`, border:`1px solid rgba(${accentBg},.28)`, color:accent }}>
                <IcoGlobe />
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>Proxy Global</div>
                <div style={{ fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontWeight:700, color:accent }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:accent, boxShadow:`0 0 6px ${accent}`,
                      animation: online ? 'pulseGlow 1.8s ease-in-out infinite' : 'none' }} />
                    {online ? 'Ativo e funcionando' : caiu ? 'Ativo — proxy fora do ar' : 'Inativo'}
                  </span>
                  <span style={{ color:'var(--text3)' }}>
                    {proxyStatus.ativo
                      ? 'toda a automação sai por este IP'
                      : `automação saindo pelo IP do servidor${ipDireto ? ` (${ipDireto})` : ''}`}
                  </span>
                </div>
              </div>
            </div>

            {proxyStatus.ativo && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {ipDireto && (
                  <div style={{ padding:'6px 11px', borderRadius:9, background:'oklch(1 0 0 / 0.04)', border:'1px solid oklch(1 0 0 / 0.08)' }}>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:8.5, color:'var(--text3)', letterSpacing:'.08em' }}>IP DO SERVIDOR</div>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text3)', textDecoration:'line-through', marginTop:2 }}>{ipDireto}</div>
                  </div>
                )}
                <div style={{ padding:'6px 11px', borderRadius:9, background:`rgba(${accentBg},.1)`, border:`1px solid rgba(${accentBg},.3)` }}>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:8.5, color:accent, opacity:.8, letterSpacing:'.08em' }}>IP EM USO AGORA</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:accent, marginTop:2 }}>
                    {proxyStatus.ip || '—'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input
              type="text"
              placeholder="http://usuario:senha@host:porta"
              value={proxyUrl}
              onChange={e => setProxyUrl(e.target.value)}
              disabled={proxyStatus.ativo}
              onKeyDown={e => { if (e.key === 'Enter' && !proxyStatus.ativo) testarProxyGlobal(); }}
              style={{
                flex: 1, minWidth: 240, padding: '9px 12px', borderRadius: 9, fontFamily:'var(--font-mono)',
                border: '1px solid oklch(1 0 0 / 0.1)', background: 'oklch(0.12 0.04 235 / 0.75)',
                color: 'var(--text)', fontSize: 12, opacity: proxyStatus.ativo ? 0.55 : 1,
              }}
            />
            <button
              onClick={testarProxyGlobal}
              disabled={!proxyUrl.trim() || proxyStatus.testando}
              style={{
                padding: '9px 15px', borderRadius: 9, fontSize: 12, fontWeight: 700, whiteSpace:'nowrap',
                background: 'rgba(0,212,255,.1)', color: 'var(--cyan)', border: '1px solid rgba(0,212,255,.25)',
                cursor: proxyStatus.testando ? 'wait' : 'pointer', opacity: !proxyUrl.trim() || proxyStatus.testando ? 0.5 : 1,
              }}
            >
              {proxyStatus.testando ? 'Testando…' : 'Testar'}
            </button>
            {!proxyStatus.ativo ? (
              <button
                onClick={ativarProxyGlobal}
                disabled={!proxyUrl.trim() || proxyStatus.salvando}
                title="Testa e ativa o proxy para toda a automação"
                style={{
                  padding: '9px 15px', borderRadius: 9, fontSize: 12, fontWeight: 700, whiteSpace:'nowrap',
                  background: 'rgba(16,185,129,.12)', color: '#34d399', border: '1px solid rgba(16,185,129,.3)',
                  cursor: !proxyUrl.trim() || proxyStatus.salvando ? 'not-allowed' : 'pointer',
                  opacity: !proxyUrl.trim() || proxyStatus.salvando ? 0.5 : 1,
                }}
              >
                {proxyStatus.salvando ? 'Ativando…' : 'Ativar'}
              </button>
            ) : (
              <button
                onClick={desativarProxyGlobal}
                disabled={proxyStatus.salvando}
                style={{
                  padding: '9px 15px', borderRadius: 9, fontSize: 12, fontWeight: 700, whiteSpace:'nowrap',
                  background: 'rgba(244,63,94,.1)', color: '#f87171', border: '1px solid rgba(244,63,94,.28)',
                  cursor: 'pointer', opacity: proxyStatus.salvando ? 0.5 : 1,
                }}
              >
                {proxyStatus.salvando ? 'Desativando…' : 'Desativar'}
              </button>
            )}
          </div>

          {(proxyStatus.ativo || proxyStatus.erro) && (
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:10,
              fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)' }}>
              {proxyStatus.ativo && (
                <span>Verificado a cada 90s pelo servidor{proxyStatus.lastCheck ? ` — último: ${fmtDateCompact(proxyStatus.lastCheck)}` : ''}</span>
              )}
              {proxyStatus.erro && (
                <span style={{ color:'#f87171' }}>· {proxyStatus.erro}</span>
              )}
            </div>
          )}
        </motion.div>
          );
        })()}

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
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={toggleSelectMode} style={{
              fontSize:11, fontWeight:700, padding:'6px 12px', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap',
              background:   selectMode ? 'rgba(248,113,113,.1)'  : 'rgba(99,102,241,.1)',
              color:        selectMode ? '#f87171'                : '#818cf8',
              border:       `1px solid ${selectMode ? 'rgba(248,113,113,.3)' : 'rgba(99,102,241,.3)'}`,
              fontFamily:'var(--font-mono)', transition:'all .15s',
            }}>
              {selectMode ? 'Cancelar' : 'Selecionar'}
            </button>
            <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position:'absolute', left:10, color:'var(--text3)', pointerEvents:'none' }}>
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                style={{ background:'oklch(1 0 0 / 0.04)', border:'1px solid oklch(1 0 0 / 0.09)', borderRadius:9, padding:'7px 13px 7px 30px', fontSize:13, color:'var(--text)', outline:'none', width:'min(220px,100%)', minWidth:0, transition:'border-color .18s', fontFamily:'var(--font)' }}
                placeholder="Buscar conta..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={e => e.target.style.borderColor='rgba(0,212,255,.35)'}
                onBlur={e => e.target.style.borderColor='oklch(1 0 0 / 0.09)'}
              />
            </div>
          </div>
        </div>

        {/* ── Account cards grid ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(290px,100%),1fr))', gap:12 }}>
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
            const isSel       = selectedIds.has(account._id);

            /* Proxy desta conta: o próprio tem prioridade; sem ele vale o global.
               Status e IP vêm do monitoramento contínuo do servidor. */
            const temProxyProprio = !!account.proxy?.trim();
            const usaGlobal       = !temProxyProprio && proxyStatus.ativo;
            const pxOnline        = temProxyProprio ? account.proxyStatus === 'online'  : (usaGlobal && proxyStatus.ok);
            const pxDown          = temProxyProprio ? account.proxyStatus === 'offline' : (usaGlobal && !proxyStatus.ok);
            const pxColor         = pxOnline ? '#34d399' : pxDown ? '#f87171' : 'var(--text3)';
            const pxIp            = temProxyProprio ? (pxOnline ? account.proxyIp : '') : (pxOnline ? proxyStatus.ip : '');
            const pxLabel         = temProxyProprio
              ? (pxOnline ? 'Proxy próprio ativo' : pxDown ? 'Proxy próprio fora do ar' : 'Proxy não testado')
              : usaGlobal
                ? (pxOnline ? 'Proxy global' : 'Proxy global fora do ar')
                : 'Sem proxy — IP do servidor';

            return (
              <motion.div key={account._id} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:idx*.03, duration:.25 }}
                onClick={() => selectMode && toggleSelect(account._id)}
                style={{
                  background: isSel ? 'oklch(0.17 0.08 270 / 0.92)' : `oklch(0.16 0.05 235 / 0.92)`,
                  border:     isSel ? '1px solid rgba(99,102,241,.45)' : `1px solid oklch(1 0 0 / 0.09)`,
                  borderLeft:`3px solid ${hc}`,
                  borderRadius:14, overflow:'hidden',
                  display:'flex', flexDirection:'column',
                  transition:'transform .2s, box-shadow .2s, border-color .2s, background .15s',
                  cursor:'pointer', position:'relative',
                }}
                whileHover={{ y:-2, boxShadow: isSel ? `0 8px 32px rgba(99,102,241,.25), 0 0 0 1px rgba(99,102,241,.4)` : `0 8px 32px rgba(0,0,0,.4), 0 0 0 1px ${hc}22` }}
              >
                {/* checkbox indicator — only shown in selectMode */}
                {selectMode && (
                  <div style={{
                    position:'absolute', top:8, right:10, width:18, height:18, borderRadius:5, zIndex:2,
                    border:`1.5px solid ${isSel ? '#818cf8' : 'oklch(1 0 0 / 0.25)'}`,
                    background: isSel ? '#818cf8' : 'oklch(0.12 0.04 235 / 0.75)',
                    display:'grid', placeItems:'center', transition:'all .15s',
                  }}>
                    {isSel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                )}

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
                        <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color:'var(--text3)', fontSize:10, textDecoration:'none', flexShrink:0, lineHeight:1 }}>↗</a>
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', marginTop:1 }}>@{account.username}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:5, flexWrap:'wrap' }}>
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px 2px 5px', borderRadius:20,
                          background:`${hc}15`, color:hc, border:`1px solid ${hc}28`,
                          display:'inline-flex', alignItems:'center', gap:4 }}>
                          <span style={{ width:5, height:5, borderRadius:'50%', background:hc, boxShadow:`0 0 5px ${hc}` }} />
                          {hl}
                        </span>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'oklch(1 0 0 / 0.05)', color:'var(--text3)', letterSpacing:'.5px' }}>{accType}</span>
                        {account.provider === 'instagrapi' && (
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.25)', letterSpacing:'.4px' }}>
                            API Mobile
                          </span>
                        )}
                        <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'rgba(0,212,255,.08)', color:'var(--cyan)', border:'1px solid rgba(0,212,255,.2)', textDecoration:'none', whiteSpace:'nowrap', letterSpacing:'.3px' }}>
                          Ver Perfil ↗
                        </a>
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
                <div style={{ padding:'6px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                  {account.provider === 'instagrapi' && account.sessionStatus ? (
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:10, display:'flex', alignItems:'center', gap:5,
                      color: sessionStatusColor(account.sessionStatus) }}>
                      <IcoPhone />
                      {sessionStatusLabel(account.sessionStatus)}
                      {account.consecutiveFailures > 0 && (
                        <span style={{ fontSize:9, opacity:.7 }}>({account.consecutiveFailures} falhas)</span>
                      )}
                    </span>
                  ) : (
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:isHealthy?'var(--green)':account.healthStatus==='restrita'?'#f59e0b':'#f87171', display:'flex', alignItems:'center', gap:5 }}>
                      <IcoWifi /> {isHealthy ? 'API conectada' : account.healthStatus === 'restrita' ? 'Conta restrita' : account.healthStatus === 'sessao_expirada' ? 'Sessão expirada' : account.healthStatus === 'token_invalido' ? 'Token inválido' : account.healthStatus === 'banida' ? 'Conta banida' : account.healthStatus === 'erro_login' ? 'Erro de login' : 'API desconectada'}
                    </span>
                  )}
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <IcoWave /> {compact}
                  </span>
                </div>

                {/* proxy row — por onde esta conta está saindo, ao vivo */}
                <div style={{ height:1, background:'oklch(1 0 0 / 0.06)' }} />
                <div style={{ padding:'6px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:6,
                  background: pxOnline ? 'rgba(16,185,129,.05)' : pxDown ? 'rgba(244,63,94,.05)' : 'transparent' }}>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, display:'flex', alignItems:'center', gap:5, color:pxColor, minWidth:0 }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0, background:pxColor,
                      boxShadow: pxOnline ? `0 0 6px ${pxColor}` : 'none',
                      animation: pxOnline ? 'pulseGlow 1.8s ease-in-out infinite' : 'none' }} />
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pxLabel}</span>
                  </span>
                  {pxIp && (
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, color:pxColor, flexShrink:0 }}>
                      {pxIp}
                    </span>
                  )}
                </div>

                {/* actions */}
                <div style={{ height:1, background:'oklch(1 0 0 / 0.06)' }} />
                <div onClick={e => e.stopPropagation()} style={{ padding:'8px 10px', display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
                  <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, padding:'6px 10px', borderRadius:8, border:'1px solid oklch(1 0 0 / 0.09)', color:'var(--text3)', background:'transparent', textDecoration:'none', whiteSpace:'nowrap', transition:'all .15s', flexShrink:0 }}
                    onMouseEnter={e => { e.currentTarget.style.color='var(--text)'; e.currentTarget.style.borderColor='oklch(1 0 0 / 0.16)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='oklch(1 0 0 / 0.09)'; }}
                  ><IcoEye /> Ver</a>

                  {account.provider === 'instagrapi' ? (
                    <button onClick={() => openInstaModal(account)} title="Reconectar via API Mobile"
                      style={{ flexGrow:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:12, fontWeight:700, padding:'6px 10px', borderRadius:8,
                        background:'rgba(139,92,246,.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,.28)', cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', transition:'all .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(139,92,246,.2)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(139,92,246,.12)'}
                    ><IcoPhone /> <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>Sessão</span></button>
                  ) : (
                    <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                      style={{ flexGrow:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:12, fontWeight:700, padding:'6px 10px', borderRadius:8,
                        background:'rgba(0,212,255,.1)', color:'var(--cyan)', border:'1px solid rgba(0,212,255,.25)', cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', transition:'all .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(0,212,255,.16)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(0,212,255,.1)'}
                    ><IcoPerson /> <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{isConnecting ? '...' : 'Editar'}</span></button>
                  )}

                  <button onClick={() => openProxyModal(account)} title={account.proxy ? `Proxy: ${account.proxy}` : 'Configurar proxy exclusivo desta conta'}
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, padding:'6px 10px', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                      background: temProxyProprio ? (pxOnline ? 'rgba(16,185,129,.12)' : pxDown ? 'rgba(244,63,94,.1)' : 'rgba(139,92,246,.12)') : 'oklch(1 0 0 / 0.04)',
                      color:      temProxyProprio ? (pxOnline ? '#34d399' : pxDown ? '#f87171' : 'var(--purple)') : 'var(--text3)',
                      border:     temProxyProprio ? `1px solid ${pxOnline ? 'rgba(16,185,129,.3)' : pxDown ? 'rgba(244,63,94,.28)' : 'rgba(139,92,246,.28)'}` : '1px solid oklch(1 0 0 / 0.08)',
                    }}
                  ><IcoSignal /> Proxy</button>

                  <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                    title={needsRecon ? 'Reconectar' : 'API ok'}
                    style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, fontWeight:700, padding:'6px 10px', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
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

        {/* Bulk action bar */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:20 }}
              style={{
                position:'fixed', bottom:'calc(28px + env(safe-area-inset-bottom, 0px))', left:'50%', transform:'translateX(-50%)',
                background:'oklch(0.18 0.06 235 / 0.97)',
                border:'1px solid oklch(1 0 0 / 0.15)',
                borderRadius:16, padding:'10px 16px',
                display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                boxShadow:'0 8px 32px rgba(0,0,0,.55), 0 0 0 1px rgba(99,102,241,.22)',
                backdropFilter:'blur(12px)', zIndex:100,
                maxWidth:'calc(100vw - 32px)',
              }}
            >
              <span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:700, color:'#818cf8',
                background:'rgba(99,102,241,.15)', padding:'3px 10px', borderRadius:20, border:'1px solid rgba(99,102,241,.25)' }}>
                {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
              </span>
              <button onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }} style={{
                fontSize:12, fontWeight:600, padding:'6px 12px', borderRadius:8,
                background:'oklch(1 0 0 / 0.06)', color:'var(--text2)',
                border:'1px solid oklch(1 0 0 / 0.12)', cursor:'pointer', transition:'all .15s',
              }}>Desmarcar</button>
              <button onClick={() => setBulkDeleteModal(true)} disabled={bulkDeleting} style={{
                fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:8,
                background:'rgba(244,63,94,.15)', color:'var(--red)',
                border:'1px solid rgba(244,63,94,.3)', cursor:'pointer',
                display:'flex', alignItems:'center', gap:6, transition:'all .15s',
              }}><IcoTrash /> Excluir {selectedIds.size}</button>
            </motion.div>
          )}
        </AnimatePresence>

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
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
              As chamadas desta conta sairão por este proxy — IP exclusivo, independente do proxy global.
            </div>
            <input className="input" style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} placeholder="http://usuario:senha@host:porta" value={proxyValue} onChange={e => { setProxyValue(e.target.value); setProxyTest({ testando:false, ip:null, erro:null }); }} onKeyDown={e => e.key === 'Enter' && testarProxyConta()} autoFocus />

            {/* Estado atual gravado + resultado do teste feito agora */}
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10 }}>
              {proxyModal.proxy && !proxyTest.ip && (
                <div style={{ display:'flex', alignItems:'center', gap:7, fontFamily:'var(--font-mono)', fontSize:11,
                  color: proxyModal.proxyStatus === 'online' ? '#34d399' : proxyModal.proxyStatus === 'offline' ? '#f87171' : 'var(--text3)' }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:'currentColor' }} />
                  {proxyModal.proxyStatus === 'online'
                    ? `Online — saindo por ${proxyModal.proxyIp || '—'}`
                    : proxyModal.proxyStatus === 'offline' ? 'Offline no último teste do servidor' : 'Ainda não testado'}
                  {proxyModal.proxyLastCheck && <span style={{ color:'var(--text3)' }}>· {fmtDateCompact(proxyModal.proxyLastCheck)}</span>}
                </div>
              )}
              {proxyTest.ip && (
                <div style={{ padding:'9px 11px', borderRadius:9, background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)' }}>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'#34d399', opacity:.8, letterSpacing:'.08em' }}>PROXY OK — IP DE SAÍDA</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color:'#34d399', marginTop:2 }}>{proxyTest.ip}</div>
                </div>
              )}
              {proxyTest.erro && (
                <div style={{ padding:'9px 11px', borderRadius:9, background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.25)', fontSize:11, color:'#f87171' }}>
                  {proxyTest.erro}
                </div>
              )}
              {!proxyModal.proxy && !proxyTest.ip && !proxyTest.erro && (
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text3)' }}>
                  {proxyStatus.ativo
                    ? `Sem proxy próprio — hoje esta conta usa o proxy global${proxyStatus.ip ? ` (${proxyStatus.ip})` : ''}.`
                    : 'Sem proxy próprio — esta conta sai pelo IP do servidor.'}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: 14 }}>
              {proxyModal.proxy && (
                <button className="btn btn-ghost" onClick={() => { setProxyValue(''); setProxyTest({ testando:false, ip:null, erro:null }); saveProxy(); }} disabled={savingProxy}>Remover</button>
              )}
              <button className="btn btn-ghost" onClick={() => setProxyModal(null)}>Cancelar</button>
              <button className="btn btn-ghost" onClick={testarProxyConta} disabled={!proxyValue.trim() || proxyTest.testando}>
                {proxyTest.testando ? 'Testando…' : 'Salvar e testar'}
              </button>
              <button className="btn btn-primary" onClick={saveProxy} disabled={savingProxy}>{savingProxy ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Instagrapi (API Mobile) Modal ───────────────────────── */}
      {instaModal && (() => {
        const uname       = instaModal.username.trim().replace(/^@/, '');
        const selAcc      = safeAccounts.find(a => a.username === uname) || null;
        const isConnected = selAcc?.provider === 'instagrapi';
        const is2FA       = instaModal.step === 'two_factor';
        // Desafio de verificação (checkpoint por e-mail/SMS) — passo próprio,
        // mecanismo diferente do 2FA, mas com a mesma forma de tela: pede código.
        const isChallenge = instaModal.step === 'challenge';
        const isCodeStep  = is2FA || isChallenge;
        // blocked = true only while an active countdown is running.
        // status === 'RATE_LIMITED' with cooldownSecs === 0 means the cooldown just
        // expired and the user should be able to retry immediately.
        const blocked = cooldownSecs > 0;
        const cdMin = Math.floor(cooldownSecs / 60);
        const cdSec = String(cooldownSecs % 60).padStart(2, '0');

        // Errors that allow immediate retry (no cooldown required)
        const RETRY_IMMEDIATELY = new Set([
          'INSTAGRAPI_SERVICE_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR',
          'PROXY_ERROR', 'LOGIN_IN_PROGRESS', 'UNKNOWN_ERROR',
        ]);
        const canRetryNow = !!instaModal.status && RETRY_IMMEDIATELY.has(instaModal.status);

        const isSidMode = instaModal.loginMethod === 'sessionid';

        const lbl = (text) => (
          <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:5, letterSpacing:'.04em' }}>{text}</label>
        );
        const field = (content) => <div style={{ marginBottom:12 }}>{content}</div>;

        return (
          <div className="modal-overlay">
            <div className="modal" style={{ width: 'min(480px,100%)' }}>

              {/* Header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div>
                  <h3 style={{ margin:0 }}>📱 {is2FA ? 'Verificação em 2 etapas' : isChallenge ? 'Verificação do Instagram' : 'Conectar Instagram'}</h3>
                  <div style={{ fontSize:12, color:'var(--text2)', marginTop:3 }}>
                    {isCodeStep ? `@${uname} — código necessário` : 'API Mobile — sessão duradoura'}
                  </div>
                </div>
                <button onClick={() => setInstaModal(null)} style={{ background:'none', border:'none', color:'var(--text2)', fontSize:20, cursor:'pointer' }}>×</button>
              </div>

              {/* Method toggle (only on credentials step, not connected) */}
              {!isCodeStep && !isConnected && (
                <div style={{ display:'flex', gap:6, marginBottom:14, background:'rgba(0,0,0,.12)', borderRadius:8, padding:4 }}>
                  {[['password','🔑 Senha'],['sessionid','🍪 Session ID']].map(([method, label]) => (
                    <button key={method} onClick={() => setInstaModal(m => ({ ...m, loginMethod: method, error:'', status:null }))}
                      style={{ flex:1, padding:'7px 0', fontSize:12, fontWeight:600, borderRadius:6, border:'none', cursor:'pointer',
                        background: instaModal.loginMethod === method ? 'rgba(139,92,246,.8)' : 'transparent',
                        color: instaModal.loginMethod === method ? '#fff' : 'var(--text2)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Step: credentials */}
              {!isCodeStep && (
                <>
                  {!isSidMode && field(<>
                    {lbl('USUÁRIO DO INSTAGRAM')}
                    <input className="input" type="text" style={{ width:'100%' }} placeholder="@usuario"
                      value={instaModal.username}
                      onChange={e => setInstaModal(m => ({ ...m, username: e.target.value, error: '', status: null }))}
                      disabled={instaModal.loading} autoFocus />
                  </>)}

                  {isConnected && (
                    <div style={{ background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.22)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#34d399' }}>
                      ✓ <strong>@{uname}</strong> já usa API Mobile. Clique em "Desconectar" para voltar ao modo oficial.
                    </div>
                  )}

                  {!isConnected && !isSidMode && (<>
                    {field(<>
                      {lbl('SENHA')}
                      <input className="input" type="password" style={{ width:'100%' }} placeholder="••••••••"
                        value={instaModal.password}
                        onChange={e => setInstaModal(m => ({ ...m, password: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && !instaModal.loading && !blocked && connectInstagrapi()}
                        disabled={instaModal.loading || blocked} />
                    </>)}
                    <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12, lineHeight:1.6, background:'rgba(139,92,246,.06)', border:'1px solid rgba(139,92,246,.18)', borderRadius:8, padding:'10px 12px' }}>
                      A senha é usada apenas para login e <strong>nunca é salva</strong>. Se a conta tiver 2FA, o código será pedido na próxima etapa.
                    </div>
                  </>)}

                  {!isConnected && isSidMode && (<>
                    {!instaModal.accountId && (() => {
                      const validAccounts = safeAccounts.filter(a => a.username);
                      return (
                        validAccounts.length > 0
                          ? field(<>
                              {lbl('CONTA')}
                              <select className="input" style={{ width:'100%' }}
                                defaultValue=""
                                onChange={e => {
                                  const acc = validAccounts.find(a => String(a._id || a.id) === e.target.value);
                                  if (acc) setInstaModal(m => ({ ...m, accountId: acc._id || acc.id, username: acc.username }));
                                }}
                                disabled={instaModal.loading}>
                                <option value="" disabled>— selecione a conta —</option>
                                {validAccounts.map(a => {
                                  const id = String(a._id || a.id || '');
                                  return <option key={id} value={id}>@{a.username}</option>;
                                })}
                              </select>
                            </>)
                          : field(<>
                              {lbl('USUÁRIO DO INSTAGRAM')}
                              <input className="input" type="text" style={{ width:'100%' }} placeholder="@seuusuario"
                                value={instaModal.username}
                                onChange={e => setInstaModal(m => ({ ...m, username: e.target.value, error:'', status:null }))}
                                disabled={instaModal.loading} autoFocus />
                            </>)
                      );
                    })()}
                    <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10, lineHeight:1.7, background:'rgba(59,130,246,.06)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:'10px 12px' }}>
                      <strong style={{ color:'var(--text1)' }}>Como obter o Session ID:</strong><br/>
                      1. Abra <strong>instagram.com</strong> no navegador (Chrome/Edge)<br/>
                      2. Pressione <strong>F12</strong> → aba <strong>Application</strong><br/>
                      3. Cookies → <code style={{ fontSize:11 }}>https://www.instagram.com</code><br/>
                      4. Copie o valor do cookie <strong>sessionid</strong>
                    </div>
                    {field(<>
                      {lbl('SESSION ID')}
                      <input className="input" type="text" style={{ width:'100%' }} placeholder="Cole o valor do cookie sessionid aqui"
                        value={instaModal.sessionid}
                        onChange={e => {
                          let val = e.target.value.trim();
                          try { val = decodeURIComponent(val); } catch {}
                          setInstaModal(m => ({ ...m, sessionid: val, error:'', status:null }));
                        }}
                        onKeyDown={e => e.key === 'Enter' && !instaModal.loading && connectBySessionId()}
                        disabled={instaModal.loading} autoFocus />
                    </>)}
                  </>)}
                </>
              )}

              {/* Step: two_factor */}
              {is2FA && (
                <>
                  <div style={{ background:'rgba(234,179,8,.07)', border:'1px solid rgba(234,179,8,.25)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#fbbf24', lineHeight:1.6 }}>
                    O Instagram enviou um código pelo seu método de autenticação. Digite-o abaixo.
                  </div>
                  {field(<>
                    {lbl('CÓDIGO DE VERIFICAÇÃO')}
                    <input className="input" type="text" style={{ width:'100%' }} placeholder="000000"
                      value={instaModal.totp}
                      onChange={e => setInstaModal(m => ({ ...m, totp: e.target.value.replace(/\D/g, '') }))}
                      onKeyDown={e => e.key === 'Enter' && !instaModal.loading && verify2fa()}
                      disabled={instaModal.loading} maxLength={8} autoFocus />
                  </>)}
                </>
              )}

              {/* Step: challenge — checkpoint do Instagram por e-mail/SMS */}
              {isChallenge && (
                <>
                  <div style={{ background:'rgba(59,130,246,.07)', border:'1px solid rgba(59,130,246,.25)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#60a5fa', lineHeight:1.6 }}>
                    O Instagram pediu confirmação de identidade e enviou um código
                    {instaModal.channel ? <> por <strong>{instaModal.channel}</strong></> : null}.
                    Digite-o abaixo para concluir a conexão.
                    <div style={{ marginTop:6, fontSize:11, opacity:.8 }}>
                      Você tem 10 minutos. Se errar o código, pode digitar outro sem refazer o login.
                    </div>
                  </div>
                  {field(<>
                    {lbl('CÓDIGO DE VERIFICAÇÃO')}
                    <input className="input" type="text" style={{ width:'100%' }} placeholder="000000"
                      value={instaModal.totp}
                      onChange={e => setInstaModal(m => ({ ...m, totp: e.target.value.replace(/\D/g, ''), error:'' }))}
                      onKeyDown={e => e.key === 'Enter' && !instaModal.loading && submitChallengeCode()}
                      disabled={instaModal.loading} maxLength={8} autoFocus />
                  </>)}
                </>
              )}

              {/* Rate limited — active countdown */}
              {blocked && (
                <div style={{ fontSize:12, background:'rgba(234,179,8,.09)', border:'1px solid rgba(234,179,8,.3)', borderRadius:8, padding:'10px 14px', marginBottom:10 }}>
                  <div style={{ fontWeight:700, color:'#fbbf24', marginBottom:4 }}>
                    Instagram confirmou limite de tentativas neste IP
                  </div>
                  <div style={{ color:'#fbbf24', opacity:.9 }}>
                    Aguarde <strong style={{ fontFamily:'monospace' }}>{cdMin}:{cdSec}</strong> antes de tentar novamente.
                    Tentar antes piora o bloqueio.
                  </div>
                </div>
              )}

              {/* Error (shown only when no active countdown) */}
              {instaModal.error && !blocked && (
                <div style={{ fontSize:12, color: canRetryNow ? '#94a3b8' : '#f87171', background: canRetryNow ? 'rgba(100,116,139,.08)' : 'rgba(244,63,94,.08)', border: `1px solid ${canRetryNow ? 'rgba(100,116,139,.25)' : 'rgba(244,63,94,.2)'}`, borderRadius:8, padding:'8px 12px', marginBottom:10 }}>
                  {instaModal.error}
                  {canRetryNow && <span style={{ display:'block', marginTop:4, fontSize:11, color:'#64748b' }}>Você pode tentar novamente.</span>}
                </div>
              )}

              {/* Actions */}
              <div className="modal-actions" style={{ marginTop:4 }}>
                {isCodeStep
                  ? <button className="btn btn-ghost" onClick={() => setInstaModal(m => ({ ...m, step:'credentials', totp:'', error:'', status:null }))} disabled={instaModal.loading}>Voltar</button>
                  : <button className="btn btn-ghost" onClick={() => setInstaModal(null)} disabled={instaModal.loading}>Cancelar</button>
                }

                {isChallenge && (
                  <button className="btn btn-primary" onClick={submitChallengeCode}
                    disabled={instaModal.loading || !instaModal.totp.trim()}
                    style={{ background:'rgba(139,92,246,.85)', borderColor:'rgba(139,92,246,.5)' }}>
                    {instaModal.loading ? 'Verificando...' : 'Confirmar código'}
                  </button>
                )}

                {!isCodeStep && isConnected && (
                  <button className="btn" onClick={() => disconnectInstagrapi(selAcc)} disabled={instaModal.loading}
                    style={{ background:'rgba(244,63,94,.12)', color:'#f87171', borderColor:'rgba(244,63,94,.3)' }}>
                    Desconectar
                  </button>
                )}

                {!isCodeStep && !isConnected && !isSidMode && (
                  <button className="btn btn-primary" onClick={connectInstagrapi}
                    disabled={instaModal.loading || !uname || !instaModal.password.trim() || blocked}
                    style={{ background: blocked ? 'rgba(100,116,139,.4)' : 'rgba(139,92,246,.85)', borderColor: blocked ? 'rgba(100,116,139,.3)' : 'rgba(139,92,246,.5)', cursor: blocked ? 'not-allowed' : 'pointer' }}>
                    {instaModal.loading ? 'Conectando...' : blocked ? `Aguarde ${cdMin}:${cdSec}` : 'Conectar'}
                  </button>
                )}

                {!isCodeStep && !isConnected && isSidMode && (() => {
                  const hasAccount = !!instaModal.accountId;
                  const hasSid     = !!instaModal.sessionid.trim();
                  const hasUser    = !!instaModal.username.trim();
                  const sidOk      = hasSid && (hasAccount || hasUser);
                  return (
                    <button className="btn btn-primary"
                      onClick={hasAccount ? connectBySessionId : connectBySessionIdNew}
                      disabled={instaModal.loading || !sidOk}
                      style={{ background:'rgba(59,130,246,.85)', borderColor:'rgba(59,130,246,.5)' }}>
                      {instaModal.loading ? 'Conectando...' : 'Conectar via Session ID'}
                    </button>
                  );
                })()}

                {is2FA && (
                  <button className="btn btn-primary" onClick={verify2fa}
                    disabled={instaModal.loading || !instaModal.totp.trim()}
                    style={{ background:'rgba(139,92,246,.85)', borderColor:'rgba(139,92,246,.5)' }}>
                    {instaModal.loading ? 'Verificando...' : 'Verificar'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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

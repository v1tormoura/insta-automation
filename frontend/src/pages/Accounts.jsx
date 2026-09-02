import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import PageShell from '../components/PageShell';
import { EsqueletoLista } from '../components/Estados';


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
  const [perfilModal,    setPerfilModal]    = useState(null);
  const [perfilForm,     setPerfilForm]     = useState({ fullName:'', biography:'', externalUrl:'', gender:'', foto:null });
  const [perfilSalvando, setPerfilSalvando] = useState(false);
  const [perfilErro,     setPerfilErro]     = useState('');
  const [perfilPreview,  setPerfilPreview]  = useState(null); // objectURL da foto escolhida
  const [perfilRisco,    setPerfilRisco]    = useState(null); // motivos do alto risco, quando bloqueado
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

  /* Conferência de ambiente. Separa "o ambiente não está pronto" de "o
     Instagram recusou esta conta" — dois problemas com donos diferentes que
     produziam a mesma tela de erro, e por isso mandavam trocar senha quando a
     causa era a cota do proxy. */
  const [preflight, setPreflight] = useState(null);
  const [rateLimitExpiry, setRateLimitExpiry] = useState(null);
  const [cooldownSecs,    setCooldownSecs]    = useState(0);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 4000); }

  /* Começa em false se o cache já tem contas: nesse caso a tela desenha na
     hora e um esqueleto apareceria só para sumir no quadro seguinte. */
  const [primeiraCarga, setPrimeiraCarga] = useState(() => {
    try { return !JSON.parse(localStorage.getItem(ACCOUNTS_CACHE_KEY) || '[]').length; }
    catch { return true; }
  });

  async function loadAccounts(targetPage = page) {
    try {
      const res = await api.get(`/accounts?page=${targetPage}&limit=50`);
      const list = Array.isArray(res.data.accounts) ? res.data.accounts : [];
      setAccounts(list); setPagination(res.data.pagination || null);
      localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(list));
    } catch (err) { console.log('Erro ao carregar contas:', err.message); }
    /* Só a PRIMEIRA carga mostra esqueleto. A tela recarrega sozinha a cada
       trinta segundos, e trocar a lista por blocos cinzas a cada ciclo faria
       a página piscar sem que ninguém tivesse pedido nada — pior que não ter
       estado de carregamento. */
    finally { setPrimeiraCarga(false); }
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
      setProxyStatus(s => ({
        ...s,
        ip: data.ip, ok: true, erro: null, rotating: !!data.rotating, ip2: data.ip2 || null,
        lastCheck: new Date().toISOString(),
      }));
      if (data.rotating) {
        showToast('warning', 'Proxy rotativa', `IP mudou entre duas medições: ${data.ip} → ${data.ip2}`);
      } else {
        showToast('success', 'Proxy OK', `IP de saída: ${data.ip} (${data.latencyMs} ms)`);
      }
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

  useServerEvents(['accounts', 'posts', 'profile_edit'], (data, evento) => {
    // A edição de perfil roda em segundo plano e o backend transmite o desfecho.
    // Sem escutar isto, o usuário salvava e nunca sabia se deu certo.
    if (evento === 'profile_edit') {
      if (data?.status === 'done') {
        const campos = Array.isArray(data.changed) && data.changed.length
          ? data.changed.join(', ')
          : 'perfil';
        showToast('success', 'Perfil atualizado', `@${data.username || ''} — ${campos}`);
      } else if (data?.status === 'error') {
        showToast('error', 'Falha ao editar perfil', data.error || 'Erro desconhecido');
      }
      loadRef.current?.();
      return;
    }

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
  /* Ao abrir o modal, confere o ambiente uma vez. Não bloqueia: um bloqueio
     transformaria diagnóstico em portão, e diagnóstico errado vira portão
     errado — uma instabilidade de dez segundos impediria quem quer tentar
     assim mesmo. */
  /* Uma chave, não duas expressões no array. `!!instaModal` ali dentro é
     expressão complexa: o compilador não consegue conferir a lista, e a regra
     de dependências deixa de valer justamente onde ela protege. */
  const chavePreflight = instaModal ? (instaModal.accountId || 'nova') : '';
  useEffect(() => {
    if (!chavePreflight) { setPreflight(null); return undefined; }
    let vivo = true;
    setPreflight({ carregando: true });
    const params = chavePreflight === 'nova' ? {} : { accountId: chavePreflight };
    api.get('/accounts/preflight', { params })
      .then(({ data }) => { if (vivo) setPreflight(data); })
      .catch(() => { if (vivo) setPreflight(null); });
    return () => { vivo = false; };
  }, [chavePreflight]);

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
    /* O retorno do Facebook chega pela mesma porta e precisa ser lido aqui:
       sem isto, o usuário voltaria da autorização para uma tela idêntica à que
       deixou, sem nada dizendo se funcionou. */
    const graphLink = params.get('graphLink');
    if (graphLink === 'success') {
      showToast('success', 'Link em story ativado',
        `Publicando pela Página ${params.get('pagina') || 'vinculada'}`);
      loadAccounts();
      window.history.replaceState({}, '', '/accounts');
      return;
    }
    if (graphLink === 'error') {
      showToast('error', 'Não foi possível ativar o link',
        params.get('msg') || 'O Facebook recusou a autorização');
      window.history.replaceState({}, '', '/accounts');
      return;
    }

    const oauth = params.get('oauth');
    if (!oauth) return;
    if (oauth === 'success') {
      const uname = params.get('username') || '';
      showToast('success', 'Conta conectada!', `@${uname} adicionada via Meta API`);
      loadAccounts();

      /* ── A emenda ──────────────────────────────────────────────────────
         Antes, conectar pela API oficial e depois pela mobile eram duas
         viagens: você voltava da Meta, via "conectada", e tinha de procurar o
         botão Mobile no card para começar tudo de novo.

         Não dá para dispensar a senha — o token que a Meta devolve não contém
         credencial nenhuma, e a sessão mobile é a de um APARELHO logado no
         aplicativo, que o Instagram só emite para quem apresenta senha ou
         sessionid. O que dá para dispensar é a SEGUNDA VIAGEM: a senha é
         pedida aqui, no mesmo instante, com a conta já identificada.

         Continua sendo uma escolha — o botão Cancelar fecha e a conta segue
         perfeitamente conectada pela via oficial. */
      if (uname) {
        /* Com prazo. Sem ele, um @ que nunca aparece na lista deixaria o pedido
           pendurado, e o modal pularia numa atualização qualquer minutos depois
           — fora de contexto, e sem a pessoa entender de onde veio. */
        setEmendaMobile({ username: uname, ate: Date.now() + 60_000 });
      }
    }
    else if (oauth === 'error') { showToast('error', 'Erro na conexão', params.get('msg') || 'Falha no OAuth'); }
    window.history.replaceState({}, '', '/accounts');
  }, []);

  /* Guarda o @ da conta que acabou de conectar pela via oficial, para abrir o
     login mobile assim que ela aparecer na lista. Não dá para abrir de imediato:
     `loadAccounts` é assíncrono, e o modal precisa do `_id` para saber em qual
     conta gravar a sessão — sem ele, o login criaria uma conta duplicada. */
  const [emendaMobile, setEmendaMobile] = useState(null);

  useEffect(() => {
    if (!emendaMobile) return;
    if (Date.now() > emendaMobile.ate) { setEmendaMobile(null); return; }
    /* `accounts`, e não `safeAccounts`: aquele é declarado 600 linhas abaixo, e
       referenciar um `const` antes da declaração funciona aqui — o callback do
       efeito só roda depois do render — mas é o mesmo padrão que faz o
       compilador do React desistir de memoizar o que estiver no meio. */
    const lista = Array.isArray(accounts) ? accounts : [];
    const conta = lista.find(
      a => (a.username || '').toLowerCase() === emendaMobile.username.toLowerCase());
    if (!conta) return;                       // ainda não chegou na lista
    setEmendaMobile(null);
    if (conta.hasInstagrapiSession) return;   // já tem: nada a pedir
    openInstaModal(conta);
    setInstaModal(m => (m ? { ...m, emenda: true } : m));
  }, [emendaMobile, accounts]);

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

  /* ── Link em story (Graph via Facebook Login) ─────────────────────────────
     Segunda conexão, feita DEPOIS da conta já existir. Ela não substitui a
     primeira: story sem link continua saindo pelo token de sempre. O que ela
     acrescenta é a única coisa que o outro token não faz — a figurinha de link,
     que a Meta só libera para token emitido para uma Página. */

  /* ── Entrar na API mobile em um clique ────────────────────────────────────

     O token da API oficial NÃO vira sessão mobile — são dois sistemas de
     autenticação diferentes. O oficial é emitido pela Meta por OAuth e só vale
     nos endereços públicos da Graph; a sessão mobile é a de um aparelho logado
     no aplicativo, e o Instagram só a emite para quem apresenta a senha ou um
     sessionid. Não existe conversão entre as duas.

     O que dá para eliminar é a digitação repetida: o servidor tenta primeiro
     reativar a sessão que já existe e, se não houver, entra com a senha
     guardada. Só sobra um caso pedindo teclado — conta sem senha guardada e sem
     sessão — e aí é uma vez só. */

  async function entrarNoMobile(account) {
    const key = `mobile:${account._id}`;
    setConnecting(p => ({ ...p, [key]: true }));
    try {
      const { data } = await api.post(`/accounts/${account._id}/mobile-1clique`);
      if (data?.status === 'TWO_FACTOR_REQUIRED') {
        showToast('warning', 'Falta o código', 'Esta conta usa verificação em duas etapas.');
        openInstaModal(account);
        return;
      }
      showToast('success', 'API Mobile ativa',
        data?.via === 'sessao'
          ? `@${account.username} — sessão reativada, sem precisar da senha`
          : `@${account.username} entrou com a senha guardada`);
      loadAccounts();
    } catch (err) {
      const d = err.response?.data || {};
      if (d.code === 'SEM_SENHA') {
        /* Uma vez só. O modal já existe e trata 2FA e desafio — abrir aqui
           evita construir um segundo caminho de login que teria de aprender as
           mesmas coisas de novo. */
        showToast('info', 'Senha necessária uma vez', d.comoResolver || '');
        openInstaModal(account);
        return;
      }
      showToast('error', 'Não foi possível entrar', d.error || err.message);
    } finally {
      setConnecting(p => ({ ...p, [key]: false }));
    }
  }

  async function ativarLinkEmStory(account) {
    const key = `link:${account._id}`;
    setConnecting(p => ({ ...p, [key]: true }));
    try {
      /* O mesmo app da Meta que a tela usa para conectar. Deixar o servidor
         resolver o padrao aqui abriria o dialogo de um app e trocaria o codigo
         em outro, quando ha mais de um cadastrado. */
      const res = await api.get('/graph-link/start', {
        params: { accountId: account._id, ...(selectedAppId ? { metaAppId: selectedAppId } : {}) },
      });
      const url = res.data?.url;
      if (!url) throw new Error('URL de autorização não retornada');
      /* Mesma aba, não popup: bloqueador de popup engoliria a janela em
         silêncio e o botão pareceria não funcionar. */
      window.location.href = url;
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || err.message);
      setConnecting(p => ({ ...p, [key]: false }));
    }
  }

  async function desativarLinkEmStory(account) {
    if (!window.confirm(
      `Desativar link em story de @${account.username}?\n\n` +
      'A conta continua publicando normalmente — só os stories deixam de sair com a figurinha de link.'
    )) return;
    try {
      await api.delete(`/graph-link/${account._id}`);
      showToast('success', 'Link desativado', `@${account.username} volta a publicar story sem link`);
      loadAccounts();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || err.message);
    }
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

  /* ── Editar perfil ────────────────────────────────────────────────────────
     Contas instagrapi editam nome, bio, link e gênero pela própria sessão —
     sem senha e sem navegador. O link da bio só é alterável por este caminho. */

  function openPerfilModal(account) {
    setPerfilModal(account);
    setPerfilErro('');
    setPerfilRisco(null);
    if (perfilPreview) URL.revokeObjectURL(perfilPreview);
    setPerfilPreview(null);
    setPerfilForm({
      fullName:    account.name || '',
      biography:   account.bio  || '',
      externalUrl: account.externalLink || '',
      gender:      '',
      foto:        null,
    });
  }

  function escolherFotoPerfil(file) {
    if (perfilPreview) URL.revokeObjectURL(perfilPreview);
    setPerfilPreview(file ? URL.createObjectURL(file) : null);
    setPerfilForm(f => ({ ...f, foto: file || null }));
  }

  function fecharPerfilModal() {
    if (perfilPreview) URL.revokeObjectURL(perfilPreview);
    setPerfilPreview(null);
    setPerfilModal(null);
  }

  async function salvarPerfil(confirmarRisco = false) {
    if (!perfilModal) return;
    setPerfilSalvando(true);
    setPerfilErro('');
    if (!confirmarRisco) setPerfilRisco(null);
    try {
      // multipart porque a foto vai no mesmo envio (campo `photo` na rota)
      const fd = new FormData();
      if (perfilForm.fullName    !== '') fd.append('fullName',    perfilForm.fullName);
      if (perfilForm.biography   !== '') fd.append('biography',   perfilForm.biography);
      if (perfilForm.externalUrl !== '') fd.append('externalUrl', perfilForm.externalUrl);
      if (perfilForm.gender      !== '') fd.append('gender',      perfilForm.gender);
      if (perfilForm.foto)               fd.append('photo',       perfilForm.foto);
      if (confirmarRisco)                fd.append('confirmarRisco', 'true');

      await api.post(`/profile-edit/${perfilModal._id}`, fd);
      // O resultado real chega pelo evento SSE 'profile_edit' — aqui só
      // confirmamos o envio, sem afirmar que o Instagram aceitou.
      showToast('info', 'Enviado', `@${perfilModal.username} — aplicando no Instagram...`);
      fecharPerfilModal();
    } catch (err) {
      const dados = err.response?.data;
      if (dados?.code === 'PROFILE_EDIT_RISK') {
        // Não é falha: é bloqueio proposital, aguardando decisão consciente.
        setPerfilRisco(dados.motivos || []);
      } else {
        setPerfilErro(dados?.error || err.message || 'Falha ao editar o perfil');
      }
    } finally {
      setPerfilSalvando(false);
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
    ACCOUNT_SUSPENDED:              'Esta conta está SUSPENSA pelo Instagram. Nenhuma automação consegue conectá-la enquanto isso durar — entre no app oficial com ela e siga o processo de recurso.',
    TWO_FACTOR_REQUIRED:            'Digite o código enviado pelo seu método de autenticação.',
    BAD_PASSWORD:                   'O Instagram recusou o login. Se a senha está certa, ele está bloqueando a tentativa — veja o detalhe abaixo.',
    USER_NOT_FOUND:                 'O Instagram não encontrou nenhuma conta com esse @. Confira o nome de usuário exatamente como aparece no perfil — ou tente o e-mail cadastrado.',
    TWO_FACTOR_NO_SESSION:          'O código foi aceito, mas o Instagram não liberou a sessão. Faça o login novamente — se repetir, aguarde alguns minutos antes de tentar.',
    NOT_APPROVED_YET:               'O Instagram ainda não registrou a aprovação. Abra o app, aprove a tentativa de login e confirme aqui de novo.',
    CHALLENGE_CODE_REJECTED:        'Código incorreto. Confira o e-mail/SMS e digite novamente.',
    NO_PENDING_CHALLENGE:           'O prazo da verificação expirou (10 min). Faça o login novamente.',
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

  /**
   * Pergunta ao Instagram se um @ existe, usando a sessão de uma conta já
   * conectada como sonda. Chamado quando o login falha com USER_NOT_FOUND, para
   * separar "@ digitado errado" de "@ existe e o login está sendo recusado".
   */
  async function verificarUsername(uname) {
    try {
      const { data } = await api.get(`/accounts/check-username/${encodeURIComponent(uname)}`);
      if (!data.available) {
        return 'Não há conta conectada para verificar o @ — confira manualmente em instagram.com/' + uname;
      }
      if (data.exists) {
        return `Verificado: o @ EXISTE no Instagram (${data.full_name || 'sem nome'} · ${data.followers} seguidores). `
             + 'Então o problema não é o nome de usuário — o Instagram está recusando o login em si.';
      }
      return `Verificado: esse @ NÃO existe no Instagram. Confira separadores — a outra conta sua tem underscore no início `
           + `(ex.: _${uname} ou ${uname.replace(/(\d+)$/, '.$1')}).`;
    } catch {
      return '';
    }
  }

  function _igMessage(code, fallback) {
    return INSTA_MESSAGES[code] || fallback || 'Não foi possível autenticar. Verifique suas credenciais.';
  }

  /**
   * @param {{ignorarCooldown?: boolean}} [opts] — ignorarCooldown é usado pela
   *   retomada após aprovação no app, onde esperar faria a aprovação expirar.
   */
  async function connectInstagrapi(opts = {}) {
    const uname = instaModal.username.trim().replace(/^@/, '');
    // Guardas visíveis: antes retornavam em silêncio, e quando esta função era
    // chamada por outro fluxo (retomada após aprovação no app) a tela voltava às
    // credenciais sem explicação nenhuma — parecia que o clique não fez nada.
    if (!uname) {
      setInstaModal(m => ({ ...m, loading: false, error: 'Informe o usuário do Instagram.' }));
      return;
    }
    if (!instaModal.password.trim()) {
      setInstaModal(m => ({
        ...m, loading: false,
        error: 'A senha foi apagada do campo. Digite novamente para concluir a conexão.',
      }));
      return;
    }
    // A espera não se aplica à retomada após aprovação no app: o Instagram acabou
    // de autorizar a tentativa, e esperar aqui deixaria a aprovação expirar.
    if (cooldownSecs > 0 && !opts.ignorarCooldown) {
      const m2 = Math.floor(cooldownSecs / 60), s2 = String(cooldownSecs % 60).padStart(2, '0');
      setInstaModal(m => ({
        ...m, loading: false, status: 'RATE_LIMITED',
        error: `Limite de tentativas ativo neste IP — aguarde ${m2}:${s2} antes de tentar novamente.`,
      }));
      return;
    }
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      const r = await api.post('/accounts/instagrapi-direct', {
        username:  uname,
        password:  instaModal.password.trim(),
        ...(instaModal.accountId ? { accountId: instaModal.accountId } : {}),
        // 2FA code is collected in step 'two_factor' after Instagram requests it — not here
      });
      // 202 — desafio de verificação. Dois tipos: 'approval' (aprovar no app,
      // sem código) e 'code' (código por e-mail/SMS).
      if (r.data?.status === 'CHALLENGE_REQUIRED') {
        setInstaModal(m => ({
          ...m,
          loading:       false,
          step:          'challenge',
          totp:          '',
          challengeKind: r.data?.kind === 'approval' ? 'approval' : 'code',
          channel:       r.data?.channel || null,
          status:        'CHALLENGE_REQUIRED',
          // Cair de novo no desafio logo após uma aprovação significa que o
          // Instagram não registrou o "fui eu". Sem dizer isso, a tela parecia
          // apenas "voltar sozinha" e o usuário repetia o ciclo às cegas.
          // opts vem direto da chamada; não depende do tempo de atualização do
          // estado do React, que poderia ainda não ter aplicado a marcação.
          error: (opts.aprovacaoTentada || m.aprovacaoTentada)
            ? 'O Instagram bloqueou o login por falta de 2FA. Para evitar loop e banimento, feche esta janela e conecte via Session ID ou ative o 2FA no seu app.'
            : '',
          aprovacaoTentada: false,
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
        detail:  err.response?.data?.detail || '',
      }));
      // O Instagram diz que o @ não existe — confirmamos com uma sessão já
      // conectada em vez de deixar a dúvida entre erro de digitação e bloqueio.
      if (code === 'USER_NOT_FOUND') {
        const veredito = await verificarUsername(uname);
        if (veredito) setInstaModal(m => (m ? { ...m, veredito } : m));
      }
    }
  }

  /**
   * Confirma que o usuário aprovou a tentativa de login no app do Instagram.
   * O servidor reconhece o checkpoint e então repetimos o login — a senha
   * continua apenas nesta tela, nunca foi armazenada no servidor.
   */
  async function confirmChallengeApproval() {
    const uname = instaModal.username.trim().replace(/^@/, '');
    if (!uname) return;
    setInstaModal(m => ({ ...m, loading: true, error: '', status: 'CONNECTING' }));
    try {
      await api.post('/accounts/instagrapi-challenge-approved', { username: uname });
      // Reconhecido — refaz o login, que agora deve passar. A espera local é
      // ignorada de propósito: a aprovação tem validade curta.
      setRateLimitExpiry(null);
      setCooldownSecs(0);
      try { localStorage.removeItem(`ig_rl_${uname}`); } catch {}
      // Marca a tentativa para que um novo desafio logo em seguida seja
      // explicado, em vez de a tela simplesmente voltar sem motivo aparente.
      setInstaModal(m => ({ ...m, step: 'credentials', error: '', status: null, aprovacaoTentada: true }));
      await connectInstagrapi({ ignorarCooldown: true, aprovacaoTentada: true });
    } catch (err) {
      const errCode = err.response?.data?.code || '';
      const expirou = errCode === 'NO_PENDING_CHALLENGE' || errCode === 'CHALLENGE_FAILED';
      setInstaModal(m => ({
        ...m,
        loading: false,
        // NOT_APPROVED_YET mantém o passo: o usuário aprova no app e confirma de novo.
        step:    expirou ? 'credentials' : 'challenge',
        status:  errCode || 'AUTH_FAILED',
        error:   _igMessage(errCode, err.response?.data?.error),
        detail:  err.response?.data?.detail || '',
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
      const r = await api.post('/accounts/instagrapi-challenge-code', { username: uname, code });
      // Checkpoint resolvido mas sem sessão: refaz o login, que agora passa sem
      // desafio no caminho. A senha continua nesta tela — nunca foi ao servidor.
      if (r.data?.status === 'RELOGIN_REQUIRED') {
        setInstaModal(m => ({ ...m, step: 'credentials', totp: '', error: '', status: null }));
        await connectInstagrapi();
        return;
      }
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
        detail:  err.response?.data?.detail || '',
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
        detail:  err.response?.data?.detail || '',
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
        detail:  err.response?.data?.detail || '',
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
        detail:  err.response?.data?.detail || '',
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
    if (s === 'restrita')        return 'var(--mf-warning-500)';
    if (s === 'banida')          return 'var(--mf-danger-500)';
    if (s === 'token_invalido')  return 'var(--mf-danger-500)';
    if (s === 'sessao_expirada') return 'var(--mf-warning-500)';
    if (s === 'erro_login')      return 'var(--mf-danger-500)';
    if (s === 'desconectada')    return 'var(--mf-text-3)';
    return 'var(--mf-success-500)';
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
    if (s === 'VALID')                         return 'var(--mf-success-500)';
    if (s === 'EXPIRING' || s === 'RECOVERING') return 'var(--mf-warning-500)';
    if (s === 'RATE_LIMITED')                  return 'var(--mf-warning-500)';
    if (s === 'NETWORK_ERROR')                 return 'var(--mf-text-3)';
    if (s === 'UNKNOWN')                       return 'var(--mf-text-3)';
    return 'var(--mf-danger-500)';
  }

  /* ── stat cards config ────────────────────────────────────────────── */
  const STATS = [
    { label: 'CONECTADAS',  value: fmt(safeAccounts.length), color: 'var(--mf-primary-500)', Icon: IcoUsers,  numColor: 'var(--mf-text)' },
    { label: 'SAUDÁVEIS',   value: fmt(activeAccounts),      color: 'var(--mf-mod-contas)', Icon: IcoShield, numColor: 'var(--mf-text)' },
    { label: 'COM ERRO',    value: fmt(errorAccounts),       color: 'var(--mf-danger-500)', Icon: IcoWarn,   numColor: 'var(--mf-text)' },
    { label: 'SEGUIDORES',  value: fmt(totalFollowers),      color: 'var(--mf-warning-500)', Icon: IcoTrend,  numColor: 'var(--mf-warning-500)' },
    { label: 'PUBLICAÇÕES', value: fmt(totalPosts),          color: 'var(--mf-warning-500)', Icon: IcoGrid,   numColor: 'var(--mf-warning-500)' },
  ];

  /**
   * Conta realmente conectada: tem token da Meta API ou sessão mobile salva.
   * `healthStatus` NÃO serve para isso — ele nasce saudável numa conta nova, e
   * usá-lo fazia o card anunciar "API conectada" para conta que nunca conectou.
   * Os flags vêm do backend, que nunca expõe token nem sessão em si.
   */
  const isLinked = a => !!(a?.hasApiToken || a?.hasInstagrapiSession || a?.hasIgSession);

  /* ── health helpers ── */
  /* Saúde da conta no vocabulário do sistema. Antes cada estado carregava o
     próprio rgba de fundo e de borda — sete estados x duas cores, mantidos
     em sincronia na mão. Agora cada estado declara só a intenção, e fundo e
     borda saem dela por color-mix. */
  const hTom = s => ({
    ativa: 'var(--mf-success-500)', restrita: 'var(--mf-warning-500)',
    banida: 'var(--mf-danger-500)', token_invalido: 'var(--mf-danger-500)',
    sessao_expirada: 'var(--mf-warning-500)', erro_login: 'var(--mf-danger-500)',
    desconectada: 'var(--mf-text-3)',
  }[s] || 'var(--mf-success-500)');
  const hBg     = s => `color-mix(in oklch, ${hTom(s)} 10%, transparent)`;
  const hBorder = s => `color-mix(in oklch, ${hTom(s)} 26%, transparent)`;

  /* Rótulos em caixa alta viraram caixa normal: "PUBLICAÇÕES" em versalete
     lê-se letra a letra, "Publicações" lê-se de uma vez. A distinção de
     hierarquia já vem do tamanho e da cor. */
  const STAT_DEFS = [
    { label:'Conectadas',  value:fmt(safeAccounts.filter(isLinked).length), cor:'var(--mf-mod-publicar)', Icon:IcoUsers  },
    { label:'Saudáveis',   value:fmt(activeAccounts),  cor:'var(--mf-success-500)', Icon:IcoShield },
    { label:'Com erro',    value:fmt(errorAccounts),   cor:'var(--mf-danger-500)',  Icon:IcoWarn   },
    { label:'Seguidores',  value:fmt(totalFollowers),  cor:'var(--mf-warning-500)', Icon:IcoTrend  },
    { label:'Publicações', value:fmt(totalPosts),      cor:'var(--mf-mod-contas)',  Icon:IcoGrid   },
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
            <button onClick={() => { setBulkProxyOpen(true); setBulkProxyText(''); }} className="btn-ghost">
              <IcoSignal /> Proxies em massa
            </button>
            <button onClick={syncAll} disabled={syncing} className="btn-ghost">
              {syncing ? <span className="mf-spin" /> : <IcoSync />} {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            {/* Conectar pelo app e conectar pela API são as duas ações que
                criam conta. Ficam juntas e com a cor do módulo publicar para
                se distinguirem das ações de manutenção à esquerda. */}
            <button onClick={() => openInstaModal(null)} className="btn-ghost"
              style={{ background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', borderColor:'color-mix(in oklch, var(--mf-mod-publicar) 30%, transparent)' }}>
              <IcoPhone /> Conectar Instagram
            </button>
            <button onClick={() => openOAuthConnect(null)} disabled={!!connecting['new']} className="btn-primary">
              {connecting['new'] ? <span className="mf-spin" /> : <IcoLink />} {connecting['new'] ? 'Aguarde…' : 'Conectar via API'}
            </button>
          </>
        }
      >
        {/* ── 5 stat cards ── */}
        <div className="accounts-stats-grid" style={{ gap:10 }}>
          {STAT_DEFS.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*.05, duration:.28 }}
              style={{ '--c':s.cor, position:'relative', overflow:'hidden', minWidth:0,
                containerType:'inline-size',
                background:'color-mix(in oklch, var(--c) 9%, transparent)',
                border:'1px solid color-mix(in oklch, var(--c) 20%, transparent)',
                borderRadius:'var(--mf-r-lg)', padding:'var(--mf-4)' }}
            >
              <span aria-hidden="true" style={{ position:'absolute', inset:'auto -8px -12px auto', width:52, height:52, borderRadius:'var(--mf-r-full)',
                background:'radial-gradient(circle, color-mix(in oklch, var(--c) 18%, transparent), transparent 70%)' }} />
              <span style={{ color:'var(--c)', display:'block' }}><s.Icon /></span>
              {/* mono e tabular porque o número muda ao sincronizar: sem
                  largura fixa de dígito, o rótulo abaixo dança a cada troca */}
              <div className="mf-mono" style={{ fontSize:'clamp(1.35rem, 1.05rem + 1.6cqw, 1.75rem)', fontWeight:650, color:'var(--c)', lineHeight:1, letterSpacing:'-.03em', marginTop:'var(--mf-3)' }}>{s.value}</div>
              <div className="mf-trunc" style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-3)', marginTop:5, fontWeight:600 }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* ── Card de Proxy Global ── */}
        {(() => {
          const online  = proxyStatus.ativo && proxyStatus.ok;
          const caiu    = proxyStatus.ativo && !proxyStatus.ok;
          const accent  = online ? 'var(--mf-success-500)' : caiu ? 'var(--mf-danger-500)' : 'var(--mf-mod, var(--mf-accent-500))';
          const accentBg = online ? '16,185,129' : caiu ? '244,63,94' : '0,212,255';

          return (
        <motion.div initial={{ opacity:0, y:-10 }} animate={{ opacity:1, y:0 }} style={{
          background: `linear-gradient(135deg, rgba(${accentBg},.07) 0%, color-mix(in oklch, var(--mf-surface-1) 60%, transparent) 100%)`,
          border: `1px solid rgba(${accentBg},${proxyStatus.ativo ? '.35' : '.18'})`,
          borderLeft: `3px solid ${accent}`,
          borderRadius: 'var(--mf-r-lg)', padding: 16, marginBottom: 20,
          boxShadow: online ? `0 0 24px rgba(${accentBg},.10)` : 'none',
          transition: 'border-color .3s, box-shadow .3s',
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap', marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:11 }}>
              <div style={{ width:36, height:36, borderRadius: 'var(--mf-r-md)', flexShrink:0, display:'grid', placeItems:'center',
                background:`rgba(${accentBg},.12)`, border:`1px solid rgba(${accentBg},.28)`, color:accent }}>
                <IcoGlobe />
              </div>
              <div>
                <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-text)' }}>Proxy Global</div>
                <div style={{ fontSize: 'var(--mf-t-micro)', marginTop:3, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontWeight:700, color:accent }}>
                    <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', background:accent, boxShadow:`0 0 6px ${accent}`,
                      animation: online ? 'pulseGlow 1.8s ease-in-out infinite' : 'none' }} />
                    {online ? 'Ativo e funcionando' : caiu ? 'Ativo — proxy fora do ar' : 'Inativo'}
                  </span>
                  <span style={{ color:'var(--mf-text-3)' }}>
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
                  <div style={{ padding:'4px 12px', borderRadius: 'var(--mf-r-md)', background:'var(--mf-border-subtle)', border:'1px solid var(--mf-border)' }}>
                    <div style={{ fontFamily:'var(--mf-mono)', fontSize:8.5, color:'var(--mf-text-3)', letterSpacing:'.08em' }}>IP DO SERVIDOR</div>
                    <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', textDecoration:'line-through', marginTop:2 }}>{ipDireto}</div>
                  </div>
                )}
                <div style={{ padding:'4px 12px', borderRadius: 'var(--mf-r-md)', background:`rgba(${accentBg},.1)`, border:`1px solid rgba(${accentBg},.3)` }}>
                  <div style={{ fontFamily:'var(--mf-mono)', fontSize:8.5, color:accent, opacity:.8, letterSpacing:'.08em' }}>IP EM USO AGORA</div>
                  <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-sm)', fontWeight:700, color:accent, marginTop:2 }}>
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
                flex: 1, minWidth: 240, padding: '8px 12px', borderRadius: 'var(--mf-r-md)', fontFamily:'var(--mf-mono)',
                border: '1px solid var(--mf-border)', background: 'color-mix(in oklch, var(--mf-bg) 75%, transparent)',
                color: 'var(--mf-text)', fontSize: 'var(--mf-t-xs)', opacity: proxyStatus.ativo ? 0.55 : 1,
              }}
            />
            <button
              onClick={testarProxyGlobal}
              disabled={!proxyUrl.trim() || proxyStatus.testando}
              style={{
                padding: '8px 16px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-xs)', fontWeight: 700, whiteSpace:'nowrap',
                background: 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', color: 'var(--mf-mod, var(--mf-accent-500))', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)',
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
                  padding: '8px 16px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-xs)', fontWeight: 700, whiteSpace:'nowrap',
                  background: 'color-mix(in oklch, var(--mf-success-500) 12%, transparent)', color: 'var(--mf-success-500)', border: '1px solid color-mix(in oklch, var(--mf-success-500) 30%, transparent)',
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
                  padding: '8px 16px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-xs)', fontWeight: 700, whiteSpace:'nowrap',
                  background: 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)', color: 'var(--mf-danger-500)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 28%, transparent)',
                  cursor: 'pointer', opacity: proxyStatus.salvando ? 0.5 : 1,
                }}
              >
                {proxyStatus.salvando ? 'Desativando…' : 'Desativar'}
              </button>
            )}
          </div>

          {proxyStatus.rotating && (
            <div style={{ marginTop:10, padding:'8px 12px', borderRadius: 'var(--mf-r-md)', fontSize: 'var(--mf-t-micro)', lineHeight:1.6,
              background:'color-mix(in oklch, var(--mf-warning-500) 9%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-warning-500) 30%, transparent)', color:'var(--mf-warning-500)' }}>
              <strong>Proxy rotativa detectada</strong> — o IP mudou entre duas medições
              {proxyStatus.ip2 ? <> (<span style={{fontFamily:'var(--mf-mono)'}}>{proxyStatus.ip} → {proxyStatus.ip2}</span>)</> : null}.
              O login do Instagram são 4 requisições em sequência; se cada uma sai de um IP
              diferente, ele recusa mesmo com a senha certa. Peça ao seu provedor uma
              <strong> sticky session</strong> (IP fixo por 10–30 min) para conectar contas.
            </div>
          )}

          {(proxyStatus.ativo || proxyStatus.erro) && (
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:10,
              fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
              {proxyStatus.ativo && (
                <span>Verificado a cada 90s pelo servidor{proxyStatus.lastCheck ? ` — último: ${fmtDateCompact(proxyStatus.lastCheck)}` : ''}</span>
              )}
              {proxyStatus.erro && (
                <span style={{ color:'var(--mf-danger-500)' }}>· {proxyStatus.erro}</span>
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
                  fontSize: 'var(--mf-t-xs)', fontWeight:600, padding:'4px 12px', borderRadius: 'var(--mf-r-xl)', cursor:'pointer', whiteSpace:'nowrap',
                  display:'flex', alignItems:'center', gap:6, transition:'all .15s',
                  background: active ? 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)' : 'var(--mf-border-subtle)',
                  color:       active ? 'var(--mf-mod, var(--mf-accent-500))'        : 'var(--mf-text-3)',
                  border:      active ? '1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : '1px solid var(--mf-border)',
                }}>
                  {f.label}
                  <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 4px', borderRadius: 'var(--mf-r-xl)',
                    background: active ? 'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)' : 'var(--mf-border)',
                    color: active ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)',
                  }}>{f.count}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={toggleSelectMode} style={{
              fontSize: 'var(--mf-t-micro)', fontWeight:700, padding:'4px 12px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap',
              background:   selectMode ? 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)'  : 'color-mix(in oklch, var(--mf-primary-500) 10%, transparent)',
              color:        selectMode ? 'var(--mf-danger-500)'                : 'var(--mf-primary-300)',
              border:       `1px solid ${selectMode ? 'color-mix(in oklch, var(--mf-danger-500) 30%, transparent)' : 'color-mix(in oklch, var(--mf-primary-500) 30%, transparent)'}`,
              fontFamily:'var(--mf-mono)', transition:'all .15s',
            }}>
              {selectMode ? 'Cancelar' : 'Selecionar'}
            </button>
            <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position:'absolute', left:10, color:'var(--mf-text-3)', pointerEvents:'none' }}>
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                style={{ background:'var(--mf-border-subtle)', border:'1px solid var(--mf-border)', borderRadius: 'var(--mf-r-md)', padding:'8px 12px 8px 32px', fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)', outline:'none', width:'min(220px,100%)', minWidth:0, transition:'border-color .18s', fontFamily:'var(--font)' }}
                placeholder="Buscar conta..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={e => e.target.style.borderColor='color-mix(in oklch, var(--mf-mod-contas) 35%, transparent)'}
                onBlur={e => e.target.style.borderColor='var(--mf-border)'}
              />
            </div>
          </div>
        </div>

        {/* ── Account cards grid ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(min(290px,100%),1fr))', gap:12 }}>
          {primeiraCarga && !filteredAccounts.length && (
            <div style={{ gridColumn: '1 / -1' }}><EsqueletoLista itens={6} /></div>
          )}

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
            const linked      = isLinked(account);

            /* Proxy desta conta: o próprio tem prioridade; sem ele vale o global.
               Status e IP vêm do monitoramento contínuo do servidor. */
            const temProxyProprio = !!account.proxy?.trim();
            const usaGlobal       = !temProxyProprio && proxyStatus.ativo;
            const pxOnline        = temProxyProprio ? account.proxyStatus === 'online'  : (usaGlobal && proxyStatus.ok);
            const pxDown          = temProxyProprio ? account.proxyStatus === 'offline' : (usaGlobal && !proxyStatus.ok);
            const pxColor         = pxOnline ? 'var(--mf-success-500)' : pxDown ? 'var(--mf-danger-500)' : 'var(--mf-text-3)';
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
                  background: isSel ? 'color-mix(in oklch, var(--mf-mod-publicar) 12%, var(--mf-surface-1))' : `color-mix(in oklch, var(--mf-surface-1) 92%, transparent)`,
                  border:     isSel ? '1px solid color-mix(in oklch, var(--mf-primary-500) 45%, transparent)' : `1px solid var(--mf-border)`,
                  borderLeft:`3px solid ${hc}`,
                  borderRadius: 'var(--mf-r-lg)', overflow:'hidden',
                  display:'flex', flexDirection:'column',
                  transition:'transform .2s, box-shadow .2s, border-color .2s, background .15s',
                  cursor:'pointer', position:'relative',
                }}
                whileHover={{ y:-2, boxShadow: isSel ? `0 8px 32px color-mix(in oklch, var(--mf-primary-500) 25%, transparent), 0 0 0 1px color-mix(in oklch, var(--mf-primary-500) 40%, transparent)` : `0 8px 32px rgba(0,0,0,.4), 0 0 0 1px ${hc}22` }}
              >
                {/* checkbox indicator — only shown in selectMode */}
                {selectMode && (
                  <div style={{
                    position:'absolute', top:8, right:10, width:18, height:18, borderRadius: 'var(--mf-r-xs)', zIndex:2,
                    border:`1.5px solid ${isSel ? 'var(--mf-primary-300)' : 'var(--mf-border-strong)'}`,
                    background: isSel ? 'var(--mf-primary-300)' : 'color-mix(in oklch, var(--mf-bg) 75%, transparent)',
                    display:'grid', placeItems:'center', transition:'all .15s',
                  }}>
                    {isSel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text)" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                )}

                {/* top line */}
                <div style={{ position:'absolute', top:0, left:16, right:16, height:1, background:`linear-gradient(90deg,transparent,${hc}30,transparent)` }} />

                {/* body */}
                <div style={{ padding:'12px 12px 12px' }}>
                  {/* avatar + name */}
                  <div style={{ display:'flex', alignItems:'center', gap:11, marginBottom:11 }}>
                    <div style={{ flexShrink:0, position:'relative' }}>
                      {account.avatar
                        ? <img src={avatarUrl(account.avatar)} alt="" onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}
                            style={{ width:44, height:44, borderRadius: 'var(--mf-r-full)', objectFit:'cover', border:`2px solid ${hc}55`, display:'block' }} />
                        : null}
                      <div style={{ width:44, height:44, borderRadius: 'var(--mf-r-full)', background:`linear-gradient(135deg,${hc}22,${hc}11)`, border:`2px solid ${hc}33`,
                        display:account.avatar?'none':'flex', alignItems:'center', justifyContent:'center', fontSize: 'var(--mf-t-h2)', fontWeight:800, color:hc }}>
                        {account.username?.charAt(0)?.toUpperCase() || 'I'}
                      </div>
                      {/* status dot */}
                      <span style={{ position:'absolute', bottom:1, right:1, width:9, height:9, borderRadius: 'var(--mf-r-full)', background:hc, border:'2px solid var(--mf-surface-1)', boxShadow:`0 0 6px ${hc}` }} />
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span style={{ fontWeight:700, fontSize: 'var(--mf-t-sm)', color:'var(--mf-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:140 }}>{account.name || account.username}</span>
                        <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color:'var(--mf-text-3)', fontSize: 'var(--mf-t-nano)', textDecoration:'none', flexShrink:0, lineHeight:1 }}>↗</a>
                      </div>
                      <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:1 }}>@{account.username}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:5, flexWrap:'wrap' }}>
                        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:600, padding:'2px 8px 2px 4px', borderRadius: 'var(--mf-r-xl)',
                          background:`${hc}15`, color:hc, border:`1px solid ${hc}28`,
                          display:'inline-flex', alignItems:'center', gap:4 }}>
                          <span style={{ width:5, height:5, borderRadius: 'var(--mf-r-full)', background:hc, boxShadow:`0 0 5px ${hc}` }} />
                          {hl}
                        </span>
                        <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-xl)', background:'var(--mf-border-subtle)', color:'var(--mf-text-3)', letterSpacing:'.5px' }}>{accType}</span>
                        {account.provider === 'instagrapi' && (
                          <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-xl)', background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 25%, transparent)', letterSpacing:'.4px' }}>
                            API Mobile
                          </span>
                        )}
                        <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-xl)', background:'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)', textDecoration:'none', whiteSpace:'nowrap', letterSpacing:'.3px' }}>
                          Ver Perfil ↗
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* mini stats */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', borderTop:'1px solid var(--mf-border)', paddingTop:9 }}>
                    {[
                      { label:'SEGUIDORES',  value:fmt(account.followers)  },
                      { label:'SEGUINDO',    value:fmt(account.following)  },
                      { label:'POSTS',       value:fmt(account.postsCount) },
                    ].map((s, i) => (
                      <div key={s.label} style={{ textAlign:'center', padding:'4px 4px', borderRight:i<2?'1px solid var(--mf-border)':'none' }}>
                        <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700, color:'var(--mf-text-3)', letterSpacing:'.8px', marginBottom:3, textTransform:'uppercase' }}>{s.label}</div>
                        <div style={{ fontSize: 'var(--mf-t-h2)', fontWeight:800, color:'var(--mf-text)', letterSpacing:'-0.5px', fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* meta row */}
                <div style={{ height:1, background:'var(--mf-border)' }} />
                <div style={{ padding:'4px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                  {!linked ? (
                    // Sem token e sem sessão: a conta existe no painel mas não está
                    // conectada a nada. Antes isso aparecia como "API conectada".
                    <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', display:'flex', alignItems:'center', gap:5, color:'var(--mf-danger-500)' }}>
                      <IcoWifi /> Não conectada
                    </span>
                  ) : account.provider === 'instagrapi' && account.sessionStatus ? (
                    <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', display:'flex', alignItems:'center', gap:5,
                      color: sessionStatusColor(account.sessionStatus) }}>
                      <IcoPhone />
                      {sessionStatusLabel(account.sessionStatus)}
                      {account.consecutiveFailures > 0 && (
                        <span style={{ fontSize: 'var(--mf-t-nano)', opacity:.7 }}>({account.consecutiveFailures} falhas)</span>
                      )}
                    </span>
                  ) : (
                    <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:isHealthy?'var(--mf-success-500)':account.healthStatus==='restrita'?'var(--mf-warning-500)':'var(--mf-danger-500)', display:'flex', alignItems:'center', gap:5 }}>
                      <IcoWifi /> {isHealthy ? 'API conectada' : account.healthStatus === 'restrita' ? 'Conta restrita' : account.healthStatus === 'sessao_expirada' ? 'Sessão expirada' : account.healthStatus === 'token_invalido' ? 'Token inválido' : account.healthStatus === 'banida' ? 'Conta banida' : account.healthStatus === 'erro_login' ? 'Erro de login' : 'API desconectada'}
                    </span>
                  )}
                  <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <IcoWave /> {compact}
                  </span>
                </div>

                {/* proxy row — por onde esta conta está saindo, ao vivo */}
                <div style={{ height:1, background:'var(--mf-border)' }} />
                <div style={{ padding:'4px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:6,
                  background: pxOnline ? 'color-mix(in oklch, var(--mf-success-500) 5%, transparent)' : pxDown ? 'color-mix(in oklch, var(--mf-danger-500) 5%, transparent)' : 'transparent' }}>
                  <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', display:'flex', alignItems:'center', gap:5, color:pxColor, minWidth:0 }}>
                    <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', flexShrink:0, background:pxColor,
                      boxShadow: pxOnline ? `0 0 6px ${pxColor}` : 'none',
                      animation: pxOnline ? 'pulseGlow 1.8s ease-in-out infinite' : 'none' }} />
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pxLabel}</span>
                  </span>
                  {pxIp && (
                    <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight:700, color:pxColor, flexShrink:0 }}>
                      {pxIp}
                    </span>
                  )}
                </div>

                {/* actions */}
                <div style={{ height:1, background:'var(--mf-border)' }} />
                <div onClick={e => e.stopPropagation()} style={{ padding:'8px 8px', display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
                  <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize: 'var(--mf-t-xs)', fontWeight:600, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', border:'1px solid var(--mf-border)', color:'var(--mf-text-3)', background:'transparent', textDecoration:'none', whiteSpace:'nowrap', transition:'all .15s', flexShrink:0 }}
                    onMouseEnter={e => { e.currentTarget.style.color='var(--mf-text)'; e.currentTarget.style.borderColor='var(--mf-border-strong)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color='var(--mf-text-3)'; e.currentTarget.style.borderColor='var(--mf-border)'; }}
                  ><IcoEye /> Ver</a>

                  {account.provider === 'instagrapi' ? (
                    <button onClick={() => openInstaModal(account)} title="Reconectar via API Mobile"
                      style={{ flexGrow:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)',
                        background:'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)', cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', transition:'all .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)'}
                      onMouseLeave={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)'}
                    ><IcoPhone /> <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>Sessão</span></button>
                  ) : (
                    <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                      style={{ flexGrow:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)',
                        background:'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)', cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', transition:'all .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-contas) 16%, transparent)'}
                      onMouseLeave={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)'}
                    ><IcoPerson /> <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{isConnecting ? '...' : 'Editar'}</span></button>
                  )}

                  <button onClick={() => openProxyModal(account)} title={account.proxy ? `Proxy: ${account.proxy}` : 'Configurar proxy exclusivo desta conta'}
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize: 'var(--mf-t-xs)', fontWeight:600, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                      background: temProxyProprio ? (pxOnline ? 'color-mix(in oklch, var(--mf-success-500) 12%, transparent)' : pxDown ? 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)' : 'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)') : 'var(--mf-border-subtle)',
                      color:      temProxyProprio ? (pxOnline ? 'var(--mf-success-500)' : pxDown ? 'var(--mf-danger-500)' : 'var(--mf-mod-publicar)') : 'var(--mf-text-3)',
                      border:     temProxyProprio ? `1px solid ${pxOnline ? 'color-mix(in oklch, var(--mf-success-500) 30%, transparent)' : pxDown ? 'color-mix(in oklch, var(--mf-danger-500) 28%, transparent)' : 'color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)'}` : '1px solid var(--mf-border)',
                    }}
                  ><IcoSignal /> Proxy</button>

                  {/* Editar perfil — nome, bio, link e gênero pela sessão salva */}
                  <button onClick={() => openPerfilModal(account)} title="Editar nome, bio, link da bio e foto"
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize: 'var(--mf-t-xs)', fontWeight:600, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                      background:'color-mix(in oklch, var(--mf-mod-publicar) 10%, transparent)', color:'var(--mf-mod-publicar)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 25%, transparent)' }}
                    onMouseEnter={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-publicar) 18%, transparent)'}
                    onMouseLeave={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-publicar) 10%, transparent)'}
                  ><IcoPerson /> Perfil</button>

                  <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                    title={needsRecon ? 'Reconectar' : 'API ok'}
                    style={{ display:'flex', alignItems:'center', gap:4, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                      background: needsRecon ? 'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)' : 'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',
                      color:      needsRecon ? 'var(--mf-danger-500)'           : 'var(--mf-success-500)',
                      border:     needsRecon ? '1px solid color-mix(in oklch, var(--mf-danger-500) 28%, transparent)' : '1px solid color-mix(in oklch, var(--mf-success-500) 25%, transparent)',
                    }}
                  ><IcoCheck /> API</button>

                  {/* API Mobile em um clique. É ela que destrava o aquecimento
                      de verdade (Explorar, hashtags, stories de outros perfis) e
                      o story com link sem depender de Página do Facebook. */}
                  <button
                    onClick={() => account.hasInstagrapiSession
                      ? openInstaModal(account)
                      : entrarNoMobile(account)}
                    disabled={!!connecting[`mobile:${account._id}`]}
                    title={account.hasInstagrapiSession
                      ? 'API Mobile ativa — clique para gerenciar a sessão'
                      : 'Entrar na API Mobile. Destrava o aquecimento completo e o story com link.'}
                    style={{ display:'flex', alignItems:'center', gap:4, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                      background: account.hasInstagrapiSession ? 'color-mix(in oklch, var(--mf-success-500) 12%, transparent)' : 'var(--mf-border-subtle)',
                      color:      account.hasInstagrapiSession ? 'var(--mf-success-500)' : 'var(--mf-text-3)',
                      border:     account.hasInstagrapiSession ? '1px solid color-mix(in oklch, var(--mf-success-500) 28%, transparent)' : '1px solid var(--mf-border)',
                    }}
                  >
                    {connecting[`mobile:${account._id}`] ? <span className="mf-spin" /> : <IcoPhone />}
                    <span>{account.hasInstagrapiSession ? 'Mobile on' : 'Mobile'}</span>
                  </button>

                  {/* Link em story. Só para contas da API oficial: nas contas
                      instagrapi o link já sai nativo, e o botão seria um
                      caminho a mais para o mesmo lugar. */}
                  {account.provider !== 'instagrapi' && (
                    <button
                      onClick={() => account.linkEmStoryAtivo
                        ? desativarLinkEmStory(account)
                        : ativarLinkEmStory(account)}
                      disabled={!!connecting[`link:${account._id}`]}
                      title={account.linkEmStoryAtivo
                        ? `Story com link ativo pela Página "${account.fbPageName || '—'}". Clique para desativar.`
                        : 'Ativar link em story — conecta a Página do Facebook, o único caminho que a Meta permite para a figurinha de link'}
                      style={{ display:'flex', alignItems:'center', gap:4, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                        background: account.linkEmStoryAtivo ? 'color-mix(in oklch, var(--mf-mod-publicar) 12%, transparent)' : 'var(--mf-border-subtle)',
                        color:      account.linkEmStoryAtivo ? 'var(--mf-mod-publicar)' : 'var(--mf-text-3)',
                        border:     account.linkEmStoryAtivo ? '1px solid color-mix(in oklch, var(--mf-mod-publicar) 28%, transparent)' : '1px solid var(--mf-border)',
                      }}
                    >
                      {connecting[`link:${account._id}`] ? <span className="mf-spin" /> : <IcoLink />}
                      <span>{account.linkEmStoryAtivo ? 'Link on' : 'Link'}</span>
                    </button>
                  )}

                  <button onClick={() => deleteAccount(account._id)} title="Excluir conta"
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', flexShrink:0,
                      background:'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', color:'var(--mf-danger-500)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 20%, transparent)', cursor:'pointer', transition:'all .15s' }}
                    onMouseEnter={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-danger-500) 16%, transparent)'}
                    onMouseLeave={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-danger-500) 8%, transparent)'}
                  ><IcoTrash /></button>
                </div>
              </motion.div>
            );
          })}

          {!primeiraCarga && !filteredAccounts.length && (
            <div style={{ gridColumn:'1 / -1', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 16px', color:'var(--mf-text-3)', gap:12 }}>
              <div style={{ width:56, height:56, borderRadius: 'var(--mf-r-lg)', background:'var(--mf-border-subtle)', border:'1px solid var(--mf-border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <IcoUsers />
              </div>
              <div style={{ fontSize: 'var(--mf-t-body)', fontWeight:600, color:'var(--mf-text-2)' }}>Nenhuma conta encontrada</div>
              <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)', textAlign:'center' }}>
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
                background:'color-mix(in oklch, var(--mf-primary-500) 12%, var(--mf-surface-1))',
                border:'1px solid var(--mf-border-strong)',
                borderRadius: 'var(--mf-r-lg)', padding:'8px 16px',
                display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                boxShadow:'0 8px 32px rgba(0,0,0,.55), 0 0 0 1px color-mix(in oklch, var(--mf-primary-500) 22%, transparent)',
                backdropFilter:'blur(12px)', zIndex:100,
                maxWidth:'calc(100vw - 32px)',
              }}
            >
              <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-xs)', fontWeight:700, color:'var(--mf-primary-300)',
                background:'color-mix(in oklch, var(--mf-primary-500) 15%, transparent)', padding:'2px 8px', borderRadius: 'var(--mf-r-xl)', border:'1px solid color-mix(in oklch, var(--mf-primary-500) 25%, transparent)' }}>
                {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
              </span>
              <button onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }} style={{
                fontSize: 'var(--mf-t-xs)', fontWeight:600, padding:'4px 12px', borderRadius: 'var(--mf-r-sm)',
                background:'var(--mf-border)', color:'var(--mf-text-2)',
                border:'1px solid var(--mf-border-strong)', cursor:'pointer', transition:'all .15s',
              }}>Desmarcar</button>
              <button onClick={() => setBulkDeleteModal(true)} disabled={bulkDeleting} style={{
                fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 12px', borderRadius: 'var(--mf-r-sm)',
                background:'color-mix(in oklch, var(--mf-danger-500) 15%, transparent)', color:'var(--mf-danger-500)',
                border:'1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', cursor:'pointer',
                display:'flex', alignItems:'center', gap:6, transition:'all .15s',
              }}><IcoTrash /> Excluir {selectedIds.size}</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 0' }}>
            <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', opacity:page<=1?.4:1 }} disabled={page<=1} onClick={() => goToPage(page-1)}>← Anterior</button>
            <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>Página {pagination.page} de {pagination.pages} · {pagination.total} contas</span>
            <button className="btn-ghost" style={{ fontSize: 'var(--mf-t-xs)', padding:'4px 12px', opacity:page>=pagination.pages?.4:1 }} disabled={page>=pagination.pages} onClick={() => goToPage(page+1)}>Próxima →</button>
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
                <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 3 }}>
                  {oauthModal.account ? `Reconectar @${oauthModal.account.username}` : 'Nova conta Instagram Business/Creator'}
                </div>
              </div>
              <button onClick={() => { setOauthModal(null); setOauthWaiting(false); setCallbackUrl(''); setOauthError(''); setUrlCopied(false); setTokenValue(''); setTokenError(''); }} style={{ background: 'none', border: 'none', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* ── Seletor de App Meta (só aparece se há >1 app) ── */}
            {metaApps.length > 1 && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: .5, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>App Meta a usar</label>
                <select
                  value={selectedAppId}
                  onChange={e => setSelectedAppId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--mf-r-md)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">— Padrão do servidor (env vars) —</option>
                  {metaApps.map(a => (
                    <option key={a._id} value={a._id}>{a.name}{a.isDefault ? ' ★' : ''} — {a.appId}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Conexão rápida por token ── */}
            <div style={{ background:'color-mix(in oklch, var(--mf-mod-contas) 5%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 18%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'16px 16px', marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod, var(--mf-accent-500))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span style={{ fontWeight:700, fontSize: 'var(--mf-t-body)', color:'var(--mf-text)' }}>Conexão rápida por token</span>
                <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight:700, padding:'2px 8px', borderRadius: 'var(--mf-r-xl)', background:'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', letterSpacing:.5 }}>RECOMENDADO</span>
              </div>
              <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', marginBottom:10, lineHeight:1.6 }}>
                Cole seu token <strong style={{ color:'var(--mf-text-2)' }}>IGAA</strong> abaixo. Obtenha-o em{' '}
                <strong style={{ color:'var(--mf-text-2)' }}>Meta → Instagram → Gerar tokens de acesso</strong>.
              </div>
              <textarea
                value={tokenValue}
                onChange={e => { setTokenValue(e.target.value); setTokenError(''); }}
                placeholder="IGAA_xxx..."
                rows={2}
                style={{
                  width:'100%', boxSizing:'border-box', padding:'8px 12px',
                  borderRadius: 'var(--mf-r-md)', border:`1px solid ${tokenError ? 'color-mix(in oklch, var(--mf-danger-500) 50%, transparent)' : 'color-mix(in oklch, var(--mf-mod-contas) 20%, transparent)'}`,
                  background:'var(--bg3)', color:'var(--mf-text)', fontSize: 'var(--mf-t-xs)',
                  fontFamily:'monospace', resize:'none', lineHeight:1.5, outline:'none',
                }}
              />
              {tokenError && <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-danger-500)', marginTop:6 }}>{tokenError}</div>}
              <button
                onClick={handleTokenConnect}
                disabled={!tokenValue.trim() || tokenConnecting}
                style={{
                  marginTop:10, width:'100%', padding:'8px', borderRadius: 'var(--mf-r-md)', border:'none',
                  background: tokenValue.trim() ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--bg3)',
                  color: tokenValue.trim() ? '#000' : 'var(--mf-text-3)',
                  fontSize: 'var(--mf-t-sm)', fontWeight:700, cursor: tokenValue.trim() ? 'pointer' : 'not-allowed',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                  transition:'all .2s',
                }}
              >
                {tokenConnecting
                  ? <><span style={{ width:14, height:14, border:'2px solid rgba(0,0,0,.3)', borderTopColor:'#000', borderRadius: 'var(--mf-r-full)', display:'inline-block', animation:'spin .7s linear infinite' }} /> Verificando token...</>
                  : '⚡ Conectar com token'}
              </button>
            </div>

            {/* OU VIA LINK OAUTH */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <div style={{ flex:1, height:1, background:'var(--border)' }} />
              <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-3)', letterSpacing:1 }}>OU VIA LINK OAUTH</span>
              <div style={{ flex:1, height:1, background:'var(--border)' }} />
            </div>

            {/* Step 1 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: 'var(--mf-r-full)', background: 'var(--mf-mod, var(--mf-accent-500))', color: '#000', fontSize: 'var(--mf-t-xs)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</div>
                <span style={{ fontWeight: 700, fontSize: 'var(--mf-t-body)', color: 'var(--mf-text)' }}>Copie o link de autorização</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-md)', padding: '8px 12px', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {oauthModal.url}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(oauthModal.url);
                    setUrlCopied(true);
                    setTimeout(() => setUrlCopied(false), 2500);
                  }}
                  style={{
                    padding: '0 16px', borderRadius: 'var(--mf-r-md)', border: `1px solid ${urlCopied ? 'color-mix(in oklch, var(--mf-success-500) 50%, transparent)' : 'color-mix(in oklch, var(--mf-mod-contas) 35%, transparent)'}`,
                    background: urlCopied ? 'color-mix(in oklch, var(--mf-success-500) 15%, transparent)' : 'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)',
                    color: urlCopied ? 'var(--mf-success-500)' : 'var(--mf-mod, var(--mf-accent-500))',
                    fontSize: 'var(--mf-t-xs)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'all var(--mf-normal) var(--mf-ease-out)',
                  }}
                >
                  {urlCopied
                    ? '✓ Copiado!'
                    : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar</>
                  }
                </button>
              </div>
              <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 8, lineHeight: 1.6 }}>
                Cole esse link no seu <strong style={{ color: 'var(--mf-text-2)' }}>navegador isolado</strong> (Dolphin Anty, AdsPower, etc.) e autorize o aplicativo.
              </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)', marginBottom: 20 }} />

            {/* Step 2 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: 'var(--mf-r-full)', background: 'color-mix(in oklch, var(--mf-mod-contas) 15%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)', color: 'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-xs)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</div>
                <span style={{ fontWeight: 700, fontSize: 'var(--mf-t-body)', color: 'var(--mf-text)' }}>Cole a URL de retorno</span>
              </div>
              <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginBottom: 10, lineHeight: 1.6 }}>
                Após autorizar, a barra de endereços vai mostrar uma URL começando com{' '}
                <code style={{ background: 'var(--bg3)', padding: '2px 4px', borderRadius: 'var(--mf-r-xs)', color: 'var(--mf-mod, var(--mf-accent-500))', fontSize: 'var(--mf-t-micro)' }}>localhost:3000</code>.
                Copie inteira e cole aqui:
              </div>
              <textarea
                value={callbackUrl}
                onChange={e => { setCallbackUrl(e.target.value); setOauthError(''); }}
                placeholder="https://localhost:3000/api/oauth/callback?code=..."
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                  borderRadius: 'var(--mf-r-md)', border: `1px solid ${oauthError ? 'color-mix(in oklch, var(--mf-danger-500) 50%, transparent)' : 'var(--border)'}`,
                  background: 'var(--bg3)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-xs)',
                  fontFamily: 'monospace', resize: 'none', lineHeight: 1.5, outline: 'none',
                }}
              />
              {oauthError && <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-danger-500)', marginTop: 6 }}>{oauthError}</div>}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => { setOauthModal(null); setOauthWaiting(false); setCallbackUrl(''); setOauthError(''); setUrlCopied(false); setTokenValue(''); setTokenError(''); }}
                style={{ padding: '8px 16px', borderRadius: 'var(--mf-r-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleManualConnect}
                disabled={!callbackUrl.trim() || oauthConnecting}
                style={{ padding: '8px 24px', borderRadius: 'var(--mf-r-md)', border: 'none', background: callbackUrl.trim() ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--bg3)', color: callbackUrl.trim() ? '#000' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, cursor: callbackUrl.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7 }}
              >
                {oauthConnecting
                  ? <><span style={{ width:14, height:14, border:'2px solid rgba(0,0,0,.3)', borderTopColor:'#000', borderRadius: 'var(--mf-r-full)', display:'inline-block', animation:'spin .7s linear infinite' }} /> Conectando...</>
                  : '✓ Conectar conta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Editar Perfil Modal ──────────────────────────────────── */}
      {perfilModal && (() => {
        const viaInstagrapi = perfilModal.provider === 'instagrapi' || !!perfilModal.hasInstagrapiSession;
        const lbl = t => <label style={{ display:'block', fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-2)', marginBottom:5, letterSpacing:'.04em' }}>{t}</label>;
        return (
          <div className="modal-overlay">
            <div className="modal" style={{ width: 'min(480px,100%)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div>
                  <h3 style={{ margin:0 }}>Editar perfil</h3>
                  <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', marginTop:3 }}>@{perfilModal.username}</div>
                </div>
                <button onClick={fecharPerfilModal} style={{ background:'none', border:'none', color:'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor:'pointer' }}>×</button>
              </div>

              <div style={{ fontSize: 'var(--mf-t-micro)', lineHeight:1.6, marginBottom:12, padding:'8px 12px', borderRadius: 'var(--mf-r-sm)',
                background: viaInstagrapi ? 'color-mix(in oklch, var(--mf-mod-publicar) 7%, transparent)' : 'color-mix(in oklch, var(--mf-warning-500) 8%, transparent)',
                border: `1px solid ${viaInstagrapi ? 'color-mix(in oklch, var(--mf-mod-publicar) 20%, transparent)' : 'color-mix(in oklch, var(--mf-warning-500) 25%, transparent)'}`,
                color: viaInstagrapi ? 'var(--mf-text-3)' : 'var(--mf-warning-500)' }}>
                {viaInstagrapi
                  ? <>Editado pela <strong>sessão API Mobile</strong> — sem senha e sem navegador. O Instagram exige e-mail ou telefone confirmado na conta para aceitar a alteração.</>
                  : <>Esta conta não usa API Mobile: a edição vai pelo caminho antigo (senha ou navegador), e o <strong>link da bio não é alterável</strong> por ali.</>}
              </div>

              <div style={{ marginBottom:12 }}>
                {lbl('NOME')}
                <input className="input" style={{ width:'100%' }} placeholder="Nome exibido no perfil"
                  value={perfilForm.fullName}
                  onChange={e => setPerfilForm(f => ({ ...f, fullName: e.target.value }))}
                  disabled={perfilSalvando} />
              </div>

              <div style={{ marginBottom:12 }}>
                {lbl('BIO')}
                <textarea className="input" rows={3} style={{ width:'100%', resize:'vertical' }} maxLength={150}
                  placeholder="Descrição do perfil"
                  value={perfilForm.biography}
                  onChange={e => setPerfilForm(f => ({ ...f, biography: e.target.value }))}
                  disabled={perfilSalvando} />
                <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', textAlign:'right', marginTop:3 }}>
                  {perfilForm.biography.length}/150
                </div>
              </div>

              <div style={{ marginBottom:12 }}>
                {lbl('LINK DA BIO')}
                <input className="input" type="url" style={{ width:'100%' }} placeholder="https://seusite.com"
                  value={perfilForm.externalUrl}
                  onChange={e => setPerfilForm(f => ({ ...f, externalUrl: e.target.value }))}
                  disabled={perfilSalvando || !viaInstagrapi} />
              </div>

              <div style={{ marginBottom:12 }}>
                {lbl('GÊNERO')}
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {[['', 'Não alterar'], ['1', 'Masculino'], ['2', 'Feminino'], ['3', 'Personalizado']].map(([valor, texto]) => {
                    const ativo = perfilForm.gender === valor;
                    return (
                      <button key={valor || 'nada'} onClick={() => setPerfilForm(f => ({ ...f, gender: valor }))}
                        disabled={perfilSalvando}
                        style={{ padding:'4px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:600, cursor:'pointer',
                          background: ativo ? 'color-mix(in oklch, var(--mf-mod-publicar) 16%, transparent)' : 'var(--mf-border-subtle)',
                          color:      ativo ? 'var(--mf-mod-publicar)'              : 'var(--mf-text-3)',
                          border:     ativo ? '1px solid color-mix(in oklch, var(--mf-mod-publicar) 35%, transparent)' : '1px solid var(--mf-border)' }}>
                        {texto}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom:14 }}>
                {lbl('FOTO DE PERFIL')}
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:54, height:54, borderRadius: 'var(--mf-r-full)', overflow:'hidden', flexShrink:0,
                    border:'1px solid var(--mf-border-strong)', background:'var(--mf-bg)', display:'grid', placeItems:'center' }}>
                    {perfilPreview
                      ? <img src={perfilPreview} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      : perfilModal.avatar
                        ? <img src={avatarUrl(perfilModal.avatar)} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                        : <span style={{ fontSize: 'var(--mf-t-h1)', fontWeight:800, color:'var(--mf-text-3)' }}>
                            {perfilModal.username?.charAt(0)?.toUpperCase() || 'I'}
                          </span>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 12px', borderRadius: 'var(--mf-r-sm)',
                      cursor: perfilSalvando ? 'not-allowed' : 'pointer', fontSize: 'var(--mf-t-micro)', fontWeight:700,
                      background:'var(--mf-border-subtle)', color:'var(--mf-text-2)', border:'1px solid var(--mf-border)',
                      opacity: perfilSalvando ? 0.5 : 1 }}>
                      {perfilForm.foto ? 'Trocar imagem' : 'Escolher imagem'}
                      <input type="file" accept="image/*" disabled={perfilSalvando} style={{ display:'none' }}
                        onChange={e => escolherFotoPerfil(e.target.files?.[0] || null)} />
                    </label>
                    <div style={{ fontSize: 'var(--mf-t-nano)', color: perfilForm.foto ? 'var(--mf-success-500)' : 'var(--mf-text-3)', marginTop:6,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {perfilForm.foto ? perfilForm.foto.name : 'JPG ou PNG — imagem quadrada fica melhor'}
                    </div>
                  </div>
                </div>
              </div>

              {perfilErro && (
                <div style={{ fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)', background:'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 20%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', marginBottom:10 }}>
                  {perfilErro}
                </div>
              )}

              {/* Bloqueio consciente: link externo em conta nova é o padrão que
                  o Instagram mais pune, e o dano (banimento) é irreversível. */}
              {perfilRisco && (
                <div style={{ fontSize: 'var(--mf-t-micro)', lineHeight:1.6, marginBottom:10, padding:'12px 12px', borderRadius: 'var(--mf-r-md)',
                  background:'color-mix(in oklch, var(--mf-warning-500) 9%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-warning-500) 35%, transparent)', color:'var(--mf-warning-500)' }}>
                  <strong style={{ display:'block', fontSize: 'var(--mf-t-xs)', marginBottom:5 }}>Alto risco de banimento</strong>
                  <div style={{ marginBottom:6 }}>
                    {perfilRisco.map((m, i) => <div key={i}>· {m}</div>)}
                  </div>
                  <div style={{ opacity:.9 }}>
                    Link externo em conta nova e sem publicações é o padrão que o Instagram
                    mais pune — normalmente com banimento, não com recusa da edição.
                    O recomendado é publicar conteúdo e deixar a conta amadurecer alguns dias antes.
                  </div>
                  <button onClick={() => salvarPerfil(true)} disabled={perfilSalvando}
                    style={{ marginTop:9, padding:'8px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700, cursor:'pointer',
                      background:'color-mix(in oklch, var(--mf-danger-500) 14%, transparent)', color:'var(--mf-danger-500)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 35%, transparent)' }}>
                    Entendo o risco — aplicar mesmo assim
                  </button>
                </div>
              )}

              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={fecharPerfilModal} disabled={perfilSalvando}>Cancelar</button>
                <button className="btn btn-primary" onClick={() => salvarPerfil(false)} disabled={perfilSalvando}
                  style={{ background:'color-mix(in oklch, var(--mf-mod-publicar) 85%, transparent)', borderColor:'color-mix(in oklch, var(--mf-mod-publicar) 50%, transparent)' }}>
                  {perfilSalvando ? 'Enviando...' : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Proxy Modal ──────────────────────────────────────────── */}
      {proxyModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(460px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>🌐 Proxy da conta</h3>
                <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 3 }}>@{proxyModal.username}</div>
              </div>
              <button onClick={() => setProxyModal(null)} style={{ background: 'none', border: 'none', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginBottom: 10 }}>
              As chamadas desta conta sairão por este proxy — IP exclusivo, independente do proxy global.
            </div>
            <input className="input" style={{ width: '100%', fontFamily: 'monospace', fontSize: 'var(--mf-t-sm)' }} placeholder="http://usuario:senha@host:porta" value={proxyValue} onChange={e => { setProxyValue(e.target.value); setProxyTest({ testando:false, ip:null, erro:null }); }} onKeyDown={e => e.key === 'Enter' && testarProxyConta()} autoFocus />

            {/* Estado atual gravado + resultado do teste feito agora */}
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10 }}>
              {proxyModal.proxy && !proxyTest.ip && (
                <div style={{ display:'flex', alignItems:'center', gap:7, fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)',
                  color: proxyModal.proxyStatus === 'online' ? 'var(--mf-success-500)' : proxyModal.proxyStatus === 'offline' ? 'var(--mf-danger-500)' : 'var(--mf-text-3)' }}>
                  <span style={{ width:6, height:6, borderRadius: 'var(--mf-r-full)', background:'currentColor' }} />
                  {proxyModal.proxyStatus === 'online'
                    ? `Online — saindo por ${proxyModal.proxyIp || '—'}`
                    : proxyModal.proxyStatus === 'offline' ? 'Offline no último teste do servidor' : 'Ainda não testado'}
                  {proxyModal.proxyLastCheck && <span style={{ color:'var(--mf-text-3)' }}>· {fmtDateCompact(proxyModal.proxyLastCheck)}</span>}
                </div>
              )}
              {proxyTest.ip && (
                <div style={{ padding:'8px 12px', borderRadius: 'var(--mf-r-md)', background:'color-mix(in oklch, var(--mf-success-500) 10%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-success-500) 30%, transparent)' }}>
                  <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-success-500)', opacity:.8, letterSpacing:'.08em' }}>PROXY OK — IP DE SAÍDA</div>
                  <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-body)', fontWeight:700, color:'var(--mf-success-500)', marginTop:2 }}>{proxyTest.ip}</div>
                </div>
              )}
              {proxyTest.erro && (
                <div style={{ padding:'8px 12px', borderRadius: 'var(--mf-r-md)', background:'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-danger-500) 25%, transparent)', fontSize: 'var(--mf-t-micro)', color:'var(--mf-danger-500)' }}>
                  {proxyTest.erro}
                </div>
              )}
              {!proxyModal.proxy && !proxyTest.ip && !proxyTest.erro && (
                <div style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
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
        // Bloks redirect: aprovação no app, sem código. É o caso das contas sem 2FA.
        const isApprovalChallenge = isChallenge && instaModal.challengeKind === 'approval';
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
          <label style={{ display:'block', fontSize: 'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-2)', marginBottom:5, letterSpacing:'.04em' }}>{text}</label>
        );
        const field = (content) => <div style={{ marginBottom:12 }}>{content}</div>;

        return (
          <div className="modal-overlay">
            <div className="modal" style={{ width: 'min(480px,100%)' }}>

              {/* Header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div>
                  <h3 style={{ margin:0 }}>📱 {is2FA ? 'Verificação em 2 etapas' : isChallenge ? 'Verificação do Instagram' : instaModal.emenda ? 'Falta só a API Mobile' : 'Conectar Instagram'}</h3>
                  <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)', marginTop:3 }}>
                    {isCodeStep ? `@${uname} — código necessário`
                      : instaModal.emenda ? `@${uname} já está conectada pela API oficial`
                      : 'API Mobile — sessão duradoura'}
                  </div>
                </div>
                <button onClick={() => setInstaModal(null)} style={{ background:'none', border:'none', color:'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor:'pointer' }}>×</button>
              </div>

              {/* Method toggle (only on credentials step, not connected) */}
              {!isCodeStep && !isConnected && (
                <div style={{ display:'flex', gap:6, marginBottom:14, background:'rgba(0,0,0,.12)', borderRadius: 'var(--mf-r-sm)', padding:4 }}>
                  {[['password','🔑 Senha'],['sessionid','🍪 Session ID']].map(([method, label]) => (
                    <button key={method} onClick={() => setInstaModal(m => ({ ...m, loginMethod: method, error:'', status:null }))}
                      style={{ flex:1, padding:'8px 0', fontSize: 'var(--mf-t-xs)', fontWeight:600, borderRadius: 'var(--mf-r-sm)', border:'none', cursor:'pointer',
                        background: instaModal.loginMethod === method ? 'color-mix(in oklch, var(--mf-mod-publicar) 80%, transparent)' : 'transparent',
                        color: instaModal.loginMethod === method ? 'var(--mf-text)' : 'var(--mf-text-2)' }}>
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
                    <div style={{ background:'color-mix(in oklch, var(--mf-success-500) 7%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-success-500) 22%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', marginBottom:12, fontSize: 'var(--mf-t-xs)', color:'var(--mf-success-500)' }}>
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
                    {preflight && !preflight.carregando && !preflight.pronto && (
                      <div style={{ fontSize:'var(--mf-t-xs)', lineHeight:1.6, marginBottom:12,
                        background:'var(--mf-warning-bg)',
                        border:'1px solid color-mix(in oklch, var(--mf-warning-500) 28%, transparent)',
                        borderRadius:'var(--mf-r-sm)', padding:'8px 12px' }}>
                        <strong style={{ color:'var(--mf-warning-500)' }}>Antes de tentar: </strong>
                        <span style={{ color:'var(--mf-text-2)' }}>{preflight.veredito}</span>
                        {Object.entries(preflight.itens || {})
                          .filter(([, v]) => !v.ok && v.conserto)
                          .map(([k, v]) => (
                            <div key={k} className="mf-mono" style={{ marginTop:6, fontSize:'var(--mf-t-nano)', color:'var(--mf-text-3)' }}>
                              {v.detalhe} · {v.conserto}
                            </div>
                          ))}
                      </div>
                    )}
                    {preflight?.pronto && preflight.itens?.proxy?.ip && (
                      <div className="mf-mono" style={{ fontSize:'var(--mf-t-nano)', color:'var(--mf-text-3)', marginBottom:12 }}>
                        Ambiente pronto · saída {preflight.itens.proxy.ip} ({preflight.itens.proxy.origem})
                      </div>
                    )}
                    <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', marginBottom:12, lineHeight:1.6, background:'color-mix(in oklch, var(--mf-mod-publicar) 6%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-mod-publicar) 18%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px' }}>
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
                    <div style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', marginBottom:10, lineHeight:1.7, background:'color-mix(in oklch, var(--mf-info-500) 6%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-info-500) 20%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px' }}>
                      <strong style={{ color:'var(--text1)' }}>Como obter o Session ID:</strong><br/>
                      1. Abra <strong>instagram.com</strong> no navegador (Chrome/Edge)<br/>
                      2. Pressione <strong>F12</strong> → aba <strong>Application</strong><br/>
                      3. Cookies → <code style={{ fontSize: 'var(--mf-t-micro)' }}>https://www.instagram.com</code><br/>
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
                  <div style={{ background:'rgba(234,179,8,.07)', border:'1px solid rgba(234,179,8,.25)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', marginBottom:12, fontSize: 'var(--mf-t-xs)', color:'var(--mf-warning-500)', lineHeight:1.6 }}>
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

              {/* Step: challenge — aprovação no app OU código por e-mail/SMS */}
              {isChallenge && (isApprovalChallenge ? (
                <div style={{ background:'color-mix(in oklch, var(--mf-info-500) 7%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-info-500) 25%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'12px 12px', marginBottom:12, fontSize: 'var(--mf-t-xs)', color:'var(--mf-info-500)', lineHeight:1.7 }}>
                  <strong style={{ color:'var(--text1)' }}>Aprove no app do Instagram</strong>
                  <div style={{ marginTop:6 }}>
                    Esta conta não usa código — o Instagram mostra um aviso de
                    <strong> "tentativa de login" </strong>no app.
                  </div>
                  <div style={{ marginTop:8 }}>
                    1. Abra o app do Instagram (no celular já logado)<br/>
                    2. Toque no aviso e confirme que <strong>foi você</strong><br/>
                    3. Volte aqui e clique em <strong>Já aprovei</strong>
                  </div>
                  <div style={{ marginTop:8, fontSize: 'var(--mf-t-micro)', opacity:.8 }}>
                    Se já aprovou e ainda assim não passar, aprove de novo e repita — o
                    Instagram às vezes leva alguns segundos para registrar.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ background:'color-mix(in oklch, var(--mf-info-500) 7%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-info-500) 25%, transparent)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', marginBottom:12, fontSize: 'var(--mf-t-xs)', color:'var(--mf-info-500)', lineHeight:1.6 }}>
                    O Instagram pediu confirmação de identidade e enviou um código
                    {instaModal.channel ? <> por <strong>{instaModal.channel}</strong></> : null}.
                    Digite-o abaixo para concluir a conexão.
                    <div style={{ marginTop:6, fontSize: 'var(--mf-t-micro)', opacity:.8 }}>
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
                  {/* Escape: se o Instagram pediu aprovação no app em vez de código,
                      esta conta não vai receber código nenhum. */}
                  <button onClick={confirmChallengeApproval} disabled={instaModal.loading}
                    style={{ background:'none', border:'none', padding:0, marginBottom:10, fontSize: 'var(--mf-t-micro)',
                      color:'var(--mf-mod, var(--mf-accent-500))', textDecoration:'underline', cursor:'pointer' }}>
                    Não chegou código? O Instagram pediu aprovação no app — clique aqui
                  </button>
                </>
              ))}

              {/* Rate limited — active countdown */}
              {blocked && (
                <div style={{ fontSize: 'var(--mf-t-xs)', background:'rgba(234,179,8,.09)', border:'1px solid rgba(234,179,8,.3)', borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', marginBottom:10 }}>
                  <div style={{ fontWeight:700, color:'var(--mf-warning-500)', marginBottom:4 }}>
                    Instagram confirmou limite de tentativas neste IP
                  </div>
                  <div style={{ color:'var(--mf-warning-500)', opacity:.9 }}>
                    Aguarde <strong style={{ fontFamily:'monospace' }}>{cdMin}:{cdSec}</strong> antes de tentar novamente.
                    Tentar antes piora o bloqueio.
                  </div>
                  {/* O limite é do endpoint accounts/login/. O Session ID não passa
                      por ele, então funciona mesmo com o IP limitado — é a única
                      saída enquanto o bloqueio durar. */}
                  {!isSidMode && (
                    <button onClick={() => setInstaModal(m => ({ ...m, loginMethod:'sessionid', error:'', detail:'', status:null }))}
                      style={{ marginTop:8, padding:'8px 12px', borderRadius: 'var(--mf-r-sm)', fontSize: 'var(--mf-t-micro)', fontWeight:700, cursor:'pointer',
                        background:'color-mix(in oklch, var(--mf-info-500) 15%, transparent)', color:'var(--mf-info-500)', border:'1px solid color-mix(in oklch, var(--mf-info-500) 35%, transparent)' }}>
                      Conectar por Session ID — não passa por este limite
                    </button>
                  )}
                </div>
              )}

              {/* Error (shown only when no active countdown) */}
              {instaModal.error && !blocked && (
                <div style={{ fontSize: 'var(--mf-t-xs)', color: canRetryNow ? 'var(--mf-text-3)' : 'var(--mf-danger-500)', background: canRetryNow ? 'color-mix(in oklch, var(--mf-text-3) 8%, transparent)' : 'color-mix(in oklch, var(--mf-danger-500) 8%, transparent)', border: `1px solid ${canRetryNow ? 'color-mix(in oklch, var(--mf-text-3) 25%, transparent)' : 'color-mix(in oklch, var(--mf-danger-500) 20%, transparent)'}`, borderRadius: 'var(--mf-r-sm)', padding:'8px 12px', marginBottom:10 }}>
                  {instaModal.error}
                  {/* Resposta técnica do Instagram. Fica visível de propósito: a
                      mensagem curada acima às vezes contradiz o motivo real. */}
                  {instaModal.detail && (
                    <div style={{ marginTop:6, paddingTop:6, borderTop:'1px solid var(--mf-border)',
                      fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', wordBreak:'break-word' }}>
                      {instaModal.detail}
                    </div>
                  )}
                  {/* Veredito da sonda: consulta o Instagram com uma sessão já
                      conectada para dizer se o @ existe de fato. */}
                  {instaModal.veredito && (
                    <div style={{ marginTop:6, paddingTop:6, borderTop:'1px solid var(--mf-border)',
                      fontSize: 'var(--mf-t-micro)', color:'var(--mf-mod, var(--mf-accent-500))', lineHeight:1.5 }}>
                      {instaModal.veredito}
                    </div>
                  )}
                  {canRetryNow && <span style={{ display:'block', marginTop:4, fontSize: 'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>Você pode tentar novamente.</span>}
                </div>
              )}

              {/* Actions */}
              <div className="modal-actions" style={{ marginTop:4 }}>
                {isCodeStep
                  ? <button className="btn btn-ghost" onClick={() => setInstaModal(m => ({ ...m, step:'credentials', totp:'', error:'', status:null }))} disabled={instaModal.loading}>Voltar</button>
                  : <button className="btn btn-ghost" onClick={() => setInstaModal(null)} disabled={instaModal.loading}>Cancelar</button>
                }

                {isChallenge && (isApprovalChallenge ? (
                  <button className="btn btn-primary" onClick={confirmChallengeApproval}
                    disabled={instaModal.loading}
                    style={{ background:'color-mix(in oklch, var(--mf-info-500) 85%, transparent)', borderColor:'color-mix(in oklch, var(--mf-info-500) 50%, transparent)' }}>
                    {instaModal.loading ? 'Verificando...' : 'Já aprovei no app'}
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={submitChallengeCode}
                    disabled={instaModal.loading || !instaModal.totp.trim()}
                    style={{ background:'color-mix(in oklch, var(--mf-mod-publicar) 85%, transparent)', borderColor:'color-mix(in oklch, var(--mf-mod-publicar) 50%, transparent)' }}>
                    {instaModal.loading ? 'Verificando...' : 'Confirmar código'}
                  </button>
                ))}

                {!isCodeStep && isConnected && (
                  <button className="btn" onClick={() => disconnectInstagrapi(selAcc)} disabled={instaModal.loading}
                    style={{ background:'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)', color:'var(--mf-danger-500)', borderColor:'color-mix(in oklch, var(--mf-danger-500) 30%, transparent)' }}>
                    Desconectar
                  </button>
                )}

                {!isCodeStep && !isConnected && !isSidMode && (
                  <button className="btn btn-primary" onClick={connectInstagrapi}
                    disabled={instaModal.loading || !uname || !instaModal.password.trim() || blocked}
                    style={{ background: blocked ? 'color-mix(in oklch, var(--mf-text-3) 40%, transparent)' : 'color-mix(in oklch, var(--mf-mod-publicar) 85%, transparent)', borderColor: blocked ? 'color-mix(in oklch, var(--mf-text-3) 30%, transparent)' : 'color-mix(in oklch, var(--mf-mod-publicar) 50%, transparent)', cursor: blocked ? 'not-allowed' : 'pointer' }}>
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
                      style={{ background:'color-mix(in oklch, var(--mf-info-500) 85%, transparent)', borderColor:'color-mix(in oklch, var(--mf-info-500) 50%, transparent)' }}>
                      {instaModal.loading ? 'Conectando...' : 'Conectar via Session ID'}
                    </button>
                  );
                })()}

                {is2FA && (
                  <button className="btn btn-primary" onClick={verify2fa}
                    disabled={instaModal.loading || !instaModal.totp.trim()}
                    style={{ background:'color-mix(in oklch, var(--mf-mod-publicar) 85%, transparent)', borderColor:'color-mix(in oklch, var(--mf-mod-publicar) 50%, transparent)' }}>
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
                <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 3 }}>Distribui um proxy diferente por conta</div>
              </div>
              <button onClick={() => setBulkProxyOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ background: 'var(--card2)', borderRadius: 'var(--mf-r-sm)', padding: '8px 12px', marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text-2)', marginBottom: 6 }}>Formato — um proxy por linha:</div>
              <pre style={{ margin: 0, fontSize: 'var(--mf-t-xs)', color: 'var(--text1)', lineHeight: 1.6, fontFamily: 'monospace' }}>{`http://user1:pass1@host1:porta\nhttp://user2:pass2@host2:porta`}</pre>
            </div>
            <textarea className="txta" rows={8} style={{ fontFamily: 'monospace', fontSize: 'var(--mf-t-sm)', marginTop: 0 }} placeholder={'http://user1:pass1@host1:3128\n...'} value={bulkProxyText} onChange={e => setBulkProxyText(e.target.value)} />
            <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 6 }}>{bulkProxyText.trim() ? `${bulkProxyText.trim().split('\n').filter(Boolean).length} proxy(ies) · ${safeAccounts.length} conta(s)` : 'Cole os proxies acima.'}</div>
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


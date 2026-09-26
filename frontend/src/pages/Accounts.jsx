import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import { isAdmin } from '../services/auth';
import { lerAviso, deveAnunciar, chaveDoArroba } from './janelaDeAutorizacao';
import PassosDeConexao from '../components/PassosDeConexao';
import { montarLinkGuiado } from '../services/conexaoGuiada';
import { useServerEvents } from '../services/useServerEvents';
import { useCotas } from '../services/useCotas';
import ChipDeCota from '../components/ChipDeCota';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import PortalModal from '../components/PortalModal';
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
const IcoCheck   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcoTrash   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const IcoSync    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const IcoLink    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
const IcoWave    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
const IcoWifi    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M10.28 16.17a6 6 0 0 1 3.44 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>;
const IcoCopy    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const IcoConvite = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>;

const PAGE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

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
  const { cotas } = useCotas();
  const [selectedAppId,  setSelectedAppId]  = useState('');
  /* Nenhum App Meta cadastrado: o OAuth não tem como começar. Em vez de um
     toast de erro (beco sem saída — foi o que aconteceu quando o app padrão do
     .env saiu), esta tela explica e leva ao cadastro. */
  const [precisaApp,     setPrecisaApp]     = useState(false);
  const navigate = useNavigate();
  const [connecting,     setConnecting]     = useState({});
  const [syncing,        setSyncing]        = useState(false);
  const oauthModalRef   = useRef(null);
  const oauthWaitingRef = useRef(false);
  oauthModalRef.current   = oauthModal;
  oauthWaitingRef.current = oauthWaiting;
  /* Como abrir a autorização da API oficial: nesta aba ou colando o link no
     navegador onde a conta já está logada. A escolha vem antes do fluxo em duas
     etapas — abrir aqui não precisa da segunda etapa, colar precisa. */
  const [escolhaOAuth,   setEscolhaOAuth]   = useState(null); // { account, url }
  const [linkCopiado,    setLinkCopiado]    = useState(false);
  /* Aviso do servidor sobre a configuração do OAuth. Vazio quando está tudo
     coerente — ver `avisoDoRedirect` em oauthRoutes.js. */
  const [avisoOAuth,     setAvisoOAuth]     = useState('');
  /* A janela de autorização aberta e o que ela já trouxe. Guarda a `url` para
     "Conectar próxima conta" reabrir sem ir buscá-la de novo. */
  const [janelaOAuth,    setJanelaOAuth]    = useState(null); // { aberta, url, conectadas: [] }
  /* Convites de testador do app. */
  const [conviteModal,   setConviteModal]   = useState(false);
  const [conviteArroba,  setConviteArroba]  = useState('');
  const [convites,       setConvites]       = useState([]);
  const [convitePainel,  setConvitePainel]  = useState({ appId: '', url: null });
  const [conviteEnviando,setConviteEnviando]= useState(false);
  const [conviteErro,    setConviteErro]    = useState('');
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [selectMode,     setSelectMode]     = useState(false);
  const [bulkDeleteModal,setBulkDeleteModal]= useState(false);
  const [bulkDeleting,   setBulkDeleting]   = useState(false);

  function showToast(type, title, message) { setToast({ type, title, message }); }

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
      if (def) setSelectedAppId(def.id);
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
      const isMatch = !modal?.account || modal?.account?.id === data.accountId;
      if (isMatch) {
        setOauthModal(null);
        anunciarConexao(data.username || '');
      }
    }
  });

  /* Uma conexão chega por dois caminhos — a janela avisa e o SSE transmite — e
     não pode virar dois avisos. A decisão mora em `janelaDeAutorizacao.js`, com
     testes; aqui fica só a memória e o efeito na tela. */
  const anunciadosRef = useRef(new Map());

  function anunciarConexao(username) {
    const agora = Date.now();
    if (!deveAnunciar(anunciadosRef.current, username, agora)) return false;
    anunciadosRef.current.set(chaveDoArroba(username), agora);

    setOauthWaiting(false);
    showToast('success', 'Conta conectada!', `@${username || ''} conectada via Meta API`);
    loadRef.current?.();
    return true;
  }

  /* Pela referência, como o `loadRef` acima: a escuta se registra uma vez e
     não pode reassinar a cada render, mas precisa chamar a versão atual. */
  const anunciarRef = useRef(null);
  anunciarRef.current = anunciarConexao;

  /* A janela de autorização avisando o que aconteceu.
     A origem é conferida antes de qualquer coisa: sem isso, qualquer página que
     conseguisse uma referência a esta aceitaria um "conta conectada" inventado. */
  useEffect(() => {
    function receber(ev) {
      /* `lerAviso` é a fronteira de confiança: confere a origem, o formato e o
         tipo, e recorta o @. O que não passa volta null e é ignorado calado. */
      const aviso = lerAviso(ev, window.location.origin);
      if (!aviso) return;

      if (aviso.ok) {
        const uname = aviso.username;
        const novo = anunciarRef.current?.(uname);
        /* A janela some e esta tela fica: a lista do que já entrou é o que
           permite conectar a próxima sem perder a conta de onde parou. */
        if (novo) setJanelaOAuth(j => (j ? { ...j, conectadas: [...j.conectadas, uname] } : j));
      } else {
        setOauthWaiting(false);
        showToast('error', 'Não conectou', aviso.erro || 'Falha na autorização');
      }
    }
    window.addEventListener('message', receber);
    return () => window.removeEventListener('message', receber);
  }, []);

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
    if (oauth === 'success') {
      const uname = params.get('username') || '';
      showToast('success', 'Conta conectada!', `@${uname} adicionada via Meta API`);
      loadAccounts();

    }
    else if (oauth === 'error') { showToast('error', 'Erro na conexão', params.get('msg') || 'Falha no OAuth'); }
    window.history.replaceState({}, '', '/accounts');
  }, []);

  async function openOAuthConnect(account) {
    /* Sem App Meta cadastrado o servidor recusa o /oauth/url, e antes disso o
       clique virava só um toast vermelho — parecia que o botão não fazia nada.
       Aqui a falta de app deixa de ser erro e vira o primeiro passo. */
    if (!metaApps.length) { setPrecisaApp(true); return; }
    const key = account?.id || 'new';
    setConnecting(p => ({ ...p, [key]: true }));
    try {
      const params = { ...(account?.id ? { accountId: account.id } : {}), ...(selectedAppId ? { metaAppId: selectedAppId } : {}) };
      const res = await api.get('/oauth/url', { params });
      const url = res.data?.url;
      if (!url) throw new Error('URL não retornada');
      setOauthWaiting(false);
      /* O servidor avisa quando o `redirect_uri` configurado não pode receber
         o retorno — por exemplo apontando para localhost com o painel num host
         público. Sem isto a pessoa autoriza, a aba morre numa página que não
         carrega, e conclui que falta aprovar o app. */
      setAvisoOAuth(res.data?.aviso || '');
      /* A escolha de COMO abrir vem antes do fluxo em duas etapas. Abrindo aqui,
         a segunda etapa não existe — o callback volta para o próprio servidor e
         o SSE fecha a tela. Copiando o link, ela é obrigatória, porque o
         navegador que autoriza não é este. */
      setEscolhaOAuth({ account: account || null, url });
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
        accountId: oauthModal?.account?.id || 'new',
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

  /* ── Convites de testador do app ──────────────────────────────────────────

     A Meta não tem endpoint para convidar um testador do Instagram: o
     `POST /{app-id}/roles` da Graph API é indisponível, os papéis que ela
     conhece não incluem o testador do Instagram, e o campo `user` pede o ID
     numérico de um usuário do Facebook — não um @. Convidar é ação de painel.

     O que estas funções eliminam é o trabalho que sobra: lembrar quais @ faltam,
     achar a página certa e digitar o @ à mão em cada uma. O @ vai para a área de
     transferência e o painel abre já na seção de testadores. */

  async function carregarConvites() {
    try {
      const { data } = await api.get('/convites', { params: selectedAppId ? { metaAppId: selectedAppId } : {} });
      setConvites(data?.convites || []);
      setConvitePainel(data?.painel || { appId: '', url: null });
    } catch { /* a tela funciona sem a lista; não vale um toast a cada abrir */ }
  }

  async function pedirConvite() {
    const arroba = conviteArroba.trim();
    if (!arroba) return setConviteErro('Informe o @ da conta.');
    setConviteEnviando(true); setConviteErro('');
    try {
      const { data } = await api.post('/convites', {
        username: arroba,
        ...(selectedAppId ? { metaAppId: selectedAppId } : {}),
      });
      setConviteArroba('');
      await carregarConvites();
      /* Usuário comum pede; quem convida no painel da Meta é o admin. */
      if (!isAdmin()) {
        showToast('success', `@${data?.convite?.username || arroba} pedido`,
          'O administrador vai adicionar a conta como testadora do app. Depois é só aceitar o convite no Instagram.');
        return;
      }
      /* Abrir o painel já com o @ copiado é o ponto todo: é o único passo que
         a Meta obriga a ser manual, então que seja um colar e um clique. */
      abrirPainelDoConvite(data?.convite?.username, data?.painel?.url);
    } catch (err) {
      setConviteErro(err.response?.data?.error || err.message);
    } finally { setConviteEnviando(false); }
  }

  function abrirPainelDoConvite(username, url) {
    const destino = url || convitePainel.url;
    if (username) { try { navigator.clipboard.writeText(username); } catch { /* sem permissão: o @ segue na lista */ } }
    if (!destino) {
      showToast('warning', 'Falta o App da Meta',
        'Cadastre um App em Configurações para eu saber qual painel abrir.');
      return;
    }
    window.open(destino, '_blank', 'noopener');
    showToast('info', `@${username || ''} copiado`,
      'Cole em "Testadores do Instagram" no painel que abriu e envie o convite.');
  }

  async function marcarConviteEnviado(id) {
    try { await api.patch(`/convites/${id}/enviado`); await carregarConvites(); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
  }

  async function removerConvite(id) {
    try { await api.delete(`/convites/${id}`); await carregarConvites(); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
  }

  /* ── Copiar o link, e nada além disso ─────────────────────────────────────

     Copiar não abre o fluxo em duas etapas. Quem vai colar o link em outro
     navegador não precisa voltar aqui para colar a URL de retorno: o Instagram
     redireciona para o NOSSO /oauth-callback, que troca o código pelo token no
     servidor. A conta entra sozinha, e esta tela sabe pelo SSE.

     A segunda etapa continua existindo no modal completo, para o caso em que o
     navegador isolado não alcança este servidor e a URL de retorno morre na
     barra de endereços. Aí ela é a única saída — mas é a exceção, não o
     caminho normal. */
  function soCopiarLink(url) {
    try { navigator.clipboard.writeText(url); }
    catch { showToast('warning', 'Copie à mão', url); }
    setLinkCopiado(true);
    setTimeout(() => setLinkCopiado(false), 2500);
    /* Liga a escuta: a conta é autorizada em outro navegador e aparece aqui
       sozinha, sem ninguém apertar mais nada. */
    setOauthWaiting(true);
    showToast('success', 'Link copiado',
      'Cole no navegador onde a conta está logada e autorize. Ela aparece aqui sozinha.');
  }

  /* ── O link guiado ────────────────────────────────────────────────────────

     Não é o link de autorização: é o da NOSSA página de dois passos, que abre
     no navegador do perfil e leva à autorização depois de o convite de testador
     ser aceito.

     A diferença importa. O link cru cai direto no Instagram, e ali a conta que
     não é testadora do app recebe um erro que não diz o que faltou — foi o
     motivo de existir uma página guiada. O link cru continua disponível no
     ícone do cabeçalho, para quem já sabe o que fazer com ele.

     `window.location.origin` e não uma variável de ambiente: o link tem de
     apontar para o mesmo endereço por onde esta tela está sendo acessada, senão
     em produção ele mandaria para localhost. */
  /* O link guiado abre num navegador sem login no painel: leva o dono
     assinado pelo servidor, buscado uma vez aqui (o clique precisa copiar na
     hora — o navegador só deixa escrever na área de transferência no gesto). */
  const [donoDoLink, setDonoDoLink] = useState('');
  useEffect(() => {
    api.get('/oauth/dono').then(({ data }) => setDonoDoLink(data?.dono || '')).catch(() => {});
  }, []);

  function copiarLinkGuiado(conta = 'new') {
    if (!donoDoLink) { showToast('warning', 'Aguarde', 'Preparando o link — tente de novo em um instante.'); return; }
    const link = montarLinkGuiado(window.location.origin, conta, selectedAppId, donoDoLink);

    try { navigator.clipboard.writeText(link); }
    catch { showToast('warning', 'Copie à mão', link); }
    setLinkCopiado(true);
    setTimeout(() => setLinkCopiado(false), 2500);
    /* Liga a escuta: a conta é autorizada no outro navegador e aparece aqui
       sozinha, sem ninguém apertar mais nada. */
    setOauthWaiting(true);
    showToast('success', 'Link guiado copiado',
      'Cole no navegador do perfil. A página lá mostra os 2 passos e a conta entra aqui sozinha.');
  }

  /* O mesmo link, direto do cabeçalho — para quem já sabe o que fazer com ele. */
  async function copiarLinkOAuth() {
    if (!metaApps.length) { setPrecisaApp(true); return; }
    try {
      const { data } = await api.get('/oauth/url', { params: selectedAppId ? { metaAppId: selectedAppId } : {} });
      if (!data?.url) throw new Error('URL não retornada');
      soCopiarLink(data.url);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || err.message); }
  }

  /* ── Abrir a autorização numa janela ──────────────────────────────────────

     Janela separada e não esta aba: conectar muitas contas seguidas é o caso
     normal, e trocar a aba descarrega esta tela a cada conta — some a lista,
     some o filtro, some a rolagem, e é preciso voltar e recomeçar cinco vezes.
     Com a janela, esta tela nunca sai do lugar: a janela abre, você autoriza,
     ela se fecha sozinha e a conta aparece na lista.

     `noopener` NÃO entra aqui de propósito: sem `opener` a janela não consegue
     avisar quem a abriu, e ela precisa — é assim que ela sabe que pode se
     fechar e que esta tela sabe qual conta entrou. O destino é o próprio
     Instagram e o retorno é o nosso callback, então não há terceiro no meio.

     Se o navegador bloquear a janela, cai para copiar o link, que resolve o
     mesmo problema por outro caminho. */
  function abrirAutorizacaoEmJanela(url) {
    setEscolhaOAuth(null);
    const janela = window.open(url, 'mf_oauth', 'width=560,height=760,noreferrer');
    if (!janela) {
      soCopiarLink(url);
      showToast('warning', 'Janela bloqueada',
        'O navegador bloqueou a janela. Copiei o link — cole numa aba e autorize.');
      return;
    }
    setOauthWaiting(true);
    setJanelaOAuth({ aberta: true, url, conectadas: [] });
    try { janela.focus(); } catch { /* alguns navegadores recusam o foco; a janela abriu */ }
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
  const errorAccounts   = safeAccounts.filter(a => ['restrita','banida','token_invalido','conta_pessoal'].includes(a.healthStatus)).length;

  const countBy = s => safeAccounts.filter(a => a.healthStatus === s).length;
  const FILTERS = [
    { key: 'all',         label: 'Todas',          count: safeAccounts.length },
    { key: 'active',      label: 'Ativas',          count: activeAccounts },
    { key: 'restricted',  label: 'Em verificação',  count: countBy('restrita') },
    { key: 'token',       label: 'Token inválido',  count: countBy('token_invalido') },
    { key: 'banned',      label: 'Banidas',         count: countBy('banida') },
    { key: 'personal',    label: 'Conta pessoal',   count: countBy('conta_pessoal') },
    { key: 'offline',     label: 'Desconectadas',   count: safeAccounts.filter(a => !a.hasApiToken).length },
  ];

  const filteredAccounts = safeAccounts.filter(acc => {
    const q = search.toLowerCase();
    const match = acc.username?.toLowerCase().includes(q) || acc.name?.toLowerCase().includes(q);
    if (!match) return false;
    if (filter === 'active')     return !acc.healthStatus || acc.healthStatus === 'ativa';
    if (filter === 'restricted') return acc.healthStatus === 'restrita';
    if (filter === 'token')      return acc.healthStatus === 'token_invalido';
    if (filter === 'banned')     return acc.healthStatus === 'banida';
    if (filter === 'personal')   return acc.healthStatus === 'conta_pessoal';
    if (filter === 'offline')    return !acc.hasApiToken;
    return true;
  });

  function fmt(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function fmtDateCompact(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function healthLabel(s) {
    if (s === 'restrita')        return 'Em verificação';
    if (s === 'banida')          return 'Banida';
    if (s === 'token_invalido')  return 'Token inválido';
    if (s === 'conta_pessoal')   return 'Conta pessoal';
    return 'Saudável';
  }
  function healthColor(s) {
    if (s === 'restrita')        return 'var(--mf-warning-500)';
    if (s === 'banida')          return 'var(--mf-danger-500)';
    if (s === 'token_invalido')  return 'var(--mf-danger-500)';
    if (s === 'conta_pessoal')   return 'var(--mf-warning-500)';
    return 'var(--mf-success-500)';
  }



  /**
   * Conta realmente conectada: tem token da Meta API.
   * `healthStatus` NÃO serve para isso — ele nasce saudável numa conta nova, e
   * usá-lo fazia o card anunciar "API conectada" para conta que nunca conectou.
   * O flag vem do backend, que nunca expõe o token em si.
   */
  const isLinked = a => !!a?.hasApiToken;

  /* Rótulos em caixa alta viraram caixa normal: "PUBLICAÇÕES" em versalete
     lê-se letra a letra, "Publicações" lê-se de uma vez. A distinção de
     hierarquia já vem do tamanho e da cor. */
  const STAT_DEFS = [
    { label:'Conectadas',  value:fmt(safeAccounts.filter(isLinked).length), cor:'var(--mf-mod-publicar)', Icon:IcoUsers  },
    { label:'Saudáveis',   value:fmt(activeAccounts),  cor:'var(--mf-success-500)', Icon:IcoShield },
    /* A cor descreve o ESTADO, não a categoria: "Com erro 0" pintado de
       vermelho fazia a tela gritar por uma notícia boa. */
    { label:'Com erro',    value:fmt(errorAccounts),   cor: errorAccounts > 0 ? 'var(--mf-danger-500)' : 'var(--mf-text-3)', Icon:IcoWarn   },
    { label:'Seguidores',  value:fmt(totalFollowers),  cor:'var(--mf-warning-500)', Icon:IcoTrend  },
    { label:'Publicações', value:fmt(totalPosts),      cor:'var(--mf-mod-contas)',  Icon:IcoGrid   },
  ];


  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
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
        icon={PAGE_ICON}
        title="Contas Instagram"
        subtitle="Monitore perfis, sessões, saúde e automações em tempo real"
        accent="cyan"
        actions={
          <>
            <button onClick={syncAll} disabled={syncing} className="btn-ghost">
              {syncing ? <span className="mf-spin" /> : <IcoSync />} {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>

            {/* As formas de trazer uma conta: a autorização da API oficial e,
                para quem não conseguiu por ela, o convite de testador. */}
            <button onClick={() => openOAuthConnect(null)} disabled={!!connecting['new']} className="btn-primary">
              {connecting['new'] ? <span className="mf-spin" /> : <IcoLink />} {connecting['new'] ? 'Aguarde…' : 'Conectar Contas (OAuth)'}
            </button>

            {/* Atalho do link de autorização: o mesmo link da etapa 1 do modal,
                para quem já sabe o que fazer com ele. `title` porque um ícone
                sozinho não diz o que faz. */}
            <button onClick={copiarLinkOAuth} className="btn-ghost" aria-label="Copiar link de autorização"
              title="Copiar link de autorização — cole no navegador onde a conta está logada"
              style={{ padding:'0 10px', ...(linkCopiado ? {
                background:'color-mix(in oklch, var(--mf-success-500) 14%, transparent)',
                color:'var(--mf-success-500)',
                borderColor:'color-mix(in oklch, var(--mf-success-500) 34%, transparent)',
              } : {}) }}>
              {linkCopiado ? <IcoCheck /> : <IcoCopy />}
              {/* No celular este botão ocupa uma linha inteira como os outros,
                  e um ícone sozinho no meio de uma faixa larga não se lê como
                  botão. O rótulo aparece só nessa largura. */}
              <span className="so-no-celular">{linkCopiado ? 'Link copiado' : 'Copiar link'}</span>
            </button>

            <button onClick={() => { setConviteModal(true); setConviteErro(''); setConviteArroba(''); carregarConvites(); }}
              className="btn-ghost">
              <IcoConvite /> Pedir acesso via convite
            </button>
          </>
        }
      >
        {/* ── Conectando contas em série ───────────────────────────────────
            A janela de autorização abre por cima e esta tela fica. A faixa é o
            que dá continuidade ao gesto: mostra o que já entrou e traz o botão
            para a próxima, sem voltar ao cabeçalho a cada conta. */}
        {janelaOAuth?.aberta && (
          <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
            style={{ display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap',
              background:'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)',
              border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 26%, transparent)',
              borderLeft:'3px solid var(--mf-mod, var(--mf-accent-500))',
              borderRadius:'var(--mf-r-lg)', padding:14 }}>
            <div style={{ flex:1, minWidth:220 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:'var(--mf-t-sm)', fontWeight:700, color:'var(--mf-text)' }}>
                <span className="mf-spin" /> Conectando contas…
              </div>
              <div style={{ fontSize:'var(--mf-t-micro)', color:'var(--mf-text-3)', marginTop:5, lineHeight:1.7 }}>
                Autorize na janela que abriu — ela se fecha sozinha e a conta aparece aqui.
                {/* ── Este texto mudou porque o comportamento mudou ──────────

                    Antes ele dizia para trocar de conta na mão, e era a verdade
                    daquele momento: sem `force_reauth`, a segunda autorização
                    no mesmo navegador reaproveitava a sessão e autorizava a
                    MESMA conta de novo, em silêncio. Prometer "pede login
                    novo" ali seria mentira, e a mentira custaria uma conta
                    conectada duas vezes no lugar de duas contas.

                    Agora o pedido leva `force_reauth=true` — o parâmetro que o
                    próprio painel da Meta emite na URL de login da empresa — e
                    a janela pede login a cada conta. O texto acompanha. */}
                {' '}Cada janela pede o login da conta, então dá para ir de uma
                para a outra sem sair daqui — ou use{' '}
                <strong style={{ color:'var(--mf-text-2)' }}>Copiar link</strong> e cole
                no navegador de cada perfil.
              </div>
              {janelaOAuth.conectadas.length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:9 }}>
                  {janelaOAuth.conectadas.map(u => (
                    <span key={u} style={{ fontSize:'var(--mf-t-nano)', fontWeight:700, padding:'3px 8px',
                      borderRadius:'var(--mf-r-xl)', color:'var(--mf-success-500)',
                      background:'color-mix(in oklch, var(--mf-success-500) 12%, transparent)',
                      border:'1px solid color-mix(in oklch, var(--mf-success-500) 28%, transparent)' }}>
                      ✓ @{u}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn-primary" onClick={() => abrirAutorizacaoEmJanela(janelaOAuth.url)}>
                + Conectar próxima conta
              </button>
              <button className="btn-ghost" onClick={() => { setJanelaOAuth(null); setOauthWaiting(false); }}>
                Terminei
              </button>
            </div>
          </motion.div>
        )}

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

        {/* ── Filters + search ── */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            {FILTERS.filter(f => f.key === 'all' || f.count > 0 || filter === f.key).map(f => {
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
            const isConnecting = !!connecting[account.id];
            const needsRecon  = account.healthStatus === 'token_invalido';
            const isHealthy   = !account.healthStatus || account.healthStatus === 'ativa';
            const compact     = fmtDateCompact(account.lastSync);
            const accType     = account.accountType?.toUpperCase() || 'CREATOR';
            const isSel       = selectedIds.has(account.id);
            const linked      = isLinked(account);

            return (
              <motion.div key={account.id} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:idx*.03, duration:.25 }}
                onClick={() => selectMode && toggleSelect(account.id)}
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
                        {cotas[String(account.id)] && <ChipDeCota cota={cotas[String(account.id)]} />}
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
                    // Sem token: a conta existe no painel mas não está
                    // conectada a nada. Antes isso aparecia como "API conectada".
                    <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', display:'flex', alignItems:'center', gap:5, color:'var(--mf-danger-500)' }}>
                      <IcoWifi /> Não conectada
                    </span>
                  ) : (
                    <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:isHealthy?'var(--mf-success-500)':account.healthStatus==='restrita'?'var(--mf-warning-500)':'var(--mf-danger-500)', display:'flex', alignItems:'center', gap:5 }}>
                      <IcoWifi /> {isHealthy ? 'API conectada' : account.healthStatus === 'restrita' ? 'Em verificação no Instagram' : account.healthStatus === 'token_invalido' ? 'Token inválido' : account.healthStatus === 'banida' ? 'Conta banida' : account.healthStatus === 'conta_pessoal' ? 'Conta pessoal — mude para profissional' : 'API desconectada'}
                    </span>
                  )}
                  <span style={{ fontFamily:'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <IcoWave /> {compact}
                  </span>
                </div>

                {/* O QUE FAZER: o texto do erro que o sync gravou. Antes só o
                    rótulo aparecia ("Token inválido") e a pessoa reconectava
                    uma conta que só precisava de um clique no Instagram — a
                    verificação "confirme que você é humano". Com o texto e o
                    atalho, a instrução está onde o problema está. */}
                {!isHealthy && account.lastError && (
                  <div style={{ padding:'6px 12px 7px', borderTop:'1px solid var(--mf-border)', fontSize:'var(--mf-t-nano)', lineHeight:1.55, color:'var(--mf-text-3)', display:'flex', gap:8, alignItems:'flex-start' }}>
                    <span style={{ flex:1, minWidth:0 }}>{account.lastError}</span>
                    {account.healthStatus === 'restrita' && (
                      <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer"
                        title="Abra o Instagram no navegador/perfil desta conta e conclua a verificação"
                        style={{ flexShrink:0, fontFamily:'var(--mf-mono)', fontWeight:700, color:'var(--mf-warning-500)', textDecoration:'none', whiteSpace:'nowrap' }}>
                        Verificar ↗
                      </a>
                    )}
                  </div>
                )}

                {/* actions */}
                <div style={{ height:1, background:'var(--mf-border)' }} />
                {/* As sete ações. `align-items: stretch` (e não center) para que
                    todas tenham a MESMA altura quando a linha quebra — com
                    `center`, botões de uma linha e de duas ficavam desalinhados
                    entre si. O excluir vai para a ponta por `margin-left:auto`. */}
                <div onClick={e => e.stopPropagation()} style={{ padding:'8px 8px', display:'flex', gap:5, alignItems:'stretch', flexWrap:'wrap' }}>
                  <a href={`https://instagram.com/${account.username}`} target="_blank" rel="noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize: 'var(--mf-t-xs)', fontWeight:600, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', border:'1px solid var(--mf-border)', color:'var(--mf-text-3)', background:'transparent', textDecoration:'none', whiteSpace:'nowrap', transition:'all .15s', flexShrink:0 }}
                    onMouseEnter={e => { e.currentTarget.style.color='var(--mf-text)'; e.currentTarget.style.borderColor='var(--mf-border-strong)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color='var(--mf-text-3)'; e.currentTarget.style.borderColor='var(--mf-border)'; }}
                  ><IcoEye /> Ver</a>

                    <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                      style={{ flexGrow:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)',
                        background:'color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)', color:'var(--mf-mod, var(--mf-accent-500))', border:'1px solid color-mix(in oklch, var(--mf-mod-contas) 25%, transparent)', cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', transition:'all .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-contas) 16%, transparent)'}
                      onMouseLeave={e => e.currentTarget.style.background='color-mix(in oklch, var(--mf-mod-contas) 10%, transparent)'}
                    ><IcoPerson /> <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{isConnecting ? '...' : 'Editar'}</span></button>


                  <button onClick={() => openOAuthConnect(account)} disabled={isConnecting}
                    title={needsRecon ? 'Reconectar' : 'API ok'}
                    style={{ display:'flex', alignItems:'center', gap:4, fontSize: 'var(--mf-t-xs)', fontWeight:700, padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .15s',
                      background: needsRecon ? 'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)' : 'color-mix(in oklch, var(--mf-success-500) 10%, transparent)',
                      color:      needsRecon ? 'var(--mf-danger-500)'           : 'var(--mf-success-500)',
                      border:     needsRecon ? '1px solid color-mix(in oklch, var(--mf-danger-500) 28%, transparent)' : '1px solid color-mix(in oklch, var(--mf-success-500) 25%, transparent)',
                    }}
                  ><IcoCheck /> API</button>


                  {/* A única ação irreversível do cartão. Empurrada para a ponta
                      direita e afastada das demais: encostada nelas, ela
                      tinha a mesma presença de "Ver" — e é a distância que
                      separa "abrir" de "apagar". */}
                  <button onClick={() => deleteAccount(account.id)} title="Excluir conta"
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'4px 8px', borderRadius: 'var(--mf-r-sm)', flexShrink:0,
                      marginLeft:'auto',
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
                {safeAccounts.length === 0 ? 'Clique em "Conectar Contas (OAuth)" para adicionar sua primeira conta.' : 'Ajuste o filtro ou a busca.'}
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

      {/* Todos os modais desta página vão para o <body> via PortalModal — fora
          de qualquer ancestral com container-type/transform, para nunca abrirem
          "colados no topo". Ver components/PortalModal.jsx. */}
      <PortalModal>
      {/* ── Falta cadastrar o App Meta ─────────────────────────────────────
          O OAuth usa SÓ apps cadastrados aqui (o app padrão do .env foi
          removido de propósito — era compartilhado, e app compartilhado que
          derruba contas leva a reputação de todo mundo junto). Sem app, este
          é o caminho, não um erro. */}
      {precisaApp && (
        <div className="modal-overlay" onClick={() => setPrecisaApp(false)}>
          <div className="modal" style={{ width:'min(460px,100%)' }} onClick={e => e.stopPropagation()}>
            {!isAdmin() ? (<>
              <h3 style={{ margin:'0 0 8px', fontSize:'var(--mf-t-h2)', fontWeight:800 }}>
                A conexão ainda não está disponível
              </h3>
              <p style={{ fontSize:'var(--mf-t-sm)', color:'var(--mf-text-2)', lineHeight:1.7, margin:'0 0 16px' }}>
                O administrador da plataforma ainda não cadastrou o App da Meta usado para conectar as contas.
                Avise o administrador e tente de novo depois.
              </p>
              <button className="btn-primary" style={{ width:'100%', justifyContent:'center' }} onClick={() => setPrecisaApp(false)}>
                Entendi
              </button>
            </>) : (<>
            <h3 style={{ margin:'0 0 8px', fontSize:'var(--mf-t-h2)', fontWeight:800 }}>
              Cadastre seu App Meta primeiro
            </h3>
            <p style={{ fontSize:'var(--mf-t-sm)', color:'var(--mf-text-2)', lineHeight:1.7, margin:'0 0 14px' }}>
              Para conectar contas pela API oficial, o sistema usa <strong>o seu</strong> app
              do Meta — não existe mais app padrão embutido. Cadastre o app uma vez e
              ele fica disponível para todas as conexões.
            </p>
            <div style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-3)', lineHeight:1.8,
              background:'var(--mf-surface-2)', border:'1px solid var(--mf-border)',
              borderRadius:'var(--mf-r-md)', padding:'11px 13px', marginBottom:16 }}>
              Você vai precisar de: <strong style={{ color:'var(--mf-text-2)' }}>Meta App ID</strong>,
              <strong style={{ color:'var(--mf-text-2)' }}> App Secret</strong>,
              <strong style={{ color:'var(--mf-text-2)' }}> Instagram App ID</strong> e
              <strong style={{ color:'var(--mf-text-2)' }}> Instagram App Secret</strong> —
              todos em developers.facebook.com, no seu app.
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn-ghost" style={{ flex:1, justifyContent:'center' }}
                onClick={() => setPrecisaApp(false)}>
                Agora não
              </button>
              <button className="btn-primary" style={{ flex:1, justifyContent:'center' }}
                onClick={() => { setPrecisaApp(false); navigate('/api-meta'); }}>
                Cadastrar App Meta
              </button>
            </div>
            </>)}
          </div>
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
                    <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' ★' : ''} — {a.appId}</option>
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

      {/* ── Como abrir a autorização ─────────────────────────────────────────
          Duas maneiras de autorizar, e a diferença entre elas não é de gosto:
          nesta aba, quem autoriza é a conta logada NESTE navegador; copiando o
          link, é a conta logada no navegador onde você colar. Quem trabalha com
          um perfil por navegador precisa da segunda, e escolher antes evita
          abrir o fluxo em duas etapas para quem não vai usar a segunda etapa. */}
      {escolhaOAuth && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(420px,100%)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:4 }}>
              <div>
                <h3 style={{ margin:0, fontSize:'var(--mf-t-h2)', fontWeight:800 }}>Conectar com o Instagram</h3>
                <div style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-2)', marginTop:4 }}>
                  {escolhaOAuth.account
                    ? `Reconectar @${escolhaOAuth.account.username} — siga os 2 passos:`
                    : 'Siga os 2 passos para autorizar sua conta sem erro:'}
                </div>
              </div>
              <button onClick={() => setEscolhaOAuth(null)} aria-label="Fechar"
                style={{ background:'none', border:'none', color:'var(--mf-text-3)', fontSize:'var(--mf-t-h1)', cursor:'pointer', lineHeight:1 }}>×</button>
            </div>

            {/* O aviso vem antes dos passos: se o retorno não tem para onde
                ir, seguir os dois passos não conecta nada. */}
            {avisoOAuth && (
              <div style={{ marginTop:16, padding:'11px 13px', borderRadius:'var(--mf-r-md)',
                background:'color-mix(in oklch, var(--mf-warning-500) 10%, transparent)',
                border:'1px solid color-mix(in oklch, var(--mf-warning-500) 28%, transparent)',
                color:'var(--mf-warning-500)', fontSize:'var(--mf-t-micro)', lineHeight:1.7 }}>
                <strong style={{ display:'block', marginBottom:3 }}>Configuração do OAuth</strong>
                {avisoOAuth}
              </div>
            )}

            {/* ── Os dois passos ───────────────────────────────────────────
                Vêm de `PassosDeConexao`, o mesmo componente da página guiada:
                os textos explicam por que a autorização falha sem o convite de
                testador, e essa explicação não pode existir em duas versões.

                O passo 2 aqui abre uma JANELA em vez de navegar — é o que
                mantém esta tela de pé para receber a próxima conta. A decisão
                é de quem chama, por isso `onAutorizar`. */}
            <div style={{ marginTop:18 }}>
              <PassosDeConexao
                conta={escolhaOAuth.account?.id || 'new'}
                metaAppId={selectedAppId}
                url={escolhaOAuth.url}
                mod="contas"
                onAutorizar={abrirAutorizacaoEmJanela}
                onErro={msg => showToast('error', 'Erro', msg)}
              />
            </div>

            <div style={{ borderTop:'1px solid var(--border)', margin:'16px 0 14px' }} />

            {/* O link guiado leva à MESMA tela de dois passos, aberta no
                navegador do perfil. Antes eu copiava só o link de autorização —
                que cai direto no Instagram e falha sem explicação quando o
                convite de testador não foi aceito. O link do cabeçalho continua
                copiando o link cru, para quem já sabe o que fazer com ele. */}
            <button className="btn-ghost tom-modulo" style={{ width:'100%', justifyContent:'center', padding:'11px',
                '--tom':'var(--mf-mod-contas)',
                color:'var(--mf-mod, var(--mf-accent-500))',
                background:'color-mix(in oklch, var(--mf-mod-contas) 8%, transparent)' }}
              onClick={() => { copiarLinkGuiado(escolhaOAuth.account?.id || 'new'); setEscolhaOAuth(null); }}>
              <IcoCopy /> Copiar link guiado (para Multilogin)
            </button>

            <div style={{ fontSize:'var(--mf-t-micro)', color:'var(--mf-text-3)', lineHeight:1.7, marginTop:12 }}>
              Cole no perfil do multilogin (anti-detect) onde a conta está logada.
              A página guiada abre os 2 passos lá dentro, e ao autorizar a conta
              entra aqui sozinha — sem voltar e sem colar nada.
            </div>

            {/* A saída de emergência, não o caminho normal.
                Só serve quando o navegador isolado não alcança este servidor e a
                URL de retorno morre na barra de endereços — aí colar a URL à mão
                é a única forma de a conta entrar. */}
            <button onClick={() => { setOauthModal({ account: escolhaOAuth.account, url: escolhaOAuth.url }); setEscolhaOAuth(null); }}
              style={{ marginTop:14, width:'100%', background:'none', border:'none', padding:0,
                color:'var(--mf-text-3)', fontSize:'var(--mf-t-micro)', cursor:'pointer', textDecoration:'underline', textAlign:'center' }}>
              O navegador isolado não alcança este servidor — colar a URL de retorno à mão
            </button>
          </div>
        </div>
      )}

      {/* ── Pedir acesso via convite ─────────────────────────────────────────
          A Meta não convida testador por API. O `POST /{app-id}/roles` da Graph
          API é indisponível, os papéis que ela conhece
          (administrators/developers/testers/insights users) não incluem o
          testador do Instagram, e o campo `user` pede o ID numérico de um
          usuário do Facebook — não um @. Enviar é clique de painel.

          Então esta tela cuida do que é nosso: a fila de @ que faltam, o @ na
          área de transferência e o painel abrindo na página certa. O estado
          "conectado" não é marcado à mão — o servidor o deduz olhando se já
          existe conta vinculada com aquele @. */}
      {conviteModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width:'min(560px,100%)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:4 }}>
              <div>
                <h3 style={{ margin:0, fontSize:'var(--mf-t-h2)', fontWeight:800 }}>Pedir acesso via convite</h3>
                <div style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-2)', marginTop:4 }}>
                  Testador do app — sem senha e sem risco de checkpoint
                </div>
              </div>
              <button onClick={() => setConviteModal(false)} aria-label="Fechar"
                style={{ background:'none', border:'none', color:'var(--mf-text-3)', fontSize:'var(--mf-t-h1)', cursor:'pointer', lineHeight:1 }}>×</button>
            </div>

            <div style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-text-3)', lineHeight:1.7, margin:'14px 0 16px' }}>
              Se a conta não conectou por senha nem por Session&nbsp;ID, ela pode entrar como{' '}
              <strong style={{ color:'var(--mf-text-2)' }}>testadora do app</strong>: o convite chega
              no Instagram dela (Configurações → Apps e sites) e é aceito por lá.
              <br /><br />
              <strong style={{ color:'var(--mf-text-2)' }}>O envio é um clique no painel da Meta</strong> —
              não existe API para convidar testador. Ao pedir aqui, eu copio o @ e abro o
              painel na seção certa; você cola e envia.
            </div>

            <label style={{ fontSize:'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-3)', letterSpacing:.5, textTransform:'uppercase', display:'block', marginBottom:7 }}>
              Usuário do Instagram (@)
            </label>
            <div style={{ display:'flex', gap:8 }}>
              <input
                value={conviteArroba}
                onChange={e => { setConviteArroba(e.target.value); setConviteErro(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && !conviteEnviando) pedirConvite(); }}
                placeholder="seu_usuario_ig"
                style={{ flex:1, minWidth:0, boxSizing:'border-box', padding:'9px 12px',
                  borderRadius:'var(--mf-r-md)',
                  border:`1px solid ${conviteErro ? 'color-mix(in oklch, var(--mf-danger-500) 50%, transparent)' : 'var(--border)'}`,
                  background:'var(--bg3)', color:'var(--mf-text)', fontSize:'var(--mf-t-sm)', outline:'none' }}
              />
              <button className="btn-primary" onClick={pedirConvite} disabled={conviteEnviando || !conviteArroba.trim()}
                style={{ whiteSpace:'nowrap', padding:'0 18px' }}>
                {conviteEnviando ? <span className="mf-spin" /> : null} Enviar pedido
              </button>
            </div>
            {conviteErro && <div style={{ fontSize:'var(--mf-t-xs)', color:'var(--mf-danger-500)', marginTop:7 }}>{conviteErro}</div>}
            {!convitePainel.url && (
              <div style={{ fontSize:'var(--mf-t-micro)', color:'var(--mf-warning-500)', marginTop:8, lineHeight:1.6 }}>
                Nenhum App da Meta configurado — sem ele eu não sei qual painel abrir.
                O @ fica guardado na fila mesmo assim.
              </div>
            )}

            {convites.length > 0 && (
              <div style={{ marginTop:22 }}>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:9 }}>
                  <span style={{ fontSize:'var(--mf-t-micro)', fontWeight:700, color:'var(--mf-text-3)', letterSpacing:.5, textTransform:'uppercase' }}>
                    Convites
                  </span>
                  <span style={{ fontSize:'var(--mf-t-micro)', color:'var(--mf-text-3)' }}>
                    {convites.filter(c => c.conectado).length} de {convites.length} já conectadas
                  </span>
                </div>

                <div style={{ border:'1px solid var(--border)', borderRadius:'var(--mf-r-md)', overflow:'hidden', maxHeight:260, overflowY:'auto' }}>
                  {convites.map((c, i) => {
                    /* Três estados, um por dono: conectado é fato do sistema,
                       enviado é o que você já fez, pendente é o que falta. */
                    const tom = c.conectado ? 'var(--mf-success-500)'
                      : c.estado === 'enviado' ? 'var(--mf-warning-500)'
                      : 'var(--mf-text-3)';
                    const rotulo = c.conectado ? 'Conectada'
                      : c.estado === 'enviado' ? 'Convite enviado'
                      : 'Pendente';
                    return (
                      <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 11px',
                        borderTop: i ? '1px solid var(--border)' : 'none', minWidth:0 }}>
                        <span style={{ width:7, height:7, borderRadius:'var(--mf-r-full)', background:tom, flexShrink:0 }} />
                        <span className="mf-trunc" style={{ flex:1, minWidth:0, fontSize:'var(--mf-t-sm)', fontWeight:600, color:'var(--mf-text)' }}>
                          @{c.username}
                        </span>
                        <span style={{ fontSize:'var(--mf-t-nano)', fontWeight:700, color:tom, whiteSpace:'nowrap' }}>{rotulo}</span>

                        {!c.conectado && isAdmin() && (
                          <>
                            <button onClick={() => abrirPainelDoConvite(c.username, convitePainel.url)}
                              title="Copiar o @ e abrir o painel da Meta"
                              className="btn-ghost" style={{ padding:'3px 8px', fontSize:'var(--mf-t-nano)' }}>
                              Painel
                            </button>
                            {c.estado !== 'enviado' && (
                              <button onClick={() => marcarConviteEnviado(c.id)}
                                title="Marcar que o convite já foi enviado no painel"
                                className="btn-ghost" style={{ padding:'3px 8px', fontSize:'var(--mf-t-nano)' }}>
                                Enviei
                              </button>
                            )}
                          </>
                        )}
                        <button onClick={() => removerConvite(c.id)} aria-label={`Remover convite de @${c.username}`}
                          className="btn-ghost" style={{ padding:'3px 7px', color:'var(--mf-danger-500)' }}>
                          <IcoTrash />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ fontSize:'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:9, lineHeight:1.7 }}>
                  “Conectada” aparece sozinha quando a conta daquele @ entra no sistema —
                  não precisa marcar nada.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </PortalModal>
    </>
  );
}


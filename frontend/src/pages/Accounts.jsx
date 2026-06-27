import { useEffect, useState } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

export default function Accounts() {
  const ACCOUNTS_CACHE_KEY = 'instaflow_accounts_cache';

  const [accounts, setAccounts] = useState(() => {
    try { const c = localStorage.getItem(ACCOUNTS_CACHE_KEY); return c ? JSON.parse(c) : []; } catch { return []; }
  });
  const [syncing, setSyncing] = useState(null);
  const [toast, setToast] = useState(null);
  const [deleteModal, setDeleteModal] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [selectedBulkAccounts, setSelectedBulkAccounts] = useState({});
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkName, setBulkName] = useState('');
  const [bulkBio, setBulkBio] = useState('');
  const [bulkLink, setBulkLink] = useState('');
  const [bulkPhoto, setBulkPhoto] = useState(null);
  const [bulkSetGender, setBulkSetGender] = useState(true);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [proxyAccount, setProxyAccount] = useState(null);
  const [proxyValue, setProxyValue] = useState('');
  const [testingProxy, setTestingProxy] = useState(null);
  const [passwordModal, setPasswordModal] = useState(null);   // account object
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [mobileModal, setMobileModal]     = useState(null);   // account object
  const [mobileCode, setMobileCode]       = useState('');
  const [mobileStep, setMobileStep]       = useState('idle'); // idle | loading | needsCode | done
  const [mobileMsg, setMobileMsg]         = useState('');
  // oauthModal: null | { _id, username } — conta existente, ou { _id:'new', username:'Nova conta' }
  const [oauthModal, setOauthModal]       = useState(null);
  const [oauthUrl, setOauthUrl]           = useState('');
  const [oauthUrlLoading, setOauthUrlLoading] = useState(false);
  const [oauthPasted, setOauthPasted]     = useState('');
  const [oauthLoading, setOauthLoading]   = useState(false);
  const [oauthResult, setOauthResult]     = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [importing, setImporting]         = useState(false);
  const [totpModal, setTotpModal]         = useState(null);  // { _id, username }
  const [totpCode, setTotpCode]           = useState('');
  const [totpLoading, setTotpLoading]     = useState(false);
  const [connectingApi, setConnectingApi] = useState({});   // { [accountId]: true }
  const [mobileCodeType, setMobileCodeType] = useState('email'); // 'email' | 'totp'
  const [sessionModal, setSessionModal]   = useState(null);  // account object
  const [sessionId, setSessionId]         = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);
  // TOTP Secret modal — salva segredo base32 para geração automática de 2FA
  const [totpSecretModal, setTotpSecretModal] = useState(null);  // account object
  const [totpSecretValue, setTotpSecretValue] = useState('');
  const [totpSecretLoading, setTotpSecretLoading] = useState(false);

  // Rename modal
  const [renameModal, setRenameModal]     = useState(null);   // account object
  const [renameValue, setRenameValue]     = useState('');
  // Cookie import modal
  const [cookieModal, setCookieModal]     = useState(null);   // account object
  const [cookieText, setCookieText]       = useState('');
  const [cookieLoading, setCookieLoading] = useState(false);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }
  function toggleBulkAccount(id) { const aid = String(id); setSelectedBulkAccounts(p => ({ ...p, [aid]: !p[aid] })); }
  function selectedBulkAccountIds() { return Object.keys(selectedBulkAccounts).filter(id => selectedBulkAccounts[id]); }

  async function loadAccounts(targetPage = page) {
    try {
      const res = await api.get(`/accounts?page=${targetPage}&limit=50`);
      const list = Array.isArray(res.data.accounts) ? res.data.accounts : [];
      setAccounts(list); setPagination(res.data.pagination || null);
      localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(list));
    } catch (err) { console.log('Erro ao carregar contas:', err.message); }
  }

  function goToPage(p) { setPage(p); loadAccounts(p); }
  // Escuta eventos de contas E de posts (status muda quando post termina)
  useServerEvents(['accounts', 'posts'], loadAccounts);
  // Polling a cada 5s para manter status "Publicando" / contadores em tempo real
  useEffect(() => { loadAccounts(); const t = setInterval(loadAccounts, 5000); return () => clearInterval(t); }, []);

  // Detect OAuth callback result from URL (?oauth=success&username=XXX or ?oauth=error&msg=XXX)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    if (!oauth) return;
    if (oauth === 'success') {
      const username = params.get('username') || '';
      showToast('success', 'Conta conectada!', `@${username} adicionada via Meta API`);
      loadAccounts();
    } else if (oauth === 'error') {
      showToast('error', 'Erro na conexão', params.get('msg') || 'Falha no OAuth');
    }
    // Clean URL
    window.history.replaceState({}, '', '/accounts');
  }, []);

  async function connectBulkAccounts() {
    try { await api.post('/accounts/connect-bulk'); showToast('success', 'Conexão em lote iniciada', 'As contas importadas serão conectadas uma por vez.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao iniciar conexão em lote.'); }
  }

  async function importBulkAccounts() {
    try {
      if (!bulkText.trim()) return showToast('warning', 'Atenção', 'Cole pelo menos uma conta.');
      setImporting(true);
      const res = await api.post('/accounts/import-bulk', { accountsText: bulkText, connectApi: true });
      setBulkText('');
      await loadAccounts();
      setImportResults(res.data);  // show per-account results
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao importar contas.');
    } finally {
      setImporting(false);
    }
  }

  async function submitBulkEdit() {
    try {
      const ids = selectedBulkAccountIds();
      if (!ids.length) return showToast('warning', 'Atenção', 'Selecione pelo menos uma conta.');
      if (!bulkName && !bulkBio && !bulkLink && !bulkPhoto) return showToast('warning', 'Atenção', 'Preencha nome, bio ou foto.');
      const form = new FormData();
      form.append('accountIds', JSON.stringify(ids));
      form.append('name', bulkName);
      form.append('bio', bulkBio);
      form.append('externalLink', bulkLink);
      form.append('setGender', String(bulkSetGender));
      if (bulkPhoto) form.append('photo', bulkPhoto);
      await api.post('/accounts/bulk-edit-profile', form);
      setBulkEditOpen(false); setBulkName(''); setBulkBio(''); setBulkLink(''); setBulkPhoto(null); setBulkSetGender(true); setSelectedBulkAccounts({});
      showToast('success', 'Edição iniciada', 'As contas selecionadas serão editadas uma por vez.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao iniciar edição em massa.'); }
  }

  // Abre o modal OAuth (conta existente ou nova)
  function openOauthModal(account) {
    setOauthModal(account);
    setOauthResult(null);
    setOauthPasted('');
    setOauthUrl('');
  }

  // Botão "Conectar via API" no topo — cria nova conta
  function openOauthNew() {
    openOauthModal({ _id: 'new', username: 'Nova conta' });
  }

  // Auto-connect: usa cookies.json importados para fazer OAuth em background sem janela visível
  async function autoConnect(account) {
    showToast('info', 'Conectando...', `Iniciando OAuth automático para @${account.username}...`);
    try {
      await api.post(`/api/oauth/auto-connect/${account._id}`);
      showToast('success', 'Em progresso', `Conectando @${account.username} em background. Aguarde ~30 segundos e recarregue a página.`);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      showToast('error', 'Erro', msg);
    }
  }

  // Busca URL de autorização quando o modal abre
  useEffect(() => {
    if (!oauthModal) return;
    setOauthUrlLoading(true);
    const accountId = oauthModal._id || 'new';
    api.get(`/oauth/url?accountId=${accountId}`)
      .then(r => setOauthUrl(r.data.url || ''))
      .catch(() => setOauthUrl(''))
      .finally(() => setOauthUrlLoading(false));
  }, [oauthModal?._id]);

  // Envia a URL colada (barra de endereços) ou código direto para trocar por token
  async function submitOauthPaste() {
    const raw = oauthPasted.trim();
    if (!raw) return showToast('warning', 'Atenção', 'Cole a URL ou o código que apareceu no navegador.');
    setOauthLoading(true);
    try {
      const accountId = oauthModal._id || 'new';
      const trimmed = raw.trim();

      // Detecta se é um token direto (IGAA... ou EAA...) — salva sem precisar de OAuth
      if (/^(IGAA|IGQV|EAA|EAAA)[A-Za-z0-9_-]{20,}/.test(trimmed)) {
        await api.patch(`/accounts/${accountId}/credentials`, { accessToken: trimmed });
        setOauthResult({ success: true, message: 'Token salvo! Conta conectada via token direto.' });
        await loadAccounts();
        return;
      }

      // Aceita: URL completa, "code=ABC", "?code=ABC", ou só o valor do código
      let pastedUrl = trimmed;
      if (!trimmed.startsWith('http')) {
        const codeMatch = trimmed.match(/(?:^|[?&])code=([^&\s]+)/i);
        const code = codeMatch ? codeMatch[1] : trimmed.replace(/\s/g, '');
        pastedUrl = `https://localhost:3000/api/oauth/callback?code=${encodeURIComponent(code)}&state=${accountId}`;
      }
      const res = await api.post(`/oauth/connect/${accountId}`, { pastedUrl });
      setOauthResult({ success: true, message: res.data.message });
      await loadAccounts();
    } catch (err) {
      setOauthResult({ success: false, message: err.response?.data?.error || 'Erro ao conectar.' });
    } finally {
      setOauthLoading(false);
    }
  }

  async function renameAccount() {
    if (!renameModal || !renameValue.trim()) return;
    try {
      await api.patch(`/accounts/${renameModal._id}/username`, { username: renameValue.trim() });
      showToast('success', 'Conta renomeada', `@${renameValue.trim().replace(/^@/,'')}`);
      setRenameModal(null);
      loadAccounts();
    } catch (e) {
      showToast('error', 'Erro', e.response?.data?.error || 'Falha ao renomear');
    }
  }

  async function disconnectOauth(accountId) {
    try {
      await api.delete(`/oauth/disconnect/${accountId}`);
      await loadAccounts();
      showToast('success', 'Desconectado', 'Token removido. Conta voltará a usar API privada.');
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao desconectar.');
    }
  }

  async function connectAccount() {
    try { await api.post('/accounts/connect'); showToast('success', 'Conta conectada', 'O navegador foi aberto para login da conta.'); await loadAccounts(); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao conectar conta'); }
  }

  async function syncAllAccounts() {
    try { setSyncing('all'); await api.post('/accounts/sync-all'); showToast('success', 'Sincronização iniciada', 'As contas serão atualizadas em segundo plano.'); }
    catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao sincronizar contas.'); }
    finally { setSyncing(null); }
  }

  async function quickCheckAll() {
    try {
      setSyncing('quickcheck');
      await api.post('/accounts/quick-check-all');
      showToast('success', 'Verificação iniciada', 'Checando saúde de todas as contas em background. A lista atualiza automaticamente.');
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao verificar contas.');
    } finally {
      setSyncing(null);
    }
  }

  async function refreshSessions() {
    try {
      setSyncing('refresh');
      await api.post('/accounts/refresh-sessions');
      showToast('success', 'Renovação iniciada', 'Renovando sessões em background. Isso mantém as contas logadas por mais tempo.');
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao renovar sessões.');
    } finally {
      setSyncing(null);
    }
  }

  function deleteAccount(id) { setAccountToDelete(id); setDeleteModal(true); }

  async function confirmDelete() {
    try { await api.delete(`/accounts/${accountToDelete}`); await loadAccounts(); showToast('success', 'Conta removida', 'A conta foi excluída com sucesso.'); }
    catch { showToast('error', 'Erro', 'Não foi possível excluir a conta.'); }
    setDeleteModal(false); setAccountToDelete(null);
  }

  async function openAccount(account) {
    try {
      if (account.isBusy) return showToast('warning', 'Conta em uso', 'Essa conta está publicando ou sincronizando.');
      await api.post(`/accounts/${account._id}/open`);
      showToast('success', 'Conta aberta', `Abrindo @${account.username} no navegador. A sessão de story será capturada automaticamente.`);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Não foi possível abrir a conta.'); }
  }

  async function captureSession(account) {
    try {
      await api.post(`/accounts/${account._id}/capture-session`);
      showToast('success', 'Capturando sessão', `Browser abrindo para @${account.username}. Aguarde — será fechado automaticamente.`);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Falha ao capturar sessão.'); }
  }

  async function webLogin(account) {
    try {
      await api.post(`/accounts/${account._id}/web-login`);
      showToast('success', 'Login automático', `Browser abrindo para @${account.username} — preenche usuário/senha automaticamente. Se pedir 2FA, resolva no browser.`);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Falha ao iniciar login.'); }
  }

  function openMobileModal(account, skipToCode = false) {
    setMobileModal(account);
    setMobileCode('');
    setMobileMsg('');
    // skipToCode=true: challenge já foi iniciado no import, vai direto para digitar o código
    setMobileStep(skipToCode ? 'needsCode' : 'idle');
  }

  async function initMobileSession() {
    setMobileStep('loading');
    try {
      const res = await api.post(`/accounts/${mobileModal._id}/init-mobile-session`);
      if (res.data.success) {
        setMobileStep('done');
        setMobileMsg('✅ Sessão mobile ativa! Próximos stories terão link sticker.');
        await loadAccounts();
      } else if (res.data.needsCode) {
        setMobileStep('needsCode');
        setMobileMsg(res.data.message);
      }
    } catch (err) {
      setMobileStep('idle');
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao iniciar sessão mobile.');
    }
  }

  // Código do Google Authenticator dentro do fluxo de checkpoint
  // Usa /resolve-challenge com codeType='totp' (ig.challenge.selectVerifyMethod('0') + sendSecurityCode)
  async function submitChallengeAsTotp() {
    if (!mobileCode.trim()) return showToast('warning', 'Atenção', 'Digite o código do Google Authenticator.');
    setMobileStep('loading');
    try {
      const res = await api.post(`/accounts/${mobileModal._id}/resolve-challenge`, { code: mobileCode.trim(), codeType: 'totp' });
      if (res.data.totpRequired) {
        setMobileCode(''); setMobileCodeType('totp'); setMobileStep('needsCode');
        setMobileMsg(res.data.message);
        return;
      }
      setMobileStep('done');
      setMobileMsg('✅ Conta conectada!');
      await loadAccounts();
    } catch (err) {
      setMobileStep('needsCode');
      showToast('error', 'Código inválido', err.response?.data?.error || 'Verifique o Google Authenticator e tente novamente.');
    }
  }

  async function resolveChallenge() {
    if (!mobileCode.trim()) return showToast('warning', 'Atenção', 'Digite o código recebido.');
    setMobileStep('loading');
    try {
      const res = await api.post(`/accounts/${mobileModal._id}/resolve-challenge`, { code: mobileCode.trim() });

      // Checkpoint OK mas agora precisa do Google Authenticator
      if (res.data.totpRequired) {
        setMobileCode('');
        setMobileCodeType('totp');
        setMobileStep('needsCode');
        setMobileMsg(res.data.message);
        showToast('info', '🔐 Autenticador necessário', 'Checkpoint verificado! Agora insira o código do Google Authenticator.');
        return;
      }

      setMobileStep('done');
      setMobileMsg(res.data.message || 'Conta conectada!');
      await loadAccounts();
    } catch (err) {
      setMobileStep('needsCode');
      showToast('error', 'Código inválido', err.response?.data?.error || 'Verifique o código e tente novamente.');
    }
  }

  async function importSession() {
    if (!sessionId.trim()) return showToast('warning', 'Atenção', 'Cole o sessionid antes de confirmar.');
    setSessionLoading(true);
    try {
      const res = await api.post(`/accounts/${sessionModal._id}/import-session`, { sessionid: sessionId.trim() });
      showToast('success', '✅ Conectada!', res.data.message);
      setSessionModal(null); setSessionId('');
      await loadAccounts();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'sessionid inválido.');
    } finally {
      setSessionLoading(false);
    }
  }

  async function retryApiLogin() {
    // Limpa challenge state e faz novo login para gerar novo checkpoint
    try {
      await api.post(`/accounts/${mobileModal._id}/clear-challenge`);
      setMobileStep('loading');
      const res = await api.post(`/accounts/${mobileModal._id}/login-private`);
      const { status, autoSent } = res.data;
      if (status === 'challenge_required') {
        setMobileCode('');
        setMobileStep('needsCode');
        showToast('info', autoSent ? '📧 Novo código enviado' : '⚠️ Auto-envio falhou', autoSent ? 'Verifique o email da conta.' : 'Selecione o tipo de código e tente.');
      } else if (status === 'connected') {
        setMobileStep('done'); setMobileMsg('Conta conectada!'); await loadAccounts();
      }
    } catch (err) {
      setMobileStep('needsCode');
      showToast('error', 'Erro', err.response?.data?.error || err.message);
    }
  }

  async function connectApi(account) {
    if (!account.password) {
      // Sem senha → abre modal de senha primeiro
      openPasswordModal(account);
      return;
    }
    setConnectingApi(p => ({ ...p, [account._id]: true }));
    try {
      const res = await api.post(`/accounts/${account._id}/login-private`);
      const { status, autoSent, converted, message } = res.data;

      if (status === 'connected') {
        showToast('success', converted ? '⭐ Convertida para Creator' : '✅ Conta conectada', message);
        await loadAccounts();
      } else if (status === 'challenge_required') {
        showToast('info', '📧 Código enviado',
          autoSent ? 'Verifique o email da conta e insira o código.' : 'O Instagram pediu verificação. Insira o código recebido.');
        openMobileModal(account, true);
      } else if (status === 'email_required') {
        showToast('info', '📧 Email necessário', 'Instagram não reconhece o username. Informe o email/telefone da conta.');
        openPasswordModal(account);
      } else if (status === 'totp_required') {
        if (account.hasTotpSecret) {
          // Tem segredo salvo mas o auto-login falhou — avisa sem abrir modal
          showToast('error', '❌ TOTP automático falhou', 'Verifique se o segredo 2FA está correto. Clique em 🔑 2FA para reconfigurar.');
        } else {
          showToast('info', '🔐 Autenticador', 'Configure o 2FA automático clicando em 🔑 2FA e cole o segredo.');
          setTotpSecretModal({ _id: account._id, username: account.username });
          setTotpSecretValue('');
        }
      }
    } catch (err) {
      showToast('error', 'Erro ao conectar', err.response?.data?.error || 'Verifique a senha da conta.');
    } finally {
      setConnectingApi(p => ({ ...p, [account._id]: false }));
    }
  }

  async function saveTotpSecret() {
    const secret = totpSecretValue.trim().replace(/\s/g, '').toUpperCase();
    if (!secret) return showToast('warning', 'Atenção', 'Cole o segredo TOTP (chave base32).');
    setTotpSecretLoading(true);
    try {
      const res = await api.patch(`/accounts/${totpSecretModal._id}/totp-secret`, { totpSecret: secret });
      showToast('success', '🔑 Segredo salvo!', res.data.message || 'Login automático 2FA ativado.');
      setTotpSecretModal(null);
      setTotpSecretValue('');
      // Tenta login automático agora
      const account = accounts.find(a => String(a._id) === String(totpSecretModal._id));
      if (account) setTimeout(() => connectApi(account), 500);
    } catch (err) {
      showToast('error', 'Segredo inválido', err.response?.data?.error || 'Verifique o segredo e tente novamente.');
    } finally {
      setTotpSecretLoading(false);
    }
  }

  async function resolveTotp() {
    if (!totpCode.trim()) return showToast('warning', 'Atenção', 'Digite o código de 6 dígitos do autenticador.');
    setTotpLoading(true);
    try {
      await api.post(`/accounts/${totpModal._id}/resolve-totp`, { code: totpCode.trim() });
      setTotpModal(null);
      setTotpCode('');
      await loadAccounts();
      showToast('success', '✅ Login 2FA concluído', 'Conta pronta para publicar Reels.');
    } catch (err) {
      showToast('error', 'Código inválido', err.response?.data?.error || 'Verifique o código e tente novamente.');
    } finally {
      setTotpLoading(false);
    }
  }

  function openCookieModal(account) { setCookieModal(account); setCookieText(''); }

  async function importCookies() {
    if (!cookieText.trim()) return showToast('warning', 'Atenção', 'Cole os cookies exportados do Multilogin.');
    setCookieLoading(true);
    try {
      const res = await api.post(`/accounts/${cookieModal._id}/import-cookies`, { cookies: cookieText.trim() });
      setCookieModal(null);
      showToast('success', '🍪 Cookies importados!', res.data.message);
      await loadAccounts();
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || 'Erro ao importar cookies.');
    } finally {
      setCookieLoading(false);
    }
  }

  const [loginEmailValue, setLoginEmailValue] = useState('');

  function openPasswordModal(account) { setPasswordModal(account); setPasswordValue(''); setLoginEmailValue(account.loginEmail || ''); }

  async function savePassword() {
    if (!passwordValue.trim()) return showToast('warning', 'Atenção', 'Digite a senha.');
    setPasswordLoading(true);
    try {
      await api.patch(`/accounts/${passwordModal._id}/credentials`, {
        password: passwordValue.trim(),
        loginEmail: loginEmailValue.trim(),
      });
      setPasswordModal(null);
      showToast('success', '✅ Credenciais salvas', 'Clique em 🔗 API para conectar.');
      // Tenta conectar automaticamente se tiver senha
      const acc = accounts.find(a => String(a._id) === String(passwordModal._id));
      if (acc) setTimeout(() => connectApi({ ...acc, password: passwordValue.trim(), loginEmail: loginEmailValue.trim() }), 300);
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao salvar.'); }
    finally { setPasswordLoading(false); }
  }

  function openProxyModal(account) { setProxyAccount(account); setProxyValue(account.proxy || ''); setProxyModalOpen(true); }

  async function saveProxy() {
    try {
      if (!proxyAccount) return;
      await api.patch(`/accounts/${proxyAccount._id}/proxy`, { proxy: proxyValue });
      await loadAccounts(); setProxyModalOpen(false); setProxyAccount(null); setProxyValue('');
      showToast('success', 'Proxy salvo', 'Proxy atualizado com sucesso.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao salvar proxy.'); }
  }

  async function testProxy(account) {
    try {
      setTestingProxy(account._id);
      const res = await api.post(`/accounts/${account._id}/proxy/test`);
      await loadAccounts();
      if (res.data.success) showToast('success', 'Proxy online', `IP detectado: ${res.data.ip}`);
      else showToast('error', 'Proxy offline', res.data.error || 'Falha ao testar proxy.');
    } catch (err) { showToast('error', 'Erro', err.response?.data?.error || 'Erro ao testar proxy.'); }
    finally { setTestingProxy(null); }
  }

  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const totalFollowers = safeAccounts.reduce((s, a) => s + Number(a.followers || 0), 0);
  const totalPosts = safeAccounts.reduce((s, a) => s + Number(a.postsCount || 0), 0);
  const busyAccounts = safeAccounts.filter(a => a.isBusy).length;
  const activeAccounts = safeAccounts.filter(a => (a.healthStatus || 'ativa') === 'ativa').length;

  const filteredAccounts = accounts.filter(acc => {
    const ms = acc.username?.toLowerCase().includes(search.toLowerCase()) || acc.name?.toLowerCase().includes(search.toLowerCase());
    if (!ms) return false;
    if (filter === 'busy') return acc.isBusy;
    if (filter === 'active') return acc.healthStatus === 'ativa';
    if (filter === 'restricted') return acc.healthStatus !== 'ativa';
    return true;
  });

  function fmt(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function fmtDate(d) { if (!d) return 'Nunca'; return new Date(d).toLocaleString('pt-BR'); }
  function healthLabel(s) {
    if (s === 'ativa') return 'Saudável';
    if (s === 'restrita') return 'Restrita';
    if (s === 'erro_login') return 'Erro login';
    if (s === 'sessao_expirada') return 'Sess. expirada';
    if (s === 'banida') return 'Banida';
    return 'Saudável';
  }
  function healthBadge(s) {
    if (s === 'ativa') return 'badge-green';
    if (s === 'restrita') return 'badge-amber';
    if (s === 'banida') return 'badge-red';
    if (s === 'erro_login') return 'badge-red';
    return 'badge-gray';
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Gerenciamento</div>
          <h1>Contas Instagram</h1>
          <p>Monitore perfis, sessões, saúde da conta e automações em tempo real.</p>
        </div>
        <div className="page-header-right">
          <button onClick={() => setBulkImportOpen(true)} className="btn btn-ghost btn-sm">Importar lote</button>
          <button onClick={openOauthNew} className="btn btn-primary btn-sm">🔗 Conectar via API</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Conectadas', value: safeAccounts.length, color: '#6366f1' },
          { label: 'Ativas', value: activeAccounts, color: '#10b981' },
          { label: 'Em uso', value: busyAccounts, color: '#8b5cf6' },
          { label: 'Seguidores', value: totalFollowers, color: '#06b6d4' },
          { label: 'Postagens', value: totalPosts, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: -1 }}>{fmt(s.value)}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Contas conectadas</h3>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Mostrando {filteredAccounts.length} de {accounts.length} conta(s)</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="search-wrap" style={{ minWidth: 180 }}>
              <span className="search-icon">🔍</span>
              <input className="inp" placeholder="Buscar conta..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
            </div>
            <select className="sel" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">Todas</option>
              <option value="active">Ativas</option>
              <option value="busy">Em uso</option>
              <option value="restricted">Restritas</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Conta</th>
                <th>Seguidores</th>
                <th>Seguindo</th>
                <th>Posts</th>
                <th>Status</th>
                <th>Última sync</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map(account => (
                <tr key={account._id}>
                  <td style={{ width: 32 }}>
                    <input type="checkbox" checked={!!selectedBulkAccounts[String(account._id)]}
                      onChange={() => toggleBulkAccount(account._id)}
                      style={{ accentColor: 'var(--indigo)', cursor: 'pointer' }} />
                  </td>
                  <td>
                    <div className="td-account">
                      {account.avatar ? (
                        <img
                          src={account.avatar.startsWith('http')
                            ? `http://localhost:3000/image-proxy?url=${encodeURIComponent(account.avatar)}`
                            : `http://localhost:3000${account.avatar}`}
                          alt=""
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                      ) : null}
                      <div className="td-avatar" style={{ display: account.avatar ? 'none' : 'flex' }}>
                        {account.username?.charAt(0)?.toUpperCase() || 'I'}
                      </div>
                      <div className="td-name">
                        <strong>{account.name || account.username}</strong>
                        <span>@{account.username}</span>
                        {account.isBusy && <span style={{ fontSize: 10, color: '#a78bfa', display: 'block' }}>🔒 {account.busyReason || 'Em uso'}</span>}
                      </div>
                    </div>
                  </td>
                  <td>{fmt(account.followers)}</td>
                  <td>{fmt(account.following)}</td>
                  <td>{fmt(account.postsCount)}</td>
                  <td><span className={`badge ${healthBadge(account.healthStatus || 'ativa')}`}>{healthLabel(account.healthStatus || 'ativa')}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtDate(account.lastSync)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {account.igUserId ? (
                        /* Conta conectada via API */
                        <>
                          <span
                            className="btn btn-sm"
                            style={{ background: 'rgba(16,185,129,.15)', color: '#34d399', border: '1px solid rgba(16,185,129,.3)', cursor: 'default' }}
                            title={`API conectada — token expira em ${account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toLocaleDateString('pt-BR') : '?'}`}
                          >✅ API</span>
                          <button className="btn btn-ghost btn-sm" onClick={() => openProxyModal(account)}>Proxy</button>
                          <button
                            className="btn btn-sm"
                            style={{ background: 'rgba(239,68,68,.1)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)', fontSize: 11 }}
                            onClick={() => disconnectOauth(account._id)}
                            title="Remover token API"
                          >Desconectar</button>
                          <button className="btn btn-ghost btn-sm" title="Renomear conta" onClick={() => { setRenameModal(account); setRenameValue(account.username); }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteAccount(account._id)}>Excluir</button>
                        </>
                      ) : (
                        /* Conta sem API */
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => openOauthModal(account)}
                            title="Autorizar via Meta OAuth — uma vez só, depois fica salvo"
                          >🔗 Conectar</button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => connectApi(account)}
                            disabled={connectingApi[account._id]}
                            title="Login via Private API (senha + 2FA)"
                            style={{ fontSize: 10 }}
                          >{connectingApi[account._id] ? '⏳' : 'API'}</button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => { setTotpSecretModal(account); setTotpSecretValue(''); }}
                            title={account.hasTotpSecret ? '2FA automático configurado ✅ — clique para alterar' : 'Configurar 2FA automático'}
                            style={account.hasTotpSecret ? { borderColor: '#34d399', color: '#34d399' } : {}}
                          >🔑 2FA{account.hasTotpSecret ? ' ✅' : ''}</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openPasswordModal(account)} title="Atualizar senha da conta">🔒 Senha</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openProxyModal(account)}>Proxy</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteAccount(account._id)}>Excluir</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredAccounts.length && <div className="empty-state" style={{ marginTop: 12 }}>Nenhuma conta encontrada.</div>}
        </div>

        {pagination && pagination.pages > 1 && (
          <div className="pagination">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Anterior</button>
            <span>Página {pagination.page} de {pagination.pages} · {pagination.total} contas</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pagination.pages} onClick={() => goToPage(page + 1)}>Próxima →</button>
          </div>
        )}
      </div>

      {/* Bulk Import Modal */}
      {bulkImportOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Importar contas em lote</h3>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>Cada conta terá sessão isolada — sem interferência entre elas</span>
              </div>
              <button onClick={() => { setBulkImportOpen(false); setImportResults(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {!importResults ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text2)', margin: '8px 0 4px' }}>
                  Cole uma conta por linha:
                  <code style={{ background: 'var(--card2)', padding: '2px 6px', borderRadius: 4, fontSize: 12, marginLeft: 6 }}>usuario:senha:email_ou_telefone</code>
                </p>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                  O email/telefone é obrigatório para postar stories via API privada — o Instagram não aceita mais login só pelo username.
                </p>
                <textarea className="txta" style={{ marginTop: 4 }} rows={8}
                  placeholder={"usuario1:senha1:email1@gmail.com\nusuario2:senha2:+5511999990000\nusuario3:senha3"}
                  value={bulkText} onChange={e => setBulkText(e.target.value)} />
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => { setBulkImportOpen(false); setImportResults(null); }}>Cancelar</button>
                  <button className="btn btn-primary" onClick={importBulkAccounts} disabled={importing}>
                    {importing ? 'Importando e conectando...' : 'Importar e conectar'}
                  </button>
                </div>
              </>
            ) : (
              /* Results view */
              <>
                <div style={{ margin: '12px 0 8px', fontSize: 13, color: 'var(--text2)' }}>
                  <strong style={{ color: 'var(--text1)' }}>{importResults.total} conta(s) importada(s) com sucesso</strong>
                  {importResults.errors?.length > 0 && <span style={{ color: '#f87171', marginLeft: 8 }}>{importResults.errors.length} linha(s) inválida(s)</span>}
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(importResults.imported || []).map(username => {
                    const apiInfo = (importResults.apiResults || []).find(r => r.username === username);
                    const statusMap = {
                      conectada:              { color: '#34d399', label: '✅ Conectada' },
                      convertida_para_creator:{ color: '#a78bfa', label: '⭐ Convertida para Creator' },
                      challenge_required:     { color: '#fbbf24', label: '📧 Verificar email/SMS' },
                      totp_required:          { color: '#60a5fa', label: '🔐 Código autenticador' },
                      erro:                   { color: '#f87171', label: '⚠️ Erro no login' },
                    };
                    const s = statusMap[apiInfo?.apiStatus] || { color: '#94a3b8', label: '💾 Salva' };
                    const isChallenge = apiInfo?.apiStatus === 'challenge_required';
                    const isTotp      = apiInfo?.apiStatus === 'totp_required';
                    return (
                      <div key={username} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'var(--card2)', borderRadius: 6, padding: '8px 12px',
                        border: `1px solid ${s.color}44`,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>@{username}</span>
                          {apiInfo?.error && <div style={{ fontSize: 11, color: isChallenge ? '#fbbf24' : isTotp ? '#60a5fa' : '#f87171', marginTop: 2 }}>
                            {isChallenge && apiInfo.autoSent ? '📧 Código enviado para o email da conta.' : apiInfo.error}
                          </div>}
                          {apiInfo?.conversionWarning && <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 2 }}>{apiInfo.conversionWarning.slice(0, 80)}</div>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                          {isChallenge && apiInfo?.accountId && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {apiInfo.challengeUrl && (
                                <a href={apiInfo.challengeUrl} target="_blank" rel="noreferrer"
                                  className="btn btn-sm" style={{ fontSize: 11, padding: '3px 10px', background: '#fbbf2422', color: '#fbbf24', border: '1px solid #fbbf2444', textDecoration: 'none' }}>
                                  Abrir link
                                </a>
                              )}
                              <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 10px', background: '#34d39922', color: '#34d399', border: '1px solid #34d39944' }}
                                onClick={() => { setBulkImportOpen(false); setImportResults(null); openMobileModal({ _id: apiInfo.accountId, username }, true); }}>
                                Inserir código
                              </button>
                            </div>
                          )}
                          {isTotp && apiInfo?.accountId && (
                            <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 10px', background: '#60a5fa22', color: '#60a5fa', border: '1px solid #60a5fa44' }}
                              onClick={() => { setBulkImportOpen(false); setImportResults(null); setTotpModal({ _id: apiInfo.accountId, username }); setTotpCode(''); }}>
                              Inserir código
                            </button>
                          )}
                          <span style={{ fontSize: 12, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>
                        </div>
                      </div>
                    );
                  })}
                  {importResults.errors?.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#f87171', padding: '4px 8px' }}>⛔ {e}</div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 10 }}>
                  Contas com status <strong style={{ color: '#34d399' }}>Conectada</strong> ou <strong style={{ color: '#a78bfa' }}>Convertida</strong> já estão prontas para publicar Reels.
                  Contas com erro de login precisam de verificação manual (challenge/2FA).
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => { setImportResults(null); }}>Importar mais</button>
                  <button className="btn btn-primary" onClick={() => { setBulkImportOpen(false); setImportResults(null); }}>Fechar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TOTP Modal — código do Google Authenticator / Authy */}
      {totpModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(400px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>🔐 Autenticador 2FA</h3>
              <button onClick={() => { setTotpModal(null); setTotpCode(''); }} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px' }}>
              A conta <strong>@{totpModal.username}</strong> tem autenticador ativado.<br/>
              Abra o <strong>Google Authenticator</strong> ou <strong>Authy</strong> e digite o código de 6 dígitos:
            </p>
            <input
              type="text" inputMode="numeric" maxLength={6} placeholder="000000"
              value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              style={{ width: '100%', textAlign: 'center', fontSize: 28, letterSpacing: 8, padding: '10px 0', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text1)' }}
              onKeyDown={e => e.key === 'Enter' && resolveTotp()}
            />
            <p style={{ fontSize: 11, color: 'var(--text2)', margin: '8px 0 0' }}>
              ⚠️ O código muda a cada 30 segundos. Insira assim que aparecer.
            </p>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => { setTotpModal(null); setTotpCode(''); }}>Cancelar</button>
              <button className="btn btn-primary" onClick={resolveTotp} disabled={totpLoading || totpCode.length < 6}>
                {totpLoading ? 'Verificando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {bulkEditOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3>Editar perfis em massa</h3>
              <button onClick={() => setBulkEditOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p>Selecione as contas e defina nome, biografia, link ou foto.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0', maxHeight: 120, overflowY: 'auto' }}>
              {accounts.map(account => (
                <button key={account._id} type="button" onClick={() => toggleBulkAccount(account._id)}
                  style={{
                    padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${selectedBulkAccounts[String(account._id)] ? 'rgba(99,102,241,.4)' : 'var(--border2)'}`,
                    background: selectedBulkAccounts[String(account._id)] ? 'var(--indigo-dim)' : 'var(--card2)',
                    color: selectedBulkAccounts[String(account._id)] ? '#a5b4fc' : 'var(--text2)',
                  }}>@{account.username}</button>
              ))}
            </div>
            <div className="form-group">
              <label>Nome do perfil</label>
              <input className="inp" value={bulkName} onChange={e => setBulkName(e.target.value)} placeholder="Ex: Maria Silva" />
            </div>

            <div className="form-group">
              <label>Biografia <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 11 }}>— mencione @usuario (vira link clicável)</span></label>
              <textarea
                className="inp"
                value={bulkBio}
                onChange={e => setBulkBio(e.target.value)}
                placeholder={"Ex: Mãe coruja 👩‍👧 | @nomeparceiro"}
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{bulkBio.length}/150 · A bio existente será substituída completamente</span>
            </div>

            <div className="form-group">
              <label>Link externo</label>
              <input className="inp" value={bulkLink} onChange={e => setBulkLink(e.target.value)} placeholder="https://seudominio.com" />
            </div>

            <div className="form-group">
              <label>Foto de perfil</label>
              <input className="inp" type="file" accept="image/*" onChange={e => setBulkPhoto(e.target.files?.[0] || null)} />
              {bulkPhoto && <span style={{ fontSize: 11, color: 'var(--green)', marginTop: 4, display: 'block' }}>✅ {bulkPhoto.name}</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: '1px solid var(--border2)', marginTop: 4 }}>
              <input
                type="checkbox"
                id="bulkGender"
                checked={bulkSetGender}
                onChange={e => setBulkSetGender(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <label htmlFor="bulkGender" style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text1)', margin: 0 }}>
                🚺 Definir gênero como <strong>Feminino</strong>
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setBulkEditOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={submitBulkEdit}>Aplicar alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Session Modal — challenge / verificação de identidade */}
      {mobileModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(420px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Verificação de identidade</h3>
              <button onClick={() => { setMobileModal(null); setMobileCode(''); setMobileStep('idle'); }}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 14px' }}>
              Conta: <strong>@{mobileModal.username}</strong>
            </p>

            {mobileStep === 'idle' && (
              <>
                <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                  O Instagram vai enviar um código para o email ou telefone da conta para verificar sua identidade.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setMobileModal(null)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={initMobileSession}>Enviar código</button>
                </div>
              </>
            )}

            {mobileStep === 'loading' && (
              <p style={{ textAlign: 'center', color: 'var(--text2)', padding: '16px 0' }}>Aguardando...</p>
            )}

            {mobileStep === 'needsCode' && (
              <>
                {/* Seleção do tipo de código */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button
                    onClick={() => setMobileCodeType('email')}
                    style={{ flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                      background: mobileCodeType === 'email' ? '#6366f133' : 'var(--card2)',
                      border: mobileCodeType === 'email' ? '1px solid #6366f1' : '1px solid var(--border)',
                      color: mobileCodeType === 'email' ? '#a5b4fc' : 'var(--text2)' }}>
                    📧 Email / SMS
                  </button>
                  <button
                    onClick={() => setMobileCodeType('totp')}
                    style={{ flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                      background: mobileCodeType === 'totp' ? '#8b5cf633' : 'var(--card2)',
                      border: mobileCodeType === 'totp' ? '1px solid #8b5cf6' : '1px solid var(--border)',
                      color: mobileCodeType === 'totp' ? '#c4b5fd' : 'var(--text2)' }}>
                    🔐 Google Authenticator
                  </button>
                </div>
                <p style={{ fontSize: 12, color: '#fbbf24', marginBottom: 10 }}>
                  {mobileCodeType === 'totp'
                    ? 'Abra o Google Authenticator ou Authy e insira o código de 6 dígitos:'
                    : (mobileMsg || 'Verifique seu email ou SMS e insira o código de 6 dígitos:')}
                </p>
                <input
                  className="inp" type="text" inputMode="numeric" maxLength={6}
                  placeholder="000000" value={mobileCode}
                  onChange={e => setMobileCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && mobileCode.length >= 4) {
                      mobileCodeType === 'totp' ? submitChallengeAsTotp() : resolveChallenge();
                    }
                  }}
                  style={{ textAlign: 'center', fontSize: 24, letterSpacing: 6 }}
                  autoFocus
                />
                <div className="modal-actions" style={{ marginTop: 12 }}>
                  <button className="btn btn-ghost" onClick={() => setMobileModal(null)}>Cancelar</button>
                  <button className="btn btn-ghost" onClick={retryApiLogin} title="Limpa estado e faz novo login para gerar novo código">
                    🔄 Novo código
                  </button>
                  <button className="btn btn-primary"
                    onClick={() => mobileCodeType === 'totp' ? submitChallengeAsTotp() : resolveChallenge()}
                    disabled={mobileCode.length < 4}>
                    Confirmar código
                  </button>
                </div>
              </>
            )}

            {mobileStep === 'done' && (
              <>
                <p style={{ fontSize: 13, color: '#34d399' }}>{mobileMsg || '✅ Verificação concluída! Conta conectada.'}</p>
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={() => { setMobileModal(null); setMobileStep('idle'); }}>Fechar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TOTP Secret Modal — configura 2FA automático */}
      {totpSecretModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(500px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>🔑 Configurar 2FA Automático</h3>
              <button onClick={() => setTotpSecretModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 8px' }}>
              Conta: <strong>@{totpSecretModal.username}</strong>
            </p>
            <div style={{ background: 'var(--card2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text1)' }}>Como obter o segredo TOTP:</strong><br/>
              <strong>Opção 1 — Google Authenticator:</strong><br/>
              1. Abra o Google Authenticator → pressione e segure a conta Instagram<br/>
              2. Toque em "Transferir contas" → "Exportar contas"<br/>
              3. Use um app como <strong>Authenticator Pro</strong> ou <strong>Aegis</strong> para exportar o segredo<br/>
              <br/>
              <strong>Opção 2 — Reconfigurar 2FA (mais fácil):</strong><br/>
              1. No Instagram → Configurações → Central de contas → Senha e segurança → Autenticação de dois fatores<br/>
              2. Desative e reative o "Aplicativo de autenticação"<br/>
              3. Na tela de QR code, clique em "Não consigo escanear" → copie a <strong>chave de 16/32 caracteres</strong><br/>
              4. Cole abaixo
            </div>
            <input
              className="inp"
              type="text"
              placeholder="Ex: JBSWY3DPEHPK3PXP (chave base32)"
              value={totpSecretValue}
              onChange={e => setTotpSecretValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveTotpSecret()}
              autoFocus
              style={{ fontFamily: 'monospace', fontSize: 13, letterSpacing: 2 }}
            />
            <p style={{ fontSize: 11, color: 'var(--text2)', margin: '6px 0 0' }}>
              Após salvar, o sistema gera os códigos automaticamente — sem precisar abrir o celular.
            </p>
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setTotpSecretModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveTotpSecret} disabled={totpSecretLoading || !totpSecretValue.trim()}>
                {totpSecretLoading ? 'Salvando...' : '✅ Salvar e Conectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session ID Modal */}
      {sessionModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(480px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>🔗 Conectar via Session Cookie</h3>
              <button onClick={() => setSessionModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 6px' }}>
              Conta: <strong>@{sessionModal.username}</strong>
            </p>
            <div style={{ background: 'var(--card2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text1)' }}>Como obter o sessionid:</strong><br/>
              1. Abra <strong>instagram.com</strong> no Chrome e faça login normalmente<br/>
              2. Pressione <strong>F12</strong> → aba <strong>Application</strong> → <strong>Cookies</strong> → <strong>instagram.com</strong><br/>
              3. Encontre o cookie <strong>sessionid</strong> e copie o valor<br/>
              4. Cole abaixo e clique em Conectar
            </div>
            <input
              className="inp"
              type="text"
              placeholder="Cole aqui o valor do cookie sessionid..."
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && importSession()}
              autoFocus
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setSessionModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={importSession} disabled={sessionLoading || !sessionId.trim()}>
                {sessionLoading ? 'Conectando...' : 'Conectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proxy Modal */}
      {proxyModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3>Proxy da conta</h3>
              <button onClick={() => setProxyModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <p>Conta: <strong>@{proxyAccount?.username}</strong> · Status: <span style={{ color: proxyAccount?.proxyStatus === 'online' ? '#34d399' : '#f87171' }}>{proxyAccount?.proxyStatus || 'offline'}</span></p>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Proxy URL</label>
              <input className="inp" value={proxyValue} onChange={e => setProxyValue(e.target.value)} placeholder="http://usuario:senha@host:porta" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setProxyModalOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveProxy}>Salvar proxy</button>
            </div>
          </div>
        </div>
      )}

      {/* OAuth Modal — conectar via Meta API (nova conta ou conta existente) */}
      {oauthModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(500px,100%)' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0 }}>Conectar via Meta API</h3>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                  {oauthModal._id === 'new' ? 'Nova conta' : `@${oauthModal.username}`}
                </span>
              </div>
              <button onClick={() => setOauthModal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* ── Sucesso ── */}
            {oauthResult?.success ? (
              <>
                <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ color: '#34d399', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>✅ Conta conectada!</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>{oauthResult.message}</div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
                  Token salvo. Postagens feitas via Meta Graph API — sem browser, válido por ~60 dias.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={() => setOauthModal(null)}>Fechar</button>
                </div>
              </>

            ) : oauthResult?.success === false ? (
              /* ── Erro ── */
              <>
                <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 4 }}>❌ Erro ao conectar</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>{oauthResult.message}</div>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setOauthResult(null)}>Tentar novamente</button>
                  <button className="btn btn-ghost" onClick={() => setOauthModal(null)}>Fechar</button>
                </div>
              </>

            ) : (
              /* ── Formulário principal ── */
              <>
                {/* Passo 1 — Abrir link de autorização */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--text1)' }}>
                    Passo 1 — Abra o link de autorização
                  </div>
                  {oauthUrlLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Gerando link...</div>
                  ) : oauthUrl ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}
                        onClick={() => window.open(oauthUrl, '_blank')}>
                        🔗 Abrir no navegador
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}
                        onClick={() => { navigator.clipboard.writeText(oauthUrl); showToast('success', 'Link copiado!', ''); }}>
                        📋 Copiar link
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#f87171' }}>Erro ao gerar link. Feche e tente novamente.</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.6 }}>
                    Clique em <strong>"Abrir no navegador"</strong>, faça login no Instagram e clique <strong>Autorizar</strong>.
                    Você vai ver um <strong style={{ color: '#fbbf24' }}>erro de conexão</strong> — isso é normal, ignore.
                  </div>
                </div>

                {/* Divisor */}
                <div style={{ borderTop: '1px solid var(--border2)', margin: '0 0 20px' }} />

                {/* Passo 2 — Colar URL de retorno */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: 'var(--text1)' }}>
                    Passo 2 — Cole a URL da barra de endereços
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.6 }}>
                    Na página de erro, <strong>copie a URL completa</strong> da barra de endereços
                    (começa com <code style={{ background: 'var(--card2)', padding: '1px 4px', borderRadius: 3 }}>localhost:3000...?code=</code>)
                    e cole abaixo. Pode colar também só o valor do <code style={{ background: 'var(--card2)', padding: '1px 4px', borderRadius: 3 }}>code=</code>.
                  </div>
                  <textarea
                    className="txta"
                    rows={3}
                    placeholder="https://localhost:3000/api/oauth/callback?code=AQC... ou só o código"
                    value={oauthPasted}
                    onChange={e => setOauthPasted(e.target.value)}
                    style={{ fontSize: 12 }}
                  />
                </div>

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setOauthModal(null)}>Cancelar</button>
                  <button
                    className="btn btn-primary"
                    onClick={submitOauthPaste}
                    disabled={oauthLoading || !oauthPasted.trim()}
                  >
                    {oauthLoading ? 'Conectando...' : '✅ Conectar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(380px,100%)' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: 16 }}>Renomear conta</h3>
              <button onClick={() => setRenameModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                Digite o username correto do Instagram (sem @):
              </div>
              <input
                className="input"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value.replace(/^@/, ''))}
                placeholder="oliveirareginadeise"
                onKeyDown={e => e.key === 'Enter' && renameAccount()}
                autoFocus
              />
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={() => setRenameModal(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={renameAccount} disabled={!renameValue.trim()}>Renomear</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cookie Import Modal */}
      {cookieModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(540px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>🍪 Importar Cookies</h3>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>@{cookieModal.username}</span>
              </div>
              <button onClick={() => setCookieModal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ background: 'var(--card2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text1)', display: 'block', marginBottom: 4 }}>Como exportar do Multilogin:</strong>
              1. Abra o perfil da conta no Multilogin<br/>
              2. Acesse o Instagram e certifique-se que está logado<br/>
              3. No Multilogin: Perfil → Exportar Cookies → Copiar JSON<br/>
              4. Cole o JSON abaixo e clique em Importar
            </div>

            <div className="form-group">
              <label>JSON dos cookies <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(array de objetos)</span></label>
              <textarea
                className="txta"
                rows={8}
                placeholder={'[{"name":"sessionid","value":"abc123...","domain":".instagram.com",...}]'}
                value={cookieText}
                onChange={e => setCookieText(e.target.value)}
                style={{ fontSize: 12, fontFamily: 'monospace' }}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setCookieModal(null)}>Cancelar</button>
              <button
                className="btn btn-primary"
                onClick={importCookies}
                disabled={cookieLoading || !cookieText.trim()}
              >
                {cookieLoading ? 'Importando...' : '🍪 Importar cookies'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Credenciais (senha + email/telefone) */}
      {passwordModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(420px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>🔑 Credenciais da conta</h3>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>@{passwordModal.username}</span>
              </div>
              <button onClick={() => setPasswordModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: 'var(--text2)' }}>
              ⚠️ Instagram não reconhece o username para login — informe o <strong>email ou telefone</strong> cadastrado na conta. Feito isso, não precisará repetir.
            </div>
            <div className="form-group">
              <label>Senha da conta</label>
              <input className="inp" type="password" value={passwordValue} onChange={e => setPasswordValue(e.target.value)} placeholder="••••••••" autoFocus />
            </div>
            <div className="form-group">
              <label>Email ou Telefone <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(uma vez só)</span></label>
              <input className="inp" type="text" value={loginEmailValue} onChange={e => setLoginEmailValue(e.target.value)} placeholder="exemplo@gmail.com ou +5511999999999" onKeyDown={e => e.key === 'Enter' && savePassword()} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPasswordModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={savePassword} disabled={passwordLoading || !passwordValue.trim()}>
                {passwordLoading ? 'Conectando...' : '🔗 Salvar e Conectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal open={deleteModal} title="Excluir conta" message="Tem certeza que deseja excluir esta conta?" onConfirm={confirmDelete} onCancel={() => setDeleteModal(false)} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

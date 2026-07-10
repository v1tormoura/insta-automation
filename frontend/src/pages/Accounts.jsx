import { useEffect, useState } from 'react';
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

  // Bulk profile edit modal
  const [bulkProfileEditOpen, setBulkProfileEditOpen] = useState(false);
  const [bpFullName, setBpFullName]   = useState('');
  const [bpBio, setBpBio]             = useState('');
  const [bpGender, setBpGender]       = useState('');
  const [bpPicUrl, setBpPicUrl]       = useState('');
  const [bpPicFile, setBpPicFile]     = useState(null);
  const [bpLoading, setBpLoading]     = useState(false);
  const [bpJobId, setBpJobId]         = useState(null);
  const [bpJobStatus, setBpJobStatus] = useState(null);

  async function submitBulkProfileEdit() {
    const ids = selectedBulkAccountIds();
    if (!ids.length) { showToast('error', 'Nenhuma conta', 'Selecione pelo menos uma conta.'); return; }
    const hasText = bpFullName.trim() || bpBio.trim() !== '' || bpGender !== '';
    if (!hasText && !bpPicFile) { showToast('error', 'Nenhuma alteração', 'Preencha pelo menos um campo ou selecione uma foto.'); return; }

    setBpLoading(true);
    try {
      const form = new FormData();
      const edits = ids.map(id => {
        const e = { accountId: id };
        if (bpFullName.trim()) e.fullName = bpFullName.trim();
        if (bpBio.trim() !== '') e.biography = bpBio.trim();
        if (bpGender !== '') e.gender = Number(bpGender);
        return e;
      });
      form.append('edits', JSON.stringify(edits));
      form.append('delayBetween', '4000');
      if (bpPicFile) form.append('photo', bpPicFile);

      const res = await api.post('/profile-edit/bulk', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setBpJobId(res.data.jobId);
      setBpJobStatus('running');
      showToast('success', 'Job iniciado', `Editando ${ids.length} conta(s) em background...`);
      setBulkProfileEditOpen(false);
      setSelectedBulkAccounts({});
      setBpFullName(''); setBpBio(''); setBpGender(''); setBpPicFile(null);

      const poll = setInterval(async () => {
        try {
          const s = await api.get(`/profile-edit/job/${res.data.jobId}`);
          setBpJobStatus(s.data.status);
          if (s.data.status !== 'running') {
            clearInterval(poll);
            const ok = s.data.results?.filter(r => r.status === 'ok').length || 0;
            const fail = s.data.results?.filter(r => r.status === 'error').length || 0;
            showToast(fail === 0 ? 'success' : 'error', 'Edição concluída', `${ok} conta(s) editadas, ${fail} falha(s).`);
          }
        } catch { clearInterval(poll); }
      }, 3000);
    } catch (err) {
      showToast('error', 'Erro', err.response?.data?.error || err.message);
    } finally {
      setBpLoading(false);
    }
  }

  // Edit Profile modal
  const [editProfileModal, setEditProfileModal] = useState(null);
  const [epLoading, setEpLoading]     = useState(false);
  const [epPassword,   setEpPassword]   = useState('');
  const [epTotpSecret, setEpTotpSecret] = useState('');
  const [epError,      setEpError]      = useState('');

  function openEditProfile(account) {
    setEditProfileModal(account);
    setEpPassword('');
    setEpTotpSecret('');
    setEpError('');
  }

  async function submitEditProfile() {
    if (!editProfileModal) return;
    setEpError('');
    if (!epPassword.trim() && !epTotpSecret.trim()) {
      setEpError('Preencha pelo menos a senha ou a chave 2FA.');
      return;
    }
    setEpLoading(true);
    try {
      if (epPassword.trim()) {
        await api.patch(`/accounts/${editProfileModal._id}/credentials`, { password: epPassword.trim() });
      }
      if (epTotpSecret.trim()) {
        await api.patch(`/accounts/${editProfileModal._id}/totp-secret`, { totpSecret: epTotpSecret.trim() });
      }
      showToast('success', 'Credenciais salvas', `@${editProfileModal.username} — senha e 2FA atualizados.`);
      setEditProfileModal(null);
    } catch (err) {
      setEpError(err.response?.data?.error || err.message || 'Erro ao salvar credenciais.');
    } finally {
      setEpLoading(false);
    }
  }

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
  // Polling a cada 3s para status em tempo real
  useEffect(() => { loadAccounts(); const t = setInterval(loadAccounts, 3000); return () => clearInterval(t); }, []);

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
      setBulkImportOpen(false);
      await loadAccounts();
      const { total, errors = [], status } = res.data;
      const errMsg = errors.length ? ` · ${errors.length} linha(s) inválida(s)` : '';
      if (status === 'running') {
        showToast('success', `${total} conta(s) salvas`, `Conectando via API em background...${errMsg}`);
      } else {
        showToast('success', `${total} conta(s) importadas`, errMsg || 'Importação concluída.');
      }
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
        pastedUrl = `${API_BASE}/api/oauth/callback?code=${encodeURIComponent(code)}&state=${accountId}`;
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
    if (!account.hasPassword) {
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

  function ActionBtn({ children, onClick, danger, disabled, title, style }) {
    return (
      <button onClick={onClick} disabled={disabled} title={title} style={{
        fontSize: 13, width: 30, height: 28, borderRadius: 6, border: `1px solid ${danger ? 'rgba(239,68,68,.3)' : 'rgba(51,65,85,.5)'}`,
        background: danger ? 'rgba(239,68,68,.08)' : 'rgba(30,41,59,.8)',
        color: danger ? '#f87171' : '#94a3b8',
        cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? .4 : 1, transition: 'all .15s', flexShrink: 0,
        ...style,
      }}>{children}</button>
    );
  }
  function healthLabel(s) {
    if (s === 'restrita') return 'Restrita';
    if (s === 'banida') return 'Banida';
    if (s === 'token_invalido') return 'Reconectar';
    return 'Saudável';
  }
  function healthBadge(s) {
    if (s === 'restrita') return 'badge-amber';
    if (s === 'banida') return 'badge-red';
    if (s === 'token_invalido') return 'badge-red';
    return 'badge-green';
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
          <button onClick={() => { setBulkProfileEditOpen(true); }} className="btn btn-ghost btn-sm">👤 Editar Perfil</button>
          <button onClick={openOauthNew} className="btn btn-primary btn-sm">🔗 Conectar via API</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Conectadas', value: safeAccounts.length,  color: '#6366f1', icon: '🔗', sub: 'Total de contas' },
          { label: 'Ativas',     value: activeAccounts,        color: '#10b981', icon: '✅', sub: 'Status saudável' },
          { label: 'Em uso',     value: busyAccounts,          color: '#8b5cf6', icon: '🔒', sub: 'Processando agora' },
          { label: 'Seguidores', value: totalFollowers,        color: '#06b6d4', icon: '👥', sub: 'Total acumulado' },
          { label: 'Postagens',  value: totalPosts,            color: '#f59e0b', icon: '📸', sub: 'Posts realizados' },
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
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>Mostrando {filteredAccounts.length} de {accounts.length} conta(s)</div>
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
            {['all','active','busy','restricted'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600,
                background: filter === f ? '#6366f1' : 'rgba(51,65,85,.4)',
                color: filter === f ? '#fff' : '#94a3b8',
              }}>{{ all:'Todas', active:'Ativas', busy:'Em uso', restricted:'Restritas' }[f]}</button>
            ))}
          </div>
        </div>

        {/* Barra de ações em massa — aparece quando há seleção */}
        {selectedBulkAccountIds().length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 20px', background:'linear-gradient(90deg,rgba(99,102,241,.12),rgba(139,92,246,.08))', borderBottom:'1px solid rgba(99,102,241,.2)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:22, height:22, borderRadius:6, background:'#6366f1', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#fff', fontWeight:800 }}>
                {selectedBulkAccountIds().length}
              </span>
              <span style={{ fontSize:13, color:'#a5b4fc', fontWeight:600 }}>conta(s) selecionada(s)</span>
            </div>
            <div style={{ width:1, height:20, background:'rgba(99,102,241,.3)' }} />
            <button onClick={() => setBulkProfileEditOpen(true)} style={{ fontSize:12, padding:'6px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.35)', background:'rgba(99,102,241,.15)', color:'#818cf8', fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              👤 Editar perfil em massa
            </button>
            <button onClick={() => setSelectedBulkAccounts({})} style={{ fontSize:12, padding:'6px 10px', borderRadius:8, border:'1px solid rgba(51,65,85,.4)', background:'transparent', color:'#475569', cursor:'pointer', marginLeft:'auto' }}>
              Desmarcar tudo
            </button>
          </div>
        )}

        {/* Scrollable table (header + rows) */}
        <div className="tbl-scroll-wrap">
        <div className="tbl-scroll-inner">

        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr 1.4fr 2.4fr', gap: 0, padding: '10px 20px', borderBottom: '1px solid rgba(51,65,85,.35)', background: 'rgba(15,23,42,.5)' }}>
          {['', 'Conta', 'Seguidores', 'Seguindo', 'Posts', 'Status', 'Última sync', 'Ações'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: .6 }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {filteredAccounts.map((account, ri) => {
          const hc = { restrita:'#f59e0b', banida:'#ef4444', token_invalido:'#ef4444' }[account.healthStatus] || '#10b981';
          const hl = healthLabel(account.healthStatus || 'ativa');
          return (
            <div key={account._id} style={{
              display: 'grid',
              gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr 1.4fr 2.4fr',
              gap: 0,
              padding: '13px 20px',
              borderBottom: ri < filteredAccounts.length - 1 ? '1px solid rgba(51,65,85,.25)' : 'none',
              alignItems: 'center',
              transition: 'background .15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* checkbox */}
              <div>
                <input type="checkbox" checked={!!selectedBulkAccounts[String(account._id)]}
                  onChange={() => toggleBulkAccount(account._id)}
                  style={{ accentColor: '#6366f1', cursor: 'pointer', width: 14, height: 14 }} />
              </div>

              {/* conta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {account.avatar ? (
                    <img
                      src={avatarUrl(account.avatar)}
                      alt=""
                      onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}
                      style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover', border: `2px solid ${hc}44` }}
                    />
                  ) : null}
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, #6366f133, #8b5cf633)`, border: `2px solid #6366f133`, display: account.avatar ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#818cf8' }}>
                    {account.username?.charAt(0)?.toUpperCase() || 'I'}
                  </div>
                  {account.isBusy && (
                    <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#a855f7', border: '2px solid rgba(15,23,42,.9)' }} title="Em uso" />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name || account.username}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>@{account.username}</div>
                  {account.isBusy && <div style={{ fontSize: 10, color: '#a78bfa', marginTop: 1 }}>{account.busyReason || 'Em uso'}</div>}
                </div>
              </div>

              {/* seguidores */}
              <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>{fmt(account.followers)}</div>

              {/* seguindo */}
              <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(account.following)}</div>

              {/* posts */}
              <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(account.postsCount)}</div>

              {/* status */}
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

              {/* última sync */}
              <div style={{ fontSize: 11, color: '#475569' }}>{fmtDate(account.lastSync)}</div>

              {/* ações */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {account.igUserId ? (
                  <>
                    {account.healthStatus === 'token_invalido' ? (
                      <button className="btn btn-sm" style={{ background:'rgba(239,68,68,.15)', color:'#f87171', border:'1px solid rgba(239,68,68,.3)' }}
                        onClick={() => openOauthModal(account)} title="Token expirado — clique para reconectar">🔄 Reconectar</button>
                    ) : (
                      <span className="btn btn-sm" style={{ background:'rgba(16,185,129,.15)', color:'#34d399', border:'1px solid rgba(16,185,129,.3)', cursor:'default' }}
                        title={`API conectada — token expira em ${account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toLocaleDateString('pt-BR') : '?'}`}>✅ API</span>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => openEditProfile(account)} title="Credenciais da conta">✏️ Editar</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openProxyModal(account)}>Proxy</button>
                    <button className="btn btn-sm" style={{ background:'rgba(239,68,68,.1)', color:'#f87171', border:'1px solid rgba(239,68,68,.2)', fontSize:11 }} onClick={() => disconnectOauth(account._id)} title="Remover token API">Desconectar</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteAccount(account._id)}>Excluir</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => openOauthModal(account)} title="Autorizar via Meta OAuth">🔗 Conectar</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEditProfile(account)} title="Editar perfil do Instagram">✏️ Editar</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openProxyModal(account)}>Proxy</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteAccount(account._id)}>Excluir</button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {!filteredAccounts.length && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#475569' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>👤</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>Nenhuma conta encontrada</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Tente ajustar o filtro ou importar novas contas.</div>
          </div>
        )}

        </div>{/* /tbl-scroll-inner */}
        </div>{/* /tbl-scroll-wrap */}

        {pagination && pagination.pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid rgba(51,65,85,.35)' }}>
            <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(51,65,85,.5)', background: 'transparent', color: '#94a3b8', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? .4 : 1 }} disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Anterior</button>
            <span style={{ fontSize: 12, color: '#64748b' }}>Página {pagination.page} de {pagination.pages} · {pagination.total} contas</span>
            <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(51,65,85,.5)', background: 'transparent', color: '#94a3b8', cursor: page >= pagination.pages ? 'default' : 'pointer', opacity: page >= pagination.pages ? .4 : 1 }} disabled={page >= pagination.pages} onClick={() => goToPage(page + 1)}>Próxima →</button>
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
                  Cole uma conta por linha — formato recomendado:
                  <code style={{ background: 'var(--card2)', padding: '2px 6px', borderRadius: 4, fontSize: 12, marginLeft: 6 }}>usuario:senha:email:CHAVE_2FA</code>
                </p>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                  A chave 2FA (base32) permite login automático sem digitar código. Email é necessário para stories via API privada.
                </p>
                <textarea className="txta" style={{ marginTop: 4 }} rows={8}
                  placeholder={"usuario1:senha1:email1@gmail.com:JBSWY3DPEHPK3PXP\nusuario2:senha2:+5511999990000:CHAVE2FA\nusuario3:senha3:email3@gmail.com"}
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
                    (começa com <code style={{ background: 'var(--card2)', padding: '1px 4px', borderRadius: 3 }}>instaflow.pro:3001...?code=</code>)
                    e cole abaixo. Pode colar também só o valor do <code style={{ background: 'var(--card2)', padding: '1px 4px', borderRadius: 3 }}>code=</code>.
                  </div>
                  <textarea
                    className="txta"
                    rows={3}
                    placeholder="https://instaflow.pro:3001/api/oauth/callback?code=AQC... ou só o código"
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

      {/* Bulk Profile Edit Modal */}
      {bulkProfileEditOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ width:'min(520px,100%)', maxHeight:'90vh', display:'flex', flexDirection:'column', background:'linear-gradient(160deg,rgba(15,23,42,.98),rgba(15,23,42,.95))', border:'1px solid rgba(99,102,241,.25)', borderRadius:20, boxShadow:'0 0 0 1px rgba(99,102,241,.1), 0 24px 60px rgba(0,0,0,.6)', overflow:'hidden' }}>

            <div style={{ padding:'20px 24px 18px', background:'linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.08))', borderBottom:'1px solid rgba(99,102,241,.15)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:'#f1f5f9' }}>👥 Editar Perfil em Massa</div>
                <div style={{ fontSize:12, color:'#6366f1', marginTop:2 }}>{selectedBulkAccountIds().length} conta(s) selecionada(s)</div>
              </div>
              <button onClick={() => setBulkProfileEditOpen(false)} style={{ width:32, height:32, borderRadius:8, background:'rgba(51,65,85,.5)', border:'1px solid rgba(51,65,85,.7)', color:'#64748b', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
            </div>

            <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:16, overflowY:'auto' }}>

              {/* Seleção de contas */}
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6 }}>Selecionar contas</label>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={() => setSelectedBulkAccounts(Object.fromEntries(accounts.map(a => [String(a._id), true])))}
                      style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:'1px solid rgba(99,102,241,.3)', background:'rgba(99,102,241,.12)', color:'#818cf8', cursor:'pointer' }}>Todas</button>
                    <button onClick={() => setSelectedBulkAccounts({})}
                      style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:'1px solid rgba(51,65,85,.4)', background:'transparent', color:'#475569', cursor:'pointer' }}>Nenhuma</button>
                  </div>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, maxHeight:120, overflowY:'auto', padding:'8px', background:'rgba(15,23,42,.5)', borderRadius:10, border:'1px solid rgba(51,65,85,.4)' }}>
                  {accounts.map(acc => {
                    const sel = !!selectedBulkAccounts[String(acc._id)];
                    return (
                      <button key={acc._id} onClick={() => toggleBulkAccount(acc._id)} style={{
                        padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:600, cursor:'pointer',
                        border:`1px solid ${sel ? 'rgba(99,102,241,.5)' : 'rgba(51,65,85,.5)'}`,
                        background: sel ? 'rgba(99,102,241,.2)' : 'rgba(30,41,59,.6)',
                        color: sel ? '#a5b4fc' : '#64748b',
                        transition:'all .15s',
                      }}>@{acc.username}</button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6, display:'block', marginBottom:6 }}>Nome completo</label>
                  <input value={bpFullName} onChange={e => setBpFullName(e.target.value)} placeholder="Mesmo nome para todas"
                    style={{ width:'100%', background:'rgba(15,23,42,.8)', border:'1px solid rgba(51,65,85,.6)', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#e2e8f0', outline:'none', boxSizing:'border-box' }}
                    onFocus={e => e.target.style.borderColor='rgba(99,102,241,.6)'}
                    onBlur={e => e.target.style.borderColor='rgba(51,65,85,.6)'} />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6, display:'block', marginBottom:6 }}>Gênero</label>
                  <select value={bpGender} onChange={e => setBpGender(e.target.value)}
                    style={{ width:'100%', background:'rgba(15,23,42,.8)', border:'1px solid rgba(51,65,85,.6)', borderRadius:8, padding:'9px 12px', fontSize:13, color: bpGender ? '#e2e8f0' : '#475569', outline:'none', cursor:'pointer' }}>
                    <option value="">Não alterar</option>
                    <option value="1">Masculino</option>
                    <option value="2">Feminino</option>
                    <option value="3">Não-binário</option>
                    <option value="4">Prefiro não dizer</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6, display:'block', marginBottom:6 }}>Biografia</label>
                <textarea value={bpBio} onChange={e => setBpBio(e.target.value)} placeholder="Mesma bio para todas as contas..." rows={3}
                  style={{ width:'100%', background:'rgba(15,23,42,.8)', border:'1px solid rgba(51,65,85,.6)', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#e2e8f0', outline:'none', resize:'vertical', boxSizing:'border-box', fontFamily:'inherit' }}
                  onFocus={e => e.target.style.borderColor='rgba(99,102,241,.6)'}
                  onBlur={e => e.target.style.borderColor='rgba(51,65,85,.6)'} />
                <div style={{ fontSize:11, color:'#475569', textAlign:'right', marginTop:3 }}>{bpBio.length}/150</div>
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6, display:'block', marginBottom:6 }}>Foto de perfil</label>
                <label style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'rgba(15,23,42,.6)', border:`1px dashed ${bpPicFile ? 'rgba(99,102,241,.6)' : 'rgba(51,65,85,.6)'}`, borderRadius:10, cursor:'pointer', transition:'all .2s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor='rgba(99,102,241,.5)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = bpPicFile ? 'rgba(99,102,241,.6)' : 'rgba(51,65,85,.6)'}>
                  <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => setBpPicFile(e.target.files?.[0] || null)} />
                  {bpPicFile ? (
                    <>
                      <img src={URL.createObjectURL(bpPicFile)} alt="" style={{ width:44, height:44, borderRadius:10, objectFit:'cover', border:'2px solid rgba(99,102,241,.4)', flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:'#a5b4fc', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{bpPicFile.name}</div>
                        <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>{(bpPicFile.size / 1024).toFixed(0)} KB · Clique para trocar</div>
                      </div>
                      <button type="button" onClick={e => { e.preventDefault(); setBpPicFile(null); }} style={{ fontSize:16, color:'#475569', background:'none', border:'none', cursor:'pointer', padding:4, lineHeight:1 }}>×</button>
                    </>
                  ) : (
                    <>
                      <div style={{ width:44, height:44, borderRadius:10, background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>📷</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:'#64748b' }}>Clique para fazer upload</div>
                        <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>JPG, PNG ou WEBP · máx. 10MB</div>
                      </div>
                    </>
                  )}
                </label>
                <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>A mesma foto será aplicada em todas as contas selecionadas.</div>
              </div>

              {bpJobStatus === 'running' && (
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:10, background:'rgba(99,102,241,.08)', border:'1px solid rgba(99,102,241,.2)' }}>
                  <span style={{ fontSize:16 }}>⏳</span>
                  <span style={{ fontSize:12, color:'#818cf8' }}>Job <strong>{bpJobId}</strong> rodando em background...</span>
                </div>
              )}

              <div style={{ display:'flex', gap:10, marginTop:4 }}>
                <button onClick={() => setBulkProfileEditOpen(false)} style={{ flex:1, padding:'10px', borderRadius:10, border:'1px solid rgba(51,65,85,.5)', background:'transparent', color:'#64748b', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Cancelar
                </button>
                <button onClick={submitBulkProfileEdit} disabled={bpLoading} style={{ flex:2, padding:'10px', borderRadius:10, border:'none', background: bpLoading ? 'rgba(99,102,241,.4)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontSize:13, fontWeight:700, cursor: bpLoading ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow: bpLoading ? 'none' : '0 4px 16px rgba(99,102,241,.35)' }}>
                  {bpLoading ? <><span>⏳</span> Enviando...</> : <><span>🚀</span> Aplicar em {selectedBulkAccountIds().length} conta(s)</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editProfileModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ width:'min(460px,100%)', background:'linear-gradient(160deg,rgba(15,23,42,.98) 0%,rgba(15,23,42,.95) 100%)', border:'1px solid rgba(99,102,241,.25)', borderRadius:20, boxShadow:'0 0 0 1px rgba(99,102,241,.1), 0 24px 60px rgba(0,0,0,.6)', overflow:'hidden' }}>

            {/* Header com gradiente */}
            <div style={{ padding:'20px 24px 18px', background:'linear-gradient(135deg,rgba(99,102,241,.12) 0%,rgba(139,92,246,.08) 100%)', borderBottom:'1px solid rgba(99,102,241,.15)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                {editProfileModal.avatar ? (
                  <img src={avatarUrl(editProfileModal.avatar)}
                    alt="" style={{ width:44, height:44, borderRadius:12, objectFit:'cover', border:'2px solid rgba(99,102,241,.4)' }} />
                ) : (
                  <div style={{ width:44, height:44, borderRadius:12, background:'linear-gradient(135deg,#6366f133,#8b5cf633)', border:'2px solid rgba(99,102,241,.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800, color:'#818cf8' }}>
                    {editProfileModal.username?.[0]?.toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:'#f1f5f9' }}>Credenciais da conta</div>
                  <div style={{ fontSize:12, color:'#6366f1', marginTop:1 }}>@{editProfileModal.username}</div>
                </div>
              </div>
              <button onClick={() => setEditProfileModal(null)} style={{ width:32, height:32, borderRadius:8, background:'rgba(51,65,85,.5)', border:'1px solid rgba(51,65,85,.7)', color:'#64748b', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
            </div>

            <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:16 }}>

              {/* Aviso */}
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:10, background:'rgba(99,102,241,.07)', border:'1px solid rgba(99,102,241,.18)' }}>
                <span style={{ fontSize:16 }}>🔑</span>
                <span style={{ fontSize:12, color:'#94a3b8' }}>Salve a senha e a chave 2FA para que o sistema faça login automaticamente quando necessário.</span>
              </div>

              {/* Senha */}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6, display:'block', marginBottom:6 }}>Senha da conta</label>
                {editProfileModal?.hasPassword && !epPassword ? (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 12px', background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.2)', borderRadius:8 }}>
                    <span style={{ fontSize:13, color:'#34d399' }}>✅ Senha salva</span>
                    <button type="button" onClick={() => setEpPassword(' ')} style={{ fontSize:11, color:'#475569', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>Trocar</button>
                  </div>
                ) : (
                  <input type="password" value={epPassword} onChange={e => setEpPassword(e.target.value)}
                    placeholder="Digite a senha do Instagram" autoFocus
                    style={{ width:'100%', background:'rgba(15,23,42,.8)', border:'1px solid rgba(51,65,85,.6)', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#e2e8f0', outline:'none', boxSizing:'border-box', transition:'border .2s' }}
                    onFocus={e => e.target.style.borderColor='rgba(99,102,241,.6)'}
                    onBlur={e => e.target.style.borderColor='rgba(51,65,85,.6)'} />
                )}
              </div>

              {/* Chave 2FA */}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:.6, display:'block', marginBottom:6 }}>
                  Chave 2FA <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'#334155' }}>— opcional</span>
                </label>
                {editProfileModal?.hasTotpSecret && !epTotpSecret ? (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 12px', background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.2)', borderRadius:8 }}>
                    <span style={{ fontSize:13, color:'#34d399' }}>✅ Chave 2FA salva — código gerado automaticamente</span>
                    <button type="button" onClick={() => setEpTotpSecret(' ')} style={{ fontSize:11, color:'#475569', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>Trocar</button>
                  </div>
                ) : (
                  <input type="text" value={epTotpSecret} onChange={e => setEpTotpSecret(e.target.value)}
                    placeholder="JBSWY3DPEHPK3PXP (base32)"
                    style={{ width:'100%', background:'rgba(15,23,42,.8)', border:'1px solid rgba(51,65,85,.6)', borderRadius:8, padding:'9px 12px', fontSize:12, color:'#e2e8f0', outline:'none', boxSizing:'border-box', fontFamily:'monospace' }}
                    onFocus={e => e.target.style.borderColor='rgba(99,102,241,.6)'}
                    onBlur={e => e.target.style.borderColor='rgba(51,65,85,.6)'} />
                )}
                <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>Cole a chave secreta base32 do Google Authenticator. O sistema gera o código 2FA sozinho no login.</div>
              </div>

              {/* Erro inline */}
              {epError && (
                <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:'#f87171', fontSize:13, lineHeight:1.5 }}>
                  ⚠️ {epError}
                </div>
              )}

              {/* Botões */}
              <div style={{ display:'flex', gap:10, marginTop:4 }}>
                <button onClick={() => setEditProfileModal(null)} style={{ flex:1, padding:'10px', borderRadius:10, border:'1px solid rgba(51,65,85,.5)', background:'transparent', color:'#64748b', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Cancelar
                </button>
                <button onClick={submitEditProfile} disabled={epLoading} style={{ flex:2, padding:'10px', borderRadius:10, border:'none', background: epLoading ? 'rgba(99,102,241,.4)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontSize:13, fontWeight:700, cursor: epLoading ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow: epLoading ? 'none' : '0 4px 16px rgba(99,102,241,.35)' }}>
                  {epLoading ? <><span style={{ fontSize:16 }}>⏳</span> Salvando...</> : <><span style={{ fontSize:14 }}>🔑</span> Salvar credenciais</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Processando autorização...');
  const [error,  setError]  = useState('');

  useEffect(() => {
    const code    = searchParams.get('code');
    const state   = searchParams.get('state') || 'new';
    const err     = searchParams.get('error');
    const errDesc = searchParams.get('error_description');

    if (err) {
      const msg = errDesc || err;
      navigate(`/accounts?oauth=error&msg=${encodeURIComponent(msg)}`);
      return;
    }
    if (!code) {
      navigate('/accounts?oauth=error&msg=codigo_nao_encontrado');
      return;
    }

    /* Dois fluxos voltam por esta mesma porta, e a diferença está no state.
       O `fb_` é a conexão do Facebook, feita DEPOIS da conta já existir, só
       para habilitar link em story — mandar esse código para o endpoint de
       conectar tentaria criar uma conta que já existe, com um token de outra
       porta. A assinatura vem depois de `~`, então o prefixo continua visível. */
    if (state.startsWith('fb_')) {
      setStatus('Ativando link em story...');
      api.post('/graph-link/callback', { code, state })
        .then(res => {
          const pagina = res.data?.pagina || '';
          navigate(`/accounts?graphLink=success&pagina=${encodeURIComponent(pagina)}`);
        })
        .catch(ex => {
          const d = ex.response?.data || {};
          /* `comoResolver` existe justamente porque as recusas daqui têm
             conserto do lado do Instagram, não do sistema. Descartá-lo deixaria
             só "não foi possível", que não diz o que fazer. */
          const msg = [d.error, d.comoResolver, d.detalhe].filter(Boolean).join(' — ')
            || ex.message || 'Falha ao ativar link em story';
          setError(msg);
          setTimeout(() => navigate(`/accounts?graphLink=error&msg=${encodeURIComponent(msg)}`), 6000);
        });
      return;
    }

    setStatus('Trocando código por token...');

    api.post(`/oauth/connect/${state}`, { pastedUrl: window.location.href })
      .then(res => {
        const username = res.data?.username || '';
        navigate(`/accounts?oauth=success&username=${encodeURIComponent(username)}`);
      })
      .catch(ex => {
        const msg = ex.response?.data?.error || ex.message || 'Falha na autenticação';
        setError(msg);
        setTimeout(() => navigate(`/accounts?oauth=error&msg=${encodeURIComponent(msg)}`), 3000);
      });
  }, []);

  return (
    <div data-mf style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
    }}>
      {error ? (
        <>
          <div><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger-500)" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
          <strong style={{ color: 'var(--mf-danger-500)' }}>Erro na autenticação</strong>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 400, textAlign: 'center' }}>{error}</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--mf-t-sm)' }}>Redirecionando...</p>
        </>
      ) : (
        <>
          <div style={{
            width: 48, height: 48, border: '3px solid var(--accent)',
            borderTopColor: 'transparent', borderRadius: 'var(--mf-r-full)',
            animation: 'spin .8s linear infinite',
          }} />
          <strong>{status}</strong>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--mf-t-body)' }}>
            Aguarde, conectando sua conta Instagram...
          </p>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

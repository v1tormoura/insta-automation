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
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
    }}>
      {error ? (
        <>
          <div><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
          <strong style={{ color: '#f87171' }}>Erro na autenticação</strong>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 400, textAlign: 'center' }}>{error}</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '.8rem' }}>Redirecionando...</p>
        </>
      ) : (
        <>
          <div style={{
            width: 48, height: 48, border: '3px solid var(--accent)',
            borderTopColor: 'transparent', borderRadius: '50%',
            animation: 'spin .8s linear infinite',
          }} />
          <strong>{status}</strong>
          <p style={{ color: 'var(--text-secondary)', fontSize: '.85rem' }}>
            Aguarde, conectando sua conta Instagram...
          </p>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

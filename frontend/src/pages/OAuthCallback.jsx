import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { ehJanela, TIPO_DE_AVISO } from './janelaDeAutorizacao';

/* ── Esta página abre de dois jeitos ────────────────────────────────────────

   Na própria aba, quando a autorização foi aberta ali: o desfecho vira uma
   navegação de volta para /accounts, que já sabe ler `?oauth=`.

   Numa janela separada, quando a tela de contas a abriu para conectar várias
   contas seguidas. Aí navegar para /accounts levaria o app inteiro para DENTRO
   da janela de 560px e deixaria a tela de trás sem saber de nada. O certo é
   avisar quem abriu e fechar.

   `ehJanela` distingue os dois pelo que só existe no segundo caso: um `opener`
   vivo. A tela de contas abre a janela sem `noopener` justamente para isso. */

/**
 * Avisa quem abriu e fecha.
 *
 * `window.location.origin` como destino do postMessage, nunca '*': a mensagem
 * carrega o @ da conta que acabou de entrar, e '*' a entregaria a qualquer
 * página que estivesse no `opener`. Quem recebe confere a origem do outro lado.
 */
function avisarEFechar(carga) {
  try { window.opener.postMessage({ tipo: TIPO_DE_AVISO, ...carga }, window.location.origin); }
  catch { /* se a mensagem não sai, o SSE ainda atualiza a lista */ }
  /* Um instante antes de fechar: sem ele, o fechamento às vezes corre na frente
     da entrega da mensagem e a tela de trás não recebe nada. */
  setTimeout(() => { try { window.close(); } catch { /* navegador recusou */ } }, 150);
}

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

    /* Decidido uma vez, no início: se a janela se fechar sozinha no meio do
       caminho, `ehJanela()` passaria a responder false e o desfecho iria para
       a navegação — dentro de uma janela já morta. */
    const naJanela = ehJanela();

    /** Um único lugar decide o que fazer com o desfecho. */
    const desfecho = (params, carga) => {
      if (naJanela) { setStatus(carga.ok ? 'Conta conectada. Fechando…' : 'Falhou. Fechando…'); avisarEFechar(carga); return; }
      navigate(`/accounts?${params}`);
    };

    if (err) {
      const msg = errDesc || err;
      desfecho(`oauth=error&msg=${encodeURIComponent(msg)}`, { ok: false, erro: msg });
      return;
    }
    if (!code) {
      desfecho('oauth=error&msg=codigo_nao_encontrado', { ok: false, erro: 'codigo_nao_encontrado' });
      return;
    }

    setStatus('Trocando código por token...');

    api.post(`/oauth/connect/${state}`, { pastedUrl: window.location.href })
      .then(res => {
        const username = res.data?.username || '';
        desfecho(`oauth=success&username=${encodeURIComponent(username)}`, { ok: true, username });
      })
      .catch(ex => {
        const msg = ex.response?.data?.error || ex.message || 'Falha na autenticação';
        setError(msg);
        /* Na janela o erro fica visível por 3s antes de fechar — dentro de uma
           janela que já sumiu, ninguém leria o motivo. */
        setTimeout(() => desfecho(`oauth=error&msg=${encodeURIComponent(msg)}`, { ok: false, erro: msg }), 3000);
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

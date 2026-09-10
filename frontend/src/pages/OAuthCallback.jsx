import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { ehJanela, TIPO_DE_AVISO } from './janelaDeAutorizacao';
import TelaDeCarregamento from '../components/TelaDeCarregamento';

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

  return error ? (
    <TelaDeCarregamento erro titulo={`${error} — redirecionando...`} />
  ) : (
    <TelaDeCarregamento titulo={status} subtitulo="Aguarde, conectando sua conta Instagram..." />
  );
}

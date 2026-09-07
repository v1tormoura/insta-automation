import { useState } from 'react';
import api from '../services/api';
import { contaValida } from '../services/conexaoGuiada';

/**
 * Os dois passos para autorizar uma conta.
 *
 * ── Por que os passos são dois, e não um
 *
 * A autorização da API oficial falha por um motivo que a tela do Instagram não
 * explica: enquanto o app está em desenvolvimento, só conta com papel de
 * TESTADOR pode autorizá-lo. Quem clica em "Conectar" antes de aceitar o
 * convite recebe um erro genérico e não tem como saber que faltava isso.
 *
 * Então a ordem é obrigatória: aceitar o convite no Instagram, depois autorizar.
 * Colocar os dois passos numerados na tela é o que transforma um erro sem
 * explicação numa instrução.
 *
 * ── Por que é um componente compartilhado
 *
 * Os mesmos passos aparecem em dois lugares: no modal do painel e na página
 * guiada, que abre no navegador do perfil (multilogin) onde a conta está
 * logada. Escritos duas vezes, um dos dois ficaria desatualizado — e o que
 * desatualiza aqui é uma instrução errada sobre por que a conexão falhou.
 */

/* A página de "Apps e sites" do Instagram, onde fica a aba de convites para
   testador. Endereço estável e documentado pela própria Instagram; a aba não
   tem link direto, por isso o texto diz onde clicar. */
const APPS_E_SITES = 'https://www.instagram.com/accounts/manage_access/';

/**
 * @param {object} props
 * @param {string} [props.conta]   — id da conta a reconectar, ou 'new'
 * @param {string} [props.metaAppId]
 * @param {string} [props.mod]     — módulo do sistema para a cor
 * @param {string} [props.url]     — a URL de autorização, quando quem chama já a tem
 * @param {(url: string) => void} [props.onAutorizar]
 *   O que fazer com a URL. Sem isto, esta aba navega para ela.
 *
 *   Existe porque os dois lugares que usam este componente terminam o passo 2
 *   de forma diferente, e a diferença é real: na página guiada a aba É o fluxo,
 *   então navegar está certo; no modal do painel a tela precisa ficar de pé
 *   para receber a próxima conta, então quem chama abre uma janela. Os TEXTOS
 *   dos passos continuam vindo daqui — que é o motivo de o componente existir.
 * @param {(msg: string) => void} [props.onErro]
 */
export default function PassosDeConexao({
  conta = 'new', metaAppId = '', mod = 'contas', url = '', onAutorizar, onErro,
}) {
  /* Se o passo 1 já foi feito. Não dá para SABER — o Instagram não nos conta se
     o convite foi aceito, e não existe API para consultar isso. O que a tela
     sabe é se o botão foi clicado, e é só isso que ela afirma. */
  const [abriuInstagram, setAbriuInstagram] = useState(false);
  const [indo, setIndo] = useState(false);

  async function autorizar() {
    setIndo(true);
    try {
      /* A URL vem de fora quando quem chama já a pediu — o modal do painel a
         tem em mãos, e buscá-la de novo geraria um `state` novo à toa. */
      let destino = url;
      if (!destino) {
        const { data } = await api.get('/oauth/url', {
          params: { accountId: contaValida(conta), ...(metaAppId ? { metaAppId } : {}) },
        });
        destino = data?.url;
      }
      if (!destino) throw new Error('URL de autorização não retornada');

      if (onAutorizar) { onAutorizar(destino); return; }
      /* Nesta aba: a página guiada existe para ser o começo do fluxo, e o
         retorno cai no /oauth-callback do próprio servidor. */
      window.location.href = destino;
    } catch (err) {
      setIndo(false);
      const msg = err.response?.data?.error || err.message || 'Não foi possível montar a autorização';
      if (onErro) onErro(msg); else alert(msg);
    }
  }

  return (
    <div style={{ '--mf-mod': `var(--mf-mod-${mod})`, display: 'grid', gap: 12 }}>

      <Passo
        numero={1}
        feito={abriuInstagram}
        titulo="Aceitar convite no Instagram"
        descricao={<>Faça login no Instagram (se pedir) e, na aba <strong>Convites para testador</strong> de <strong>Apps e sites</strong>, clique em <strong>Aceitar</strong>.</>}
      >
        <button type="button" className="btn-ghost tom-modulo"
          style={{ width: '100%', justifyContent: 'center', padding: '10px',
            '--tom': abriuInstagram ? 'var(--mf-success-500)' : 'var(--mf-mod)',
            color: abriuInstagram ? 'var(--mf-success-500)' : 'var(--mf-mod)',
            background: `color-mix(in oklch, ${abriuInstagram ? 'var(--mf-success-500)' : 'var(--mf-mod)'} 10%, transparent)` }}
          onClick={() => {
            /* `noopener` aqui SIM: o destino é o Instagram, não o nosso
               callback, e nada precisa voltar por essa referência. */
            window.open(APPS_E_SITES, '_blank', 'noopener,noreferrer');
            setAbriuInstagram(true);
          }}>
          {abriuInstagram
            ? '✓ Instagram aberto — aceite o convite lá'
            : '1. Abrir Apps e Sites no Instagram ↗'}
        </button>
      </Passo>

      <Passo
        numero={2}
        titulo="Autorizar e conectar"
        descricao="Depois de aceitar o convite, clique abaixo para transformar a conta em profissional e concluir a conexão."
      >
        <button type="button" className="btn-primary" disabled={indo}
          style={{ width: '100%', justifyContent: 'center', padding: '11px' }}
          onClick={autorizar}>
          {indo ? <><span className="mf-spin" /> Abrindo autorização…</> : '2. Conectar conta no painel →'}
        </button>
      </Passo>

      <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', textAlign: 'center', lineHeight: 1.8 }}>
        {/* O atalho para quem já é testador. Sem ele, quem reconecta uma conta
            antiga passaria pelo passo 1 toda vez sem precisar. */}
        Já aceitou o convite antes?{' '}
        <button type="button" onClick={autorizar} disabled={indo}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--mf-mod)', fontWeight: 700, fontSize: 'inherit', textDecoration: 'underline' }}>
          Conectar direto
        </button>
        <br />
        Não encontrou o convite no Instagram? Peça ao administrador para te convidar como testador.
      </div>
    </div>
  );
}

function Passo({ numero, titulo, descricao, feito = false, children }) {
  const tom = feito ? 'var(--mf-success-500)' : 'var(--mf-mod)';
  return (
    <div style={{ padding: 13, borderRadius: 'var(--mf-r-lg)',
      background: `color-mix(in oklch, ${tom} 6%, transparent)`,
      border: `1px solid color-mix(in oklch, ${tom} 24%, transparent)` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 'var(--mf-r-full)',
          display: 'grid', placeItems: 'center',
          background: tom, color: 'var(--mf-bg)',
          fontSize: 'var(--mf-t-nano)', fontWeight: 800 }}>
          {feito ? '✓' : numero}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{titulo}</div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 3, lineHeight: 1.65 }}>
            {descricao}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PassosDeConexao from '../components/PassosDeConexao';
import { contaValida } from '../services/conexaoGuiada';

/**
 * A página guiada — o destino do "Copiar link guiado".
 *
 * ── Por que ela existe fora do painel
 *
 * Quem trabalha com um perfil de navegador por conta (multilogin,
 * anti-detect) não está logado no MouraFlow naquele navegador, e nem deveria:
 * o ponto daquele perfil é ser só aquela conta do Instagram. Uma página do
 * painel exigiria login e o fluxo morreria no primeiro passo.
 *
 * Por isso esta rota fica FORA do `PrivateRoute` e não pede nada do painel além
 * de `/oauth/url`, que já é público — o mesmo endereço que o botão do painel
 * usa. Nenhuma informação nova é exposta: a URL de autorização é montada com o
 * App ID e o `state` assinado pelo servidor, e autorizar continua exigindo as
 * credenciais do Instagram da própria pessoa.
 *
 * ── O que ela carrega na URL
 *
 * Só qual conta reconectar (ou `new`) e qual App da Meta usar. `contaValida`
 * recusa o que não é 'new' nem um ObjectId: um id inventado falharia lá no
 * callback, de um jeito que ninguém ligaria ao endereço colado.
 */
export default function ConectarGuiado() {
  const [params] = useSearchParams();
  const [erro, setErro] = useState('');

  const conta = contaValida(params.get('conta'));
  const metaAppId = String(params.get('app') || '').trim();

  return (
    /* `data-mf` porque os tokens do tema moram nele — sem o atributo, todas as
       variáveis `--mf-*` resolvem vazias e a página sai sem cor nenhuma. */
    <div data-mf style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      padding: 'var(--mf-4)', background: 'var(--mf-bg)', color: 'var(--mf-text)',
      /* A fonte precisa ser declarada aqui: esta página não está dentro do
         layout do painel, que é quem normalmente a define. */
      fontFamily: 'var(--mf-font, Inter, system-ui, sans-serif)',
    }}>
      <div style={{ width: 'min(470px, 100%)' }}>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '5px 12px', borderRadius: 'var(--mf-r-xl)',
            background: 'color-mix(in oklch, var(--mf-mod-contas) 12%, transparent)',
            border: '1px solid color-mix(in oklch, var(--mf-mod-contas) 28%, transparent)',
            color: 'var(--mf-mod-contas)', fontSize: 'var(--mf-t-nano)', fontWeight: 700 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><line x1="17.5" y1="6.5" x2="17.5" y2="6.5" />
            </svg>
            Instagram OAuth
          </span>
        </div>

        <div style={{
          padding: 'var(--mf-5)', borderRadius: 'var(--mf-r-xl)',
          background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
        }}>
          <h1 style={{ margin: 0, fontSize: 'var(--mf-t-h1)', fontWeight: 800, textAlign: 'center', textWrap: 'balance' }}>
            Conectar Instagram ao MouraFlow
          </h1>
          <p style={{ margin: '7px 0 20px', textAlign: 'center', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', lineHeight: 1.65 }}>
            Siga os 2 passos para autorizar esta conta sem erro:
          </p>

          {erro && (
            <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 'var(--mf-r-md)',
              background: 'color-mix(in oklch, var(--mf-danger-500) 10%, transparent)',
              border: '1px solid color-mix(in oklch, var(--mf-danger-500) 28%, transparent)',
              color: 'var(--mf-danger-500)', fontSize: 'var(--mf-t-micro)', lineHeight: 1.6 }}>
              {erro}
            </div>
          )}

          <PassosDeConexao conta={conta} metaAppId={metaAppId} mod="contas" onErro={setErro} />
        </div>
      </div>
    </div>
  );
}

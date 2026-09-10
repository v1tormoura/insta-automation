import FundoCiber from './FundoCiber';

/**
 * A tela cheia de "aguarde" — hoje só a do retorno do OAuth do Instagram.
 *
 * ── Por que existe como componente próprio
 *
 * Antes era markup solto dentro de `OAuthCallback.jsx`: fundo liso, um anel
 * girando, texto. Funcionava, mas não tinha nada do resto do painel — nenhum
 * fundo vivo, nenhuma marca. Separei porque uma tela de espera é o tipo de
 * coisa que reaparece: a próxima automação que precisar de uma (um passo de
 * importação, uma migração) usa esta em vez de inventar a sua.
 *
 * ── Por que o logo tem seu próprio pulso, e não fica só girando
 *
 * Um anel giratório diz "algo está processando". Isso já existe aqui — mas
 * sozinho, um spinner não carrega marca nenhuma. O logo pulsando por baixo
 * dele é o que faz a tela de espera parecer PARTE do produto, não um
 * componente genérico de biblioteca esquecido em branco.
 *
 * ── Por que o pulso para no erro
 *
 * Uma marca respirando calmamente ao lado de "Erro na autenticação" manda um
 * sinal contraditório — como se nada tivesse errado. A animação anuncia
 * processo em andamento, e um processo que já terminou — bem ou mal — não
 * deveria continuar anunciando que ainda está.
 */
export default function TelaDeCarregamento({ titulo, subtitulo, erro }) {
  return (
    <div data-mf style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 'var(--mf-4)',
      background: 'var(--mf-bg)', color: 'var(--mf-text)', position: 'relative',
      padding: 'var(--mf-5)', textAlign: 'center',
    }}>
      <FundoCiber />

      <div className={`tela-carregando__logo${erro ? ' tela-carregando__logo--parado' : ''}`}>
        <span aria-hidden="true" className="tela-carregando__halo" />
        <img src="/nexora-icon-512.png?v=1" alt="" width="88" height="88" />
        {/* O anel continua a cargo de quem chama: ele é o que muda de cor no
            erro (vermelho) e de forma (círculo parado) — o logo não precisa
            saber disso, só parar de pulsar. */}
      </div>

      {erro ? (
        <>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--mf-danger-500)"
            strokeWidth="1.8" strokeLinecap="round" style={{ position: 'relative', zIndex: 1 }}>
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <strong style={{ color: 'var(--mf-danger-500)', position: 'relative', zIndex: 1 }}>
            Erro na autenticação
          </strong>
          <p style={{ color: 'var(--mf-text-3)', maxWidth: 400, position: 'relative', zIndex: 1 }}>{titulo}</p>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="tela-carregando__anel" />
          <strong style={{ position: 'relative', zIndex: 1 }}>{titulo}</strong>
          {subtitulo && (
            <p style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-body)', position: 'relative', zIndex: 1 }}>
              {subtitulo}
            </p>
          )}
        </>
      )}
    </div>
  );
}

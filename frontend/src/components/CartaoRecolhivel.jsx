import { useState } from 'react';
import TituloDeCartao from './TituloDeCartao';

/**
 * Cartão que começa fechado, com um resumo do estado atual no cabeçalho.
 *
 * ── Por que não é só "esconder"
 *
 * Recolher uma opção que a pessoa usa é pior do que deixá-la ocupando espaço:
 * ela some da varredura e passa a ser descoberta por acidente. O que torna isto
 * seguro é o `resumo` — fechado, o cabeçalho continua dizendo em que pé a opção
 * está ("Humanizador", "Comentário ativo"). Ninguém precisa abrir para saber; só
 * abre quem vai mudar.
 *
 * Serve para o que tem padrão bom e é mexido raramente. O que se ajusta a cada
 * publicação continua aberto.
 */
export default function CartaoRecolhivel({
  icone, titulo, resumo, children, aberto: abertoInicial = false, estilo,
  /* `estilo` continua aceito para ajustes pontuais (margem, sticky), mas o
     CARTÃO agora é sempre o canônico: antes cada página passava o seu e os
     três recolhíveis do Postar podiam divergir entre si. */
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const idCorpo = `recolhivel-${titulo.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="mf-card" style={estilo}>
      <button type="button"
        onClick={() => setAberto(a => !a)}
        aria-expanded={aberto}
        aria-controls={idCorpo}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--mf-3)', padding: 'var(--mf-3) var(--mf-4)',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
          borderBottom: aberto ? '1px solid var(--mf-border)' : 'none',
        }}>
        <TituloDeCartao icone={icone}>{titulo}</TituloDeCartao>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          {resumo && (
            <span style={{
              fontSize: 'var(--mf-t-micro)', fontFamily: 'var(--mf-mono)',
              color: 'var(--mf-mod, var(--mf-primary-500))',
              background: 'color-mix(in oklch, var(--mf-mod, var(--mf-primary-500)) 10%, transparent)',
              border: '1px solid color-mix(in oklch, var(--mf-mod, var(--mf-primary-500)) 22%, transparent)',
              borderRadius: 'var(--mf-r-full)', padding: '2px 9px', whiteSpace: 'nowrap',
            }}>{resumo}</span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text-3)"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: aberto ? 'rotate(180deg)' : 'none', transition: 'transform var(--mf-normal) var(--mf-ease-out)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {aberto && <div id={idCorpo}>{children}</div>}
    </div>
  );
}

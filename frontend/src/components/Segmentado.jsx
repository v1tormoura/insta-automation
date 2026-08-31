/**
 * Segmentado — escolha exclusiva entre poucas opções.
 *
 * Existia repetido à mão em várias telas: uma <div> com fundo, e dentro dela
 * botões que trocavam de cor de fundo quando ativos. O problema não era o
 * código duplicado, era o que ele comunicava — vários botões pintados de
 * cores diferentes leem-se como várias ações independentes, não como um
 * controle com um valor. O indicador único deslizando resolve isso: fica
 * claro que existe uma escolha só, e a transição mostra de onde ela saiu.
 *
 * Props:
 *   opcoes   — [{ value, label }]  (label aceita ReactNode)
 *   valor    — value da opção ativa
 *   onChange — (value) => void
 *   mod      — módulo do sistema para a cor ('publicar', 'contas', …)
 *   full     — ocupa toda a largura disponível
 *   rotulo   — texto do aria-label do grupo
 */
export default function Segmentado({
  opcoes, valor, onChange, mod = 'publicar', full = false, rotulo,
}) {
  const idx = Math.max(0, opcoes.findIndex(o => o.value === valor));
  const n = opcoes.length;

  return (
    /* O grupo é uma grade de colunas iguais, não um flex de itens que
       encolhem. A diferença aparece quando as opções não cabem: com
       `flex: 1 1 0` os botões espremiam abaixo do próprio rótulo e o texto
       era cortado no meio — em 320px "Agendadas" virava 60px de texto numa
       caixa de 56px. Com `grid-auto-columns: 1fr` sob `width: max-content`,
       toda coluna mede o mesmo e nenhuma fica menor que o rótulo mais longo;
       `min-width: 100%` faz o grupo ocupar a linha quando há espaço. Se
       ainda assim não couber, quem rola é o invólucro — o controle sai da
       tela de lado, mas continua legível.

       As colunas iguais também são o que sustenta a conta do indicador:
       (100% - 6px)/n só descreve a posição do botão ativo porque todos os
       botões medem igual. */
    <div style={{ overflowX: 'auto', maxWidth: '100%', minWidth: 0, scrollbarWidth: 'thin' }}>
    <div
      role="group" aria-label={rotulo}
      style={{
        '--mf-mod': `var(--mf-mod-${mod})`,
        position: 'relative',
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr',
        width: full ? '100%' : 'max-content',
        minWidth: full ? undefined : '100%',
        padding: 3,
        background: 'var(--mf-surface-2)',
        border: '1px solid var(--mf-border)',
        borderRadius: 'var(--mf-r-md)',
      }}
    >
      {/* Desliza por transform, não por `left`: translateX em porcentagem
          resolve contra a própria caixa — que já mede uma fração exata — e
          anima no compositor, sem relayout a cada quadro. */}
      <span aria-hidden="true" style={{
        position: 'absolute', top: 3, bottom: 3, left: 3,
        width: `calc((100% - 6px) / ${n})`,
        transform: `translateX(${idx * 100}%)`,
        borderRadius: 'calc(var(--mf-r-md) - 3px)',
        background: 'color-mix(in oklch, var(--mf-mod) 18%, transparent)',
        border: '1px solid color-mix(in oklch, var(--mf-mod) 36%, transparent)',
        transition: 'transform var(--mf-normal) var(--mf-ease-out)',
      }} />

      {opcoes.map(o => {
        const ativo = o.value === valor;
        return (
          <button
            key={o.value} type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={ativo}
            style={{
              position: 'relative', zIndex: 1, minWidth: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--mf-1)',
              padding: '4px 8px', border: 'none', background: 'none', cursor: 'pointer',
              borderRadius: 'calc(var(--mf-r-md) - 3px)',
              fontSize: 'var(--mf-t-xs)', fontWeight: 600, whiteSpace: 'nowrap',
              /* No tom neutro a cor do módulo é um cinza próximo demais do
                 rótulo inativo para comunicar seleção; ali o ativo sobe para
                 o texto principal e o contraste volta. */
              color: ativo
                ? (mod === 'sistema' ? 'var(--mf-text)' : 'var(--mf-mod)')
                : 'var(--mf-text-3)',
              transition: 'color var(--mf-fast) var(--mf-ease-out)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
    </div>
  );
}

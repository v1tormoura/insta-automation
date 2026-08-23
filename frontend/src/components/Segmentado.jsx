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
    /* gap: 0 e minWidth: 0 nos botões são propositais. Com `flex: 1 1 0` e
       sem largura mínima de conteúdo, cada botão mede exatamente
       (100% - 6px)/n — a mesma conta que dimensiona o indicador. Com gap,
       ou deixando o rótulo mais longo ditar a própria largura, os dois
       desalinham. */
    <div
      role="group" aria-label={rotulo}
      style={{
        '--mf-mod': `var(--mf-mod-${mod})`,
        position: 'relative', display: full ? 'flex' : 'inline-flex',
        width: full ? '100%' : undefined,
        padding: 3, gap: 0, minWidth: 0,
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
              position: 'relative', zIndex: 1, flex: '1 1 0', minWidth: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--mf-1)',
              padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer',
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
  );
}

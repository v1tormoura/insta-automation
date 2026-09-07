/**
 * Chave de opção — um liga/desliga com título e explicação.
 *
 * Existia à mão em várias telas como um `<label>` com checkbox e a explicação
 * solta ao lado, e o resultado era que a explicação parecia legenda da tela e
 * não daquela opção. Aqui a linha inteira é a área de clique, e a explicação
 * fica visivelmente presa ao título.
 *
 * A explicação não é enfeite: cada uma destas opções muda o que o sistema faz
 * por horas sem ninguém olhando. "Modo Loop Infinito" sem a frase que diz que
 * ele nunca termina é uma armadilha.
 *
 * Props:
 *   titulo, descricao — texto
 *   marcada  — boolean
 *   onChange — (boolean) => void
 *   mod      — módulo do sistema para a cor
 *   icone    — ReactNode opcional
 */
export default function ChaveDeOpcao({
  titulo, descricao, marcada, onChange, mod = 'publicar', icone = null,
}) {
  return (
    <label style={{
      '--mf-mod': `var(--mf-mod-${mod})`,
      display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer',
      marginTop: 10, padding: '11px 12px', borderRadius: 'var(--mf-r-md)',
      background: marcada ? 'color-mix(in oklch, var(--mf-mod) 8%, transparent)' : 'var(--mf-surface-2)',
      border: `1px solid ${marcada ? 'color-mix(in oklch, var(--mf-mod) 26%, transparent)' : 'var(--mf-border)'}`,
      transition: 'background var(--mf-fast) var(--mf-ease-out), border-color var(--mf-fast) var(--mf-ease-out)',
    }}>
      {icone && (
        <span style={{ flexShrink: 0, marginTop: 1, color: marcada ? 'var(--mf-mod)' : 'var(--mf-text-3)' }}>{icone}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: marcada ? 'var(--mf-text)' : 'var(--mf-text-2)' }}>
          {titulo}
        </span>
        {descricao && (
          <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 3, lineHeight: 1.6 }}>
            {descricao}
          </span>
        )}
      </span>
      {/* `flexShrink: 0` e `marginTop` alinham a caixa com a primeira linha do
          título, e não com o centro do bloco — que desceria conforme a
          explicação ficasse mais longa. */}
      <input
        type="checkbox"
        checked={!!marcada}
        onChange={e => onChange(e.target.checked)}
        style={{ flexShrink: 0, marginTop: 2, accentColor: 'var(--mf-mod)', cursor: 'pointer' }}
      />
    </label>
  );
}

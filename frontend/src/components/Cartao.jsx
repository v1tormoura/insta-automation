import TituloDeCartao from './TituloDeCartao';

/**
 * O cartão do painel — um só, para todas as telas.
 *
 * ── Por que ele precisou existir
 *
 * O sistema de design já tinha `.mf-card`, `.mf-card__head` e `.mf-card__body`
 * em `design/ponte.css`, com tokens, sombra, container query e transição. Só
 * que quinze páginas declaravam o próprio `cardStyle` inline — cada uma com um
 * fundo levemente diferente (umas `surface-1` sólido, outras 85% com blur),
 * um `padding` diferente e um cabeçalho remontado à mão. O resultado é o que
 * se vê rolando o painel: cartões que quase combinam.
 *
 * O CSS não estava errado; faltava o caminho fácil. Este componente é esse
 * caminho: usar o padrão passa a dar menos trabalho que reinventá-lo.
 *
 * ── O que ele NÃO faz
 *
 * Não inventa estilo novo. Cada classe aqui já existe em `ponte.css` — o
 * componente só monta a estrutura certa. Quem precisar de um cartão fora do
 * padrão passa `className`/`style`, e a exceção fica visível no código em vez
 * de virar mais um `cardStyle` copiado.
 *
 * @param {string}  [titulo]    título do cabeçalho; sem ele, o cartão não tem cabeçalho
 * @param {string}  [icone]     chave de ícone de TituloDeCartao (midia, legenda, capa…)
 * @param {string}  [mod]       módulo de cor do ícone ('auto' herda o da página)
 * @param {string}  [sub]       linha de apoio sob o título
 * @param {node}    [acoes]     botões à direita do cabeçalho
 * @param {node}    [rodape]    faixa inferior (totais, avisos, ações secundárias)
 * @param {boolean} [denso]     corpo com respiro menor — listas e formulários longos
 * @param {boolean} [semCorpo]  o filho já traz o próprio espaçamento (tabela, gráfico)
 * @param {func}    [aoClicar]  torna o cartão clicável (vira botão, com foco e hover)
 */
export default function Cartao({
  titulo, icone, mod = 'auto', sub, acoes, rodape,
  denso = false, semCorpo = false, aoClicar,
  className = '', style, children, ...resto
}) {
  const clicavel = typeof aoClicar === 'function';

  const corpo = semCorpo ? children : (
    <div className="mf-card__body" style={denso ? { padding: 'var(--mf-3) var(--mf-4)' } : undefined}>
      {children}
    </div>
  );

  const conteudo = (
    <>
      {(titulo || acoes) && (
        <div className="mf-card__head">
          <div style={{ minWidth: 0 }}>
            {icone
              ? <TituloDeCartao icone={icone} mod={mod}>{titulo}</TituloDeCartao>
              : <h3 className="mf-card__title">{titulo}</h3>}
            {sub && <p className="mf-card__sub">{sub}</p>}
          </div>
          {acoes && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-2)', flexShrink: 0 }}>
              {acoes}
            </div>
          )}
        </div>
      )}
      {corpo}
      {rodape && (
        <div style={{
          padding: 'var(--mf-3) var(--mf-5)', borderTop: '1px solid var(--mf-border)',
          background: 'color-mix(in oklch, var(--mf-surface-2) 60%, transparent)',
          fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--mf-2)',
        }}>
          {rodape}
        </div>
      )}
    </>
  );

  /* Cartão que reage a clique é um BOTÃO, não uma div com onClick: teclado,
     leitor de tela e o anel de foco do sistema vêm de graça. */
  if (clicavel) {
    return (
      <button type="button" onClick={aoClicar}
        className={`mf-card mf-card--hover ${className}`}
        style={{ textAlign: 'left', display: 'block', width: '100%', padding: 0, ...style }}
        {...resto}>
        {conteudo}
      </button>
    );
  }

  return (
    <section className={`mf-card ${className}`} style={style} {...resto}>
      {conteudo}
    </section>
  );
}

/**
 * Uma grade de cartões com o respiro padrão do painel.
 *
 * `colunas="kpi"` para blocos de número, `"2"` para dois painéis lado a lado,
 * `"cards"` para uma grade de itens. As três medidas vêm de `.mf-grid--*`, que
 * usa container query: o mesmo bloco se comporta igual dentro de qualquer
 * largura, sem media query por página.
 */
export function GradeDeCartoes({ colunas = 'cards', className = '', style, children }) {
  return (
    <div className={`mf-grid mf-grid--${colunas} ${className}`} style={style}>
      {children}
    </div>
  );
}

import { Component } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Limite de erro — impede que uma falha de render apague o app inteiro.
 *
 * Sem isto, qualquer exceção durante o render desmonta a árvore toda e o
 * usuário fica com a tela em branco, sem mensagem, sem saber o que fazer e
 * sem caminho de volta a não ser recarregar. Aconteceu ao escolher uma capa
 * na biblioteca: um `filename` ausente derrubou uma linha de texto, e com
 * ela a aplicação inteira.
 *
 * O ganho não é esconder o defeito — é conter o estrago. A área que falhou
 * mostra o que houve e oferece uma saída; o resto da tela continua de pé.
 *
 * É um componente de classe porque `getDerivedStateFromError` e
 * `componentDidCatch` não têm equivalente em hooks. Não é código legado.
 */
export default class LimiteDeErro extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    /* Vai para o console com a pilha de componentes, que é o que diz QUAL
       parte da árvore quebrou — a mensagem sozinha raramente basta. */
    console.error('[LimiteDeErro]', erro, info?.componentStack);
  }

  tentarDeNovo = () => this.setState({ erro: null });

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    const { titulo = 'Algo quebrou nesta área', compacto = false } = this.props;

    return (
      <div role="alert" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--mf-3)',
        padding: compacto ? 'var(--mf-4)' : 'var(--mf-8) var(--mf-5)',
        margin: compacto ? 0 : 'var(--mf-4) 0',
        borderRadius: 'var(--mf-r-lg)',
        background: 'var(--mf-danger-bg)',
        border: '1px solid color-mix(in oklch, var(--mf-danger-500) 26%, transparent)',
        minWidth: 0,
      }}>
        <div style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 650, color: 'var(--mf-danger-500)' }}>
          {titulo}
        </div>
        <p style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-2)', margin: 0, maxWidth: '54ch', textWrap: 'pretty' }}>
          O resto da página continua funcionando. Se insistir, recarregue —
          e se você souber o que estava fazendo, isso ajuda a corrigir.
        </p>

        {/* A mensagem técnica fica recolhida: quem só quer voltar a
            trabalhar não precisa dela, e quem vai reportar precisa. */}
        <details style={{ width: '100%', minWidth: 0 }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>
            Detalhe técnico
          </summary>
          <pre className="mf-mono" style={{
            margin: 'var(--mf-2) 0 0', padding: 'var(--mf-3)',
            background: 'var(--mf-surface-2)', borderRadius: 'var(--mf-r-md)',
            fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto',
          }}>{String(erro?.stack || erro?.message || erro)}</pre>
        </details>

        <div style={{ display: 'flex', gap: 'var(--mf-2)', flexWrap: 'wrap' }}>
          <button type="button" onClick={this.tentarDeNovo} className="btn btn-ghost btn-sm">
            Tentar de novo
          </button>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-ghost btn-sm">
            Recarregar a página
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Limite atado à rota atual.
 *
 * A chave reinicia o limite a cada navegação. Sem ela, uma tela que falhou
 * deixaria o erro preso também na tela seguinte — que talvez esteja
 * perfeita — e o usuário concluiria que o app inteiro quebrou.
 *
 * Existe como componente próprio porque `useLocation` é um hook e precisa de
 * um componente para viver; chamá-lo no meio da árvore de rotas do App não é
 * possível.
 */
export function LimiteDeRota({ children, titulo }) {
  const { pathname } = useLocation();
  return <LimiteDeErro key={pathname} titulo={titulo}>{children}</LimiteDeErro>;
}

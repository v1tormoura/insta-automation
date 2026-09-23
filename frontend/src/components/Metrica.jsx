/**
 * O bloco de número — o "quanto" do painel.
 *
 * ── Por que ele precisou existir
 *
 * `.mf-kpi` já existia em `design/ponte.css`, com mono tabular, tamanho fluido
 * por container query e cores de tendência prontas. Em React havia um
 * `StatCard` de sete linhas, herdado da primeira versão, que usava as classes
 * LEGADAS (`.card` + `<h3>/<h1>`) — por isso ninguém o usava: ele não parecia
 * com o resto do painel. Cada tela então desenhava seus próprios números
 * inline, e o mesmo dado aparecia em três tamanhos diferentes conforme a tela.
 *
 * ── As decisões que este componente carrega
 *
 * `tabular-nums` (do CSS): número que muda a cada atualização não pode dançar
 * de largura — em uma coluna de valores, a vírgula tem de ficar no lugar.
 *
 * A variação é texto E cor, nunca só cor: "+12%" em verde continua legível em
 * preto e branco, e para quem não distingue verde de vermelho a seta e o sinal
 * resolvem. Por isso `dir` desenha uma seta além de pintar.
 *
 * Zero é um valor, não um vazio: `valor={0}` mostra 0. Só `null`/`undefined`
 * viram "—", que quer dizer "não sei", coisa diferente de "nenhum".
 *
 * @param {string} rotulo            o que o número é ("Postados hoje")
 * @param {number|string} valor      o número; null/undefined viram "—"
 * @param {node}   [icone]           SVG pequeno no canto (herda a cor do módulo)
 * @param {string} [variacao]        texto da variação ("+12%", "3 a mais")
 * @param {string} [dir]             'up' | 'down' | 'flat' — cor e seta da variação
 * @param {string} [nota]            linha de apoio no rodapé ("vs. ontem")
 * @param {string} [cor]             sobrescreve a cor do valor (use para estado, não enfeite)
 * @param {boolean}[carregando]      mostra o esqueleto no lugar do número
 * @param {func}   [aoClicar]        leva a uma tela de detalhe
 */

const SETA = { up: 'M7 14l5-5 5 5', down: 'M7 10l5 5 5-5' };

function Seta({ dir }) {
  if (dir !== 'up' && dir !== 'down') return null;
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={SETA[dir]} />
    </svg>
  );
}

/** "12.480" — pt-BR, e sem inventar casas decimais em número inteiro. */
function formatar(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('pt-BR') : '—';
  return v;
}

export default function Metrica({
  rotulo, valor, icone, variacao, dir = 'flat', nota, cor,
  carregando = false, aoClicar, className = '', style,
}) {
  const clicavel = typeof aoClicar === 'function';
  const Casca = clicavel ? 'button' : 'div';

  return (
    <Casca
      {...(clicavel ? { type: 'button', onClick: aoClicar } : {})}
      className={`mf-card ${clicavel ? 'mf-card--hover' : ''} ${className}`}
      style={{ ...(clicavel ? { textAlign: 'left', display: 'block', width: '100%', padding: 0 } : {}), ...style }}
    >
      <div className="mf-kpi">
        <div className="mf-kpi__top">
          <span className="mf-kpi__label">{rotulo}</span>
          {icone && <span className="mf-kpi__ico" aria-hidden="true">{icone}</span>}
        </div>

        {carregando
          ? <div className="mf-skel" style={{ height: 30, width: '60%', borderRadius: 'var(--mf-r-sm)' }} />
          : <div className="mf-kpi__value" style={cor ? { color: cor } : undefined}>{formatar(valor)}</div>}

        {(variacao || nota) && (
          <div className="mf-kpi__foot">
            {variacao
              ? <span className="mf-trend" data-dir={dir}><Seta dir={dir} />{variacao}</span>
              : <span />}
            {nota && <span className="mf-kpi__vs">{nota}</span>}
          </div>
        )}
      </div>
    </Casca>
  );
}

/**
 * O número em LINHA — a versão compacta, para colunas estreitas.
 *
 * Existe porque o Dashboard e o Automatizar inventaram, cada um com a sua
 * marcação, exatamente o mesmo desenho: um ponto colorido, o rótulo à
 * esquerda, o valor à direita. Dois blocos iguais escritos duas vezes divergem
 * na primeira manutenção — e já divergiam no tamanho do texto.
 *
 * O ponto é decoração e leva `aria-hidden`: a informação é o par
 * rótulo/valor, e um leitor de tela anunciando "círculo" antes de cada linha
 * só atrapalha.
 */
export function MetricaLinha({ rotulo, valor, cor = 'var(--mf-mod, var(--mf-primary-500))', nota }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-3)', padding: '6px 0',
      borderBottom: '1px solid var(--mf-border-subtle)' }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 'var(--mf-r-full)',
        background: cor, flexShrink: 0, boxShadow: `0 0 6px ${cor}` }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotulo}</span>
      {nota && <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', flexShrink: 0 }}>{nota}</span>}
      <strong style={{ fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-body)', fontWeight: 700,
        color: cor, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatar(valor)}</strong>
    </div>
  );
}

/** Um grupo de linhas compactas, sem a borda sobrando na última. */
export function ListaDeMetricas({ children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}
      className="mf-metricas-lista">{children}</div>
  );
}

/**
 * A fileira de números do topo de uma tela.
 *
 * Existe para a página não repetir a grade: `minmax(220px, 1fr)` com
 * `auto-fit` é a medida do painel inteiro, e ela mora em `.mf-grid--kpi`.
 */
export function FileiraDeMetricas({ className = '', style, children }) {
  return <div className={`mf-grid mf-grid--kpi ${className}`} style={style}>{children}</div>;
}

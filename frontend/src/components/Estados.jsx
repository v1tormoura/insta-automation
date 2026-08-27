import { cn } from '../lib/utils';

/**
 * Os três estados que toda tela com dados tem: carregando, vazio e falhou.
 *
 * ── Por que isso vale um arquivo
 *
 * Uma varredura encontrou `Skeleton` em 2 de 43 páginas. As outras 41 mostram
 * `Carregando...` em cinza no meio da tela, e depois a página inteira aparece
 * de uma vez. Essa troca — nada, nada, nada, TUDO — é o que faz uma interface
 * parecer improvisada, mesmo quando é rápida.
 *
 * ── O que um esqueleto tem que fazer
 *
 * Ter a FORMA do que vem. Um retângulo genérico no meio da tela não é
 * esqueleto, é um spinner deitado: quando o conteúdo chega, o layout salta e
 * quem está lendo perde o ponto. Esqueleto bom ocupa o mesmo espaço, na mesma
 * grade, com as mesmas alturas — a chegada do dado deve ser uma troca de
 * textura, não um solavanco.
 *
 * Por isso aqui não existe um `<Esqueleto />` universal. Existem peças com o
 * formato das coisas que o produto realmente desenha: cartão de métrica,
 * linha de tabela, grade de mídia.
 *
 * ── O que este arquivo NÃO faz
 *
 * Não define aparência. A varredura do esqueleto e a caixa do estado vazio
 * já existiam como `.mf-skel` e `.mf-empty`, e é delas que estas peças se
 * servem. O que faltava não era o estilo — era ter as FORMAS prontas, para
 * que usar o estado certo custasse menos que escrever `Carregando...`.
 */

/* ── Peça base ───────────────────────────────────────────────────────────── */

export function Bloco({ className, style, ...resto }) {
  return (
    <div
      aria-hidden
      /* `mf-skel` já existia no design system e era usado em duas páginas.
         Criar uma classe nova aqui teria sido a mesma armadilha que a
         auditoria apontou na cor: um segundo sistema, com o mesmo propósito,
         divergindo do primeiro no dia em que alguém ajustasse só um deles. */
      className={cn('mf-skel', className)}
      style={{ borderRadius: 'var(--mf-r-sm)', ...style }}
      {...resto}
    />
  );
}

/* ── Formatos ────────────────────────────────────────────────────────────── */

/** Linha de texto. `largura` em porcentagem para o parágrafo não sair reto. */
export function LinhaTexto({ largura = '100%', altura = 11 }) {
  return <Bloco style={{ width: largura, height: altura, borderRadius: 'var(--mf-r-xs)' }} />;
}

/** Cartão de métrica: rótulo curto, número grande, variação. */
export function EsqueletoMetrica() {
  return (
    <div style={{
      background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', padding: 'var(--mf-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--mf-2)', minWidth: 0,
    }}>
      <LinhaTexto largura="42%" altura={9} />
      <Bloco style={{ width: '58%', height: 26, borderRadius: 'var(--mf-r-sm)' }} />
      <LinhaTexto largura="34%" altura={9} />
    </div>
  );
}

/** Fileira de métricas na mesma grade que a tela usa quando há dado. */
export function EsqueletoMetricas({ quantas = 4 }) {
  return (
    <div style={{
      display: 'grid', gap: 'var(--mf-3)',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    }}>
      {Array.from({ length: quantas }, (_, i) => <EsqueletoMetrica key={i} />)}
    </div>
  );
}

/**
 * Tabela. As larguras das células variam de propósito: coluna toda do mesmo
 * tamanho lê como código de barras, não como texto.
 */
export function EsqueletoTabela({ linhas = 5, colunas = 4 }) {
  const larguras = ['62%', '38%', '48%', '30%', '54%', '44%'];
  return (
    <div style={{
      background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', gap: 'var(--mf-4)', padding: 'var(--mf-3) var(--mf-4)',
        borderBottom: '1px solid var(--mf-border)',
      }}>
        {Array.from({ length: colunas }, (_, c) => (
          <div key={c} style={{ flex: 1, minWidth: 0 }}>
            <LinhaTexto largura="52%" altura={8} />
          </div>
        ))}
      </div>
      {Array.from({ length: linhas }, (_, l) => (
        <div key={l} style={{
          display: 'flex', gap: 'var(--mf-4)', padding: 'var(--mf-3) var(--mf-4)',
          borderBottom: l < linhas - 1 ? '1px solid var(--mf-border-subtle)' : 'none',
        }}>
          {Array.from({ length: colunas }, (_, c) => (
            <div key={c} style={{ flex: 1, minWidth: 0 }}>
              <LinhaTexto largura={larguras[(l + c) % larguras.length]} altura={10} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Grade de mídia — a proporção 3/4 é a que a biblioteca usa. */
export function EsqueletoGrade({ itens = 8, minimo = 124 }) {
  return (
    <div style={{
      display: 'grid', gap: 'var(--mf-3)',
      gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minimo}px), 1fr))`,
    }}>
      {Array.from({ length: itens }, (_, i) => (
        <Bloco key={i} style={{ aspectRatio: '3/4', borderRadius: 'var(--mf-r-md)' }} />
      ))}
    </div>
  );
}

/** Lista de cartões — contas, loops, campanhas. */
export function EsqueletoLista({ itens = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-3)' }}>
      {Array.from({ length: itens }, (_, i) => (
        <div key={i} style={{
          background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
          borderRadius: 'var(--mf-r-lg)', padding: 'var(--mf-4)',
          display: 'flex', alignItems: 'center', gap: 'var(--mf-3)',
        }}>
          <Bloco style={{ width: 36, height: 36, borderRadius: 'var(--mf-r-full)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <LinhaTexto largura="34%" altura={11} />
            <LinhaTexto largura="56%" altura={9} />
          </div>
          <Bloco style={{ width: 68, height: 26, borderRadius: 'var(--mf-r-sm)', flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

/* ── Vazio ───────────────────────────────────────────────────────────────── */

/**
 * Tela vazia.
 *
 * "Nenhuma conta" sozinho é um beco sem saída: informa e abandona. Um estado
 * vazio bom responde três coisas — o que deveria estar aqui, por que não
 * está, e o que fazer agora. A `acao` é a terceira, e é a que transforma a
 * tela de aviso em ponto de partida.
 */
export function Vazio({ icone, titulo, descricao, acao }) {
  return (
    <div className="mf-empty" style={{
      background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)',
    }}>
      {icone && <span className="mf-empty__ico">{icone}</span>}
      <div className="mf-empty__t" style={{ color: 'var(--mf-text)' }}>{titulo}</div>
      {descricao && <p className="mf-empty__d">{descricao}</p>}
      {acao && <div style={{ marginTop: 'var(--mf-2)' }}>{acao}</div>}
    </div>
  );
}

/* ── Falha ───────────────────────────────────────────────────────────────── */

/**
 * Erro.
 *
 * Diz o que fazer antes de dizer o que quebrou. O detalhe técnico fica em
 * segundo plano, monoespaçado e rolável — quem precisa dele sabe procurar,
 * e quem não precisa não deveria tropeçar num rastro de pilha.
 */
export function Falha({ titulo = 'Não foi possível carregar', descricao, detalhe, onTentar }) {
  return (
    <div style={{
      display: 'flex', gap: 'var(--mf-3)', alignItems: 'flex-start',
      padding: 'var(--mf-4)',
      background: 'color-mix(in oklch, var(--mf-danger-500) 7%, transparent)',
      border: '1px solid color-mix(in oklch, var(--mf-danger-500) 28%, transparent)',
      borderRadius: 'var(--mf-r-lg)',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 'var(--mf-r-md)', flexShrink: 0,
        display: 'grid', placeItems: 'center',
        background: 'color-mix(in oklch, var(--mf-danger-500) 15%, transparent)',
        color: 'var(--mf-danger-500)',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>
          {titulo}
        </div>
        {descricao && (
          <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 3, lineHeight: 1.6 }}>
            {descricao}
          </div>
        )}
        {detalhe && (
          <div style={{
            marginTop: 'var(--mf-2)', padding: '6px 9px', borderRadius: 'var(--mf-r-sm)',
            background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)',
            fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)',
            overflowX: 'auto', whiteSpace: 'nowrap',
          }}>{detalhe}</div>
        )}
        {onTentar && (
          <button onClick={onTentar} style={{
            marginTop: 'var(--mf-3)', padding: '6px 14px', borderRadius: 'var(--mf-r-sm)',
            fontSize: 'var(--mf-t-xs)', fontWeight: 700, cursor: 'pointer',
            background: 'color-mix(in oklch, var(--mf-danger-500) 13%, transparent)',
            color: 'var(--mf-danger-500)',
            border: '1px solid color-mix(in oklch, var(--mf-danger-500) 32%, transparent)',
          }}>Tentar de novo</button>
        )}
      </div>
    </div>
  );
}

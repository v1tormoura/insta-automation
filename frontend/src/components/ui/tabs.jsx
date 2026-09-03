import { createContext, useContext, useId, useRef } from 'react';
import { cn } from '../../lib/utils';

/**
 * Tabs acessível sem dependência nova.
 *
 * @radix-ui/react-tabs não está no projeto, e o padrão de tablist do WAI-ARIA é
 * pequeno o bastante para não justificar mais um pacote: roles corretos,
 * navegação por setas/Home/End e `tabIndex` gerenciado (só a aba ativa entra na
 * ordem do Tab — as outras se alcançam pelas setas).
 *
 * Estado controlado pelo pai: a aba escolhida costuma ir para a URL ou para o
 * estado da página, então guardá-la aqui dentro só criaria duas verdades.
 */

const TabsCtx = createContext(null);

export function Tabs({ value, onValueChange, children, className }) {
  const baseId = useId();
  return (
    <TabsCtx.Provider value={{ value, onValueChange, baseId }}>
      <div className={cn('flex flex-col gap-4', className)}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className, label = 'Seções' }) {
  const listRef = useRef(null);

  // Setas/Home/End movem entre abas. Sem isso o componente parece um tablist
  // para o leitor de tela mas não se comporta como um.
  const aoTeclar = e => {
    const teclas = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!teclas.includes(e.key)) return;

    const abas = Array.from(listRef.current?.querySelectorAll('[role="tab"]:not([disabled])') || []);
    if (!abas.length) return;

    const atual = abas.indexOf(document.activeElement);
    let proximo;
    if (e.key === 'Home')            proximo = 0;
    else if (e.key === 'End')        proximo = abas.length - 1;
    else if (atual < 0)              proximo = 0;
    else if (e.key === 'ArrowRight') proximo = (atual + 1) % abas.length;
    else                             proximo = (atual - 1 + abas.length) % abas.length;

    e.preventDefault();
    abas[proximo].focus();
    abas[proximo].click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={aoTeclar}
      // Rola na horizontal no celular em vez de quebrar em duas linhas.
      /* Linha de base em vez de caixa.

         Numa caixa com fundo e sete opções de texto pequeno, os limites entre
         as abas somem e o conjunto lê como uma frase: "Timeline 12 Por conta 1
         Por conteúdo 12 Publicações 12…". A linha inferior dá ao grupo um
         eixo, e a aba ativa o interrompe — que é o gesto que diz "você está
         aqui" sem depender de o olho comparar dois tons de cinza. */
      className={cn(
        'flex gap-5 overflow-x-auto border-b border-[var(--border)]',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value: valor, children, count, className }) {
  const { value, onValueChange, baseId } = useContext(TabsCtx);
  const ativo = value === valor;

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${valor}`}
      aria-selected={ativo}
      aria-controls={`${baseId}-panel-${valor}`}
      tabIndex={ativo ? 0 : -1}
      onClick={() => onValueChange(valor)}
      className={cn(
        /* `-mb-px` sobe o botão um pixel para a borda inferior dele cobrir a
           da lista — é o que faz a aba ativa parecer recortada da linha em vez
           de desenhada por cima. */
        'relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap',
        'border-b-2 px-0.5 py-2.5 text-[var(--mf-t-micro)] font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mf-primary-500)]',
        ativo
          ? 'border-[var(--mf-primary-500)] text-[var(--mf-primary-500)]'
          : 'border-transparent text-[var(--mf-text-3)] hover:border-[var(--mf-border-strong)] hover:text-[var(--mf-text-2)]',
        className
      )}
    >
      {children}
      {count !== undefined && count !== null && (
        <span
          /* Contagem zero fica apagada em vez de sumir: a lista de abas é a
             mesma em toda campanha, e uma que muda de largura conforme os
             números obriga a reler para saber onde clicar. */
          className={cn(
            'rounded-full px-1.5 font-mono text-[var(--mf-t-nano)] tabular-nums',
            ativo
              ? 'bg-[color-mix(in_oklch,var(--mf-primary-500)_20%,transparent)] text-[var(--mf-primary-500)]'
              : 'bg-[var(--mf-border-subtle)] text-[var(--mf-text-3)]',
            !count && 'opacity-45',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function TabsContent({ value: valor, children, className }) {
  const { value, baseId } = useContext(TabsCtx);
  if (value !== valor) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${valor}`}
      aria-labelledby={`${baseId}-tab-${valor}`}
      tabIndex={0}
      className={cn('focus-visible:outline-none', className)}
    >
      {children}
    </div>
  );
}

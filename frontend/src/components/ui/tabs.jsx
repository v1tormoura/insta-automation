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
      className={cn(
        'flex gap-1 overflow-x-auto rounded-[var(--mf-r-md)] border border-[var(--border)]',
        'bg-[var(--mf-border-subtle)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
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
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--mf-r-sm)] px-3 py-1.5',
        'text-[var(--mf-t-micro)] font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cyan)]',
        ativo
          ? 'bg-[color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_12%,transparent)] text-[var(--cyan)]'
          : 'text-[var(--text3)] hover:bg-[var(--mf-border-subtle)] hover:text-[var(--text2)]',
        className
      )}
    >
      {children}
      {count !== undefined && count !== null && (
        <span
          className={cn(
            'rounded-full px-1.5 font-mono text-[var(--mf-t-nano)] tabular-nums',
            ativo ? 'bg-[color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_18%,transparent)]' : 'bg-[var(--mf-border)]'
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

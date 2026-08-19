import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Painel lateral (drawer), construído sobre @radix-ui/react-dialog — a mesma
 * dependência que dialog.jsx já usa. Nenhum pacote novo: o Sheet do shadcn é
 * justamente um Dialog com posicionamento na borda.
 *
 * Herda de graça o que importa num drawer: foco preso dentro do painel, fechar
 * no Esc, `aria-modal`, e devolver o foco ao elemento que o abriu.
 *
 * No celular ocupa a largura toda; a partir de sm ganha largura máxima.
 */

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = ({ className, ...props }) => (
  <DialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
);
SheetOverlay.displayName = 'SheetOverlay';

const SheetContent = ({ className, children, ...props }) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex flex-col',
        // Largura total no celular; teto a partir de sm para não virar uma
        // coluna estreita demais no desktop.
        'w-full sm:max-w-[440px]',
        'border-l border-[var(--border)] bg-[var(--bg2)] shadow-[0_0_80px_rgba(0,0,0,.7)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:duration-200 data-[state=open]:duration-300',
        'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Fechar"
        className="absolute right-4 top-4 rounded-[6px] p-1.5 text-[var(--text3)] transition-all hover:bg-[rgba(255,255,255,.06)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--cyan)]"
      >
        <X size={14} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
);
SheetContent.displayName = 'SheetContent';

const SheetHeader = ({ className, ...props }) => (
  <div
    className={cn('shrink-0 border-b border-[var(--border)] px-5 py-4 pr-12', className)}
    {...props}
  />
);

/** Corpo rolável — o cabeçalho e o rodapé ficam fixos. */
const SheetBody = ({ className, ...props }) => (
  <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
);

const SheetFooter = ({ className, ...props }) => (
  <div
    className={cn('shrink-0 border-t border-[var(--border)] px-5 py-3', className)}
    {...props}
  />
);

const SheetTitle = ({ className, ...props }) => (
  <DialogPrimitive.Title
    className={cn('text-[14px] font-bold text-[var(--text)]', className)}
    {...props}
  />
);

const SheetDescription = ({ className, ...props }) => (
  <DialogPrimitive.Description
    className={cn('text-[11.5px] text-[var(--text3)]', className)}
    {...props}
  />
);

export {
  Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay,
  SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
};

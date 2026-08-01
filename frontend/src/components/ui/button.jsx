import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[9px] text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-[var(--cyan2)] to-[var(--cyan)] text-[#040e1c] shadow-[0_0_18px_rgba(0,212,255,.28)] hover:shadow-[0_0_28px_rgba(0,212,255,.45)] hover:-translate-y-px active:translate-y-0',
        outline:
          'border border-[var(--border)] bg-[rgba(255,255,255,.04)] text-[var(--text2)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--text)] hover:border-[var(--border2)]',
        ghost:
          'text-[var(--text2)] hover:bg-[rgba(255,255,255,.06)] hover:text-[var(--text)]',
        danger:
          'bg-[rgba(244,63,94,.1)] text-[var(--red)] border border-[rgba(244,63,94,.2)] hover:bg-[rgba(244,63,94,.18)]',
        secondary:
          'bg-[var(--bg4)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg5)] hover:border-[var(--border2)]',
        link:
          'text-[var(--cyan)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-[7px] px-3 text-[12px]',
        lg: 'h-11 rounded-[11px] px-6 text-[14px]',
        icon: 'h-8 w-8 rounded-[8px]',
        xs: 'h-6 rounded-[6px] px-2 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const Button = forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});

Button.displayName = 'Button';

export { Button, buttonVariants };

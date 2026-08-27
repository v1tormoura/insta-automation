import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--mf-r-md)] text-[var(--mf-t-sm)] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-[var(--cyan2)] to-[var(--cyan)] text-[var(--mf-bg)] shadow-[0_0_18px_color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_28%,transparent)] hover:shadow-[0_0_28px_color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_45%,transparent)] hover:-translate-y-px active:translate-y-0',
        outline:
          'border border-[var(--border)] bg-[var(--mf-border-subtle)] text-[var(--text2)] hover:bg-[var(--mf-border)] hover:text-[var(--text)] hover:border-[var(--border2)]',
        ghost:
          'text-[var(--text2)] hover:bg-[var(--mf-border)] hover:text-[var(--text)]',
        danger:
          'bg-[color-mix(in_oklch,var(--mf-danger-500)_10%,transparent)] text-[var(--red)] border border-[color-mix(in_oklch,var(--mf-danger-500)_20%,transparent)] hover:bg-[color-mix(in_oklch,var(--mf-danger-500)_18%,transparent)]',
        secondary:
          'bg-[var(--bg4)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg5)] hover:border-[var(--border2)]',
        link:
          'text-[var(--cyan)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-[var(--mf-r-sm)] px-3 text-[var(--mf-t-xs)]',
        lg: 'h-11 rounded-[var(--mf-r-md)] px-6 text-[var(--mf-t-body)]',
        icon: 'h-8 w-8 rounded-[var(--mf-r-sm)]',
        xs: 'h-6 rounded-[var(--mf-r-sm)] px-2 text-[var(--mf-t-micro)]',
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

import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Input = forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-[var(--mf-r-md)] border border-[var(--border)] bg-[var(--mf-border-subtle)] px-3 py-2 text-[var(--mf-t-sm)] text-[var(--text)] placeholder:text-[var(--text3)]',
        'transition-all duration-200 outline-none',
        'focus:border-[var(--border2)] focus:shadow-[0_0_12px_color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_14%,transparent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = 'Input';

export { Input };

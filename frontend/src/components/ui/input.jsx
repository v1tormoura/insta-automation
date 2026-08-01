import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Input = forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-[9px] border border-[var(--border)] bg-[rgba(255,255,255,.04)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text3)]',
        'transition-all duration-200 outline-none',
        'focus:border-[var(--border2)] focus:shadow-[0_0_12px_rgba(0,212,255,.14)]',
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

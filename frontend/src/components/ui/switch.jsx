import { forwardRef } from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

const Switch = forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-[var(--mf-border)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
      'bg-[var(--mf-border)] data-[state=checked]:bg-[var(--cyan2)] data-[state=checked]:border-[var(--cyan2)]',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-3.5 w-3.5 rounded-full shadow-md ring-0 transition-transform duration-200',
        'bg-white/90 data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-[18px]',
        'data-[state=checked]:bg-[var(--mf-bg)]'
      )}
    />
  </SwitchPrimitives.Root>
));

Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

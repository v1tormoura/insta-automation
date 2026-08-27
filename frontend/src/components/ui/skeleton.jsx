import { cn } from '../../lib/utils';

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[var(--mf-border-subtle)]',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };

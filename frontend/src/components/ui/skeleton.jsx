import { cn } from '../../lib/utils';

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[rgba(255,255,255,.05)]',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };

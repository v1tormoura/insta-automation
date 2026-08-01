import { cn } from '../../lib/utils';

export function AnimatedGradientText({ children, className }) {
  return (
    <span
      className={cn(
        'inline-block bg-gradient-to-r from-[var(--cyan)] via-[#60a5fa] to-[var(--purple)]',
        'bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient-text_4s_linear_infinite]',
        className
      )}
    >
      {children}
    </span>
  );
}

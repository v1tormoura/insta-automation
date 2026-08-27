import { cn } from '../../lib/utils';

export function AnimatedGradientText({ children, className }) {
  return (
    <span
      className={cn(
        'inline-block bg-gradient-to-r from-[var(--mf-mod,var(--mf-accent-500))] via-[var(--mf-info-500)] to-[var(--mf-mod-publicar)]',
        'bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient-text_4s_linear_infinite]',
        className
      )}
    >
      {children}
    </span>
  );
}

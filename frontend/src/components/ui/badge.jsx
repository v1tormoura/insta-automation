import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--cyan)] text-[#040e1c]',
        secondary:
          'border-[var(--border)] bg-[rgba(255,255,255,.06)] text-[var(--text2)]',
        destructive:
          'border-[rgba(244,63,94,.2)] bg-[rgba(244,63,94,.1)] text-[var(--red)]',
        outline:
          'border-[var(--border2)] bg-[rgba(0,212,255,.08)] text-[var(--cyan)]',
        success:
          'border-[rgba(16,185,129,.2)] bg-[rgba(16,185,129,.1)] text-[var(--green)]',
        warning:
          'border-[rgba(245,158,11,.2)] bg-[rgba(245,158,11,.1)] text-[var(--amber)]',
        purple:
          'border-[rgba(139,92,246,.2)] bg-[rgba(139,92,246,.1)] text-[var(--purple)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

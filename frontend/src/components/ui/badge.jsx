import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[var(--mf-t-micro)] font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--cyan)] text-[var(--mf-bg)]',
        secondary:
          'border-[var(--border)] bg-[var(--mf-border)] text-[var(--text2)]',
        destructive:
          'border-[color-mix(in_oklch,var(--mf-danger-500)_20%,transparent)] bg-[color-mix(in_oklch,var(--mf-danger-500)_10%,transparent)] text-[var(--red)]',
        outline:
          'border-[var(--border2)] bg-[color-mix(in_oklch,var(--mf-mod,var(--mf-accent-500))_8%,transparent)] text-[var(--cyan)]',
        success:
          'border-[color-mix(in_oklch,var(--mf-success-500)_20%,transparent)] bg-[color-mix(in_oklch,var(--mf-success-500)_10%,transparent)] text-[var(--green)]',
        warning:
          'border-[color-mix(in_oklch,var(--mf-warning-500)_20%,transparent)] bg-[color-mix(in_oklch,var(--mf-warning-500)_10%,transparent)] text-[var(--amber)]',
        purple:
          'border-[color-mix(in_oklch,var(--mf-mod-publicar)_20%,transparent)] bg-[color-mix(in_oklch,var(--mf-mod-publicar)_10%,transparent)] text-[var(--purple)]',
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

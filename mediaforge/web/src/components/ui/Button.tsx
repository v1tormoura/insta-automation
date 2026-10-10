import clsx from 'clsx';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover shadow-[0_6px_20px_-8px_rgb(47_123_255/0.8)] disabled:shadow-none border border-accent-hover/40',
  secondary: 'bg-surface-3 text-ink border border-line-strong hover:border-accent/60 hover:bg-surface-3/80',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-3 border border-transparent',
  danger: 'bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20',
  subtle: 'bg-surface-2 text-ink-2 border border-line hover:text-ink hover:border-line-strong',
};

const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11.5px] gap-1',
  sm: 'h-7.5 px-2.5 text-[12.5px] gap-1.5',
  md: 'h-9 px-3.5 text-[13.5px] gap-2',
};

export function Button({ variant = 'secondary', size = 'sm', icon: Icon, iconRight: IconRight, loading, className, children, disabled, ...rest }: ButtonProps) {
  const iconSize = size === 'md' ? 16 : size === 'sm' ? 14 : 12;
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-ctl)] font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : Icon ? <Icon size={iconSize} strokeWidth={2} /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} strokeWidth={2} /> : null}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  ...rest
}: Omit<ButtonProps, 'children' | 'icon'> & { icon: LucideIcon; label: string }) {
  const box = size === 'md' ? 'h-9 w-9' : size === 'sm' ? 'h-7.5 w-7.5' : 'h-6 w-6';
  return (
    <Button {...rest} variant={variant} size={size} aria-label={label} title={label} className={clsx(box, '!px-0', className)}>
      <Icon size={size === 'md' ? 16 : size === 'sm' ? 14 : 12} strokeWidth={2} />
    </Button>
  );
}

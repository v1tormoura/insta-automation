import { cn } from '../../lib/utils';

export function ShimmerButton({
  shimmerColor = 'rgba(0,212,255,.6)',
  shimmerSize = '0.05em',
  shimmerDuration = '2s',
  borderRadius = '9px',
  background = 'linear-gradient(135deg, #00aacc, #00d4ff)',
  className,
  children,
  ...props
}) {
  return (
    <button
      style={{
        '--shimmer-color': shimmerColor,
        '--shimmer-size': shimmerSize,
        '--shimmer-duration': shimmerDuration,
        '--border-radius': borderRadius,
        '--background': background,
      }}
      className={cn(
        'group relative z-0 flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap',
        'rounded-[var(--border-radius)] px-4 py-2 text-[13px] font-semibold text-[#040e1c]',
        '[background:var(--background)]',
        'transition-all duration-200 hover:scale-[1.01] hover:shadow-[0_0_28px_rgba(0,212,255,.45)] active:scale-[.98]',
        className
      )}
      {...props}
    >
      {/* shimmer overlay */}
      <div
        className={cn(
          'absolute inset-0 overflow-hidden rounded-[var(--border-radius)]',
          'before:absolute before:-inset-full before:animate-[shimmer_var(--shimmer-duration)_linear_infinite]',
          "before:content-[''] before:bg-[conic-gradient(from_0deg,transparent_0_340deg,var(--shimmer-color)_360deg)]",
          'before:[transform-origin:50%_50%]'
        )}
        style={{ '--shimmer-duration': shimmerDuration }}
      />
      <span className="relative z-10">{children}</span>
    </button>
  );
}

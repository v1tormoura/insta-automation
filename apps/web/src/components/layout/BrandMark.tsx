import { cn } from '@/lib/utils';

export function BrandMark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src="/brand/nexora-icon.png" alt="" className="size-7 rounded-lg" />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight">
          Nexora<span className="text-brand">.</span>
        </span>
      )}
    </div>
  );
}

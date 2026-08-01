import { cn } from '../../lib/utils';

export function Meteors({ number = 20, className }) {
  const meteors = Array.from({ length: number }, (_, i) => ({
    id: i,
    left: `${Math.floor(Math.random() * 100)}%`,
    delay: `${(Math.random() * 0.6 + 0.2).toFixed(2)}s`,
    duration: `${(Math.random() * 5 + 5).toFixed(2)}s`,
    size: `${Math.floor(Math.random() * 1 + 0.5)}px`,
    opacity: `${(Math.random() * 0.4 + 0.3).toFixed(2)}`,
  }));

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {meteors.map((m) => (
        <span
          key={m.id}
          className="absolute top-0 left-1/2 h-0.5 rotate-[215deg] animate-meteor-effect rounded-full bg-gradient-to-r from-[var(--cyan)] to-transparent shadow-[0_0_0_1px_rgba(0,212,255,.1)]"
          style={{
            left: m.left,
            width: `${Math.floor(Math.random() * 80 + 60)}px`,
            animationDelay: m.delay,
            animationDuration: m.duration,
            opacity: m.opacity,
          }}
        />
      ))}
    </div>
  );
}

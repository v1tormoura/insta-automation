import { useEffect, useRef } from 'react';
import { useInView, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '../../lib/utils';

export function NumberTicker({ value, direction = 'up', delay = 0, className, decimalPlaces = 0 }) {
  const ref = useRef(null);
  const motionValue = useMotionValue(direction === 'down' ? value : 0);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: '0px' });

  useEffect(() => {
    if (isInView) {
      setTimeout(() => {
        motionValue.set(direction === 'down' ? 0 : value);
      }, delay * 1000);
    }
  }, [motionValue, isInView, delay, value, direction]);

  useEffect(() => {
    const fmt = (v) =>
      Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(Number(v.toFixed(decimalPlaces)));

    // Render the starting value immediately (critical for value=0: spring never fires)
    if (ref.current) ref.current.textContent = fmt(springValue.get());

    return springValue.on('change', (latest) => {
      if (ref.current) ref.current.textContent = fmt(latest);
    });
  }, [springValue, decimalPlaces]);

  return (
    <span
      className={cn('inline-block tabular-nums tracking-tighter', className)}
      ref={ref}
    />
  );
}

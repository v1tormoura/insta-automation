import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

export function BlurFade({ children, delay = 0, duration = 0.4, yOffset = 6, inView = false, className }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const isVisible = !inView || isInView;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: yOffset, filter: 'blur(6px)' }}
      animate={isVisible ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
      transition={{ duration, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

import React from 'react';

/**
 * Animate a number from its previous display value to `target` using an
 * ease-out curve. Respects `prefers-reduced-motion` by jumping straight to the
 * target value. Values are clamped to integers to avoid sub-unit jitter.
 */
export const useCountUp = (target: number, duration = 500): number => {
  const [value, setValue] = React.useState(0);
  const fromRef = React.useRef(0);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      setValue(target);
      return undefined;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setValue(target);
      return undefined;
    }

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }

    const start = performance.now();
    const from = fromRef.current;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      if (progress >= 1) {
        // Land exactly on the target so non-integer values (e.g. USD costs)
        // keep their full precision in the final frame.
        setValue(target);
        rafRef.current = null;
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [duration, target]);

  // Keep the latest settled value as the next animation's starting point.
  React.useEffect(() => {
    fromRef.current = value;
  }, [value]);

  return value;
};

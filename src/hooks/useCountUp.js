// useCountUp — animate an integer counter from `previous` to `next`.
//
// Returns a `value` that tweens at ~60fps over `durationMs`. Designed
// for the bell badge so when a new alert arrives the counter
// gracefully rolls up (1 → 2 → 3…) instead of snapping. On mark-read
// it rolls back down (3 → 2 → 1 → 0 → fades out).
//
// Why not framer-motion: the bell already imports nothing animation-
// related and is performance-sensitive — it renders in the header
// on every page. A 30-line rAF-based hook is leaner than a 30kB
// dep.
//
// Why requestAnimationFrame: smooth, browser-paced, pauses when the
// tab is backgrounded. setInterval would keep running.
//
// Easing: ease-out-cubic for "incoming" (new alert — fast at first,
// settles) and ease-in-cubic for "outgoing" (mark-read — starts slow,
// accelerates) so the visual reads as a soft breath.

import { useEffect, useRef, useState } from 'react';

// easeOutCubic: f(0)=0, f(1)=1, derivative at 0 is 1.
// "Inhale" — fast arrival, gentle settle. Used when the count goes UP.
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// easeInCubic: f(0)=0, f(1)=1, derivative at 0 is 0.
// "Exhale" — slow start, accelerate. Used when the count goes DOWN.
function easeInCubic(t) {
  return t * t * t;
}

export function useCountUp(next, { durationMs = 420 } = {}) {
  const [value, setValue] = useState(next);
  const fromRef = useRef(next);
  const rafRef = useRef(0);

  useEffect(() => {
    // If next is unchanged, no animation needed. (React fires this
    // effect on first mount with from === next — we want the badge
    // to settle on its initial value, not animate from it.)
    if (next === value) return;

    const from = value;
    const to = next;
    fromRef.current = from;
    const start = performance.now();
    const direction = to >= from ? 'up' : 'down';
    const ease = direction === 'up' ? easeOutCubic : easeInCubic;

    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = ease(t);
      const current = Math.round(from + (to - from) * eased);
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Snap to exact target to avoid floating-point drift
        // (e.g. round(0.999 * 100) = 100, but round(0.99 * 100) = 99).
        setValue(to);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // value intentionally not in deps: we want to react to `next`
    // changes, not to our own intermediate setState calls. Including
    // `value` would cause the effect to re-run every animation
    // frame, which would re-cancel + re-create the rAF and freeze
    // the counter at frame 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, durationMs]);

  return value;
}
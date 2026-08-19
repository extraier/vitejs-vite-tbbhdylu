/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        // 2026-08-17 — Manus step 17: bell badge arrival animation.
        // Fires each time a new alert arrives (the bell bumps a
        // `pulseKey` React state on count-up which re-mounts the
        // <span> via React `key={pulseKey}` — Tailwind replays the
        // animation on each remount).
        //
        // Keyframe shape (smoother, longer, lower peak — the
        // 2026-08-17 v1 had a 1.55 peak that was jarring for users
        // with high-frequency arrivals; v2 settles on 1.35 over
        // 750ms with a 4-stop bezier that has a gentle landing):
        //   0%   scale 1      start
        //   30%  scale 1.35   brief pop (~225ms at 750ms total)
        //   55%  scale 0.96   tiny undershoot — gives the badge
        //                     a "spring" feel rather than a flat pop
        //   80%  scale 1.02   one more small overshoot
        //   100% scale 1      settle
        // Easing: cubic-bezier(0.25, 0.1, 0.25, 1.3) — material
        // design "decelerate" with a soft overshoot. The full
        // animation runs in ~750ms which is short enough to not
        // delay subsequent alerts but long enough to read at a
        // glance.
        keyframes: {
          'bell-pulse': {
            '0%':   { transform: 'scale(1)' },
            '30%':  { transform: 'scale(1.35)' },
            '55%':  { transform: 'scale(0.96)' },
            '80%':  { transform: 'scale(1.02)' },
            '100%': { transform: 'scale(1)' },
          },
        },
        animation: {
          'bell-pulse': 'bell-pulse 0.75s cubic-bezier(0.25, 0.1, 0.25, 1.3)',
        },
      },
    },
    plugins: [],
  };
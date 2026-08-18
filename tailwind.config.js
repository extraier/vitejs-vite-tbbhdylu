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
        // Keyframe shape:
        //   0%   scale 1      start
        //   35%  scale 1.55   brief pop (~210ms at 600ms total)
        //   70%  scale 0.95   tiny undershoot — gives the badge
        //                     a "spring" feel rather than a flat pop
        //   100% scale 1      settle
        // Easing: cubic-bezier with overshoot so it doesn't look
        // mechanical. The full animation runs in ~600ms which is
        // short enough to not delay subsequent alerts but long
        // enough to read at a glance.
        keyframes: {
          'bell-pulse': {
            '0%':   { transform: 'scale(1)' },
            '35%':  { transform: 'scale(1.55)' },
            '70%':  { transform: 'scale(0.95)' },
            '100%': { transform: 'scale(1)' },
          },
        },
        animation: {
          'bell-pulse': 'bell-pulse 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        },
      },
    },
    plugins: [],
  }
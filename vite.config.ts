// 2026-09-20 — Bundle analyzer wired into the build pipeline.
//
// rollup-plugin-visualizer is gated by an env var so it
// only emits the analysis HTML when explicitly requested:
//   npm run build:analyze
//
// (defined below as a script in package.json). The plugin
// doesn't run on `npm run build` — zero overhead on
// the production build path.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

const shouldAnalyze = process.env.ANALYZE === '1'

export default defineConfig({
  plugins: [
    react(),
    shouldAnalyze && visualizer({
      // Treemap shows chunks by size; treemap-style is the
      // rollup default and the most readable for our case
      // (one big index chunk + a handful of lazy chunks).
      filename: 'dist/bundle-report.html',
      template: 'treemap',
      // gzipSize + brotliSize lets us see the real on-the-
      // wire cost, not just the raw bytes. gzip is what
      // Vercel serves today.
      gzipSize: true,
      brotliSize: true,
      // Drop the report into dist/ so it's served by the
      // same Vercel preview deployment when needed.
      projectRoot: process.cwd(),
      title: 'vitejs-vite-tbbhdylu bundle analysis',
    }),
  ].filter(Boolean),
  optimizeDeps: {
    // This stops the bundler from crashing when loading our icons
    include: ['lucide-react']
  }
})

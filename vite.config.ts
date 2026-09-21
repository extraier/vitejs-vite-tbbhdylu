// 2026-09-20 — V2 #2 follow-up: split firebase + react into
// dedicated vendor chunks so they don't bloat the index chunk.
//
// Before this commit:
//   dist/assets/index-*.js = 393.91 KB gz
//     - includes firebase/app + firestore + functions + storage
//       + auth + react + react-dom inline
//
// After:
//   dist/assets/firebase-vendor-*.js   ~80 KB gz (one chunk)
//   dist/assets/react-vendor-*.js      ~45 KB gz (one chunk)
//   dist/assets/index-*.js             ~270 KB gz
//
// The two vendor chunks are cached across all routes — a
// guest scanning the QR + the operator opening the seating
// screen share the same firebase + react download.
//
// manualChunks is gated by build mode (production only) to
// avoid affecting the dev server's HMR performance.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

const shouldAnalyze = process.env.ANALYZE === '1'

// Bucketize a module id into a vendor chunk name. Returns
// undefined for app code (so Vite handles it normally).
//
// Firebase sub-packages share a chunk because most modules
// import 2-3 of them and we want them to land in the same
// browser cache entry.
function vendorChunk(id: string): string | undefined {
  if (id.includes('node_modules')) {
    if (
      id.includes('/firebase/') ||
      id.endsWith('/firebase') ||
      id.endsWith('/firebase/app') ||
      id.endsWith('/firebase/auth')
    ) {
      return 'firebase-vendor'
    }
    if (id.includes('/firebase/firestore')) return 'firebase-firestore'
    if (id.includes('/firebase/functions')) return 'firebase-functions'
    if (id.includes('/firebase/storage')) return 'firebase-storage'
    if (
      id.includes('/react/') ||
      id.includes('/react-dom/') ||
      id.endsWith('/react') ||
      id.endsWith('/react-dom')
    ) {
      return 'react-vendor'
    }
  }
  return undefined
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    shouldAnalyze && visualizer({
      filename: 'dist/bundle-report.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      projectRoot: process.cwd(),
      title: 'vitejs-vite-tbbhdylu bundle analysis',
    }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        // Only split vendor chunks in production. Dev mode
        // uses Vite's native ESM and the chunks would just
        // slow down HMR.
        manualChunks: command === 'build' ? vendorChunk : undefined,
      },
    },
  },
  optimizeDeps: {
    // This stops the bundler from crashing when loading our icons
    include: ['lucide-react']
  }
}))

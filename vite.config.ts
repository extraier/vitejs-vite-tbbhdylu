// 2026-09-20 — V2 #2 follow-up #4: deep-import plugin for
// lucide-react. See ./vite-plugins/lucideDeepImports.js for
// the rationale and edge-case handling.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { lucideDeepImportsPlugin } from './vite-plugins/lucideDeepImports.js'

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
    // lucideDeepImportsPlugin MUST run before @vitejs/plugin-react
    // so the rewritten imports land as plain ES module imports
    // (not JSX-rewritten JSX nodes).
    lucideDeepImportsPlugin(),
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
    // 2026-09-20 — removed 'lucide-react' from this list.
    // The lucideDeepImportsPlugin rewrites every barrel
    // import to per-icon deep imports, so the barrel is
    // never actually requested. Pre-bundling it now would
    // be wasted work (and would actually be counter-
    // productive: Vite would pull the whole 4,538-icon
    // barrel into the dep cache, defeating the rewrite).
    include: [],
  }
}))

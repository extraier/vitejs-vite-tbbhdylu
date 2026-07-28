import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Hermes 2026-06-25: use `define:` (not vi.stubEnv) so the env vars are baked
// in at transform time. The module reads import.meta.env at import — which
// happens before beforeEach — so stubbing at runtime is too late.
//
// 2026-07-27 — REMOVED `VITE_NAS_UPLOAD_SECRET` from the define block.
// The HMAC secret is no longer bundled into the client; the Vercel
// /api/photo-upload proxy reads it from its own process.env at
// runtime. Tests that previously asserted the secret was available
// now assert the opposite (the client must NOT send auth headers —
// see uploadToNas.test.js).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // The functions/ sub-project has its own vitest suite
    // (run via `cd functions && npm test`). Exclude it from the
    // top-level run so its test file imports (which use
    // `import.meta.url` and `@firebase/rules-unit-testing` requiring
    // a JRE) don't break the front-end build's test command.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'functions/test/**',
    ],
  },
  define: {
    // Replace import.meta.env.* literals at build/transform time. Vitest treats
    // these as plain strings, so Vite's import.meta.env.{NAME} resolves to the
    // constant. Production uses real env via Vite's normal loadEnv pipeline.
    'import.meta.env.VITE_NAS_UPLOAD_URL': JSON.stringify(
      'http://localhost:9879/upload',
    ),
  },
});
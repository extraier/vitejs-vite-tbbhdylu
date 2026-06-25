import { defineConfig } from 'vitest/config';

// Hermes 2026-06-25: use `define:` (not vi.stubEnv) so the env vars are baked
// in at transform time. The module reads import.meta.env at import — which
// happens before beforeEach — so stubbing at runtime is too late.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  define: {
    // Replace import.meta.env.* literals at build/transform time. Vitest treats
    // these as plain strings, so Vite's import.meta.env.{NAME} resolves to the
    // constant. Production uses real env via Vite's normal loadEnv pipeline.
    'import.meta.env.VITE_NAS_UPLOAD_URL': JSON.stringify(
      'http://localhost:9879/upload',
    ),
    'import.meta.env.VITE_NAS_UPLOAD_SECRET': JSON.stringify(
      'test-secret-32-bytes-long-xxxxx',
    ),
  },
});
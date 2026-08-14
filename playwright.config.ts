import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for savetheday.io.
 *
 * 2026-08-14 — first version. Two test directories:
 *   - tests/e2e/  — true end-to-end (no API mocking, real browser)
 *   - tests/api/  — pure HTTP tests (no browser needed, fast)
 *
 * We keep API tests in a separate dir so they don't need to
 * boot a browser. Most of the M-06 / csp-report work is API-shaped
 * so the API dir is where the first smoke lives.
 *
 * Why a config file in TypeScript:
 * The project uses Vite + React in TypeScript-adjacent style;
 * having the test config in TS keeps the dev story consistent.
 * We don't need to compile — Playwright bundles its own tsc.
 */
export default defineConfig({
  testDir: './tests',
  // Don't run API tests as part of `npm test` (vitest there).
  // We run them via `npx playwright test` only.
  testMatch: ['**/*.e2e.test.*', '**/*.api.test.*'],
  // E2E tests are slow; we let them run sequentially by default.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://savetheday.io',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // We don't auto-start a webServer because all tests hit the
  // deployed Vercel instance. CI runs against a staging URL via
  // PLAYWRIGHT_BASE_URL; local dev runs against prod.
});

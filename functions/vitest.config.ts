import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Don't walk up to the app's postcss.config.js. Functions tests
  // don't use Tailwind, and loading that config fails unless the
  // frontend devDependencies are installed.
  css: { postcss: { plugins: [] } },
  test: {
    // Long timeout because the Firestore rules emulator has a multi-second
    // startup cost (spawns the JVM).
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Force the gRPC keep-alive so the rules-unit-testing harness doesn't
    // hit "Channel closed" on the long-running emulator connection.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

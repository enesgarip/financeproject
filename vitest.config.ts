import { defineConfig } from 'vitest/config'

// Unit tests (pure finance/util logic) live next to their source as
// `src/**/*.test.ts`. Playwright e2e specs under `tests/e2e/*.spec.ts` are
// intentionally excluded so the two runners never pick up each other's files.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Coverage tracks the pure domain core (`src/utils`) — the money/ledger/
      // projection layer the whole trust journey is built on. UI (pages/
      // components) is exercised by Playwright, not unit-covered, so including
      // it here would only produce a misleading, unmovable percentage.
      include: ['src/utils/**'],
      reporter: ['text-summary', 'html'],
      // Thresholds sit a small margin below current coverage: a genuine
      // regression (new untested branch/function in the core) fails CI, but
      // adding one helper without a test does not immediately break the build.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 87,
      },
    },
  },
})

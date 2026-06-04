import { defineConfig } from 'vitest/config'

// Unit tests (pure finance/util logic) live next to their source as
// `src/**/*.test.ts`. Playwright e2e specs under `tests/e2e/*.spec.ts` are
// intentionally excluded so the two runners never pick up each other's files.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})

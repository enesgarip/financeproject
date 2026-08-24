import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests (pure finance/util logic) live next to their source as
// `src/**/*.test.ts`. Component a11y tests use `.test.tsx` and opt into a DOM
// environment per-file via a `// @vitest-environment happy-dom` pragma; the
// default stays `node` so pure util tests keep their fast, DOM-free runtime.
// Playwright e2e specs under `tests/e2e/*.spec.ts` are intentionally excluded
// so the two runners never pick up each other's files.
export default defineConfig({
  resolve: {
    // vite.config.ts ile aynı `@` alias'ı: bileşen testleri (`.test.tsx`)
    // `@/utils/...` importlu kaynakları çekebilsin diye burada da tanımlı.
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Varsayılan 'forks' her test dosyası için child process açar (~110 dosya ×
    // spawn maliyeti). Testler saf util + pragma'lı happy-dom; paylaşılan
    // global state / setupFiles yok, worker thread'de güvenle koşarlar.
    pool: 'threads',
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

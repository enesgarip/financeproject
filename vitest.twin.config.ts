import path from 'node:path'
import { defineConfig } from 'vitest/config'

// SQL↔TS ikiz harness'inin AYRI vitest config'i (muh. turu ④). Harness node
// API'leri (child_process/process) kullanır; src ağacında yaşasaydı node
// tipleri app tsconfig'ine sızacaktı (denendi: setTimeout → NodeJS.Timeout
// hatası). tests/twin altında yaşar, tipini tsconfig.e2e.json verir, koşumu
// `npm run db:test:twins` (scripts/verify-twin-equivalence.mjs) yapar —
// normal test:unit include'una bilinçli girmez (docker ister).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    include: ['tests/twin/**/*.test.ts'],
    environment: 'node',
  },
})

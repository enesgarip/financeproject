// SQL↔TS ikiz diferansiyel harness başlatıcısı (mühendislik turu ④).
// Asıl mantık src/utils/twinEquivalence.test.ts'te (TWIN_DB=1 kapılı vitest —
// TS çözümleme/import zinciri vitest'ten bedavaya gelir; Node'un type-stripping'i
// uzantısız importları çözemediği için doğrudan .ts import edilemiyordu).
// Önkoşul: yerel Supabase ayakta + migration'lar + seed. TWIN_SEED ile tekrar
// üretilebilir koşu. Cross-platform env için bu sarmalayıcı var (Windows npm
// script'inde TWIN_DB=1 öneki çalışmaz).
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.twin.config.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, TWIN_DB: '1' },
})
process.exit(result.status ?? 1)

#!/usr/bin/env node
/**
 * supabase/tests altındaki TÜM .sql testlerini sırayla koşar (zero-dependency).
 * S4 sistemik düzeltme (denetim 2026-08-12): daha önce her test dosyası CI'a ve
 * package.json'a TEK TEK bağlanıyordu; yeni dosya eklemek adım eklemeyi unutunca
 * test sessizce koşmuyordu. Artık kanonik mekanizma bu döngü: `supabase/tests/`e
 * düşen her .sql otomatik kapsanır.
 *
 * Kullanım: `npm run db:test:all` (yerel Supabase docker ayakta olmalı;
 * gerekirse önce `npm run db:seed:local`). Windows'ta da çalışır — bash döngüsü
 * yerine node child_process kullanılır, her dosya psql stdin'ine verilir.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const TESTS_DIR = path.resolve('supabase/tests')
const CONTAINER = 'supabase_db_financeproject'
const PSQL_ARGS = [
  'exec', '-i', CONTAINER,
  'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-',
]

let files
try {
  files = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
} catch {
  console.error(`✗ ${TESTS_DIR} bulunamadı — depo kökünden çalıştır.`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`✗ ${TESTS_DIR} altında .sql testi yok — bu beklenmiyor, dizin mi taşındı?`)
  process.exit(1)
}

console.log(`supabase/tests: ${files.length} SQL testi koşuluyor (${CONTAINER})\n`)

const failures = []
for (const file of files) {
  const sql = readFileSync(path.join(TESTS_DIR, file))
  process.stdout.write(`── ${file} … `)
  const result = spawnSync('docker', PSQL_ARGS, { input: sql, encoding: 'utf8' })

  if (result.error) {
    console.error(`✗\n  docker çalıştırılamadı: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status === 0) {
    // psql NOTICE'ları (GECTI: ...) stderr'e düşer; özet için ayıkla.
    const notices = `${result.stderr}`
      .split(/\r?\n/)
      .filter((line) => line.includes('NOTICE'))
      .map((line) => line.replace(/^.*NOTICE:\s*/, '   · '))
    console.log('✓')
    for (const notice of notices) console.log(notice)
  } else {
    console.log('✗')
    console.error(result.stdout)
    console.error(result.stderr)
    failures.push(file)
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} test başarısız:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(`\n✓ ${files.length}/${files.length} SQL testi geçti.`)

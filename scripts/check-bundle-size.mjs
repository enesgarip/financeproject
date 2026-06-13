#!/usr/bin/env node
/**
 * Bundle bütçesi guard'ı (zero-dependency). `npm run build` sonrası çalışır:
 * dist/assets/*.js dosyalarını gzip'leyip mantıksal chunk'lara (hash'siz ad)
 * gruplar, isimli bütçeler + toplam JS gzip bütçesiyle karşılaştırır, aşımda
 * çıkış kodu 1 verir (CI'ı kırar).
 *
 * Neden toplam + birkaç ağır chunk, sayfa-bazlı değil: page chunk'ları kod
 * taşındıkça yer değiştirir; sabit olan vendor/entry chunk'ları + toplam,
 * gerçek "bundle şişti" regresyonunu kırılgan olmadan yakalar. Bütçeler mevcut
 * boyutun ~%10 üstünde — yavaş büyümeye izin var, sıçrama kırmızı.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const ASSETS_DIR = path.resolve('dist/assets')

// gzip kB cinsinden bütçeler. Yeni bir vendor/entry chunk ağırlaşırsa buraya ekle.
const BUDGETS = {
  'index.js': 150,
  'pdf.js': 138,
  'vendor-recharts.js': 122,
  'vendor-motion.js': 45,
}
const TOTAL_BUDGET_KB = 660

const KB = 1024

function stripHash(file) {
  // vite çıktısı: `<ad>-<8karakterhash>.js` → `<ad>.js`
  return file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js')
}

let files
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))
} catch {
  console.error(`✗ ${ASSETS_DIR} bulunamadı — önce \`npm run build\` çalıştır.`)
  process.exit(1)
}

const groups = new Map()
let totalGz = 0
for (const file of files) {
  const gz = gzipSync(readFileSync(path.join(ASSETS_DIR, file))).length
  totalGz += gz
  const key = stripHash(file)
  groups.set(key, (groups.get(key) ?? 0) + gz)
}

const failures = []
const rows = [...groups.entries()].sort((a, b) => b[1] - a[1])

console.log('Bundle gzip boyutları (chunk → kB / bütçe):')
for (const [name, bytes] of rows) {
  const kb = bytes / KB
  const budget = BUDGETS[name]
  const tag = budget == null ? '' : kb > budget ? `  ✗ > ${budget} kB` : `  ✓ ≤ ${budget} kB`
  if (budget != null && kb > budget) failures.push(`${name}: ${kb.toFixed(1)} kB > ${budget} kB`)
  console.log(`  ${kb.toFixed(1).padStart(8)} kB  ${name}${tag}`)
}

const totalKb = totalGz / KB
console.log(`  ${'—'.repeat(8)}`)
const totalTag = totalKb > TOTAL_BUDGET_KB ? `  ✗ > ${TOTAL_BUDGET_KB} kB` : `  ✓ ≤ ${TOTAL_BUDGET_KB} kB`
console.log(`  ${totalKb.toFixed(1).padStart(8)} kB  TOPLAM JS gzip${totalTag}`)
if (totalKb > TOTAL_BUDGET_KB) failures.push(`Toplam: ${totalKb.toFixed(1)} kB > ${TOTAL_BUDGET_KB} kB`)

if (failures.length > 0) {
  console.error('\n✗ Bundle bütçesi aşıldı:')
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\nGerçek bir artışsa bütçeyi scripts/check-bundle-size.mjs içinde güncelle.')
  process.exit(1)
}

console.log('\n✓ Bundle bütçesi içinde.')

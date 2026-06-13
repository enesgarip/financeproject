#!/usr/bin/env node
/**
 * Yerel geliştirme tek komut: `npm run dev:local`
 *
 * 1. Yerel Supabase'i başlatır (zaten açıksa atlanır).
 * 2. `supabase status` çıktısından API URL + anon key okur.
 * 3. Vite'ı bu değerlerle çalıştırır.
 *
 * Üretim `.env.local` dosyasına DOKUNMAZ: değerler yalnız spawn edilen Vite
 * sürecinin ortam değişkenlerine geçer. Vite, `VITE_` önekli process.env
 * değişkenlerini import.meta.env'e dahil eder (ci.yml build adımı da aynı
 * mekanizmaya dayanır). Bu yüzden ortada gitignore'lu env dosyası kalmaz.
 *
 * Durdurmak için: `npm run dev:local:stop` (Supabase docker'ı kapatır).
 */
import { spawnSync, spawn } from 'node:child_process'

const isWin = process.platform === 'win32'

function sb(args, opts = {}) {
  return spawnSync('supabase', args, { stdio: 'inherit', shell: isWin, ...opts })
}

console.log('› Yerel Supabase başlatılıyor (zaten açıksa atlanır)...')
sb(['start'])

console.log('› Supabase bağlantı bilgileri okunuyor...')
const status = spawnSync('supabase', ['status', '-o', 'env'], {
  encoding: 'utf8',
  shell: isWin,
})
if (status.status !== 0) {
  console.error('✗ supabase status okunamadı. Docker çalışıyor mu?')
  process.exit(1)
}

const env = {}
for (const line of status.stdout.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
  if (m) env[m[1]] = m[2]
}

const url = env.API_URL
const anonKey = env.ANON_KEY
if (!url || !anonKey) {
  console.error('✗ API_URL / ANON_KEY bulunamadı (supabase status çıktısı beklenmedik).')
  process.exit(1)
}

console.log(`› Vite yerel Supabase'e bağlanıyor: ${url}`)
console.log('  (Giriş için kullanıcı: `npm run db:seed:local` → t@t.com / password123)\n')

const vite = spawn('vite', [], {
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey },
})
vite.on('exit', (code) => process.exit(code ?? 0))

// README ekran görüntüsü çekimi (tek seferlik operasyon aracı; test koşusu DEĞİL).
// Akış: npm run db:seed:local -> npm run dev:local (5173) -> node scripts/capture-screenshots.mjs
// Yalnız SEED demo verisiyle çek — gerçek üretim verisi kamuya açık repoya girmesin.
// Boyut/DPR mevcut PNG'lerle devamlılık için 1320x900 @2x (2640x1800).
import { chromium } from 'playwright'
import { statSync } from 'node:fs'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const SCALE = Number(process.env.SCALE ?? 2)
const SHOTS = [
  { path: '/', file: 'docs/screenshots/dashboard.png' },
  { path: '/kartlar', file: 'docs/screenshots/accounts.png' },
  { path: '/borclar/krediler', file: 'docs/screenshots/loans.png' },
  { path: '/odemeler', file: 'docs/screenshots/payments.png' },
  { path: '/analiz', file: 'docs/screenshots/analysis.png' },
  { path: '/analiz/asistan', file: 'docs/screenshots/assistant.png' },
  { path: '/odemeler/alsam-mi', file: 'docs/screenshots/decision.png' },
]

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1320, height: 900 },
  deviceScaleFactor: SCALE,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'tr-TR',
  timezoneId: 'Europe/Istanbul',
})
const page = await context.newPage()

console.log(`Giriş: ${BASE_URL}/login (t@t.com)`)
await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 't@t.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })

for (const shot of SHOTS) {
  await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'networkidle' })
  // Snapshot sorguları + font yerleşimi için kısa oturma payı.
  await page.waitForTimeout(1200)
  await page.screenshot({ path: shot.file, animations: 'disabled' })
  const kb = Math.round(statSync(shot.file).size / 1024)
  const flag = kb > 800 ? '  <-- 800 KB üstü, SCALE=1.5 ile yeniden çekmeyi düşün' : ''
  console.log(`${shot.file}  ${kb} KB${flag}`)
}

await browser.close()
console.log('Bitti.')

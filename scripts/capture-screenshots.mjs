// README ekran görüntüsü çekimi (tek seferlik operasyon aracı; test koşusu DEĞİL).
// Akış: npm run db:seed:local -> npm run dev:local (5173) -> node scripts/capture-screenshots.mjs
// Yalnız SEED demo verisiyle çek — gerçek üretim verisi kamuya açık repoya girmesin.
// Boyut/DPR mevcut PNG'lerle devamlılık için 1320x900 @2x (2640x1800).
import { chromium } from 'playwright'
import { statSync } from 'node:fs'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
const base = new URL(BASE_URL)
if (base.protocol !== 'http:' || !localHosts.has(base.hostname)) {
  throw new Error('README çekimi yalnız yerel demo sunucusunda yapılabilir.')
}
const SCALE = Number(process.env.SCALE ?? 2)
const SHOTS = [
  { path: '/', file: 'docs/screenshots/dashboard.png' },
  { path: '/kartlar', file: 'docs/screenshots/accounts.png' },
  { path: '/borclar/krediler', file: 'docs/screenshots/loans.png' },
  { path: '/odemeler', file: 'docs/screenshots/payments.png' },
  { path: '/analiz', file: 'docs/screenshots/analysis.png' },
  { path: '/analiz/asistan', file: 'docs/screenshots/assistant.png' },
  { path: '/odemeler/alsam-mi', file: 'docs/screenshots/decision.png' },
  { path: '/login', file: 'docs/screenshots/login.png', public: true },
  { path: '/', file: 'docs/screenshots/dashboard-mobile.png', mobile: true },
  { path: '/', file: 'docs/screenshots/dashboard-dark.png', dark: true },
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
// Yerel Vite yanlışlıkla production env ile açılmışsa veri isteğini engelle.
// Kur/AI/analytics gibi dış servisler de README çekiminin parçası değildir.
await context.route('**/*', (route) => {
  const url = new URL(route.request().url())
  return localHosts.has(url.hostname) ? route.continue() : route.abort()
})

// Giriş ekranını authenticated yönlendirmeden önce çek.
await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
await page.screenshot({ path: SHOTS.find((shot) => shot.public).file, animations: 'disabled' })

console.log(`Giriş: ${BASE_URL}/login (t@t.com)`)
await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 't@t.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })

for (const shot of SHOTS) {
  if (shot.public) continue
  await page.setViewportSize(shot.mobile ? { width: 390, height: 844 } : { width: 1320, height: 900 })
  await page.emulateMedia({ colorScheme: shot.dark ? 'dark' : 'light' })
  await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'networkidle' })
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error(`${shot.path}: demo oturumu yok`)
  // Snapshot sorguları + font yerleşimi için kısa oturma payı.
  await page.waitForTimeout(1200)
  await page.screenshot({ path: shot.file, animations: 'disabled' })
  const kb = Math.round(statSync(shot.file).size / 1024)
  const flag = kb > 800 ? '  <-- 800 KB üstü, SCALE=1.5 ile yeniden çekmeyi düşün' : ''
  console.log(`${shot.file}  ${kb} KB${flag}`)
}

await browser.close()
console.log('Bitti.')

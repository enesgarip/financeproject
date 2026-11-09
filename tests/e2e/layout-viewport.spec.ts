import { expect, test } from '@playwright/test'
import { mockApp } from './audit-fixtures'

// Kabuk başlığı içerikten önce görünür. Her rota için gerçek paneli bekle.
const groups = {
  'özet ve borçlar': [
    ['/', 'Ay sonuna kalan'],
    ['/kartlar', 'Örnek hesap'],
    ['/borclar/krediler', 'Henüz kredi yok'],
    ['/borclar/kisiler', 'Henüz kişi kaydı yok'],
  ],
  varlıklar: [
    ['/varliklar', 'Toplam varlık'],
    ['/varliklar/maas', 'Örnek maaş'],
    ['/varliklar/altin', 'Henüz altın işlemi yok'],
    ['/varliklar/borsa', 'İşlem geçmişi'],
    ['/varliklar/araclar', 'TEST'],
  ],
  planlama: [
    ['/odemeler', 'Kalan ödemeler'],
    ['/odemeler/hedefler', 'Örnek hedef'],
    ['/odemeler/alsam-mi', 'Bunu alsam ne olur?'],
    ['/odemeler/liste', 'Bekleyen ürün'],
    ['/odemeler/baglamlar', 'Henüz gider yok.'],
  ],
  'analiz ve veri sağlığı': [
    ['/analiz', 'Beklenen gelir'],
    ['/analiz/detay', 'Aktivite akışı'],
    ['/analiz/asistan', 'Bu ayı değerlendir'],
    ['/veri-sagligi', 'Türetilmiş alan tutarlılığı'],
    ['/veri-sagligi/islemler', 'JSON yedek'],
  ],
} as const

const screenshots = new Map([
  ['/', 'home'],
  ['/varliklar/araclar', 'varliklar-araclar'],
  ['/odemeler/hedefler', 'odemeler-hedefler'],
  ['/analiz', 'analiz'],
  ['/veri-sagligi/islemler', 'maintenance'],
])

for (const [group, routes] of Object.entries(groups)) {
  for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1280, 'light']] as const) {
    test(`${group} taşmadan açılır: ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockApp(page, theme)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))

      for (const [path, readyText] of routes) {
        await test.step(path, async () => {
          await page.goto(path, { waitUntil: 'domcontentloaded' })
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
          const main = page.locator('main')
          await expect(main.getByText(readyText, { exact: true }).first()).toBeVisible()
          await expect(main).not.toContainText('Bir şeyler ters gitti')
          await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
          await page.evaluate(async () => { await document.fonts.ready })
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)

          const screenshot = screenshots.get(path)
          if (screenshot) await page.screenshot({ path: `test-results/simplification-${screenshot}-${width}.png`, fullPage: true })
        })
      }

      expect(errors).toEqual([])
    })
  }
}

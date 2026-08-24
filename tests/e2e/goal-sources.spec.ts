import { expect, test } from '@playwright/test'

/**
 * Hedefi varlığa bağlama akışının canlı (yerel Supabase) doğrulaması.
 *
 * Varsayılan CI smoke'unda ATLANIR (orada Supabase URL'i sahtedir). Yerelde:
 *   1. npm run db:seed:local
 *   2. PLAYWRIGHT_BASE_URL=http://localhost:5173 E2E_LIVE_SUPABASE=1 \
 *      npx playwright test goal-sources --reporter=line
 *
 * Kanıtladığı şey: kaynak seçilince "Biriken miktar" alanı kaybolur, kart
 * "Varlıklardan" rozetiyle ve elle girilmeyen bir tutarla görünür.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === '1'
const EMAIL = process.env.E2E_EMAIL ?? 't@t.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'password123'

test.describe('birikim hedefi takip kaynağı (live backend)', () => {
  test.skip(!LIVE, 'set E2E_LIVE_SUPABASE=1 with a local Supabase + seeded user')

  test('hedef varlık kategorisine bağlanınca tutar türetilir', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/$/)

    await page.goto('/odemeler/hedefler')

    await page.getByRole('button', { name: 'Ekle', exact: true }).first().click()

    const modal = page.locator('form').filter({ hasText: 'Hedef adı' })
    await modal.getByLabel('Hedef adı').fill('Borsa E2E')
    await modal.getByLabel('Hedef miktar').fill('1000000')

    // Kaynak seçilmeden önce elle giriş alanı durur.
    await expect(modal.getByLabel('Biriken miktar')).toBeVisible()

    await modal.getByLabel('Takip kaynağı ekle').selectOption({ label: 'Hisse (tümü)' })

    // Kaynak bağlandı: elle giriş kalktı, türetilen değer gösteriliyor.
    await expect(modal.getByLabel('Biriken miktar')).toHaveCount(0)
    await expect(modal.getByText('Şu anki değer:')).toBeVisible()

    await modal.getByRole('button', { name: 'Kaydet' }).click()

    const card = page.locator('article, div').filter({ hasText: 'Borsa E2E' }).last()
    await expect(card.getByText('Varlıklardan')).toBeVisible({ timeout: 10_000 })
  })
})

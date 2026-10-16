import { expect, test } from '@playwright/test'

/**
 * End-to-end money-mutation flow against a REAL backend (local Supabase).
 *
 * Skipped in the default CI smoke run (which points at a dummy Supabase URL).
 * To run locally:
 *   1. npx supabase start  (and db reset if needed)
 *   2. npm run db:seed:local (test kendi sıfır borçlu kartını oluşturur).
 *   3. E2E_LIVE_SUPABASE=1 VITE_SUPABASE_URL=http://127.0.0.1:55321 \
 *      VITE_SUPABASE_ANON_KEY=<publishable> \
 *      npx playwright test money-mutation
 *
 * It logs in, adds a cash expense to a credit card, and asserts the debt rose
 * by the entered amount and that the change shows up in the card's ledger
 * drill-down — exercising add_card_expense → debt_amount → card_ledger trigger
 * → "Borç hareketleri" (A2 + D9) in one real pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === '1'
const EMAIL = process.env.E2E_EMAIL ?? 't@t.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'password123'
const AMOUNT = 500

test.describe('money mutation (live backend)', () => {
  test.skip(!LIVE, 'set E2E_LIVE_SUPABASE=1 with a local Supabase + seeded user/card')

  test('adding a card expense raises debt and lands in the ledger', async ({ page }) => {
    // Hesap seçimi formda hatırlanır; gezinme korumasının yerel onayını kabul et.
    page.on('dialog', dialog => dialog.accept())
    const CARD_NAME = `Axess E2E ${Date.now()}`
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/$/)

    await page.goto('/kartlar')
    await page.getByRole('button', { name: /Kredi kartları/ }).click()
    await page.getByRole('button', { name: 'Kredi kartı ekle', exact: true }).click()
    const create = page.getByRole('dialog')
    await create.getByLabel(/^Banka/).fill('Akbank')
    await create.getByLabel(/^Ad\s*\*?$/).fill(CARD_NAME)
    await create.getByRole('button', { name: 'Kaydet', exact: true }).click()
    await expect(create).toHaveCount(0)
    await page.getByRole('button', { name: `${CARD_NAME} kart ayrıntıları`, exact: true }).click()
    const card = page.locator('article').filter({ hasText: CARD_NAME })
    await page.getByRole('button', { name: 'İşlem', exact: true }).click()
    await page.getByRole('link', { name: /Harcama ekle/ }).click()

    // Quick-expense form lives under the "Hızlı harcama" heading.
    const form = page.locator('form').filter({ has: page.getByPlaceholder('Migros, benzin, yemek...') })
    await expect(form).toBeVisible()

    await form.locator('select').first().selectOption({ label: `Akbank · ${CARD_NAME}` })
    await form.getByPlaceholder('Migros, benzin, yemek...').fill('E2E Market')
    await form.getByLabel('Tutar (TL)', { exact: true }).fill(String(AMOUNT))
    await form.getByRole('button', { name: 'Harcamayı kaydet' }).click()
    // Submit clears the description field on success.
    await expect(form.getByPlaceholder('Migros, benzin, yemek...')).toHaveValue('', { timeout: 10_000 })

    // SPA dönüşü aynı cache'i kullanır; yazma invalidation'ı güncel borcu getirmeli.
    const shell = await page.locator('aside').elementHandle()
    await page.getByRole('region', { name: 'Harcama girişi' }).getByRole('button', { name: 'Kapat', exact: true }).click()
    await page.locator('aside').getByRole('link', { name: 'Plan', exact: true }).click()
    await page.locator('aside').getByRole('link', { name: 'Hesaplar', exact: true }).click()
    expect(await shell!.evaluate(element => element.isConnected)).toBe(true)
    await page.getByRole('button', { name: /Kredi kartları/ }).click()
    await page.getByRole('button', { name: `${CARD_NAME} kart ayrıntıları`, exact: true }).click()
    await expect(card.getByText('Toplam kart yükü')).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('500,00 ₺')

    // Kayıt geçmişinde aynı artışın ledger olayı da görünmeli.
    await card.locator('summary').filter({ hasText: 'Kart ayarları ve kayıt geçmişi' }).click()
    await expect(card.getByText('Borç hareketleri')).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText('Borç arttı').first()).toBeVisible({ timeout: 10_000 })
  })
})

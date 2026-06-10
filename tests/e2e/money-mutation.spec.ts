import { expect, test } from '@playwright/test'

/**
 * End-to-end money-mutation flow against a REAL backend (local Supabase).
 *
 * Skipped in the default CI smoke run (which points at a dummy Supabase URL).
 * To run locally:
 *   1. npx supabase start  (and db reset if needed)
 *   2. seed a confirmed user + a credit card named "Axess E2E", e.g. via psql
 *      (see tests/e2e/README or the session notes).
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
const CARD_NAME = 'Axess E2E'
const AMOUNT = 500

test.describe('money mutation (live backend)', () => {
  test.skip(!LIVE, 'set E2E_LIVE_SUPABASE=1 with a local Supabase + seeded user/card')

  test('adding a card expense raises debt and lands in the ledger', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/$/)

    await page.goto('/kartlar')
    await page.getByRole('button', { name: /İşlemler/ }).click()

    // Quick-expense form lives under the "Hızlı harcama" heading.
    const form = page.locator('form').filter({ has: page.getByPlaceholder('Migros, benzin, yemek...') })
    await expect(form).toBeVisible()

    await form.locator('select').first().selectOption({ label: `Akbank · ${CARD_NAME}` })
    await form.getByPlaceholder('Migros, benzin, yemek...').fill('E2E Market')
    await form.getByLabel('TL', { exact: true }).fill(String(AMOUNT))
    await form.getByRole('button', { name: 'Harcamayı kaydet' }).click()
    // Submit clears the description field on success.
    await expect(form.getByPlaceholder('Migros, benzin, yemek...')).toHaveValue('', { timeout: 10_000 })

    // The card's "Güncel borç" (on the Kartlar tab) should reflect the new debt.
    await page.getByRole('button', { name: /Kartlar/ }).click()
    const card = page.locator('article').filter({ hasText: CARD_NAME })
    await expect(card.getByText('Güncel borç')).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('₺500,00')

    // Drill-down: the ledger records the increase.
    await card.getByRole('button', { name: 'Detay' }).click()
    await expect(card.getByText('Borç hareketleri')).toBeVisible()
    await expect(card.getByText('Borç arttı')).toBeVisible()
  })
})

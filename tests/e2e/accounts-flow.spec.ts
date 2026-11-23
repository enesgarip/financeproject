import { expect, test } from '@playwright/test'
import { formatSeritAmount } from '../../src/utils/formatCurrency'
import { bank, base, mockApp, now, tables } from './audit-fixtures'

const first = { ...tables.cards[2], card_name: 'Ortak ana kart', limit_group_name: 'Aile', credit_limit: 100000, debt_amount: 23000, current_period_spending: 23000 }
const second = { ...first, id: 'credit-2', card_name: 'Ortak ek kart', credit_limit: 90000, debt_amount: 17000, current_period_spending: 17000 }
const solo = { ...first, id: 'credit-3', card_name: 'Bağımsız kart', limit_group_name: null, credit_limit: 300000, debt_amount: 60000, current_period_spending: 60000 }
const statement = { ...base, id: 'statement-1', card_id: 'credit-1', period_year: 2026, period_month: 10, statement_date: '2026-10-04', due_date: '2026-10-14', statement_debt_amount: 1000, minimum_payment_amount: 200, status: 'open', paid_at: null }

for (const width of [320, 390, 1280]) {
  test(`kart limitleri, dökümler ve gizlilik: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, width === 390 ? 'dark' : 'light', { cards: [bank, first, second, solo] })
    await page.goto('/kartlar?section=kartlar')
    const limits = page.getByRole('region', { name: 'Toplam limit ve kullanım' })
    const summary = limits.locator('summary').first()
    for (const [label, amount] of [['Toplam limit', 400000], ['Kullanılan limit', 100000], ['Kullanılabilir limit', 300000]] as const) {
      await expect(summary.getByText(label, { exact: true }).locator('..')).toContainText(formatSeritAmount(amount))
    }
    await expect(summary.getByText('%25', { exact: true })).toBeVisible()
    // Günlük dökümler kapalı bir kırılım açmadan kullanılabilir.
    const navigation = page.getByRole('navigation', { name: 'Kart dökümleri' })
    await navigation.getByRole('button', { name: /Gelecek taksit toplamı/ }).click()
    await expect(page.getByRole('region', { name: 'Seçilen bilgi dökümü' })).toBeVisible()
    await page.getByRole('button', { name: 'Dökümü kapat' }).click()
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: `test-results/accounts-overview-${width}.png`, fullPage: true })
    await summary.click()
    await limits.locator('summary').filter({ hasText: 'Aile · 2 kart' }).click()
    await expect(limits.getByRole('button', { name: 'Ortak ek kart', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bağımsız kart kart ayrıntıları' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: `test-results/accounts-limits-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
    await expect(summary).toContainText('••••')
    await expect(limits).not.toContainText(/400\.000|100\.000|300\.000|%25|%40/)
    await expect(summary.locator('[style]')).toHaveCount(0)
    await limits.getByRole('button', { name: 'Ortak ek kart', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Ortak ek kart', exact: true })).toBeVisible()
    await expect(page.getByText('Plan ve tahmin', { exact: true })).toBeVisible()
    await expect(page.getByText('Kart ayarları', { exact: true })).toBeVisible()
    await expect(page.getByText('Kayıt geçmişi', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Listeye dön' }).click()
    await expect(page).toHaveURL(/section=kartlar/)
  })
}

test('tek ekstre ödemesi kalanla doğrudan açılır; kayıt sonrası limit ve bakiye yenilenir', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const source = { ...bank }
  const credit = { ...tables.cards[2], id: 'credit-1', debt_amount: 1000, statement_debt_amount: 800, current_period_spending: 200 }
  const payments = [{ ...base, id: 'paid-1', card_id: credit.id, statement_archive_id: statement.id, amount: 200, paid_at: now }]
  await mockApp(page, 'light', { cards: [source, credit], card_statement_archives: [statement], card_statement_payments: payments })
  const requests: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/submit_finance_payment', async route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    const amount = body.p_args.p_amount as number
    credit.debt_amount -= amount
    credit.statement_debt_amount -= amount
    source.current_balance -= amount
    payments.push({ ...payments[0], id: 'paid-2', amount })
    return route.fulfill({ json: null })
  })
  await page.goto('/kartlar?section=kartlar&card=credit-1')
  await page.getByRole('button', { name: 'Ekstre ödemesi kaydet' }).click()
  const drawer = page.getByRole('dialog', { name: 'Ekstre ödemesi', exact: true })
  await expect(drawer).toBeVisible()
  await expect(page).not.toHaveURL(/panel=ekstreler/)
  await expect(drawer.getByRole('textbox')).toHaveValue('800')
  await expect(drawer).toContainText('Örnek kart')
  await drawer.getByRole('textbox').fill('300')
  await drawer.getByRole('combobox', { name: 'Ödemenin yapıldığı hesap' }).selectOption(bank.id)
  await drawer.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click()
  await expect(drawer).toHaveCount(0)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ p_method: 'pay_card_statement', p_args: { p_statement_id: statement.id, p_source_card_id: bank.id, p_amount: 300 } })
  await expect(page.getByRole('region', { name: 'Kart yükü ve limit' })).toContainText(formatSeritAmount(700))
  await page.getByRole('button', { name: 'Listeye dön' }).click()
  const summary = page.getByRole('region', { name: 'Toplam limit ve kullanım' }).locator('summary').first()
  await expect(summary.getByText('Kullanılan limit', { exact: true }).locator('..')).toContainText(formatSeritAmount(700))
  await expect(summary.getByText('Kullanılabilir limit', { exact: true }).locator('..')).toContainText(formatSeritAmount(9300))
  await page.getByRole('button', { name: /Hesaplar ve nakit/ }).click()
  await expect(page.getByRole('button', { name: 'Örnek hesap hesap ayrıntıları' })).toContainText(formatSeritAmount(19700))
})

test('birden fazla ekstrede dönem seçilir; ödeme okuma hatasında eylem açılmaz', async ({ page }) => {
  await mockApp(page, 'light', {
    card_statement_archives: [statement, { ...statement, id: 'statement-2', period_month: 9, statement_date: '2026-09-04', due_date: '2026-09-14' }],
  })
  await page.goto('/kartlar?section=kartlar&card=credit-1')
  await page.getByRole('button', { name: 'Ekstre ödemesi kaydet' }).click()
  await expect(page).toHaveURL(/panel=ekstreler/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const pay = page.getByRole('button', { name: 'Ekstreyi öde', exact: true })
  await expect(pay).toHaveCount(2)
  await pay.first().click()
  await expect(page.getByRole('dialog', { name: 'Ekstre ödemesi', exact: true })).toContainText('Eylül 2026')
  await page.getByRole('dialog').getByRole('button', { name: 'Kapat', exact: true }).click()
  await page.route('**/rest/v1/card_statement_payments*', route => route.fulfill({ status: 500, json: { message: 'Ödeme kayıtları okunamadı', code: 'XX000' } }))
  await page.reload()
  await expect(page.getByText('Doğrulanamadı', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ekstre ödemesi kaydet' })).toHaveCount(0)
})

for (const type of ['in', 'out', 'transfer'] as const) {
  test(`hesap işlemi doğrudan ${type} formunu açar ve aynı servisle kaydeder`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    const source = { ...bank }
    const target = { ...bank, id: 'bank-2', card_name: 'Diğer hesap', current_balance: 5000 }
    await mockApp(page, 'light', { cards: [source, target] })
    const requests: Record<string, unknown>[] = []
    await page.route('**/rest/v1/rpc/submit_finance_operation', async route => {
      const body = route.request().postDataJSON()
      requests.push(body)
      source.current_balance += type === 'in' ? 250 : -250
      if (type === 'transfer') target.current_balance += 250
      return route.fulfill({ json: null })
    })
    await page.goto('/kartlar?section=hesaplar&card=bank-1')
    await page.getByRole('button', { name: type === 'in' ? 'Para geldi' : type === 'out' ? 'Para gitti' : 'Hesaplarım arasında aktar', exact: true }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.getByRole('combobox', { name: 'İşlem tipi' })).toHaveValue(type)
    await modal.getByRole('textbox').fill('250')
    if (type === 'transfer') {
      await modal.getByRole('combobox', { name: 'Hedef', exact: true }).selectOption(target.id)
      await expect(modal).toContainText('Örnek hesap → Diğer hesap')
      await expect(modal).toContainText(formatSeritAmount(5250))
    }
    await expect(modal).toContainText(formatSeritAmount(type === 'in' ? 20250 : 19750))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: `test-results/accounts-movement-${type}.png`, fullPage: true })
    await modal.getByRole('button', { name: type === 'transfer' ? 'Aktarımı kaydet' : type === 'in' ? 'Para girişini kaydet' : 'Para çıkışını kaydet', exact: true }).click()
    await expect(modal).toHaveCount(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject(type === 'transfer'
      ? { p_method: 'transfer_between_accounts', p_args: { p_source_card_id: source.id, p_target_card_id: target.id, p_amount: 250 } }
      : { p_method: 'record_manual_account_movement', p_args: { p_card_id: source.id, p_direction: type, p_amount: 250 } })
    await expect(page.locator('article')).toContainText(formatSeritAmount(type === 'in' ? 20250 : 19750))
  })
}

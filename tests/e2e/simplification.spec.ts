import { expect, test, type Page } from '@playwright/test'

// Tüm dış istekler sentetik yanıtlanır: bu test gerçek Supabase'e bağlanamaz.
const userId = '11111111-1111-4111-8111-111111111111'
const now = '2026-10-26T09:00:00.000Z'
const base = { user_id: userId, created_at: now, updated_at: now, note: null }
const bank = { ...base, id: 'bank-1', bank_name: 'İş Bankası', card_name: 'Örnek hesap', card_type: 'banka_karti', account_kind: 'bank', current_balance: 20000, credit_limit: 0, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0, statement_day: null, due_day: null, holder_name: null, account_number: null, limit_group_name: null }
const tables: Record<string, Record<string, unknown>[]> = {
  cards: [bank, { ...bank, id: 'bank-2', card_name: 'Diğer hesap', bank_name: 'Garanti', current_balance: 5000 }, { ...bank, id: 'credit-1', card_name: 'Örnek kart', card_type: 'kredi_karti', current_balance: 0, credit_limit: 10000, debt_amount: 1000, current_period_spending: 1000, statement_day: 4, due_day: 14 }],
  assets: [{ ...base, id: 'asset-1', name: 'Örnek yatırım', category: 'Diğer', amount: 1, unit: 'adet', unit_cost: 5000, estimated_value_try: 5000, auto_valued: false, currency: 'TRY', ticker: null, source: null }],
  payments: [{ ...base, id: 'payment-1', title: 'Örnek aidat', category: 'Kira / aidat', amount: 100, amount_status: 'exact', due_date: '2026-10-28', status: 'bekliyor', payment_method: 'manual', recurrence: 'monthly', recurrence_day: 28, recurrence_end_date: null, auto_source_card_id: null }],
  salary_history: [{ ...base, id: 'salary-1', title: 'Örnek maaş', amount: 50000, effective_date: '2026-10-01' }],
  kasa_buckets: [{ ...base, id: 'reserve-1', name: 'Bağımsız pay', reserved_amount: 100, goal_id: null, last_contribution_month: null, sort_order: 0 }, { ...base, id: 'reserve-2', name: 'Hedefe bağlı pay', reserved_amount: 200, goal_id: 'goal-1', last_contribution_month: '2026-10-01', sort_order: 1 }],
  savings_goals: [{ ...base, id: 'goal-1', name: 'Örnek hedef', value_type: 'TRY', target_amount: 10000, current_amount: 1000, estimated_value_try: 1000, auto_valued: false, valued_at: null, valuation_rate: null, target_date: '2027-10-01', status: 'active', target_anchor: 'manual', target_anchor_units: null, target_anchor_months: null }],
  wishlist_items: [{ ...base, id: 'wish-1', name: 'Bekleyen ürün', estimated_price: 500, is_purchased: false, purchased_at: null, sort_order: 0 }, { ...base, id: 'wish-2', name: 'Alınmış ürün', estimated_price: 100, is_purchased: true, purchased_at: now, sort_order: 1 }],
  cars: [{ ...base, id: 'car-1', name: 'Örnek araç', plate: 'TEST', current_odometer_km: 50000, sort_order: 0 }],
  expense_contexts: [{ ...base, id: 'context-1', name: 'Örnek grup', kind: 'pet', budget_amount: 1000, starts_on: '2026-10-01', ends_on: null, completed_at: null, sort_order: 0 }],
}
const snapshotKeys = ['assets', 'cards', 'loans', 'loan_installments', 'debts', 'payments', 'salary_history', 'transaction_history', 'budgets', 'card_expenses', 'card_installments', 'card_statement_archives', 'card_statement_payments', 'savings_goals', 'savings_goal_components', 'savings_goal_sources', 'account_reconciliations', 'missing_tables']

async function mockApp(page: Page, theme: string, overrides: typeof tables = {}) {
  const rows = { ...tables, ...overrides }
  const snapshot = Object.fromEntries(snapshotKeys.map(key => [key, rows[key] ?? []]))
  await page.clock.install({ time: new Date(now) })
  const user = { id: userId, email: 'synthetic@example.test', aud: 'authenticated', role: 'authenticated', created_at: now, app_metadata: {}, user_metadata: {} }
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: 2100000000 })).toString('base64url')}.synthetic`
  await page.addInitScript(({ user, token, theme, now }) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', expires_at: 2100000000, expires_in: 3600, token_type: 'bearer', user }))
    localStorage.setItem('theme', theme)
    localStorage.setItem('denge:theme-preference', theme)
    localStorage.setItem('denge:net-worth-snapshot-day', `${user.id}:2026-10-26`)
    localStorage.setItem('fp.marketRates.v1', JSON.stringify({ rates: { USD: { buying: 40, selling: 41 }, GRA: { buying: 5000, selling: 5100 }, CEYREKALTIN: { buying: 8000, selling: 8100 } }, asOf: now, fetchedAt: now }))
  }, { user, token, theme, now })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
      if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ body: '', contentType: 'application/javascript' })
      return route.continue()
    }
    if (url.hostname === 'example.supabase.co') {
      const name = url.pathname.split('/').at(-1)!
      const data = name === 'fetch_finance_snapshot' ? snapshot : name === 'bist-quote' ? { prices: {}, asOf: now } : url.pathname.includes('/rpc/') ? 0 : name === 'user' ? user : rows[name] ?? []
      return route.fulfill({ json: data })
    }
    return route.abort()
  })
}

const routes = ['/', '/kartlar', '/varliklar', '/varliklar/maas', '/varliklar/altin', '/varliklar/borsa', '/varliklar/araclar', '/borclar/krediler', '/borclar/kisiler', '/odemeler', '/odemeler/hedefler', '/odemeler/alsam-mi', '/odemeler/liste', '/odemeler/baglamlar', '/analiz', '/analiz/detay', '/analiz/asistan', '/veri-sagligi', '/veri-sagligi/islemler']

for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1280, 'light']] as const) {
  test(`19 ekran taşmadan açılır: ${width}px ${theme}`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, theme)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    for (const path of routes) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('main')).not.toContainText('Bir şeyler ters gitti')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `${path} yatay taşıyor` }).toBeLessThanOrEqual(1)
      if (['/', '/analiz', '/odemeler/hedefler', '/varliklar/araclar'].includes(path)) await page.screenshot({ path: `test-results/simplification-${path.replaceAll('/', '-') || 'home'}-${width}.png`, fullPage: true })
    }
    expect(errors).toEqual([])
    await page.screenshot({ path: `test-results/simplification-maintenance-${width}.png`, fullPage: true })
  })
}

test('özetlerden tek yönetim yüzeyine ve transfer formuna erişilir', async ({ page }) => {
  await mockApp(page, 'light')
  await page.goto('/odemeler')
  await expect(page.getByRole('button', { name: 'Kayıtlı planlar', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ödeme planla', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'Kayıtlı planlar', exact: true }).click()
  await expect(page.locator('main').getByRole('heading', { name: 'Örnek aidat', exact: true }).filter({ visible: true })).toBeVisible()
  await page.goto('/veri-sagligi/islemler')
  await expect(page.getByRole('button', { name: 'Tüm veriyi sil', exact: true })).not.toBeVisible()
  await page.locator('summary').filter({ hasText: 'Verileri sıfırlama' }).click()
  await expect(page.getByRole('button', { name: 'Tüm veriyi sil', exact: true })).toBeVisible()
  await page.locator('summary').filter({ hasText: 'Otomasyon ve teşhis' }).click()
  await expect(page.getByText('İstemci hataları', { exact: true })).toBeVisible()
  await page.goto('/kartlar?section=hesaplar&task=transfer')
  await expect(page.getByText('Transfer için kaynak hesap seç', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Örnek hesap hesabından transfer' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Hedef hesap seç')
  await page.screenshot({ path: 'test-results/simplification-transfer.png', fullPage: true })
  await page.goto('/kartlar?section=kartlar&cycle=1')
  await expect(page.getByRole('heading', { name: /^Kart döngüsü/ })).toBeVisible()
})

test('hisse toplamları ayrıntıda korunur; eksik fiyat uyarısı açık kalır', async ({ page }) => {
  await mockApp(page, 'light', {
    stock_trades: [{ ...base, id: 'trade-1', symbol: 'THYAO', kind: 'buy', quantity: 10, unit_price: 100, fee: 0, trade_date: '2026-10-01' }],
    assets: [{ ...tables.assets[0], category: 'Hisse', symbol: 'THYAO', amount: 10 }],
  })
  await page.goto('/varliklar/borsa')
  await expect(page.getByText(/Fiyatı bulunamayan sembol: THYAO/)).toBeVisible()
  await expect(page.getByText('Alımlar', { exact: true })).not.toBeVisible()
  await page.locator('summary').filter({ hasText: 'İşlem toplamları ve hesap ayrıntısı' }).click()
  await expect(page.getByText('Alımlar', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'İşlem geçmişi', exact: true }).click()
  await expect(page.getByText('Geçmiş işlem ekle', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Al / Sat kaydet →' })).toHaveAttribute('href', '/varliklar?view=records')
})

test('mobil ayrıntılar, hedef payları, gizlilik ve kredi notu kısayolu korunur', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'dark')
  await page.goto('/odemeler/hedefler')
  await page.locator('summary').filter({ hasText: 'Bağımsız ayrılan parayı yönet' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Bağımsız pay', { exact: true })).toBeVisible()
  const reserves = page.locator('section').filter({ has: page.getByText('Toplam ayrılan (hedefler dahil)', { exact: true }) }).last()
  await expect(reserves.getByRole('button', { name: 'Hedefe bağlı pay payını düzenle' })).not.toBeVisible()
  await reserves.getByRole('checkbox', { name: 'Hedefe bağlı payları da göster' }).check()
  await expect(reserves.getByRole('button', { name: 'Hedefe bağlı pay payını düzenle' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.goto('/')
  await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
  await expect(page.getByRole('link', { name: /Hesap ve nakit/ })).toContainText('••••')
  await page.goto('/analiz/detay?new=1')
  await expect(page.getByRole('dialog')).toContainText('Kredi notu ekle')
})

for (const types of [['gram'], ['gram', 'ceyrek']]) {
  test(`altın özeti ve aktarım notu: ${types.length} tür`, async ({ page }) => {
    await mockApp(page, 'light', { gold_lots: types.map((gold_type, index) => ({ ...base, id: `gold-${index}`, purchase_date: '2026-10-01', gold_type, ayar: 24, quantity: 2, unit_price: 4000, direction: 'buy', note: index === 0 ? '[gold-import-2026-10-01] Örnek aktarım' : 'Kullanıcı notu' })) })
    await page.goto('/varliklar/altin')
    if (types.length === 1) await expect(page.getByText('Güncel eder', { exact: true })).toHaveCount(0)
    else await expect(page.getByText('Güncel eder', { exact: true })).toHaveCount(2)
    await expect(page.getByText('[gold-import-2026-10-01] Örnek aktarım', { exact: true })).not.toBeVisible()
    await page.locator('summary').filter({ hasText: 'Aktarım bilgisi' }).click()
    await expect(page.getByText('[gold-import-2026-10-01] Örnek aktarım', { exact: true })).toBeVisible()
    if (types.length > 1) await expect(page.getByText('Kullanıcı notu', { exact: true })).toBeVisible()
  })
}

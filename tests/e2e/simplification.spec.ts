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
      let data: unknown = name === 'fetch_finance_snapshot' ? snapshot : name === 'bist-quote' ? { prices: {}, asOf: now } : url.pathname.includes('/rpc/') ? 0 : name === 'user' ? user : rows[name] ?? []
      if (['card_ledger', 'account_ledger', 'card_expenses', 'card_installments', 'card_statement_archives'].includes(name)) {
        const before = url.searchParams.get('id')?.replace(/^lt\./, '')
        const cardId = url.searchParams.get('card_id')?.replace(/^eq\./, '')
        data = (rows[name] ?? []).filter(row => (!before || String(row.id) < before) && (!cardId || row.card_id === cardId))
          .toSorted((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, Number(url.searchParams.get('limit') ?? 1000))
      }
      return route.fulfill({ json: data })
    }
    return route.abort()
  })
}

test('ay sonuna kalan açık alacağı saymaz ve hesap dökümüyle tutarlıdır', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await mockApp(page, 'light', {
    cards: [bank],
    debts: [{ ...base, id: 'receivable-1', person_name: 'Örnek kişi', direction: 'borç_verdim', value_type: 'TRY',
      currency: null, amount: 5000, estimated_value_try: 5000, auto_valued: false, valued_at: null,
      valuation_rate: null, due_date: '2026-10-28', status: 'açık' }],
  })
  await page.addInitScript(() => localStorage.setItem('denge:safe-to-spend-buffer', '5000'))
  await page.goto('/')
  const hero = page.getByText('Ay sonuna kalan', { exact: true }).locator('..')
  await expect(hero).toContainText('14.600,00')
  await expect(hero).toContainText('alacak bu tutara dahil değil.')
  await page.getByText('Nasıl hesaplandı?', { exact: true }).click()
  const breakdown = page.locator('details').filter({ has: page.getByText('Nasıl hesaplandı?', { exact: true }) })
  await expect(breakdown.locator('dt').filter({ hasText: 'Bu ay beklenen maaş' }).locator('+ dd')).toContainText('0,00')
  await expect(breakdown).toContainText('tahsilat kaydedilip hesap bakiyesine geçene kadar bu tutara dahil edilmez')
})

for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1280, 'light']] as const) {
  test(`kategori analizi ekstre dönemi, geçmiş ay ve kart seçimi: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const expense = { ...base, card_id: 'credit-1', statement_archive_id: null, status: 'posted', installment_count: 1, installment_amount: 0, posted_at: now, category: 'Market', amount: 123.45, spent_at: '2026-10-10' }
    await mockApp(page, theme, {
      cards: [...tables.cards, { ...tables.cards[2], id: 'credit-2', card_name: 'İkinci kart', statement_day: 20, due_day: 30 }],
      card_expenses: [
        { ...expense, id: 'expense-1', description: 'Ekimde yapılan market alışverişi' },
        { ...expense, id: 'expense-2', card_id: 'credit-2', spent_at: '2026-11-01', category: 'Yemek', amount: 55, description: 'Kasımda yemek' },
        { ...expense, id: 'expense-3', statement_archive_id: 'archive-oct', spent_at: '2026-09-18', amount: 77, description: 'Önceki ekstre harcaması' },
      ],
      card_statement_archives: [{ ...base, id: 'archive-oct', card_id: 'credit-1', statement_date: '2026-10-04', period_year: 2026, period_month: 10, statement_debt_amount: 77, current_period_spending: 77, total_debt_amount: 77, status: 'paid', due_date: '2026-10-14' }],
    })
    await page.clock.setFixedTime(new Date('2026-11-02T09:00:00Z'))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/analiz')
    const panel = page.locator('[data-slot="card"]').filter({ has: page.getByText('Kategori harcaması', { exact: true }) })
    await expect(panel.getByLabel('Görünüm')).toHaveValue('statement')
    await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /178,45/)
    await expect(panel).toContainText('05 Eki 2026 – 04 Kas 2026')
    await expect(panel).toContainText('21 Eki 2026 – 20 Kas 2026')
    await panel.locator('summary').filter({ hasText: 'Market' }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByText('Ekimde yapılan market alışverişi', { exact: true })).toBeVisible()
    await panel.getByRole('combobox', { name: 'Kart', exact: true }).selectOption('credit-1')
    await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /123,45/)
    await panel.getByRole('combobox', { name: 'Dönem', exact: true }).selectOption('2026-10')
    await panel.locator('summary').filter({ hasText: 'Market' }).click()
    await expect(panel.getByText('Önceki ekstre harcaması', { exact: true })).toBeVisible()
    await panel.getByLabel('Görünüm').selectOption('calendar')
    await expect(panel.getByRole('combobox', { name: 'Dönem', exact: true })).toHaveValue('2026-11')
    await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /55,00/)
    await panel.getByRole('combobox', { name: 'Dönem', exact: true }).selectOption('2026-10')
    await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /123,45/)
    await panel.locator('summary').filter({ hasText: 'Market' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await panel.screenshot({ path: `test-results/category-period-${width}.png` })
    await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
    await expect(panel.getByRole('img')).not.toHaveAttribute('aria-label', /123,45/)
    await expect(panel).not.toContainText('123,45')
    expect(errors).toEqual([])
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

for (const width of [320, 390, 1280]) {
  test(`uzun kart geçmişi tam okunur ve sayfalanır: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, width === 390 ? 'dark' : 'light', {
      cards: [{ ...tables.cards[2], debt_amount: 1005, current_period_spending: 1005 }],
      card_ledger: Array.from({ length: 1005 }, (_, i) => ({ ...base, id: String(i).padStart(6, '0'), card_id: 'credit-1', kind: 'adjustment', amount_kurus: 100, occurred_at: now, source_table: null, source_id: null, statement_delta_kurus: null, current_delta_kurus: null, provision_delta_kurus: null, note: `Deneme açıklaması ${i}: Önceki hareketlerin bütün açıklamaları dar ekranda da kesilmeden okunabilmeli.` })),
    })
    await page.goto('/kartlar?section=kartlar&card=credit-1')
    await page.locator('summary').filter({ hasText: 'Kart ayarları ve kayıt geçmişi' }).click()
    const ledger = page.getByRole('region', { name: 'Kart borç hareketleri', exact: true })
    await expect(ledger.getByText('1005 hareket', { exact: true })).toBeVisible()
    await expect(ledger.getByRole('button', { name: /ledger.a göre düzelt/i })).toHaveCount(0)
    const list = ledger.getByRole('list', { name: 'Kart borç hareketi kayıtları' })
    await expect(list.getByRole('listitem')).toHaveCount(10)
    await expect(list).toContainText('Deneme açıklaması 1004:')
    await ledger.getByRole('button', { name: 'Daha eski' }).click()
    await expect(ledger.getByRole('status')).toHaveText('11–20 / 1005 hareket · Sayfa 2 / 101')
    await expect(list).toBeFocused()
    await expect(list).toContainText('Deneme açıklaması 994:')
    await ledger.getByRole('button', { name: 'Daha yeni' }).click()
    await expect(list).toContainText('Deneme açıklaması 1004:')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await ledger.getByRole('button', { name: 'En eski', exact: true }).click()
    await expect(ledger.getByRole('status')).toHaveText('1001–1005 / 1005 hareket · Sayfa 101 / 101')
    await expect(list.getByRole('listitem')).toHaveCount(5)
    await ledger.getByRole('button', { name: 'En yeni', exact: true }).click()
    await expect(list.getByRole('listitem')).toHaveCount(10)
    await ledger.screenshot({ path: `test-results/card-ledger-${width}.png` })
  })
}

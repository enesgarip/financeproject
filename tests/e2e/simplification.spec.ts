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

const sampleDebt = { ...base, id: 'debt-1', person_name: 'Örnek borçlu', direction: 'borç_aldım', value_type: 'TRY', currency: null, amount: 1000, estimated_value_try: 1000, auto_valued: false, due_date: null, status: 'açık' }

test('bağlı harcama: grup önceden seçilir, araçla aynı harcama yazılır ve mevcut harekete geçilir', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'light')
  const expenseWrites: Record<string, unknown>[] = []
  const tags: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/add_card_expense', route => {
    expenseWrites.push(route.request().postDataJSON())
    return route.fulfill({ json: { id: 'linked-expense', card_id: 'credit-1', amount: 250 } })
  })
  await page.route('**/rest/v1/card_expenses*', route => {
    if (route.request().method() === 'PATCH') tags.push(route.request().postDataJSON())
    return route.fulfill({ json: [] })
  })
  await page.goto('/odemeler/baglamlar')
  await page.getByRole('link', { name: 'Harcama kaydet →', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Gider grubu', exact: true })).toHaveValue('context-1')
  await page.getByRole('combobox', { name: 'Araç', exact: true }).selectOption('car-1')
  await page.getByRole('textbox', { name: 'Tutar (TL)', exact: true }).fill('250')
  await page.getByRole('textbox', { name: 'Açıklama', exact: true }).fill('Veteriner ulaşımı')
  expect(await page.locator('#hizli-harcama form').evaluate(form => Array.from(form.querySelectorAll<HTMLInputElement>('input,select')).filter(field => !field.validity.valid).map(field => ({ name: field.name, type: field.type, value: field.value, error: field.validationMessage })))).toEqual([])
  await page.getByRole('button', { name: 'Harcamayı kaydet', exact: true }).click()
  await expect(page.getByText('Harcama kaydedildi.', { exact: true })).toBeVisible()
  expect(expenseWrites).toHaveLength(1)
  expect(tags).toEqual([{ car_id: 'car-1' }, { context_id: 'context-1' }])
  await expect(page.getByRole('combobox', { name: 'Gider grubu', exact: true })).toHaveValue('context-1')
  await page.getByRole('link', { name: /SMS veya ekstrede zaten varsa/ }).click()
  await expect(page).toHaveURL(/\/odemeler\/baglamlar\?context=context-1#kart-iliskilendir$/)
  await expect(page.locator('#kart-iliskilendir details')).toHaveAttribute('open', '')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
})

test('bağlı gelir: kayıp yanıt aynı hareketle doğrulanır ve alacak eşlemesi tekrar para yazmaz', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const movement = { ...base, id: 'income-1', occurred_at: now, type: 'transfer', source_table: 'cards', source_id: 'bank-1', source_event_id: null, title: 'Örnek hesap para girişi', amount: 2000 }
  await mockApp(page, 'dark', { cards: [bank], transaction_history: [movement], debts: [{ ...sampleDebt, direction: 'borç_verdim', person_name: 'Örnek alacaklı' }] })
  let labels: Record<string, unknown>[] = []
  const requests: Record<string, unknown>[] = []
  const balanceWrites: string[] = []
  page.on('request', request => { if (/record_manual_account_movement|settle_personal_debt|post_account_balance/.test(request.url())) balanceWrites.push(request.url()) })
  await page.route('**/rest/v1/account_income_labels*', route => route.fulfill({ json: labels }))
  await page.route('**/rest/v1/rpc/classify_account_income', route => {
    requests.push(route.request().postDataJSON())
    labels = [{ ...base, id: 'label-1', movement_id: 'income-1', kind: 'receivable', debt_id: 'debt-1', debt_amount: 400 }]
    return requests.length === 1 ? route.abort('connectionreset') : route.fulfill({ json: labels[0] })
  })
  await page.goto('/kartlar?section=hesaplar&card=bank-1')
  await page.getByText('Gelen para neydi?', { exact: true }).click()
  await page.getByRole('button', { name: 'Bu para neydi?', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Gelen parayı sınıflandır' })
  await modal.getByRole('combobox', { name: 'Para girişinin türü', exact: true }).selectOption('receivable')
  await modal.getByRole('combobox', { name: 'Açık TL alacağı', exact: true }).selectOption('debt-1')
  await modal.getByRole('textbox', { name: 'Bu alacağa sayılacak tutar (TL)', exact: true }).fill('400')
  await page.screenshot({ path: 'test-results/linked-income-form-320.png' })
  await modal.getByRole('button', { name: 'Sınıflandırmayı kaydet', exact: true }).click()
  await expect(modal.getByRole('alert')).toBeVisible()
  await modal.getByRole('button', { name: 'Sınıflandırmayı kaydet', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0]).toMatchObject({ p_movement_id: 'income-1', p_kind: 'receivable', p_debt_id: 'debt-1', p_debt_amount: 400 })
  expect(balanceWrites).toEqual([])
  await expect(page.getByText(/Alacak tahsilatı · 400,00/)).toBeVisible()
  await page.reload()
  await page.getByText('Gelen para neydi?', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bu para neydi?', exact: true })).toHaveCount(0)
  await expect(page.getByText(/Alacak tahsilatı · 400,00/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/linked-income-320.png', fullPage: true })
})

test('bağlı bakım: gider ve sonraki plan kayıp yanıttan sonra yenilemede aynı işlemle doğrulanır', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'light')
  let reminders = [{ ...base, id: 'reminder-1', car_id: 'car-1', title: 'Yağ değişimi', kind: 'bakim', due_date: '2026-10-25', due_odometer_km: 50000, repeat_months: 6, repeat_km: 10000 }]
  let completions: Record<string, unknown>[] = []
  const requests: Record<string, unknown>[] = []
  await page.route('**/rest/v1/car_reminders*', route => route.fulfill({ json: reminders }))
  await page.route('**/rest/v1/car_service_completions*', route => route.fulfill({ json: completions }))
  await page.route('**/rest/v1/rpc/complete_car_service', route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    if (!completions.length) {
      completions = [{ ...base, id: body.p_request_id, car_id: 'car-1', reminder_id: 'reminder-1', title: 'Yağ değişimi', completed_on: '2026-10-26', odometer_km: 51500, card_expense_id: null, car_expense_id: 'reporting-expense-1', request: body.p_input }]
      reminders = reminders.map(reminder => ({ ...reminder, due_date: '2027-04-26', due_odometer_km: 61500, updated_at: '2026-10-26T09:01:00Z' }))
    }
    return requests.length === 1 ? route.abort('connectionreset') : route.fulfill({ json: completions[0] })
  })
  page.on('dialog', dialog => dialog.accept())
  await page.goto('/varliklar/araclar')
  await page.getByRole('button', { name: 'Tamamlandı', exact: true }).click()
  let modal = page.getByRole('dialog', { name: 'Bakımı veya yenilemeyi tamamla' })
  await modal.getByRole('textbox', { name: 'İşlem kilometresi (opsiyonel)', exact: true }).fill('51500')
  await expect(modal.getByRole('textbox', { name: 'Sonraki kilometre (opsiyonel)', exact: true })).toHaveValue('61500')
  await modal.getByRole('combobox', { name: 'Bu işin gideri', exact: true }).selectOption('manual')
  await modal.getByRole('textbox', { name: 'Gider tutarı (TL)', exact: true }).fill('750')
  await page.screenshot({ path: 'test-results/linked-service-form-320.png' })
  await modal.getByRole('button', { name: 'İşi tamamla', exact: true }).click()
  await expect(modal.getByRole('alert')).toBeVisible()
  await expect(modal.getByRole('textbox', { name: 'Gider tutarı (TL)', exact: true })).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: 'Tamamlandı', exact: true }).click()
  modal = page.getByRole('dialog', { name: 'Bakımı veya yenilemeyi tamamla' })
  await expect(modal.getByRole('textbox', { name: 'Gider tutarı (TL)', exact: true })).toHaveValue('750')
  await modal.getByRole('button', { name: 'Sonucu doğrula', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0].p_input).toMatchObject({ expenseMode: 'manual', amount: 750, nextDate: '2027-04-26', nextKm: 61500 })
  await page.getByText('Tamamlanan işler', { exact: true }).click()
  await expect(page.getByText('Son 50 tamamlanan iş', { exact: true })).toBeVisible()
  expect(completions).toHaveLength(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/linked-service-320.png', fullPage: true })
})

test('bağlı ay kapanışı: ilgili işe geçilir, dönüşte kontrol açılır ve rapora gidilir', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await mockApp(page, 'light')
  await page.goto('/analiz#ay-kapanisi')
  const close = page.locator('#ay-kapanisi')
  const check = close.getByText('Planlı ödemeler', { exact: true }).locator('..')
  await check.getByRole('link', { name: 'Kontrolü tamamla →', exact: true }).click()
  await expect(page).toHaveURL(/\/odemeler\?returnTo=/)
  await page.getByRole('link', { name: '← Ay kapanış kontrolüne dön', exact: true }).click()
  await expect(close.locator('details')).toHaveAttribute('open', '')
  await close.getByRole('link', { name: 'Aylık raporu aç →', exact: true }).click()
  await expect(page).toHaveURL(/\/analiz#aylik-rapor$/)
  await expect(page.locator('#aylik-rapor')).toBeFocused()
})

test('bağlı mevcut hareket: provizyon gruba tek etiketle bağlanır, yeni harcama veya gider oluşmaz', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const expense = { ...base, id: 'existing-provision', card_id: 'credit-1', description: 'Veteriner', amount: 250, spent_at: '2026-10-26', category: 'Sağlık', status: 'provision', installment_count: 1, context_id: null, car_id: null }
  await mockApp(page, 'light', { card_expenses: [expense] })
  const writes: { table: string; body: unknown }[] = []
  await page.route('**/rest/v1/card_expenses*', route => {
    if (route.request().method() === 'PATCH') writes.push({ table: 'card_expenses', body: route.request().postDataJSON() })
    return route.fulfill({ json: [expense] })
  })
  page.on('request', request => { if (request.method() === 'POST' && /add_card_expense|car_expenses|context_expenses/.test(request.url())) writes.push({ table: 'unexpected', body: request.postDataJSON() }) })
  await page.goto('/odemeler/baglamlar?context=context-1#kart-iliskilendir')
  await page.getByRole('button', { name: 'Örnek grup grubuna ekle', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Veteriner için gider grubu', exact: true })).toHaveValue('context-1')
  expect(writes).toEqual([{ table: 'card_expenses', body: { context_id: 'context-1' } }])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('birleşik alışveriş: isteğe bağlı test, aynı ürünle karar, bekletme ve alındı kaydı', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'light')
  let items = tables.wishlist_items.map(item => ({ ...item }))
  const writes: { method: string; body: Record<string, unknown> }[] = []
  await page.route('**/rest/v1/wishlist_items*', async route => {
    const request = route.request()
    const method = request.method()
    if (method === 'POST') {
      const body = request.postDataJSON()
      writes.push({ method, body })
      const item = { ...base, ...body, id: 'wish-new', purchased_at: null }
      items.push(item)
      return route.fulfill({ json: item })
    }
    if (method === 'PATCH') {
      const body = request.postDataJSON()
      writes.push({ method, body })
      const id = new URL(request.url()).searchParams.get('id')?.replace('eq.', '')
      items = items.map(item => item.id === id ? { ...item, ...body } : item)
      return route.fulfill({ json: items.find(item => item.id === id) })
    }
    return route.fulfill({ json: items })
  })
  await page.goto('/odemeler/liste')
  await page.getByLabel('Alınacak ürün', { exact: true }).fill('Yeni kulaklık')
  await page.getByRole('button', { name: 'Listeye ekle', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Yeni kulaklık', exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
  await page.getByRole('button', { name: 'Bekleyen ürün', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Alışverişi değerlendir' })
  await expect(dialog.getByLabel('Alışveriş tutarı')).toHaveValue('500')
  await expect(dialog.getByText('Bekleyen ürün', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '6', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '6', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: 'Alınacaklara ekle', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Listede beklet', exact: true }).click()
  expect(writes).toHaveLength(1)
  await expect(page).toHaveURL(/\/odemeler\/liste$/)
  await page.getByRole('button', { name: 'Yeni kulaklık', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Alışverişi değerlendir' })
  await dialog.getByLabel('Alışveriş tutarı').fill('1250')
  await dialog.getByRole('button', { name: 'Aldım', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Yeni kulaklık', { exact: true })).toHaveClass(/line-through/)
  expect(writes).toHaveLength(2)
  expect(writes[1]).toMatchObject({ method: 'PATCH', body: { is_purchased: true } })
  await page.reload()
  await expect(page.getByText('Yeni kulaklık', { exact: true })).toHaveClass(/line-through/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.getByRole('button', { name: 'Bekleyen ürün', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Alışveriş tutarı')).toHaveValue('500')
  await page.screenshot({ path: 'test-results/unified-shopping-320.png' })
})

test('birleşik hedef: aylık plan, gerçekleşen ve ayrılan para aynı kartta bağımsız görünür', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'dark', {
    savings_goal_monthly_plans: [{ ...base, id: 'monthly-1', goal_id: 'goal-1', effective_month: '2026-10-01', value_type: 'TRY', target_amount: 5000, source: 'manual', automatic_from: null }],
    savings_goal_monthly_entries: [{ ...base, id: 'entry-1', goal_id: 'goal-1', month: '2026-10-01', amount: 1250 }],
  })
  const writes: string[] = []
  page.on('request', request => { if (request.url().includes('/rest/') && ['PATCH', 'POST', 'DELETE'].includes(request.method()) && !request.url().includes('/rpc/')) writes.push(request.url()) })
  await page.goto('/odemeler/hedefler')
  const summary = page.getByLabel('Örnek hedef bu ayki takip özeti')
  await expect(summary).toContainText('Plan: 5.000,00')
  await expect(summary).toContainText('Gerçekleşen: 1.250,00')
  await expect(summary).toContainText('Kalan: 3.750,00')
  await expect(page.getByText('Bu hedefe ayrılan:', { exact: false })).toContainText('200,00')
  await expect(page.getByText('Birikim / hedef:', { exact: false })).toContainText('1.000')
  await expect(page.getByText('Aylık takip bilgi amaçlıdır;', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
  await expect(summary).toContainText('Plan: ••••')
  await expect(summary).not.toContainText('5.000')
  expect(writes).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.locator('[data-slot="card"]').filter({ has: page.getByText('Örnek hedef', { exact: true }) }).screenshot({ path: 'test-results/unified-goals-320.png' })
})

test('kategori hareketlerinden bütçe düzenlenir; ekstre veya tek kartta limit gösterilmez', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const budget = { ...base, id: 'budget-1', month: '2026-10-01', category: 'Market', limit_amount: 1000, limit_anchor: 'manual', limit_anchor_value: null }
  const expense = { ...base, id: 'expense-budget', card_id: 'credit-1', spent_at: '2026-10-20', amount: 200, description: 'Örnek market', category: 'Market', status: 'posted', installment_count: 1, statement_archive_id: null }
  await mockApp(page, 'light', { budgets: [budget], card_expenses: [expense] })
  let saved: Record<string, unknown> | null = null
  await page.route('**/rest/v1/budgets*', route => {
    if (route.request().method() === 'PATCH') saved = route.request().postDataJSON()
    return route.fulfill({ json: [{ ...budget, ...(saved ?? {}) }] })
  })
  await page.goto('/analiz#kategori-analizi')
  const chart = page.locator('#kategori-analizi')
  await expect(chart.getByRole('button', { name: 'Limiti düzenle' })).toHaveCount(0)
  await chart.getByRole('combobox', { name: 'Görünüm', exact: true }).selectOption('calendar')
  await chart.locator('summary').filter({ hasText: 'Market' }).click()
  await expect(chart.getByText('Bütçe kullanımı:', { exact: false })).toContainText('200,00')
  await chart.getByRole('button', { name: 'Limiti düzenle' }).click()
  await page.getByLabel('Aylık sabit limit (TL)', { exact: true }).fill('2500')
  await page.getByRole('button', { name: 'Limiti kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved).toMatchObject({ category: 'Market', month: '2026-10-01', limit_amount: 2500, limit_anchor: 'manual' })
  await chart.getByRole('combobox', { name: 'Kart', exact: true }).selectOption('credit-1')
  await expect(chart.getByRole('button', { name: 'Limiti düzenle' })).toHaveCount(0)
})

test('inceleme listesi düzeltilmiş hesap farkını tekrar açmaz ve ödemelerde keşfi açar', async ({ page }) => {
  await mockApp(page, 'light', {
    account_reconciliations: [{ ...base, id: 'recon-1', card_id: 'bank-1', reconciled_at: now, app_amount: 20000, real_amount: 19900, drift: 100, resolution: 'corrected' }, { ...base, id: 'recon-2', card_id: 'bank-2', reconciled_at: now, app_amount: 5000, real_amount: 4900, drift: 100, resolution: 'open' }],
  })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'İncelenecekler' })).toContainText('1 hesap veya kart karşılaştırmasında açık fark var.')
  await page.goto('/odemeler?view=plans#abonelikler')
  await expect(page.locator('#abonelikler details')).toHaveAttribute('open', '')
  await expect(page.getByRole('heading', { name: 'Ekstrelerden abonelik adayları', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kayıtlı planlar', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('320px otomasyon durumu API sonucunu gösterir ve yenileyince bekleyenleri günceller', async ({ page }) => {
  await page.setViewportSize({width:320,height:900})
  await mockApp(page,'light')
  let healthy=false
  await page.route('**/rest/v1/rpc/fetch_automation_health',route=>{
    expect(route.request().method()).toBe('POST')
    return route.fulfill({json:{maintenance:{ran_at:now,last_success_at:now,ok:healthy,errors:healthy?0:2},scheduler:{last_dispatched_at:now,last_response_at:now,last_success_at:now,last_http_status:healthy?200:502,stale:false},unknown_deliveries:healthy?0:1,retry_deliveries:healthy?0:2,failed_deliveries:0}})
  })
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/veri-sagligi/islemler')
  await page.locator('summary').filter({hasText:'Bildirim ayarları'}).click()
  await expect(page.getByText('Kart bakımında 2 hata var.',{exact:true})).toBeVisible()
  await expect(page.getByText(/1 bildirimin teslim sonucu belirsiz/)).toBeVisible()
  await expect(page.getByText('Son tamamlanan bildirim kontrolü başarısız.',{exact:true})).toBeVisible()
  healthy=true
  await page.getByRole('button',{name:'Durumu yenile',exact:true}).click()
  await expect(page.getByText('Son kart bakımı başarılı.',{exact:true})).toBeVisible()
  await expect(page.getByText(/1 bildirimin teslim sonucu belirsiz/)).toHaveCount(0)
  await expect(page.getByText('Son tamamlanan bildirim kontrolü başarılı.',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({path:'test-results/automation-health-320.png',fullPage:true})
})

test('kirli ödeme formunda tarayıcı Geri vazgeçilince rota ve tutar korunur', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await mockApp(page, 'light', { debts: [sampleDebt] })
  await page.goto('/')
  await page.getByRole('link', { name: 'Borçlar', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('link', { name: 'Kişiler', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'Ödeme kaydet', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel(/^Ödeme tutarı/).fill('100')
  const confirmations: string[] = []
  page.on('dialog', dialog => { confirmations.push(dialog.message()); return dialog.dismiss() })
  await page.goBack()
  await expect(page).toHaveURL(/\/borclar\/kisiler$/)
  await expect(modal.getByLabel(/^Ödeme tutarı/)).toHaveValue('100')
  expect(confirmations).toHaveLength(1)
  page.removeAllListeners('dialog')
  page.on('dialog', dialog => dialog.accept())
  await page.goBack()
  await expect(page).toHaveURL(/\/borclar\/krediler$/)
})

test('kayıp ödeme yanıtından sonra yenileme aynı işlem kimliği ve tutarla doğrular', async ({ page }) => {
  await mockApp(page, 'light', { debts: [sampleDebt] })
  const requests: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/submit_finance_payment', async route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) return route.abort('connectionreset')
    return route.fulfill({ json: null })
  })
  page.on('dialog', dialog => dialog.accept())
  await page.goto('/borclar/kisiler')
  await page.getByRole('button', { name: 'Ödeme kaydet', exact: true }).click()
  let modal = page.getByRole('dialog')
  await modal.getByLabel(/^Ödeme tutarı/).fill('100')
  await modal.locator('select').selectOption('bank-1')
  await modal.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click()
  await expect(modal.getByRole('button', { name: 'Sonucu doğrula', exact: true })).toBeEnabled()
  await expect(modal.getByLabel(/^Ödeme tutarı/)).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: 'Ödeme kaydet', exact: true }).click()
  modal = page.getByRole('dialog')
  await expect(modal.getByLabel(/^Ödeme tutarı/)).toHaveValue('100')
  await modal.getByRole('button', { name: 'Sonucu doğrula', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
})

test('320px benzer uzun kişi adları ödeme öncesi tam okunur', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const names = ['Muhammed Emin Abdülkadir Karahasanoğlu', 'Muhammed Emin Abdülkadir Karaosmanoğlu']
  await mockApp(page, 'light', { debts: names.map((person_name, i) => ({ ...sampleDebt, id: `debt-${i}`, person_name })) })
  await page.goto('/borclar/kisiler')
  for (const name of names) {
    const title = page.getByRole('heading', { name, exact: true })
    await expect(title).toBeVisible()
    expect(await title.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis')).toBe(true)
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
})

test('çevrimdışı açık özette son okuma ve eski veri durumu görünür', async ({ page, context }) => {
  await mockApp(page, 'light')
  await page.goto('/')
  await expect(page.getByText(/^Son okuma:/)).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Çevrimdışısın. Gösterilen tutarlar son okunan verilerdir.', { exact: false })).toBeVisible()
  await expect(page.getByText('Ay sonuna kalan', { exact: true })).toBeVisible()
  await context.setOffline(false)
})

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

test('eksik kart takviminde harcanabilir sayı ve satın alma önerisi sunulmaz', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await mockApp(page, 'light', { cards: [bank, { ...tables.cards[2], debt_amount: 25000, statement_debt_amount: 10000, current_period_spending: 15000, statement_day: null, due_day: null }] })
  await page.goto('/')
  const hero = page.getByText('Ay sonuna kalan', { exact: true }).locator('..')
  await expect(hero).toContainText('harcanabilir tutar doğrulanamadı')
  await expect(hero).not.toContainText('günde')
  await expect(hero.getByRole('link', { name: 'Kart takvimini tamamla' })).toBeVisible()
  await page.goto('/alsam-mi')
  await expect(page.getByRole('alert')).toContainText('satın alma değerlendirmesi doğrulanamadı')
  await page.goto('/odemeler/liste')
  await expect(page.getByText('Finansal veriler henüz doğrulanamadı.', { exact: false })).toBeVisible()
})

test('gecikmiş ve vadesiz borçlar harcanabilir tutardan bir kez düşer', async ({ page }) => {
  await mockApp(page, 'light', {
    cards: [bank],
    payments: [{ ...tables.payments[0], recurrence: 'none', recurrence_day: null, due_date: '2026-09-20', amount: 1000 }],
    debts: [{ ...base, id: 'borrowed', person_name: 'Örnek borç', direction: 'borç_aldım', value_type: 'TRY', currency: null, amount: 2000, estimated_value_try: 2000, auto_valued: false, due_date: null, status: 'açık' }],
  })
  await page.addInitScript(() => localStorage.setItem('denge:safe-to-spend-buffer', '5000'))
  await page.goto('/')
  const hero = page.getByText('Ay sonuna kalan', { exact: true }).locator('..')
  await expect(hero).toContainText('11.700,00')
  await page.getByText('Nasıl hesaplandı?', { exact: true }).click()
  await expect(page.locator('dt').filter({ hasText: 'Kalan, gecikmiş ve vadesiz ödemeler' }).locator('+ dd')).toContainText('3.000,00')
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

test('dövizli SMS: eski hata mesajı kurtarılır, tutar gizlenir ve kayıp yanıtta aynı TL ile tek kez tamamlanır', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const raw = 'Degerli Musterimiz, 07.11.2026 19:37:28 tarihinde 9032 ile biten kartinizla, STEAMGAMES.COM 4259522 firmasindan, 59,99 USD islem yapilmistir. Bilgi:08502220800 B002'
  await mockApp(page, 'light', {
    sms_log: [{ ...base, id: 'old-sms', raw_sms: raw, status: 'error', sms_type: 'unrecognized' }],
    card_aliases: [{ ...base, id: 'alias', card_id: 'credit-1', last_four_digits: '9032', label: 'Deniz' }],
  })
  const queued: Record<string, unknown>[] = []
  const requests: Record<string, unknown>[] = []
  let completed: number | null = null
  let writes = 0
  await page.route('**/rest/v1/rpc/queue_foreign_card_sms', async route => {
    const input = route.request().postDataJSON()
    queued.push(input)
    expect(input).toMatchObject({ p_native_amount: 59.99, p_currency: 'USD', p_card_id: 'credit-1' })
    return route.fulfill({ json: 'pending-usd' })
  })
  await page.route('**/rest/v1/foreign_card_sms*', route => route.fulfill({ json: completed === null ? [{ ...base, id: 'pending-usd', card_id: 'credit-1', native_amount: 59.99, currency: 'USD', description: 'STEAMGAMES.COM 4259522', spent_at: '2026-11-07T19:37:28+03:00', completed_amount: null, completed_at: null }] : [] }))
  await page.route('**/rest/v1/rpc/complete_foreign_card_sms', async route => {
    const input = route.request().postDataJSON()
    requests.push(input)
    if (completed === null) { completed = input.p_amount_tl; writes++ }
    if (requests.length === 1) return route.abort('connectionreset')
    return route.fulfill({ json: null })
  })
  await page.goto('/')
  await expect(page.getByText('1 dövizli işlemin kesin TL tutarı bekleniyor. Finansal toplamlar bu işlemleri içermiyor.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Dövizli işlemleri incele →', exact: true }).click()
  const pending = page.locator('#doviz-sms')
  await expect(pending.getByText('59,99 USD', { exact: true })).toBeVisible()
  await pending.screenshot({ path: 'test-results/foreign-sms-pending-320.png' })
  await expect(pending).toContainText('Bekleyen tutarlar borç ve harcama toplamlarına dahil değildir.')
  await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
  await expect(pending.getByText('59,99 USD', { exact: true })).toHaveCount(0)
  await expect(pending.getByText('•••• USD', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tutarları göster', exact: true }).click()
  await pending.getByRole('button', { name: 'Kesin TL tutarını gir' }).click()
  const dialog = page.getByRole('dialog', { name: 'Dövizli işlemi tamamla' })
  await dialog.getByLabel('Kesin TL tutarı', { exact: true }).fill('2600,25')
  await dialog.screenshot({ path: 'test-results/foreign-sms-complete-320.png' })
  await dialog.getByRole('button', { name: 'Harcamayı kaydet', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Kesin TL tutarı', { exact: true })).toHaveValue('2600,25')
  await dialog.getByRole('button', { name: 'Harcamayı kaydet', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(pending.getByText('Harcama kaydedildi.', { exact: true })).toBeVisible()
  await expect(pending.getByText('TL karşılığı bekleyen dövizli SMS yok.', { exact: true })).toBeVisible()
  expect(writes).toBe(1)
  expect(requests).toEqual([{ p_id: 'pending-usd', p_amount_tl: 2600.25 }, { p_id: 'pending-usd', p_amount_tl: 2600.25 }])
  expect(queued.length).toBeGreaterThan(0)
  expect(queued.every(input => input.p_source_event_id === queued[0].p_source_event_id)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1280, 'light']] as const) {
  test(`ara ve keşfet: arama, favoriler, klavye ve doğrudan bölüm açma ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, theme)
    await page.goto('/')
    const launcher = page.getByRole('button', { name: /^Ara ve keşfet/ })
    await launcher.click()
    const dialog = page.getByRole('dialog', { name: 'Ara ve keşfet' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Analiz ve raporlar', exact: true })).toBeVisible()
    await dialog.getByLabel('Özellik ara', { exact: true }).fill('her ay altin')
    await expect(dialog.getByRole('link', { name: /^Aylık hedef takibi/ })).toBeVisible()
    await dialog.getByRole('button', { name: 'Aylık hedef takibi: favorilere ekle', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(launcher).toBeFocused()
    await page.reload()
    await launcher.click()
    await expect(dialog.getByRole('region', { name: 'Favori kısayollar' }).getByRole('link', { name: 'Aylık hedef takibi', exact: true })).toBeVisible()
    await dialog.getByLabel('Özellik ara', { exact: true }).fill('xxxbilinmeyen')
    await expect(dialog.getByText('Bu aramayla eşleşen özellik bulunamadı.', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Tüm özellikleri göster' }).click()
    await dialog.getByRole('region', { name: 'Favori kısayollar' }).getByRole('link', { name: 'Aylık hedef takibi', exact: true }).click()
    await expect(page).toHaveURL(/\/odemeler\/hedefler#aylik-hedef$/)
    await expect(page.locator('details').filter({ has: page.locator('summary').getByText('Aylık takip', { exact: true }) })).toHaveAttribute('open', '')
    await expect(page.getByLabel('Örnek hedef aylık takibi')).toBeVisible()
    await launcher.click()
    await dialog.getByLabel('Özellik ara', { exact: true }).fill('bildirim')
    await dialog.getByRole('link', { name: /^Bildirim ayarları/ }).click()
    await expect(page).toHaveURL(/#bildirimler$/)
    const target = page.locator('#bildirimler')
    await expect(target.locator('details')).toHaveAttribute('open', '')
    await expect(target).toBeFocused()
    const bounds = await target.boundingBox()
    const header = await page.locator('header').first().boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1)
    await launcher.click()
    await dialog.getByLabel('Özellik ara', { exact: true }).fill('zekat')
    await dialog.getByRole('link', { name: /^Zekât hesaplayıcı/ }).click()
    await expect(page.locator('#zekat button').first()).toHaveAttribute('aria-expanded', 'true')
    await page.locator('#zekat button').first().click()
    await expect(page.locator('#zekat button').first()).toHaveAttribute('aria-expanded', 'false')
    await launcher.click()
    await dialog.getByLabel('Özellik ara', { exact: true }).fill('zekat')
    await dialog.getByRole('link', { name: /^Zekât hesaplayıcı/ }).click()
    await expect(page.locator('#zekat button').first()).toHaveAttribute('aria-expanded', 'true')
    await launcher.click()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: `test-results/feature-explorer-${width}.png` })
  })
}

test('özellik rehberindeki kapalı bölümler doğrudan bağlantı ile görünür olur', async ({ page }) => {
  await mockApp(page, 'light')
  for (const [url, id] of [
    ['/analiz#aylik-rapor', 'aylik-rapor'], ['/analiz#kategori-analizi', 'kategori-analizi'],
    ['/analiz#ay-kapanisi', 'ay-kapanisi'], ['/odemeler?view=plans#abonelikler', 'abonelikler'],
    ['/odemeler/hedefler#kasa', 'kasa'], ['/veri-sagligi/islemler#otomasyon', 'otomasyon'],
    ['/veri-sagligi/islemler#yedek', 'yedek'], ['/analiz/detay#kayit-arama', 'kayit-arama'],
    ['/analiz/detay#kredi-notu', 'kredi-notu'], ['/analiz/detay#enflasyon', 'enflasyon'], ['/analiz/detay#yil-sonu', 'yil-sonu'],
  ]) {
    await page.goto(url)
    const target = page.locator(`#${id}`)
    await expect(target).toBeVisible()
    await expect(target).toBeFocused()
    if (await target.locator('details').count()) await expect(target.locator('details').first()).toHaveAttribute('open', '')
    if (['kayit-arama', 'kredi-notu', 'enflasyon', 'yil-sonu'].includes(id)) await expect(target.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
  }
})

test('favori depolaması engellenirse oturum çalışır ve kalıcılık sınırı açıklanır', async ({ page }) => {
  await mockApp(page, 'light')
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('denge:feature-favorites:')) throw new DOMException('Blocked', 'SecurityError')
      return originalSet.call(this, key, value)
    }
  })
  await page.goto('/')
  const launcher = page.getByRole('button', { name: /^Ara ve keşfet/ })
  await launcher.click()
  const dialog = page.getByRole('dialog', { name: 'Ara ve keşfet' })
  await dialog.getByLabel('Özellik ara', { exact: true }).fill('findeks')
  await dialog.getByRole('button', { name: 'Kredi notum: favorilere ekle', exact: true }).click()
  await expect(dialog.getByText('Favoriler bu oturumda kullanılabilir; bu tarayıcıya kaydedilemedi.', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await launcher.click()
  await expect(dialog.getByRole('region', { name: 'Favori kısayollar' }).getByRole('link', { name: 'Kredi notum', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Kredi notum: favorilerden çıkar', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Favori kısayollar' }).getByRole('link')).toHaveCount(0)
})

test('aylık hedef: otomatik alım, geçmişe sıfır girişi, plan değişikliği ve elle toplamı kaldırma', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'light', {
    savings_goals: [{ ...tables.savings_goals[0], name: 'Altın hedefim', value_type: 'gram_altin', target_amount: 100, current_amount: 10 }],
    gold_lots: ['2026-10-02', '2026-11-02'].map((date, i) => ({ ...base, id: `lot-${i}`, gold_type: 'gram', direction: 'buy', purchase_date: date, quantity: 5, unit_price: 5000, ayar: 24 })),
  })
  await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'))
  let plans: Record<string, unknown>[] = []
  let entries: Record<string, unknown>[] = []
  let rejectSave = false
  for (const table of ['savings_goal_monthly_plans', 'savings_goal_monthly_entries']) {
    await page.route(`**/rest/v1/${table}*`, async route => {
      const request = route.request()
      if (request.method() === 'POST') {
        if (rejectSave) return route.fulfill({ status: 500, json: { message: 'Kayıt sırasında hata oluştu.' } })
        const row = { ...base, ...request.postDataJSON(), id: 'monthly-row' }
        if (table.endsWith('plans')) plans = [...plans.filter(p => p.effective_month !== row.effective_month), row]
        else entries = [...entries.filter(e => e.month !== row.month), row]
      }
      if (request.method() === 'DELETE') {
        const month = new URL(request.url()).searchParams.get('month')?.replace('eq.', '')
        entries = entries.filter(e => e.month !== month)
      }
      return route.fulfill({ json: table.endsWith('plans') ? plans : entries })
    })
  }
  await page.goto('/odemeler/hedefler')
  await page.getByText('Aylık takip', { exact: true }).click()
  await page.getByRole('button', { name: 'Aylık plan oluştur' }).click()
  await page.getByLabel('Aylık miktar (gram)', { exact: true }).fill('5')
  await page.getByLabel('Başlangıç ayı').fill('2026-09')
  await page.getByRole('button', { name: 'Planı kaydet' }).click()
  const tracking = page.getByLabel('Altın hedefim aylık takibi')
  await expect(tracking.getByText('✓ Tamamlandı', { exact: true })).toHaveCount(2)
  const september = tracking.getByRole('listitem').filter({ hasText: 'Eylül' })
  await expect(september.getByText('— Kayıt yok', { exact: true })).toBeVisible()
  await september.getByRole('button', { name: 'Gerçekleşen miktarı gir' }).click()
  await page.getByLabel('Gerçekleşen toplam (gram)', { exact: true }).fill('0')
  rejectSave = true
  await page.getByRole('button', { name: 'Miktarı kaydet' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  rejectSave = false
  await page.getByRole('button', { name: 'Miktarı kaydet' }).click()
  await expect(september.getByText('✕ Eksik kaldı', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Aylık planı değiştir' }).click()
  await page.getByLabel('Aylık miktar (gram)', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Planı kaydet' }).click()
  const november = tracking.getByRole('listitem').filter({ hasText: 'Kasım' })
  await expect(november.getByText('◷ Bekliyor', { exact: true })).toBeVisible()
  await expect(tracking.getByRole('listitem').filter({ hasText: 'Ekim' }).getByText('✓ Tamamlandı', { exact: true })).toBeVisible()
  await november.getByRole('button', { name: 'Gerçekleşen miktarı gir' }).click()
  await page.getByLabel('Gerçekleşen toplam (gram)', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Miktarı kaydet' }).click()
  await expect(november.getByText('✓ Tamamlandı', { exact: true })).toBeVisible()
  await november.getByRole('button', { name: 'Elle girişi kaldır' }).click()
  await expect(november.getByText('◷ Bekliyor', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByText('Aylık takip', { exact: true }).click()
  await expect(september.getByText('✕ Eksik kaldı', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/monthly-goal-320.png', fullPage: true })
  await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
  await expect(tracking.getByText('Her ay ••••', { exact: true })).toBeVisible()
  await expect(tracking.getByText('5 gram / 5 gram', { exact: false })).toHaveCount(0)
})

test('karma hedef: gram, çeyrek ve TL bileşenleri ayrı aylık plan ve gerçekleşme tutar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await mockApp(page, 'light', {
    savings_goals: [{ ...tables.savings_goals[0], name: 'Karma hedefim', value_type: 'composite', target_amount: 0, current_amount: 0 }],
    savings_goal_components: [
      { ...base, id: 'comp-gram', goal_id: 'goal-1', label: 'Gram birikimi', value_type: 'gram_altin', target_amount: 100, current_amount: 0, sort_order: 0 },
      { ...base, id: 'comp-quarter', goal_id: 'goal-1', label: 'Çeyrek birikimi', value_type: 'ceyrek_altin', target_amount: 20, current_amount: 0, sort_order: 1 },
      { ...base, id: 'comp-tl', goal_id: 'goal-1', label: 'Nakit birikimi', value_type: 'TRY', target_amount: 100000, current_amount: 0, sort_order: 2 },
    ],
    gold_lots: [{ ...base, id: 'lot-gram', gold_type: 'gram', direction: 'buy', purchase_date: '2026-11-02', quantity: 5, unit_price: 5000, ayar: 24 }],
  })
  await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'))
  let plans: Record<string, unknown>[] = []
  let entries: Record<string, unknown>[] = []
  for (const table of ['savings_goal_component_monthly_plans', 'savings_goal_component_monthly_entries']) {
    await page.route(`**/rest/v1/${table}*`, async route => {
      const request = route.request()
      if (request.method() === 'POST') {
        const row = { ...base, ...request.postDataJSON(), id: `monthly-${request.postDataJSON().component_id}` }
        if (table.endsWith('plans')) plans = [...plans.filter(p => p.component_id !== row.component_id || p.effective_month !== row.effective_month), row]
        else entries = [...entries.filter(e => e.component_id !== row.component_id || e.month !== row.month), row]
      }
      if (request.method() === 'DELETE') {
        const params = new URL(request.url()).searchParams
        const month = params.get('month')?.replace('eq.', '')
        const componentId = params.get('component_id')?.replace('eq.', '')
        expect(componentId).toBeTruthy()
        entries = entries.filter(e => e.month !== month || e.component_id !== componentId)
      }
      return route.fulfill({ json: table.endsWith('plans') ? plans : entries })
    })
  }
  await page.goto('/odemeler/hedefler')
  await page.getByText('Aylık takip', { exact: true }).click()
  for (const [label, unit, amount] of [['Gram birikimi', 'gram', '5'], ['Çeyrek birikimi', 'çeyrek', '1'], ['Nakit birikimi', 'TL', '10000']]) {
    await page.locator('summary').filter({ hasText: `${label} · ${unit}` }).click()
    const tracking = page.getByLabel(`Karma hedefim · ${label} aylık takibi`, { exact: true })
    await tracking.getByRole('button', { name: 'Aylık plan oluştur' }).click()
    await page.getByLabel(`Aylık miktar (${unit})`, { exact: true }).fill(amount)
    if (unit === 'TL') await expect(page.getByRole('dialog').getByRole('combobox').locator('option')).toHaveCount(1)
    await page.getByRole('button', { name: 'Planı kaydet' }).click()
    await expect(tracking.getByText(unit === 'gram' ? '✓ Tamamlandı' : '◷ Bekliyor', { exact: true })).toBeVisible()
  }
  expect(plans.map(p => [p.component_id, p.value_type, p.target_amount, p.source])).toEqual([
    ['comp-gram', 'gram_altin', 5, 'gold_buys'], ['comp-quarter', 'ceyrek_altin', 1, 'gold_buys'], ['comp-tl', 'TRY', 10000, 'manual'],
  ])
  const gram = page.getByLabel('Karma hedefim · Gram birikimi aylık takibi', { exact: true })
  const quarter = page.getByLabel('Karma hedefim · Çeyrek birikimi aylık takibi', { exact: true })
  const tl = page.getByLabel('Karma hedefim · Nakit birikimi aylık takibi', { exact: true })
  for (const [tracking, unit, amount] of [[quarter, 'çeyrek', '1'], [tl, 'TL', '10000']] as const) {
    await tracking.getByRole('button', { name: 'Gerçekleşen miktarı gir' }).click()
    await page.getByLabel(`Gerçekleşen toplam (${unit})`, { exact: true }).fill(amount)
    await page.getByRole('button', { name: 'Miktarı kaydet' }).click()
    await expect(tracking.getByText('✓ Tamamlandı', { exact: true })).toBeVisible()
  }
  await quarter.getByRole('button', { name: 'Elle girişi kaldır' }).click()
  await expect(quarter.getByText('◷ Bekliyor', { exact: true })).toBeVisible()
  await expect(gram.getByText('✓ Tamamlandı', { exact: true })).toBeVisible()
  await expect(tl.getByText('✓ Tamamlandı', { exact: true })).toBeVisible()
  await gram.getByRole('button', { name: 'Aylık planı değiştir' }).click()
  await page.getByLabel('Aylık miktar (gram)', { exact: true }).fill('6')
  await page.getByRole('button', { name: 'Planı kaydet' }).click()
  await expect(gram.getByText('◷ Bekliyor', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByText('Aylık takip', { exact: true }).click()
  for (const label of ['Gram birikimi · gram', 'Çeyrek birikimi · çeyrek', 'Nakit birikimi · TL']) await page.locator('summary').filter({ hasText: label }).click()
  await expect(gram.getByText('Her ay 6 gram', { exact: true })).toBeVisible()
  await expect(quarter.getByText('Her ay 1 çeyrek', { exact: true })).toBeVisible()
  await expect(tl.getByText('✓ Tamamlandı', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/component-monthly-320.png', fullPage: true })
  await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
  await expect(page.getByText('Her ay ••••', { exact: true })).toHaveCount(3)
})

for (const width of [320, 390, 768]) {
  test(`grafik eksenleri gerçek yazı boyutunda çakışmaz: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, width === 390 ? 'dark' : 'light', {
      gold_lots: Array.from({ length: 30 }, (_, i) => ({ ...base, id: `lot-${i}`, purchase_date: `2026-09-${String(i + 1).padStart(2, '0')}`, quantity: 50, unit_price: 5000, direction: 'buy', gold_type: 'gram', ayar: 24 })),
      net_worth_snapshots: Array.from({ length: 30 }, (_, i) => ({ ...base, id: `snap-${i}`, snapshot_date: `2026-09-${String(i + 1).padStart(2, '0')}`, net_worth: (i + 1) * 1000000, gold_try: 5000, usd_try: 40 })),
    })
    for (const path of ['/varliklar/altin', '/analiz']) {
      await page.goto(path)
      if (path.includes('altin')) await page.locator('summary').filter({ hasText: 'Birikim grafiği' }).click()
      await expect(page.locator('[data-axis="x"]').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const problems = await page.locator('svg:has([data-axis="x"])').evaluateAll(svgs => svgs.flatMap(svg => {
        const errors: string[] = []
        const bounds = svg.getBoundingClientRect()
        const horizontal = [...svg.querySelectorAll('[data-axis="x"] > text')].map(el => el.getBoundingClientRect())
        const vertical = [...svg.querySelectorAll(':scope > text')].map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top)
        for (const [i, box] of horizontal.entries()) {
          if (box.left < bounds.left || box.right > bounds.right + 1) errors.push('X etiketi kırpılıyor')
          if (i && box.left < horizontal[i - 1].right + 4) errors.push('X etiketleri çakışıyor')
        }
        for (const [i, box] of vertical.entries()) {
          if (box.left < bounds.left || box.top < bounds.top - 1) errors.push('Y etiketi kırpılıyor')
          if (i && box.top < vertical[i - 1].bottom + 4) errors.push('Y etiketleri çakışıyor')
        }
        return errors
      }))
      expect(problems).toEqual([])
      const chart = page.locator('svg:has([data-axis="x"])').first()
      await chart.evaluate(element => element.scrollIntoView({ block: 'center' }))
      const points = chart.locator(path.includes('altin') ? 'rect[fill="transparent"]' : 'g > rect[fill]:not([fill="transparent"])')
      const count = await points.count()
      for (const index of [0, Math.floor(count / 2), count - 1]) {
        await points.nth(index).hover()
        const tooltip = chart.locator('..').locator('[role="tooltip"], foreignObject > div')
        await expect(tooltip).toBeVisible()
        const clipping = await tooltip.evaluate(element => {
          const chartBox = element.closest('[role="img"]')!.getBoundingClientRect()
          const bounds = element.closest('foreignObject')?.getBoundingClientRect() ?? element.getBoundingClientRect()
          const errors: string[] = []
          if (bounds.left < chartBox.left || bounds.right > chartBox.right + 1 || bounds.top < chartBox.top || bounds.bottom > chartBox.bottom + 1) errors.push('Bilgi kutusu grafik dışına taşıyor')
          for (const child of element.querySelectorAll('p, span')) {
            const box = child.getBoundingClientRect()
            if (box.bottom > bounds.bottom + 1 || box.right > bounds.right + 1 || box.left < bounds.left - 1) errors.push('Bilgi kutusunda içerik kesiliyor')
            if (child.classList.contains('font-mono')) {
              const range = document.createRange()
              range.selectNodeContents(child)
              if (range.getClientRects().length > 1) errors.push('Tutar birden fazla satıra bölünüyor')
            }
          }
          return errors
        })
        expect(clipping).toEqual([])
      }
      // Dokunmayı, kaydırma sonrasında gelebilen eski mouseleave'den ayır.
      await page.mouse.move(0, 0)
      await chart.evaluate(element => element.scrollIntoView({ block: 'center' }))
      await expect(chart.locator('..').getByRole('tooltip')).toHaveCount(0)
      await points.first().dispatchEvent('pointerdown', { pointerType: 'touch' })
      await expect(chart.locator('..').getByRole('tooltip')).toBeVisible()
      await chart.locator('..').screenshot({ path: `test-results/chart-tooltip-${path.includes('altin') ? 'line' : 'bar'}-${width}.png` })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      await page.screenshot({ path: `test-results/chart-${path.includes('altin') ? 'line' : 'bar'}-${width}.png`, fullPage: true })
    }
  })
}

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
  test(`uzun hesap geçmişinin eski kayıtlarına ulaşılır: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, width === 390 ? 'dark' : 'light', {
      cards: [{ ...bank, current_balance: 1206 }],
      account_ledger: Array.from({ length: 1206 }, (_, i) => ({ ...base, id: String(i).padStart(6, '0'), card_id: 'bank-1', kind: 'deposit', amount_kurus: 100, occurred_at: now, source_table: null, source_id: null, note: `Hesap açıklaması ${i}: Eski kayıtlara erişim korunmalı.` })),
    })
    await page.goto('/kartlar?section=hesaplar&card=bank-1')
    const list = page.getByRole('list', { name: 'Hesap hareketi kayıtları' })
    await expect(list.getByRole('listitem')).toHaveCount(8)
    await expect(list).toContainText('Hesap açıklaması 1205:')
    await expect(page.getByRole('button', { name: /ledger.a göre düzelt/i })).toHaveCount(0)
    await page.getByRole('button', { name: 'En eski', exact: true }).click()
    await expect(list.getByRole('listitem')).toHaveCount(6)
    await expect(list).toContainText('Hesap açıklaması 0:')
    await expect(list).toBeFocused()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await list.screenshot({ path: `test-results/account-ledger-${width}.png` })
    await page.getByRole('searchbox', { name: 'Hareketlerde ara' }).fill('açıklaması 605:')
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list).toContainText('Hesap açıklaması 605:')
    await expect(page.getByText('1 / 1206 hareket bulundu')).toBeVisible()
    await expect(page.getByText('1206 kayıt · Toplamlar tüm geçmiş içindir')).toBeVisible()
  })

  test(`uzun kart geçmişi tam okunur ve sayfalanır: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApp(page, width === 390 ? 'dark' : 'light', {
      cards: [{ ...tables.cards[2], debt_amount: 1005, current_period_spending: 1005 }],
      card_ledger: Array.from({ length: 1005 }, (_, i) => ({ ...base, id: String(i).padStart(6, '0'), card_id: 'credit-1', kind: 'debit', amount_kurus: 100, occurred_at: now, source_table: null, source_id: null, statement_delta_kurus: null, current_delta_kurus: null, provision_delta_kurus: null, note: `Deneme açıklaması ${i}: Önceki hareketlerin bütün açıklamaları dar ekranda da kesilmeden okunabilmeli. Ödeme 100 TL.` })),
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
    await page.getByRole('button', { name: 'Tutarları gizle', exact: true }).click()
    await expect(list).not.toContainText('100 TL')
    await expect(list).toContainText('Ödeme •••• ₺')
    await ledger.screenshot({ path: `test-results/card-ledger-${width}.png` })
  })
}

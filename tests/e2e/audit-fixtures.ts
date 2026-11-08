import type { Page } from '@playwright/test'
// Tüm dış istekler sentetik yanıtlanır: bu test gerçek Supabase'e bağlanamaz.
export const userId = '11111111-1111-4111-8111-111111111111'
export const now = '2026-10-26T09:00:00.000Z'
export const base = { user_id: userId, created_at: now, updated_at: now, note: null }
const bank = { ...base, id: 'bank-1', bank_name: 'İş Bankası', card_name: 'Örnek hesap', card_type: 'banka_karti', account_kind: 'bank', current_balance: 20000, credit_limit: 0, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0, statement_day: null, due_day: null, holder_name: null, account_number: null, limit_group_name: null }
export const tables: Record<string, Record<string, unknown>[]> = {
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

export async function mockApp(page: Page, theme: string, overrides: typeof tables = {}) {
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

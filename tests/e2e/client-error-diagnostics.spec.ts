import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Yazma testi yalnız seed'li loopback Supabase + production preview üzerinde koşar.
const api = process.env.DIAGNOSTICS_LOCAL_API
const key = process.env.DIAGNOSTICS_LOCAL_ANON_KEY
const base = process.env.PLAYWRIGHT_BASE_URL
const local = (value: string | undefined) => Boolean(value && ['127.0.0.1', 'localhost'].includes(new URL(value).hostname))
test('istemci hatası → own-row DB → ayrıntı → kopyalama', async ({ page, context }) => {
  test.skip(!api || !key || !local(api) || !local(base), 'Seed yerel Supabase ve production preview gerekir.')
  const db = createClient(api!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await db.auth.signInWithPassword({ email: 't@t.com', password: 'password123' })
  expect(error).toBeNull()
  const marker = `LOCAL-E2E-DIAGNOSTICS-${Date.now().toString(36)}`
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // Dış servisler test verisini alamaz; analytics yükleyicisi boş betikle karşılanır.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort()
    if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    return route.continue()
  })
  try {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill('t@t.com')
    await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Finans özeti', exact: true })).toBeVisible()
    await page.evaluate(marker => {
      const error = new Error(`${marker} password=example-secret`)
      window.dispatchEvent(new ErrorEvent('error', { error, message: error.message,
        filename: `${location.origin}/assets/controlled-test.js?access_token=example-token`, lineno: 42, colno: 7 }))
    }, marker)
    await expect.poll(async () => {
      const { data } = await db.from('client_errors').select('id').ilike('message', `%${marker}%`)
      return data?.length ?? 0
    }).toBe(1)
    const { data } = await db.from('client_errors').select('*').ilike('message', `%${marker}%`).single()
    expect(data.diagnostics).toMatchObject({ version: 1, line: 42, column: 7, opaque: false })
    expect(JSON.stringify(data)).not.toContain('example-secret')
    expect(JSON.stringify(data)).not.toContain('example-token')
    expect(data.stack).toContain(marker)
    await page.goto('/veri-sagligi/islemler')
    const row = page.locator('li').filter({ hasText: marker })
    await row.getByText('Teşhis ayrıntıları', { exact: true }).click()
    await expect(row.locator('pre')).toContainText('"line": 42')
    await row.getByRole('button', { name: 'Teşhis raporunu kopyala' }).click()
    await expect(row.getByRole('status')).toHaveText('Rapor kopyalandı.')
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(JSON.parse(clipboard).diagnostics.line).toBe(42)
    expect(clipboard).not.toContain('user_id')
    await page.screenshot({ path: 'test-results/client-error-diagnostics.png', fullPage: true })
  } finally {
    await db.from('client_errors').delete().ilike('message', `%${marker}%`)
    await db.auth.signOut()
  }
})

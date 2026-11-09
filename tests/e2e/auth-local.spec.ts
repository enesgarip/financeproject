import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test.skip(process.env.E2E_LOCAL_AUTH_SMOKE !== '1', 'yerel Supabase ve demo seed gerekir')

test('demo kullanıcı giriş yapınca gerçek finans snapshotı ve Özet açılır', async ({ page, baseURL }) => {
  const app = new URL('/', baseURL)
  const backend = new URL(process.env.VITE_SUPABASE_URL ?? '')
  for (const url of [app, backend]) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      throw new Error('Demo girişi yalnızca 127.0.0.1 üzerindeki uygulama ve Supabase ile çalışır.')
    }
  }

  await page.route('**/*', route => {
    const { origin } = new URL(route.request().url())
    return origin === app.origin || origin === backend.origin ? route.continue() : route.abort()
  })
  await page.goto('/login')
  await page.getByLabel('E-posta adresi', { exact: true }).fill('t@t.com')
  await page.getByLabel('Şifre', { exact: true }).fill('password123')

  const snapshotURL = new URL('/rest/v1/rpc/fetch_finance_snapshot', backend)
  const [snapshot] = await Promise.all([
    page.waitForResponse(response => response.url() === snapshotURL.href && response.ok()),
    page.getByRole('button', { name: 'Giriş yap', exact: true }).click(),
  ])
  const data = await snapshot.json()
  expect(data.cards).toEqual(expect.arrayContaining([expect.objectContaining({ card_name: 'Vadesiz TL' })]))
  await expect(page).toHaveURL(app.href)
  await expect(page.getByText('Ay sonuna kalan', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Hesaplamak için veri yok')).toHaveCount(0)
})

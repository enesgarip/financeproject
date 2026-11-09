import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('unauthenticated user is redirected to login and can reload the form', async ({ page, baseURL }) => {
  const login = new URL('/login', baseURL)
  // Yayın kontrolü gerçek kullanıcı oturumu açmaz ve üçüncü taraflara istek atmaz.
  await page.route('**/*', route => new URL(route.request().url()).origin === login.origin ? route.continue() : route.abort())
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  const home = await page.goto('/')
  expect(home?.ok()).toBe(true)
  await expect(page).toHaveURL(login.href)

  const direct = await page.reload()
  expect(direct?.ok()).toBe(true)
  await expect(page).toHaveURL(login.href)
  const form = page.getByRole('main').locator('form')
  await expect(form.getByLabel('E-posta adresi', { exact: true })).toBeVisible()
  await expect(form.getByLabel('Şifre', { exact: true })).toBeVisible()
  await expect(form.getByRole('button', { name: 'Giriş yap', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

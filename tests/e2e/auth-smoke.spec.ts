import { expect, test } from '@playwright/test'

test('unauthenticated user is redirected to login and sees auth form', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('form')).toBeVisible()
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

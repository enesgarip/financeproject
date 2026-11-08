import { defineConfig, devices } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  workers: 2,
  testMatch: 'audit-remediation.spec.ts',
  projects: [
    { name: 'chromium-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ fetch: vi.fn(), clear: vi.fn(), copy: vi.fn() }))
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
vi.mock('../../data/repositories/clientErrorsRepo', () => ({ fetchRecentClientErrors: mock.fetch, clearClientErrors: mock.clear }))
import { ClientErrorsPanel } from './ClientErrorsPanel'
const legacy = { id: 'e1', created_at: '2026-10-16T12:38:34Z', source: 'error', message: 'Script error.', route: '/', commit_sha: '426a5a0', user_agent: 'Browser', fingerprint: 'hash', stack: 'at old.js:1:25' }
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ClientErrorsPanel /></QueryClientProvider>) }
beforeEach(() => {
  mock.fetch.mockReset().mockResolvedValue({ ok: true, data: [legacy] })
  mock.copy.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mock.copy } })
})
afterEach(cleanup)
it('eski kaydın saklanan hata izini ve tarayıcısını açar, raporu kopyalar', async () => {
  show()
  await screen.findByText('Script error.')
  fireEvent.click(screen.getByText('Teşhis ayrıntıları'))
  expect(screen.getByText(/Eski kayıt:/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Teşhis raporunu kopyala' }))
  await screen.findByText('Rapor kopyalandı.')
  const report = JSON.parse(mock.copy.mock.calls[0][0])
  expect(report).toMatchObject({ release: '426a5a0', stack: 'at old.js:1:25', user_agent: 'Browser' })
  expect(report.user_id).toBeUndefined()
})
it('opak kayıt sınırını açıklar ve kopyalama hatasını görünür kılar', async () => {
  mock.fetch.mockResolvedValue({ ok: true, data: [{ ...legacy, diagnostics: { version: 1, opaque: true, line: null } }] })
  mock.copy.mockRejectedValue(new Error('denied'))
  show()
  await screen.findByText('Script error.')
  fireEvent.click(screen.getByText('Teşhis ayrıntıları'))
  expect(screen.getByText(/Tarayıcı hata ayrıntılarını gizledi/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Teşhis raporunu kopyala' }))
  await screen.findByText(/Kopyalanamadı/)
})
it('sorgu başarısızken temiz raporu vermez', async () => {
  mock.fetch.mockResolvedValue({ ok: false, error: { message: 'offline' } })
  show()
  await waitFor(() => expect(screen.getByText(/Kayıtlar yüklenemedi/)).toBeTruthy())
  expect(screen.queryByText('Son 7 günde kayıtlı istemci hatası yok.')).toBeNull()
})

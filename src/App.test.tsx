// @vitest-environment happy-dom
import { StrictMode, useEffect, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Outlet } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

const { shellMounted, recordUsage, beforeSend } = vi.hoisted(() => ({
  shellMounted: vi.fn(),
  recordUsage: vi.fn(),
  beforeSend: vi.fn(),
}))
vi.mock('./auth/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }))
vi.mock('./lib/usageTelemetry', () => ({ recordUsage }))
vi.mock('./auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => children }))
vi.mock('./components/ui/toast', () => ({ ToastProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: ({ beforeSend: redact }: { beforeSend: (event: { url: string }) => unknown }) => {
  beforeSend.mockImplementation(redact)
  return null
} }))
vi.mock('./components/Layout', () => ({ Layout: () => {
  useEffect(() => { shellMounted() }, [])
  return <><aside data-testid="shell"><Link to="/">Özet</Link><Link to="/kartlar">Hesaplar</Link><Link to="/kartlar?card=private-id#section">Hesap ayrıntısı</Link></aside><Outlet /></>
} }))
vi.mock('./pages/DashboardPage', () => ({ DashboardPage: () => <input aria-label="Sayfa taslağı" defaultValue="" /> }))
vi.mock('./pages/CardsPage', () => ({ CardsPage: () => <p>Hesap listesi</p> }))
import { App } from './App'

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('sayfalar değişince kabuğu korur, sayfa durumunu ve geçiş sınırını yeniler', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  render(<MemoryRouter><App /></MemoryRouter>)
  const draft = await screen.findByLabelText('Sayfa taslağı')
  fireEvent.change(draft, { target: { value: 'Eski sayfa' } })
  const shell = screen.getByTestId('shell')
  fireEvent.click(screen.getByText('Hesaplar'))
  await screen.findByText('Hesap listesi')
  expect(screen.getByTestId('shell')).toBe(shell)
  expect(shellMounted).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('Özet'))
  await waitFor(() => expect((screen.getByLabelText('Sayfa taslağı') as HTMLInputElement).value).toBe(''))
  expect(screen.getByTestId('shell')).toBe(shell)
})

it('gerçek sayfa geçişini bir kez sayar ve Vercel olayından URL ayrıntılarını temizler', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  render(<StrictMode><MemoryRouter><App /></MemoryRouter></StrictMode>)
  await screen.findByLabelText('Sayfa taslağı')
  fireEvent.click(screen.getByText('Hesaplar'))
  await screen.findByText('Hesap listesi')
  fireEvent.click(screen.getByText('Hesap ayrıntısı'))
  expect(recordUsage.mock.calls).toEqual([
    ['test-user', { kind: 'page', subject: '/' }],
    ['test-user', { kind: 'page', subject: '/kartlar' }],
  ])
  expect(beforeSend({ type: 'pageview', url: 'https://denge.example/kartlar?card=private-id#section' }))
    .toEqual({ type: 'pageview', url: 'https://denge.example/kartlar' })
  expect(beforeSend({ type: 'pageview', url: 'https://denge.example/private-id' })).toBeNull()
})

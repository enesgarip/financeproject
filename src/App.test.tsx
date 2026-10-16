// @vitest-environment happy-dom
import { useEffect, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Outlet } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

const shellMounted = vi.hoisted(() => vi.fn())
vi.mock('./auth/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: ReactNode }) => children }))
vi.mock('./components/ui/toast', () => ({ ToastProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))
vi.mock('./components/Layout', () => ({ Layout: () => {
  useEffect(() => { shellMounted() }, [])
  return <><aside data-testid="shell"><Link to="/">Özet</Link><Link to="/kartlar">Hesaplar</Link></aside><Outlet /></>
} }))
vi.mock('./pages/DashboardPage', () => ({ DashboardPage: () => <input aria-label="Sayfa taslağı" defaultValue="" /> }))
vi.mock('./pages/CardsPage', () => ({ CardsPage: () => <p>Hesap listesi</p> }))
import { App } from './App'

afterEach(() => { cleanup(); vi.clearAllMocks() })

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
  vi.unstubAllGlobals()
})

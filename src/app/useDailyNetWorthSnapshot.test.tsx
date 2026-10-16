// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDailyNetWorthSnapshot } from './useDailyNetWorthSnapshot'

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  snapshot: { assets: [], cards: [], loans: [], loanInstallments: [], debts: [], payments: [], salaryHistory: [], cardInstallments: [], savingsGoals: [] },
  record: vi.fn(), fetch: vi.fn(),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../data/repositories/analysisRepo', () => ({ recordNetWorthSnapshot: mocks.record }))
vi.mock('../data/repositories/financeSnapshotRepo', () => ({ fetchFinanceSnapshot: mocks.fetch }))
vi.mock('../utils/financeSummary', () => ({ buildFinancialPosition: () => ({ netWorth: 100 }) }))
vi.mock('../lib/marketRatesClient', () => ({ ensureRatesLoaded: async () => null }))

const clients: QueryClient[] = []
function setup() {
  const client = new QueryClient()
  clients.push(client)
  client.setQueryData(['finance-snapshot', 'u1'], mocks.snapshot)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  return renderHook(() => {
    useDailyNetWorthSnapshot()
    return useNavigate()
  }, { wrapper })
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await vi.dynamicImportSettled()
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T12:00:00'))
  localStorage.clear()
  mocks.user = { id: 'u1' }
  mocks.record.mockReset().mockResolvedValue({ ok: true })
  mocks.fetch.mockReset().mockResolvedValue(mocks.snapshot)
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); localStorage.clear() })

it('gezinme 4 sn beklemeyi başa döndürmez; başarılı kayıt aynı gün yinelenmez', async () => {
  const hook = setup()
  await advance(2000)
  act(() => hook.result.current('/kartlar'))
  await advance(2000)
  expect(mocks.record).toHaveBeenCalledTimes(1)
  expect(mocks.fetch).not.toHaveBeenCalled()
  act(() => hook.result.current('/analiz'))
  await advance(4000)
  expect(mocks.record).toHaveBeenCalledTimes(1)
})

it('gece açık kalan kabukta ertesi gün gezinince dünkü cache yerine taze snapshot yazar', async () => {
  const hook = setup()
  await advance(4000)
  vi.setSystemTime(new Date('2026-10-17T12:00:00'))
  act(() => hook.result.current('/kartlar'))
  await advance(4000)
  expect(mocks.record).toHaveBeenCalledTimes(2)
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem('denge:net-worth-snapshot-day')).toBe('u1:2026-10-17')
})

it('başarısız kaydı sonraki gezinmede yeniden dener', async () => {
  mocks.record.mockResolvedValueOnce({ ok: false })
  const hook = setup()
  await advance(4000)
  expect(localStorage.getItem('denge:net-worth-snapshot-day')).toBeNull()
  act(() => hook.result.current('/analiz'))
  await advance(4000)
  expect(mocks.record).toHaveBeenCalledTimes(2)
  expect(localStorage.getItem('denge:net-worth-snapshot-day')).toBe('u1:2026-10-16')
})

it('çıkışta bekleyen koşuyu iptal eder', async () => {
  const hook = setup()
  await advance(2000)
  mocks.user = null
  hook.rerender()
  await advance(4000)
  expect(mocks.record).not.toHaveBeenCalled()
})

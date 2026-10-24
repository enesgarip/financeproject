// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useInvalidateFinanceSnapshot } from './useFinanceSnapshot'
import { useCrudRows } from './useCrudRows'

const mocks = vi.hoisted(() => ({ rows: vi.fn() }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../data/repositories/crudRepo', () => ({ fetchCrudRows: mocks.rows }))
vi.mock('../data/repositories/financeSnapshotRepo', () => ({ fetchFinanceSnapshot: vi.fn(), runFinanceMaintenance: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('ödeme sonrası aktif hesap listesini yeniler; kapalı finans listeleri eski cache ile açılmaz', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const tables = ['cards', 'payments', 'loans', 'debts', 'assets', 'stock_trades']
  const keys = tables.map((table) => ['crud-rows', table, 'u1', 'created_at', false])
  const otherKeys = [
    ['crud-rows', 'cards', 'u2', 'created_at', false], ['finance-snapshot', 'u2'],
    ['account-ledger-recent', 'u2', 'c1'], ['card-expense-pace', 'u2', '2026-10-01'],
  ]
  const detailKeys = [
    ['finance-snapshot', 'u1'], ['card-page-data', 'u1', 'statements'],
    ['account-ledger-recent', 'u1', 'c1'], ['card-expense-pace', 'u1', '2026-10-01'],
  ]
  for (const key of [...keys, ...otherKeys, ...detailKeys]) client.setQueryData(key, [])
  client.setQueryData(keys[0], [{ id: 'c1', current_balance: 100 }])
  mocks.rows.mockResolvedValue({ ok: true, data: [{ id: 'c1', current_balance: 75 }] })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  try {
    const hook = renderHook(() => ({ rows: useCrudRows('cards', 'created_at', false), invalidate: useInvalidateFinanceSnapshot() }), { wrapper })
    expect(hook.result.current.rows.data?.[0].current_balance).toBe(100)
    await act(async () => hook.result.current.invalidate())
    await waitFor(() => expect(hook.result.current.rows.data?.[0].current_balance).toBe(75))
    for (const key of [...keys.slice(1), ...detailKeys]) expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(true)
    for (const key of otherKeys) expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(false)
    expect(mocks.rows).toHaveBeenCalledTimes(1)
  } finally { client.clear() }
})

// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../hooks/useBalancePrivacy'
import { GoldPage } from './GoldPage'
import type { GoldLot } from '../types/database'

const mocks = vi.hoisted(() => ({ sync: vi.fn(), invalidate: vi.fn() }))
const rows = [{ id: 'g1', gold_type: 'gram', quantity: 1, direction: 'buy', unit_price: 100, purchase_date: null }] as GoldLot[]
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../app/useFinanceSnapshot', () => ({ useFinanceSnapshot: () => ({ data: { assets: [] } }), useInvalidateFinanceSnapshot: () => mocks.invalidate }))
vi.mock('../utils/goldLedgerSync', () => ({ syncGoldLedgerAssets: mocks.sync }))
vi.mock('../hooks/useMarketRates', () => ({ useMarketRates: () => ({ snapshot: null }) }))
vi.mock('../components/finance/RatesBanner', () => ({ RatesBanner: () => null }))
vi.mock('../components/CrudPage', () => ({ CrudPage: ({ renderBeforeList }: { renderBeforeList: (props: unknown) => ReactNode }) => renderBeforeList({ rows, loading: false, reload: vi.fn(), setError: vi.fn() }) }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each([0, 1])('altın varlık senkronunda %s değişiklik varsa ortak ekranları yalnız gerektiğinde yeniler', async (updated) => {
  mocks.sync.mockResolvedValue({ inserted: 0, updated, deleted: 0 })
  render(<BalancePrivacyProvider><GoldPage /></BalancePrivacyProvider>)
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(updated))
})

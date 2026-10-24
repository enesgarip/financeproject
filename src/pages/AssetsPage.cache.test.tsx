// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../hooks/useBalancePrivacy'
import type { Asset, Card } from '../types/database'
import { AssetsPage } from './AssetsPage'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), trade: vi.fn(), prices: {} }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../data/repositories/crudRepo', () => ({ fetchCrudRows: mocks.fetch, saveCrudRow: vi.fn(), deleteCrudRow: vi.fn() }))
vi.mock('../data/repositories/financeSnapshotRepo', () => ({ fetchFinanceSnapshot: vi.fn(), runFinanceMaintenance: vi.fn() }))
vi.mock('../services/assetTrades', () => ({ submitAssetTrade: mocks.trade, assetTradeRequiresQuantity: () => true }))
vi.mock('../hooks/useMarketRates', () => ({ useMarketRates: () => ({ snapshot: null }) }))
vi.mock('../hooks/useStockPrices', () => ({ useStockPrices: () => mocks.prices }))
vi.mock('../components/finance/RatesBanner', () => ({ RatesBanner: () => null }))
vi.mock('../components/finance/AssetValueHistoryPanel', () => ({ AssetValueHistoryPanel: () => null }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('gerçek alım formu sonrası snapshot, hesap, varlık ve kapalı hisse defteri cachelerini yeniler', async () => {
  const asset = { id: 'a1', name: 'THY', category: 'Hisse', amount: 10, symbol: 'THYAO', unit: 'TRY',
    estimated_value_try: 100, auto_valued: false, unit_cost: 10 } as Asset
  const account = { id: 'c1', bank_name: 'Banka', card_name: 'Hesap', card_type: 'banka_karti', current_balance: 1000 } as Card
  let saved = false
  mocks.fetch.mockImplementation(async (table: string) => ({ ok: true, data: table === 'cards'
    ? [{ ...account, current_balance: saved ? 975 : 1000 }]
    : [{ ...asset, amount: saved ? 11 : 10, estimated_value_try: saved ? 125 : 100 }] }))
  mocks.trade.mockImplementation(async () => { saved = true; return { error: null } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const snapshotKey = ['finance-snapshot', 'u1']
  const tradesKey = ['crud-rows', 'stock_trades', 'u1', 'trade_date', false]
  client.setQueryData(snapshotKey, {})
  client.setQueryData(tradesKey, [])
  try {
    render(<QueryClientProvider client={client}><MemoryRouter><BalancePrivacyProvider><AssetsPage /></BalancePrivacyProvider></MemoryRouter></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Al' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('İşlem tutarı'), { target: { value: '25' } })
    fireEvent.change(dialog.getByLabelText(/^Adet/), { target: { value: '1' } })
    fireEvent.submit(dialog.getByRole('button', { name: 'Alımı tamamla' }).closest('form')!)
    await waitFor(() => expect(mocks.trade).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(client.getQueryData<Card[]>(['crud-rows', 'cards', 'u1', 'created_at', false])?.[0].current_balance).toBe(975))
    expect(client.getQueryData<Asset[]>(['crud-rows', 'assets', 'u1', 'created_at', false])?.[0].amount).toBe(11)
    expect(client.getQueryState(snapshotKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(tradesKey)?.isInvalidated).toBe(true)
  } finally { client.clear() }
})

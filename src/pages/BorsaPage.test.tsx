// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../hooks/useBalancePrivacy'
import type { Asset, StockTrade } from '../types/database'
import { BorsaPage } from './BorsaPage'

const mocks = vi.hoisted(() => ({ assetsFetching: false, tradesFetching: false }))
const assets = [{ category: 'Hisse', symbol: 'THYAO', amount: 20 }] as Asset[]
const trades = [{ id: 't1', symbol: 'THYAO', kind: 'buy', quantity: 10, unit_price: 10, fee: 0, trade_date: '2026-10-24' }] as StockTrade[]
vi.mock('../app/useCrudRows', () => ({ useCrudRows: (table: string) => ({
  data: table === 'assets' ? assets : trades, isFetching: table === 'assets' ? mocks.assetsFetching : mocks.tradesFetching,
}) }))
vi.mock('../components/CrudPage', () => ({ CrudPage: ({ renderBeforeList }: { renderBeforeList: (props: unknown) => ReactNode }) => renderBeforeList({ loading: false, rows: trades, reload: vi.fn() }) }))
vi.mock('../components/finance/RatesBanner', () => ({ RatesBanner: () => null }))
vi.mock('../hooks/useStockPrices', () => ({ useStockPrices: () => ({ THYAO: 10 }) }))
afterEach(() => { cleanup(); mocks.assetsFetching = false; mocks.tradesFetching = false })

it.each(['assets', 'trades'])('%s yenilenirken eski/yeni portföyden sahte uyuşmazlık sunmaz', (pending) => {
  mocks.assetsFetching = pending === 'assets'
  mocks.tradesFetching = pending === 'trades'
  const view = render(<BalancePrivacyProvider><BorsaPage /></BalancePrivacyProvider>)
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText(/Defter ile Varlıklar satırı uyuşmuyor/)).toBeNull()
  mocks.assetsFetching = false
  mocks.tradesFetching = false
  view.rerender(<BalancePrivacyProvider><BorsaPage /></BalancePrivacyProvider>)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText(/Defter ile Varlıklar satırı uyuşmuyor/)).toBeTruthy()
})

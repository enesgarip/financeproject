import { describe, expect, it } from 'vitest'
import type { Asset, Debt, SavingsGoal } from '../types/database'
import type { MarketRatesSnapshot } from './marketRates'
import {
  assetIsStock,
  assetRateSymbol,
  debtRateSide,
  debtRateSymbol,
  effectiveAssetValue,
  effectiveDebtValue,
  effectiveGoalValue,
  goalRateSymbol,
  stockCostBasis,
  stockProfit,
  valueAsset,
  valueDebt,
  valueGoal,
  valueStock,
} from './valuation'

const SNAPSHOT: MarketRatesSnapshot = {
  rates: {
    USD: { buying: 45.9556, selling: 45.9802 },
    GRA: { buying: 6553.58, selling: 6554.44 },
    CEYREKALTIN: { buying: 10568.49, selling: 10809.58 },
  },
  asOf: '2026-06-03T21:21:01.000Z',
  fetchedAt: '2026-06-03T21:25:00.000Z',
}

const baseRow = {
  id: 'id',
  user_id: 'user',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    ...baseRow,
    name: 'Varlık',
    category: 'Altın',
    amount: 0,
    unit: 'gram',
    currency: null,
    symbol: null,
    unit_cost: null,
    estimated_value_try: 0,
    auto_valued: false,
    note: null,
    ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...baseRow,
    person_name: 'Kişi',
    direction: 'borç_aldım',
    value_type: 'doviz',
    currency: 'USD',
    amount: 0,
    estimated_value_try: 0,
    auto_valued: false,
    due_date: null,
    status: 'açık',
    note: null,
    ...overrides,
  }
}

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    ...baseRow,
    name: 'Hedef',
    value_type: 'gram_altin',
    target_amount: 0,
    current_amount: 0,
    estimated_value_try: 0,
    auto_valued: false,
    target_date: null,
    status: 'active',
    note: null,
    ...overrides,
  }
}

describe('symbol resolution', () => {
  it('maps assets to market symbols', () => {
    expect(assetRateSymbol(asset({ category: 'Altın', unit: 'gram' }))).toBe('GRA')
    expect(assetRateSymbol(asset({ category: 'Altın', unit: 'adet' }))).toBe('CEYREKALTIN')
    expect(assetRateSymbol(asset({ category: 'Nakit', unit: 'TRY', currency: 'USD' }))).toBe('USD')
    expect(assetRateSymbol(asset({ category: 'Nakit', unit: 'TRY', currency: 'TRY' }))).toBeNull()
    expect(assetRateSymbol(asset({ category: 'Fon' }))).toBeNull()
  })

  it('maps debts to symbols and sides', () => {
    expect(debtRateSymbol(debt({ value_type: 'gram_altin' }))).toBe('GRA')
    expect(debtRateSymbol(debt({ value_type: 'ceyrek_altin' }))).toBe('CEYREKALTIN')
    expect(debtRateSymbol(debt({ value_type: 'doviz', currency: 'USD' }))).toBe('USD')
    expect(debtRateSymbol(debt({ value_type: 'TRY' }))).toBeNull()
    expect(debtRateSide(debt({ direction: 'borç_aldım' }))).toBe('selling')
    expect(debtRateSide(debt({ direction: 'borç_verdim' }))).toBe('buying')
  })

  it('maps gold goals to symbols', () => {
    expect(goalRateSymbol(goal({ value_type: 'gram_altin' }))).toBe('GRA')
    expect(goalRateSymbol(goal({ value_type: 'composite' }))).toBeNull()
    expect(goalRateSymbol(goal({ value_type: 'TRY' }))).toBeNull()
  })
})

describe('live values', () => {
  it('values gold holdings at the buying price', () => {
    expect(valueAsset(asset({ category: 'Altın', unit: 'gram', amount: 50 }), SNAPSHOT)).toBe(327679)
  })

  it('values owed FX debt at the selling price and receivables at buying', () => {
    expect(valueDebt(debt({ direction: 'borç_aldım', amount: 100 }), SNAPSHOT)).toBe(4598.02)
    expect(valueDebt(debt({ direction: 'borç_verdim', amount: 100 }), SNAPSHOT)).toBe(4595.56)
  })

  it('values gold goal progress at the buying price', () => {
    expect(valueGoal(goal({ value_type: 'gram_altin', current_amount: 10 }), SNAPSHOT)).toBe(65535.8)
  })
})

describe('effective value (auto vs manual)', () => {
  it('uses the live value only when opted in and priced', () => {
    const gold = asset({ category: 'Altın', unit: 'gram', amount: 50, estimated_value_try: 1, auto_valued: true })
    expect(effectiveAssetValue(gold, SNAPSHOT)).toBe(327679)
  })

  it('keeps the stored value when auto valuation is off', () => {
    const gold = asset({ category: 'Altın', unit: 'gram', amount: 50, estimated_value_try: 300000, auto_valued: false })
    expect(effectiveAssetValue(gold, SNAPSHOT)).toBe(300000)
  })

  it('falls back to the stored value when the rate is missing', () => {
    const eur = asset({ category: 'Nakit', unit: 'TRY', currency: 'EUR', estimated_value_try: 5000, auto_valued: true })
    expect(effectiveAssetValue(eur, SNAPSHOT)).toBe(5000)
  })

  it('applies the same rules to debts and goals', () => {
    expect(effectiveDebtValue(debt({ amount: 100, auto_valued: true, estimated_value_try: 1 }), SNAPSHOT)).toBe(4598.02)
    expect(effectiveDebtValue(debt({ amount: 100, auto_valued: false, estimated_value_try: 4000 }), SNAPSHOT)).toBe(4000)
    expect(effectiveGoalValue(goal({ current_amount: 10, auto_valued: true, estimated_value_try: 1 }), SNAPSHOT)).toBe(65535.8)
    expect(effectiveGoalValue(goal({ current_amount: 10, auto_valued: false, estimated_value_try: 60000 }), SNAPSHOT)).toBe(60000)
  })
})

describe('stocks (BIST)', () => {
  const PRICES = { THYAO: 297, GARAN: 130.5 }

  it('identifies stock rows only when a ticker is present', () => {
    expect(assetIsStock(asset({ category: 'Hisse', symbol: 'THYAO' }))).toBe(true)
    expect(assetIsStock(asset({ category: 'Hisse', symbol: null }))).toBe(false)
    expect(assetIsStock(asset({ category: 'Fon', symbol: 'THYAO' }))).toBe(false)
  })

  it('values a holding at price × quantity (case-insensitive ticker)', () => {
    expect(valueStock(asset({ category: 'Hisse', symbol: 'THYAO', amount: 100 }), PRICES)).toBe(29700)
    expect(valueStock(asset({ category: 'Hisse', symbol: 'thyao', amount: 10 }), PRICES)).toBe(2970)
  })

  it('returns null when the price or symbol is missing', () => {
    expect(valueStock(asset({ category: 'Hisse', symbol: 'UNKNOWN', amount: 10 }), PRICES)).toBeNull()
    expect(valueStock(asset({ category: 'Hisse', symbol: 'THYAO', amount: 10 }), null)).toBeNull()
    expect(valueStock(asset({ category: 'Hisse', symbol: null, amount: 10 }), PRICES)).toBeNull()
  })

  it('computes cost basis and profit/loss', () => {
    const row = asset({ category: 'Hisse', symbol: 'THYAO', amount: 100, unit_cost: 250 })
    expect(stockCostBasis(row)).toBe(25000)
    const value = valueStock(row, PRICES)! // 29700
    expect(stockProfit(value, row)).toEqual({ profit: 4700, profitPct: 18.8, cost: 25000 })
  })

  it('reports loss with negative profit', () => {
    const row = asset({ category: 'Hisse', symbol: 'THYAO', amount: 100, unit_cost: 320 })
    const value = valueStock(row, PRICES)! // 29700, cost 32000
    expect(stockProfit(value, row)).toEqual({ profit: -2300, profitPct: -7.19, cost: 32000 })
  })

  it('has no profit metric without a cost basis', () => {
    expect(stockCostBasis(asset({ category: 'Hisse', symbol: 'THYAO', amount: 100, unit_cost: null }))).toBeNull()
    expect(stockProfit(29700, asset({ category: 'Hisse', unit_cost: null, amount: 100 }))).toBeNull()
  })

  it('uses live stock price in effectiveAssetValue when auto and priced', () => {
    const row = asset({ category: 'Hisse', symbol: 'THYAO', amount: 100, auto_valued: true, estimated_value_try: 1 })
    expect(effectiveAssetValue(row, SNAPSHOT, PRICES)).toBe(29700)
    // falls back to stored value when the price is unavailable
    expect(effectiveAssetValue(asset({ category: 'Hisse', symbol: 'X', amount: 100, auto_valued: true, estimated_value_try: 5000 }), SNAPSHOT, PRICES)).toBe(5000)
  })
})

import { describe, expect, it } from 'vitest'
import type { Asset, Card } from '../types/database'
import { buildInflationShield } from './inflationShield'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...overrides }
}

function bankCard(overrides: Partial<Card>): Card {
  return {
    ...base, bank_name: 'Banka', card_name: 'Banka Kartı', card_type: 'banka_karti',
    holder_name: null, account_number: null, limit_group_name: null, current_balance: 0, credit_limit: 0, debt_amount: 0,
    statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0,
    statement_day: null, due_day: null, note: null, ...overrides,
  }
}

describe('buildInflationShield', () => {
  it('returns zeros and ratio 0 for empty input', () => {
    const s = buildInflationShield([], [])
    expect(s.totalValue).toBe(0)
    expect(s.protectedRatio).toBe(0)
    expect(s.meltingRatio).toBe(0)
    expect(s.categories).toEqual([])
  })

  it('treats Nakit assets as melting', () => {
    const s = buildInflationShield([asset({ category: 'Nakit', estimated_value_try: 1000 })], [])
    expect(s.meltingValue).toBe(1000)
    expect(s.protectedValue).toBe(0)
    expect(s.meltingRatio).toBe(1)
  })

  it('treats foreign-currency cash as protected instead of TRY cash', () => {
    const s = buildInflationShield([
      asset({ category: 'Nakit', currency: 'USD', amount: 1000, estimated_value_try: 40000 }),
      asset({ id: 'try', category: 'Nakit', currency: 'TRY', estimated_value_try: 10000 }),
    ], [])
    expect(s.protectedValue).toBe(40000)
    expect(s.meltingValue).toBe(10000)
    expect(s.categories.find((item) => item.category === 'Nakit (USD)')?.bucket).toBe('protected')
  })

  it('treats gold/stocks/other as protected', () => {
    const s = buildInflationShield(
      [
        asset({ category: 'Altın', estimated_value_try: 600 }),
        asset({ category: 'Hisse', estimated_value_try: 400 }),
        asset({ category: 'Nakit', estimated_value_try: 1000 }),
      ],
      [],
    )
    expect(s.protectedValue).toBe(1000)
    expect(s.meltingValue).toBe(1000)
    expect(s.protectedRatio).toBeCloseTo(0.5, 5)
  })

  it('folds bank-card balances into the melting (Nakit) bucket', () => {
    const s = buildInflationShield(
      [asset({ category: 'Altın', estimated_value_try: 1000 })],
      [bankCard({ current_balance: 500 })],
    )
    expect(s.meltingValue).toBe(500)
    const nakit = s.categories.find((c) => c.category === 'Nakit')
    expect(nakit?.value).toBe(500)
    expect(nakit?.bucket).toBe('melting')
  })

  it('ignores credit cards and non-positive values', () => {
    const s = buildInflationShield(
      [asset({ category: 'Altın', estimated_value_try: 0 }), asset({ category: 'Diğer', estimated_value_try: -50 })],
      [{ ...bankCard({ current_balance: 999 }), card_type: 'kredi_karti' } as Card],
    )
    expect(s.totalValue).toBe(0)
    expect(s.categories).toEqual([])
  })

  it('sorts categories by value descending', () => {
    const s = buildInflationShield(
      [
        asset({ category: 'Hisse', estimated_value_try: 100 }),
        asset({ category: 'Altın', estimated_value_try: 900 }),
        asset({ category: 'Nakit', estimated_value_try: 500 }),
      ],
      [],
    )
    expect(s.categories.map((c) => c.category)).toEqual(['Altın', 'Nakit', 'Hisse'])
  })
})

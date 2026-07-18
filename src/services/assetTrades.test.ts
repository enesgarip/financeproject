import { describe, expect, it } from 'vitest'
import { assetTradeRequiresQuantity } from './assetTrades'

describe('assetTradeRequiresQuantity', () => {
  it('requires source quantity for stocks, funds, and foreign cash', () => {
    expect(assetTradeRequiresQuantity({ category: 'Hisse', currency: null })).toBe(true)
    expect(assetTradeRequiresQuantity({ category: 'Fon', currency: null })).toBe(true)
    expect(assetTradeRequiresQuantity({ category: 'Nakit', currency: 'USD' })).toBe(true)
  })

  it('allows value-only trades for TRY cash and non-quantity assets', () => {
    expect(assetTradeRequiresQuantity({ category: 'Nakit', currency: 'TRY' })).toBe(false)
    expect(assetTradeRequiresQuantity({ category: 'Araç', currency: null })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { Asset, GoldLot } from '../types/database'
import { buildGoldHoldings } from './goldHoldings'
import type { MarketRatesSnapshot } from './marketRates'

const base = { id: 'id', user_id: 'user', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }
const snapshot: MarketRatesSnapshot = {
  rates: { GRA: { buying: 6000, selling: 6100 }, CEYREKALTIN: { buying: 10000, selling: 10200 } },
  asOf: null, fetchedAt: '2026-10-13T09:00:00Z',
}
function lot(overrides: Partial<GoldLot> = {}): GoldLot {
  return { ...base, gold_type: 'gram', direction: 'buy', quantity: 5, ayar: 24, unit_price: 1000, purchase_date: '2026-10-01', note: null, ...overrides }
}
function asset(overrides: Partial<Asset> = {}): Asset {
  return { ...base, name: 'Gram altın', category: 'Altın', amount: 60, unit: 'gram', currency: null, symbol: null, unit_cost: 2000, estimated_value_try: 300000, auto_valued: true, valued_at: null, valuation_rate: null, source: null, note: null, ...overrides }
}

describe('buildGoldHoldings', () => {
  it('defterde satışları düşer ve varlık özetini ikinci kez saymaz', () => {
    const result = buildGoldHoldings([lot(), lot({ direction: 'sell', quantity: 1, unit_price: 1200 })], [asset()], snapshot)
    expect(result.source).toBe('ledger')
    expect(result.holdings[0]).toMatchObject({ quantity: 4, avgUnitCost: 1000, knownCost: 4000, ayars: [24], value: 24000 })
    expect(result.totalValue).toBe(24000)
    expect(result.profit).toBe(20000)
  })

  it('işlem defteri yoksa altın varlıklarını tür bazında toplar', () => {
    const result = buildGoldHoldings([], [asset(), asset({ amount: 2, unit: 'adet', unit_cost: 8000 })], snapshot)
    expect(result.source).toBe('assets')
    expect(result.holdings.map((holding) => holding.quantity)).toEqual([60, 2])
    expect(result.totalValue).toBe(380000)
    expect(result.totalKnownCost).toBe(136000)
    expect(result.holdings[0].hasUnspecifiedAyar).toBe(true)
    expect(result.holdings[0].ayars).toEqual([])
  })

  it('aynı türdeki varlıkların miktarını ve ağırlıklı maliyetini birleştirir', () => {
    const result = buildGoldHoldings([], [asset({ amount: 1.2345, unit_cost: 1000 }), asset({ amount: 0.7655, unit_cost: 2000 })], snapshot)
    expect(result.holdings[0].quantity).toBe(2)
    expect(result.holdings[0].knownCost).toBe(2765.5)
    expect(result.holdings[0].avgUnitCost).toBe(1382.75)
  })

  it('fiyatsız veya ayarsız kayıt için değer uydurmaz', () => {
    const result = buildGoldHoldings([lot({ unit_price: null, ayar: null })], [], null)
    expect(result.holdings[0]).toMatchObject({ quantity: 5, unknownQuantity: 5, avgUnitCost: null, ayars: [], hasUnspecifiedAyar: true, value: null })
    expect(result.totalValue).toBeNull()
    expect(result.profit).toBeNull()
  })

  it('varlıkta kur yokken son kayıtlı ederi kullanır ve bunu işaretler', () => {
    const result = buildGoldHoldings([], [asset({ unit_cost: null })], null)
    expect(result.usesStoredValue).toBe(true)
    expect(result.totalValue).toBe(300000)
    expect(result.holdings[0].unknownQuantity).toBe(60)
    expect(result.holdings[0].avgUnitCost).toBeNull()
  })

  it('kayıtlı ayarları eksik bilgiyle birlikte gösterir; ayardan fiyat türetmez', () => {
    const result = buildGoldHoldings([lot({ ayar: 22, quantity: 1 }), lot({ ayar: 24, quantity: 1 }), lot({ ayar: null, quantity: 1 })], [], snapshot)
    expect(result.holdings[0].ayars).toEqual([22, 24])
    expect(result.holdings[0].hasUnspecifiedAyar).toBe(true)
    expect(result.totalValue).toBe(18000)
  })

  it('defter boşken eski yönetilen özet satırını ve diğer varlıkları kullanmaz', () => {
    const result = buildGoldHoldings([], [asset({ source: 'gold_ledger' }), asset({ category: 'Hisse' })], snapshot)
    expect(result.holdings).toEqual([])
  })
})

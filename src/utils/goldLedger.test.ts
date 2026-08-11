import { describe, expect, it } from 'vitest'
import type { GoldLot } from '../types/database'
import { buildGoldAccumulation, summarizeGold, summarizeGoldType } from './goldLedger'

const base = {
  id: 'id',
  user_id: 'user',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

function lot(overrides: Partial<GoldLot>): GoldLot {
  return {
    ...base,
    purchase_date: '2026-06-01',
    gold_type: 'gram',
    ayar: 24,
    quantity: 1,
    unit_price: 1000,
    direction: 'buy',
    note: null,
    ...overrides,
  }
}

describe('gold ledger summaries', () => {
  it('counts unknown-cost lots in quantity but excludes them from average cost', () => {
    const summary = summarizeGoldType(
      [
        lot({ quantity: 28, unit_price: 2500 }),
        lot({ id: 'unknown', quantity: 1, unit_price: null }),
      ],
      'gram',
    )

    expect(summary).toEqual({
      goldType: 'gram',
      totalQuantity: 29,
      knownQuantity: 28,
      unknownQuantity: 1,
      knownCost: 70000,
      avgUnitCost: 2500,
    })
  })

  it('sells reduce quantity but keep average buy cost (ağırlıklı ortalama)', () => {
    const summary = summarizeGoldType(
      [
        lot({ quantity: 5, unit_price: 3000 }),
        lot({ id: 'sell1', quantity: 2, unit_price: 3500, direction: 'sell' }),
      ],
      'gram',
    )

    expect(summary.totalQuantity).toBe(3)
    expect(summary.knownQuantity).toBe(3)
    // Kalan 3 gramın maliyeti ortalama ALIŞ fiyatından: 3 × 3000 = 9000.
    // Kârlı satış fiyatı (3500) kalan maliyeti düşürmez.
    expect(summary.knownCost).toBe(9000)
    expect(summary.avgUnitCost).toBe(3000)
  })

  it('fiyatsız satış da maliyet tabanını düşürür (denetim 2026-08-12 O1)', () => {
    const summary = summarizeGoldType(
      [
        lot({ quantity: 10, unit_price: 1000 }),
        lot({ id: 'sell-no-price', quantity: 5, unit_price: null, direction: 'sell' }),
      ],
      'gram',
    )

    expect(summary.totalQuantity).toBe(5)
    expect(summary.knownQuantity).toBe(5)
    // Elde 5 gr kaldı; maliyet tabanı 5 × 1000 = 5000 (10.000 DEĞİL).
    expect(summary.knownCost).toBe(5000)
  })

  it('satır sırası sonucu değiştirmez (UI yeniden-eskiye sıralı verir)', () => {
    const rows = [
      lot({ id: 'sell', purchase_date: '2026-07-20', quantity: 5, unit_price: 4000, direction: 'sell' }),
      lot({ id: 'buy', purchase_date: '2026-05-10', quantity: 10, unit_price: 2000 }),
    ]

    const summary = summarizeGoldType(rows, 'gram')
    expect(summary.totalQuantity).toBe(5)
    expect(summary.knownQuantity).toBe(5)
    expect(summary.knownCost).toBe(10000)
  })

  it('returns one summary per used type in stable gram/ceyrek order', () => {
    const summaries = summarizeGold([
      lot({ id: 'q1', gold_type: 'ceyrek', quantity: 1, unit_price: 11000 }),
      lot({ id: 'g1', gold_type: 'gram', quantity: 2, unit_price: 3000 }),
    ])

    expect(summaries.map((summary) => summary.goldType)).toEqual(['gram', 'ceyrek'])
    expect(summaries.map((summary) => summary.totalQuantity)).toEqual([2, 1])
  })
})

describe('gold accumulation chart data', () => {
  it('builds dated cumulative quantity and known cost only', () => {
    const points = buildGoldAccumulation(
      [
        lot({ id: 'later', purchase_date: '2026-06-10', quantity: 2, unit_price: 3000 }),
        lot({ id: 'undated', purchase_date: null, quantity: 5, unit_price: 2000 }),
        lot({ id: 'first', purchase_date: '2026-06-01', quantity: 1, unit_price: 2500 }),
        lot({ id: 'unknown', purchase_date: '2026-06-15', quantity: 1, unit_price: null }),
      ],
      'gram',
    )

    expect(points).toEqual([
      { date: '2026-06-01', cumulativeQuantity: 1, cumulativeCost: 2500 },
      { date: '2026-06-10', cumulativeQuantity: 3, cumulativeCost: 8500 },
      { date: '2026-06-15', cumulativeQuantity: 4, cumulativeCost: 8500 },
    ])
  })

  it('satışta maliyeti o anki ortalamadan düşer (satış fiyatından değil)', () => {
    const points = buildGoldAccumulation(
      [
        lot({ id: 'buy', purchase_date: '2026-06-01', quantity: 4, unit_price: 2000 }),
        lot({ id: 'sell', purchase_date: '2026-06-10', quantity: 1, unit_price: 5000, direction: 'sell' }),
      ],
      'gram',
    )

    expect(points).toEqual([
      { date: '2026-06-01', cumulativeQuantity: 4, cumulativeCost: 8000 },
      // 1 gram satıldı → maliyet 8000/4 = 2000 düşer → 6000 (satış fiyatı 5000 değil).
      { date: '2026-06-10', cumulativeQuantity: 3, cumulativeCost: 6000 },
    ])
  })

  it('fiyatsız satış da maliyet havuzunu ortalamadan düşürür (O1)', () => {
    const points = buildGoldAccumulation(
      [
        lot({ id: 'buy', purchase_date: '2026-06-01', quantity: 4, unit_price: 2000 }),
        lot({ id: 'sell', purchase_date: '2026-06-10', quantity: 1, unit_price: null, direction: 'sell' }),
      ],
      'gram',
    )

    expect(points).toEqual([
      { date: '2026-06-01', cumulativeQuantity: 4, cumulativeCost: 8000 },
      { date: '2026-06-10', cumulativeQuantity: 3, cumulativeCost: 6000 },
    ])
  })
})

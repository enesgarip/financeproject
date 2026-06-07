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
})

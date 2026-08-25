import { describe, expect, it } from 'vitest'
import type { SavingsGoal } from '../types/database'
import { buildPurchaseEffort } from './purchaseEffort'

const goal = { name: 'Araba' } as SavingsGoal

describe('buildPurchaseEffort', () => {
  it('returns null without a positive amount', () => {
    expect(buildPurchaseEffort({ amount: 0, salary: 105_000, monthlyOutflow: 60_000, dominant: null })).toBeNull()
    expect(buildPurchaseEffort({ amount: -5, salary: 105_000, monthlyOutflow: 60_000, dominant: null })).toBeNull()
  })

  it('converts amount into work days, outflow days, and goal months', () => {
    const result = buildPurchaseEffort({
      amount: 10_000,
      salary: 105_000, // günlük ≈ 5.000 → 2 iş günü
      monthlyOutflow: 60_856, // günlük ≈ 1.999,2 → ~5 gün
      dominant: { goal, monthlyNeeded: 5_000 }, // 2 aylık pay
    })
    expect(result).toMatchObject({ workDays: 2, goalMonths: 2, goalName: 'Araba' })
    expect(result!.outflowDays).toBeCloseTo(5, 0)
  })

  it('silences rows whose input is missing instead of printing zeros', () => {
    const result = buildPurchaseEffort({ amount: 3_000, salary: null, monthlyOutflow: 0, dominant: null })
    expect(result).toMatchObject({ workDays: null, outflowDays: null, goalMonths: 0, goalName: null })
  })

  it('drops sub-half-month goal share to 0 so the sentence is not built', () => {
    // 2.000 / 5.000 = 0,4 ay → yuvarlama 0; küçük tutar olduğundan büyük gösterilmez.
    const result = buildPurchaseEffort({ amount: 2_000, salary: null, monthlyOutflow: 0, dominant: { goal, monthlyNeeded: 5_000 } })
    expect(result).toMatchObject({ goalMonths: 0, goalName: null })
  })
})

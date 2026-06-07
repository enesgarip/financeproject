import { describe, expect, it } from 'vitest'
import { computeFire, estimateMonthlySavingsFromNetWorth, type FireInputs } from './fire'

const base: FireInputs = {
  currentNetWorth: 0,
  monthlyExpenses: 20000,
  monthlySavings: 20000,
  annualRealReturnPct: 4,
  withdrawalRatePct: 4,
}

describe('computeFire', () => {
  it('derives the FIRE number from expenses and withdrawal rate (25× at 4 %)', () => {
    const result = computeFire(base)
    expect(result.annualExpenses).toBe(240000)
    expect(result.fireNumber).toBe(6_000_000) // 240k / 0.04
  })

  it('reports already reached when net worth covers the target', () => {
    const result = computeFire({ ...base, currentNetWorth: 7_000_000 })
    expect(result.alreadyReached).toBe(true)
    expect(result.monthsToFire).toBe(0)
    expect(result.yearsToFire).toBe(0)
    expect(result.progressPct).toBe(100)
    expect(result.targetDate).toBe(new Date().toLocaleDateString('sv-SE'))
  })

  it('counts down the months to FIRE with growth + contributions', () => {
    const result = computeFire({ ...base, currentNetWorth: 1_000_000 })
    expect(result.monthsToFire).not.toBeNull()
    expect(result.monthsToFire!).toBeGreaterThan(0)
    // Sanity: with ~20k/mo savings toward a 5M gap it takes well over a decade
    expect(result.monthsToFire!).toBeGreaterThan(120)
    expect(result.yearsToFire!).toBeCloseTo(result.monthsToFire! / 12, 2)
  })

  it('computes the target date from the provided "from" date', () => {
    const from = new Date('2026-01-15')
    const result = computeFire({ ...base, currentNetWorth: 5_900_000, monthlySavings: 100_000 }, from)
    expect(result.monthsToFire).not.toBeNull()
    expect(result.targetDate).not.toBeNull()
    // target date must be strictly after the start
    expect(new Date(result.targetDate!).getTime()).toBeGreaterThan(from.getTime())
  })

  it('returns null months when savings and growth cannot reach the target', () => {
    const result = computeFire({
      ...base,
      currentNetWorth: 100_000,
      monthlySavings: 0,
      annualRealReturnPct: 0,
    })
    expect(result.monthsToFire).toBeNull()
    expect(result.yearsToFire).toBeNull()
    expect(result.targetDate).toBeNull()
    // still provides a projection for the chart over the fallback horizon
    expect(result.projection.length).toBeGreaterThan(1)
  })

  it('still grows via savings when real return is zero', () => {
    const result = computeFire({
      ...base,
      currentNetWorth: 0,
      monthlySavings: 50000,
      annualRealReturnPct: 0,
      monthlyExpenses: 10000, // fireNumber = 120k/0.04 = 3M
    })
    // 3,000,000 / 50,000 = 60 months exactly with no growth
    expect(result.fireNumber).toBe(3_000_000)
    expect(result.monthsToFire).toBe(60)
  })

  it('treats withdrawalRate 0 as unreachable', () => {
    const result = computeFire({ ...base, withdrawalRatePct: 0 })
    expect(result.fireNumber).toBe(0)
    expect(result.alreadyReached).toBe(false)
    expect(result.monthsToFire).toBeNull()
  })

  it('builds a projection sampled yearly plus the exact reach month', () => {
    const result = computeFire({ ...base, currentNetWorth: 0, monthlySavings: 50000, annualRealReturnPct: 0, monthlyExpenses: 10000 })
    expect(result.projection[0]).toEqual({ month: 0, netWorth: 0 })
    // last projection point is the reach month (60), not a multiple of 12 boundary beyond it
    expect(result.projection[result.projection.length - 1]!.month).toBe(60)
  })
})

describe('estimateMonthlySavingsFromNetWorth', () => {
  it('returns null with fewer than two snapshots', () => {
    expect(estimateMonthlySavingsFromNetWorth([])).toBeNull()
    expect(estimateMonthlySavingsFromNetWorth([{ snapshot_date: '2026-01-01', net_worth: 100 }])).toBeNull()
  })

  it('returns null when the span is under a month', () => {
    const result = estimateMonthlySavingsFromNetWorth([
      { snapshot_date: '2026-06-01', net_worth: 100000 },
      { snapshot_date: '2026-06-10', net_worth: 120000 },
    ])
    expect(result).toBeNull()
  })

  it('estimates the average monthly change over the span', () => {
    const result = estimateMonthlySavingsFromNetWorth([
      { snapshot_date: '2026-01-01', net_worth: 100000 },
      { snapshot_date: '2026-07-01', net_worth: 220000 },
    ])
    // ~181 days ≈ 5.95 months, Δ120k → ~20.2k/mo
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(19000)
    expect(result!).toBeLessThan(21000)
  })

  it('reports negative savings when net worth shrinks', () => {
    const result = estimateMonthlySavingsFromNetWorth([
      { snapshot_date: '2026-01-01', net_worth: 200000 },
      { snapshot_date: '2026-05-01', net_worth: 120000 },
    ])
    expect(result!).toBeLessThan(0)
  })

  it('sorts unordered snapshots before computing', () => {
    const ordered = estimateMonthlySavingsFromNetWorth([
      { snapshot_date: '2026-01-01', net_worth: 100000 },
      { snapshot_date: '2026-07-01', net_worth: 220000 },
    ])
    const shuffled = estimateMonthlySavingsFromNetWorth([
      { snapshot_date: '2026-07-01', net_worth: 220000 },
      { snapshot_date: '2026-01-01', net_worth: 100000 },
    ])
    expect(shuffled).toBe(ordered)
  })
})

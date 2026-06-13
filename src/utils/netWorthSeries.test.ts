import { describe, expect, it } from 'vitest'
import { aggregateNetWorthByMonth, selectNetWorthSeries } from './netWorthSeries'
import type { NetWorthSnapshot } from '../types/database'

function snap(date: string, netWorth: number): NetWorthSnapshot {
  return {
    id: date,
    user_id: 'u1',
    snapshot_date: date,
    net_worth: netWorth,
    gold_try: null,
    usd_try: null,
    created_at: date,
    updated_at: date,
  } as NetWorthSnapshot
}

describe('aggregateNetWorthByMonth', () => {
  it('keeps one point per month = the last snapshot of that month, ascending', () => {
    const result = aggregateNetWorthByMonth([
      snap('2026-01-05', 100),
      snap('2026-01-28', 150), // Ocak ay sonu
      snap('2026-02-10', 200),
      snap('2026-02-27', 220), // Şubat ay sonu
    ])
    expect(result.map((s) => s.snapshot_date)).toEqual(['2026-01-28', '2026-02-27'])
    expect(result.map((s) => s.net_worth)).toEqual([150, 220])
  })

  it('sorts unordered input before aggregating', () => {
    const result = aggregateNetWorthByMonth([snap('2026-02-27', 220), snap('2026-01-05', 100), snap('2026-01-28', 150)])
    expect(result.map((s) => s.snapshot_date)).toEqual(['2026-01-28', '2026-02-27'])
  })
})

describe('selectNetWorthSeries', () => {
  const now = new Date(2026, 5, 15) // 15 Haziran 2026

  it('90d → daily (raw), only last 90 days, not aggregated', () => {
    const data = [snap('2026-01-01', 50), snap('2026-06-01', 100), snap('2026-06-10', 110)]
    const { series, aggregated } = selectNetWorthSeries(data, '90d', now)
    expect(aggregated).toBe(false)
    // 2026-01-01 is older than 90 days → dropped; June dailies kept as-is.
    expect(series.map((s) => s.snapshot_date)).toEqual(['2026-06-01', '2026-06-10'])
  })

  it('1y → monthly aggregation within the last year', () => {
    const data = [
      snap('2025-03-31', 10), // >1y → dropped
      snap('2026-04-30', 80),
      snap('2026-05-31', 90),
      snap('2026-06-10', 95),
    ]
    const { series, aggregated } = selectNetWorthSeries(data, '1y', now)
    expect(aggregated).toBe(true)
    expect(series.map((s) => s.snapshot_date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-10'])
  })

  it('all → monthly aggregation over everything', () => {
    const data = [snap('2024-12-31', 5), snap('2025-06-30', 40), snap('2026-06-10', 95)]
    const { series, aggregated } = selectNetWorthSeries(data, 'all', now)
    expect(aggregated).toBe(true)
    expect(series).toHaveLength(3)
  })
})

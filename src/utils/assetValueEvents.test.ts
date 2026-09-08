import { describe, expect, it } from 'vitest'
import { buildAssetValueRows, summarizeAssetValueEvents, type AssetValueEventLike } from './assetValueEvents'

function ev(occurred_at: string, before: number, after: number, contribution = 0): AssetValueEventLike {
  return {
    occurred_at,
    value_before_kurus: before * 100,
    value_after_kurus: after * 100,
    contribution_kurus: contribution * 100,
  }
}

const bes = [
  ev('2026-06-01T00:00:00Z', 100000, 110000, 5000),
  ev('2026-08-01T00:00:00Z', 118000, 115000, 5000), // düşüş: katkıya rağmen değer geriledi
  ev('2026-07-01T00:00:00Z', 110000, 118000, 5000), // sırasız gelir, tarihe göre dizilmeli
]

describe('buildAssetValueRows', () => {
  it('sorts by date, returns newest first and takes period start from the previous event', () => {
    const rows = buildAssetValueRows(bes)
    expect(rows.map((row) => row.event.occurred_at)).toEqual([
      '2026-08-01T00:00:00Z',
      '2026-07-01T00:00:00Z',
      '2026-06-01T00:00:00Z',
    ])
    expect(rows[0].periodStart).toBe('2026-07-01T00:00:00Z')
    expect(rows[2].periodStart).toBeNull()
  })

  it('splits delta into contribution and growth, pct over (before + contribution)', () => {
    const rows = buildAssetValueRows(bes)
    const june = rows[2]
    expect(june.delta).toBe(10000)
    expect(june.contribution).toBe(5000)
    expect(june.growth).toBe(5000)
    expect(june.growthPct).toBe(4.76) // 5000 / 105000

    const august = rows[0]
    expect(august.delta).toBe(-3000)
    expect(august.growth).toBe(-8000)
    expect(august.growthPct).toBe(-6.5) // -8000 / 123000
  })

  it('has no pct when nothing was invested', () => {
    const [row] = buildAssetValueRows([ev('2026-01-01T00:00:00Z', 0, 0, 0)])
    expect(row.growthPct).toBeNull()
  })
})

describe('summarizeAssetValueEvents', () => {
  it('sums contributions and growth across events, pct over start + contributions', () => {
    const summary = summarizeAssetValueEvents(bes)
    expect(summary.count).toBe(3)
    expect(summary.firstAt).toBe('2026-06-01T00:00:00Z')
    expect(summary.lastAt).toBe('2026-08-01T00:00:00Z')
    expect(summary.startValue).toBe(100000)
    expect(summary.endValue).toBe(115000)
    expect(summary.totalContribution).toBe(15000)
    expect(summary.totalGrowth).toBe(0) // 5000 + 3000 − 8000
    expect(summary.growthPct).toBe(0)
  })

  it('sums per-row growth, not the end-to-start difference, so a broken chain adds no phantom gain', () => {
    const gap = [ev('2026-01-01T00:00:00Z', 100, 120), ev('2026-02-01T00:00:00Z', 500, 510)]
    const summary = summarizeAssetValueEvents(gap)
    expect(summary.totalGrowth).toBe(30)
    expect(summary.endValue - summary.startValue).toBe(410)
  })

  it('windows with since and restarts the base at the first event inside the window', () => {
    const summary = summarizeAssetValueEvents(bes, { since: '2026-07-01' })
    expect(summary.count).toBe(2)
    expect(summary.startValue).toBe(110000)
    expect(summary.totalContribution).toBe(10000)
    expect(summary.totalGrowth).toBe(-5000)
  })

  it('returns an empty summary for no events', () => {
    const summary = summarizeAssetValueEvents([])
    expect(summary.count).toBe(0)
    expect(summary.growthPct).toBeNull()
  })
})

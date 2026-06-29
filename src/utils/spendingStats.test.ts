import { describe, expect, it } from 'vitest'
import { averageOverActiveMonths, median } from './spendingStats'

describe('averageOverActiveMonths', () => {
  it('averages only the months that had spending', () => {
    expect(averageOverActiveMonths([900, 1100, 1000])).toBeCloseTo(1000)
    // one active month → ÷1, not ÷3 (the old analysisView bug divided by 3 → 500)
    expect(averageOverActiveMonths([0, 0, 1500])).toBe(1500)
    expect(averageOverActiveMonths([0, 600, 0])).toBe(600)
  })

  it('returns 0 when no month had spending', () => {
    expect(averageOverActiveMonths([])).toBe(0)
    expect(averageOverActiveMonths([0, 0, 0])).toBe(0)
  })
})

describe('median', () => {
  it('returns the middle value for odd counts', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('averages the two middle values for even counts', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([100, 200])).toBe(150)
  })

  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0)
  })
})

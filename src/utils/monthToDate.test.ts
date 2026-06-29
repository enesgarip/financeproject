import { describe, expect, it } from 'vitest'
import { dayOfMonthCutoff, isWithinDayOfMonth } from './monthToDate'

describe('dayOfMonthCutoff', () => {
  it('returns today’s day of month', () => {
    expect(dayOfMonthCutoff(new Date(2026, 5, 15))).toBe(15)
    expect(dayOfMonthCutoff(new Date(2026, 1, 1))).toBe(1)
    expect(dayOfMonthCutoff(new Date(2026, 0, 31))).toBe(31)
  })
})

describe('isWithinDayOfMonth', () => {
  it('includes days on/before the cutoff', () => {
    expect(isWithinDayOfMonth('2026-05-10', 15)).toBe(true)
    expect(isWithinDayOfMonth('2026-05-15', 15)).toBe(true)
  })

  it('excludes days after the cutoff', () => {
    expect(isWithinDayOfMonth('2026-05-20', 15)).toBe(false)
  })

  it('handles timestamp strings and month-end', () => {
    expect(isWithinDayOfMonth('2026-05-31T12:00:00Z', 31)).toBe(true)
    expect(isWithinDayOfMonth('2026-02-28', 15)).toBe(false)
  })
})

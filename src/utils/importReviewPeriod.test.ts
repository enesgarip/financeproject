import { describe, expect, it } from 'vitest'
import { dateRangeFromIsoDates, rowsInReviewPeriod } from './importReviewPeriod'

describe('dateRangeFromIsoDates', () => {
  it('builds a sorted inclusive date range', () => {
    const range = dateRangeFromIsoDates(['2026-06-19', '2026-06-17', '2026-06-18T12:00:00'])

    expect(range).toMatchObject({
      start: '2026-06-17',
      end: '2026-06-19',
    })
  })

  it('returns null when there are no valid dates', () => {
    expect(dateRangeFromIsoDates(['', 'not-a-date'])).toBeNull()
  })
})

describe('rowsInReviewPeriod', () => {
  it('keeps rows inside the inclusive period', () => {
    const rows = [
      { id: 'before', spent_at: '2026-06-16', amount: 10 },
      { id: 'start', spent_at: '2026-06-17', amount: 20 },
      { id: 'middle', spent_at: '2026-06-18T12:00:00', amount: 30 },
      { id: 'end', spent_at: '2026-06-19', amount: 40 },
      { id: 'after', spent_at: '2026-06-20', amount: 50 },
    ]

    expect(rowsInReviewPeriod(rows, { start: '2026-06-17', end: '2026-06-19' }).map((row) => row.id)).toEqual([
      'start',
      'middle',
      'end',
    ])
  })
})

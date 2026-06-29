import { describe, expect, it } from 'vitest'
import type { CardExpense } from '../types/database'
import { comparePeriods } from './periodComparison'

const baseRow = { user_id: 'u1', created_at: '2026-01-01', updated_at: '2026-01-01' }

function expense(overrides: Partial<CardExpense> & { id: string; spent_at: string; amount: number; category: string; description: string }): CardExpense {
  return {
    ...baseRow,
    card_id: 'card-1',
    statement_archive_id: null,
    installment_count: 1,
    installment_amount: 0,
    status: 'posted',
    posted_at: overrides.spent_at,
    note: null,
    ...overrides,
    transaction_fingerprint: overrides.transaction_fingerprint ?? null,
  }
}

const NOW = new Date(2026, 5, 15) // 15 June 2026

describe('comparePeriods (month)', () => {
  it('clips the previous period to the same elapsed window', () => {
    const result = comparePeriods(
      [
        expense({ id: 'c1', spent_at: '2026-06-10', amount: 1000, category: 'Market', description: 'A' }),
        expense({ id: 'p1', spent_at: '2026-05-05', amount: 800, category: 'Market', description: 'B' }),
        // after the 15th of May → excluded from the fair comparison
        expense({ id: 'p2', spent_at: '2026-05-20', amount: 1200, category: 'Market', description: 'C' }),
      ],
      'month',
      NOW,
    )

    expect(result.currentTotal).toBe(1000)
    expect(result.previousTotal).toBe(800) // not 2000
    expect(result.totalChangePercent).toBe(25)
  })

  it('labels both periods with the partial-window note while the period is open', () => {
    const result = comparePeriods([], 'month', NOW)
    expect(result.currentLabel).toContain('ilk 15 gün')
    expect(result.previousLabel).toContain('ilk 15 gün')
  })

  it('excludes current-month spending after today from the running total', () => {
    const result = comparePeriods(
      [
        expense({ id: 'c1', spent_at: '2026-06-10', amount: 500, category: 'Market', description: 'A' }),
        // dated later this month than "now" → not counted yet
        expense({ id: 'c2', spent_at: '2026-06-28', amount: 999, category: 'Market', description: 'B' }),
      ],
      'month',
      NOW,
    )
    expect(result.currentTotal).toBe(500)
  })
})

describe('comparePeriods (year)', () => {
  it('clips the previous year to the same number of elapsed days', () => {
    const result = comparePeriods(
      [
        expense({ id: 'c1', spent_at: '2026-02-01', amount: 100, category: 'Market', description: 'A' }),
        // same calendar window last year (well before the elapsed cutoff)
        expense({ id: 'p1', spent_at: '2025-02-01', amount: 80, category: 'Market', description: 'B' }),
        // last year but far past the elapsed window → excluded
        expense({ id: 'p2', spent_at: '2025-11-01', amount: 5000, category: 'Market', description: 'C' }),
      ],
      'year',
      NOW,
    )
    expect(result.currentTotal).toBe(100)
    expect(result.previousTotal).toBe(80)
  })
})

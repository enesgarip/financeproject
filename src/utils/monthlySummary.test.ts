import { describe, expect, it } from 'vitest'
import type { CardExpense } from '../types/database'
import { buildMonthlySummary } from './monthlySummary'

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

const NOW = new Date(2026, 5, 15) // 15 June 2026 → through day 15

describe('buildMonthlySummary', () => {
  it('compares this month so far against the previous month through the same day', () => {
    const summary = buildMonthlySummary(
      [
        // current month so far
        expense({ id: 'c1', spent_at: '2026-06-10', amount: 1000, category: 'Market', description: 'A' }),
        // previous month: 800 within the first 15 days, 1200 after
        expense({ id: 'p1', spent_at: '2026-05-05', amount: 800, category: 'Market', description: 'B' }),
        expense({ id: 'p2', spent_at: '2026-05-20', amount: 1200, category: 'Market', description: 'C' }),
      ],
      NOW,
    )

    expect(summary.currentMonthTotal).toBe(1000)
    // previousMonthTotal stays the FULL prior month for reference
    expect(summary.previousMonthTotal).toBe(2000)
    // but the % change is like-for-like: 1000 vs the 800 spent by the 15th → +25%
    expect(summary.changePercent).toBe(25)
  })

  it('ignores prior-month spending after the cutoff entirely for the change', () => {
    const summary = buildMonthlySummary(
      [
        expense({ id: 'c1', spent_at: '2026-06-08', amount: 500, category: 'Yemek', description: 'A' }),
        // all prior-month spend happened after the 15th → no comparable base
        expense({ id: 'p1', spent_at: '2026-05-25', amount: 3000, category: 'Yemek', description: 'B' }),
      ],
      NOW,
    )

    expect(summary.previousMonthTotal).toBe(3000)
    expect(summary.changePercent).toBeNull()
  })
})

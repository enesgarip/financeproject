import { describe, expect, it } from 'vitest'
import { detectCategoryAnomalies, detectRecurringExpenses, detectSpendingAnomalies } from './spendingAnomalies'
import type { CardExpense } from '../types/database'

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
  }
}

const FROM = new Date('2026-06-15')

// 3-month history: avg 1000/month, current month 1500 → ratio 1.5 ≥ threshold
const categoryExpenses: CardExpense[] = [
  expense({ id: 'e1', spent_at: '2026-03-10', amount: 900, category: 'Market', description: 'A' }),
  expense({ id: 'e2', spent_at: '2026-04-10', amount: 1100, category: 'Market', description: 'B' }),
  expense({ id: 'e3', spent_at: '2026-05-10', amount: 1000, category: 'Market', description: 'C' }),
  expense({ id: 'e4', spent_at: '2026-06-10', amount: 1500, category: 'Market', description: 'D' }),
]

describe('detectCategoryAnomalies', () => {
  it('flags category above threshold', () => {
    const result = detectCategoryAnomalies(categoryExpenses, FROM)
    expect(result).toHaveLength(1)
    expect(result[0]!.category).toBe('Market')
    expect(result[0]!.currentMonth).toBe(1500)
    expect(result[0]!.threeMonthAvg).toBeCloseTo(1000)
    expect(result[0]!.ratio).toBeCloseTo(1.5)
  })

  it('does not flag category below threshold (ratio < 1.4)', () => {
    const low: CardExpense[] = [
      expense({ id: 'e1', spent_at: '2026-03-10', amount: 1000, category: 'Market', description: 'A' }),
      expense({ id: 'e2', spent_at: '2026-04-10', amount: 1000, category: 'Market', description: 'B' }),
      expense({ id: 'e3', spent_at: '2026-05-10', amount: 1000, category: 'Market', description: 'C' }),
      expense({ id: 'e4', spent_at: '2026-06-10', amount: 1350, category: 'Market', description: 'D' }),
    ]
    expect(detectCategoryAnomalies(low, FROM)).toHaveLength(0)
  })

  it('skips categories with no history', () => {
    const noHistory: CardExpense[] = [
      expense({ id: 'e1', spent_at: '2026-06-10', amount: 1000, category: 'Yeni', description: 'X' }),
    ]
    expect(detectCategoryAnomalies(noHistory, FROM)).toHaveLength(0)
  })

  it('ignores non-posted expenses', () => {
    const mixed: CardExpense[] = [
      ...categoryExpenses,
      expense({ id: 'prov', spent_at: '2026-06-12', amount: 5000, category: 'Market', description: 'Prov', status: 'provision' }),
    ]
    const result = detectCategoryAnomalies(mixed, FROM)
    expect(result[0]!.currentMonth).toBe(1500) // provision not included
  })

  it('sorts by ratio descending', () => {
    const multi: CardExpense[] = [
      // Market: ratio ~1.5
      ...categoryExpenses,
      // Eğlence: ratio ~2.0
      expense({ id: 'eg1', spent_at: '2026-03-10', amount: 500, category: 'Eğlence', description: 'E1' }),
      expense({ id: 'eg2', spent_at: '2026-04-10', amount: 500, category: 'Eğlence', description: 'E2' }),
      expense({ id: 'eg3', spent_at: '2026-05-10', amount: 500, category: 'Eğlence', description: 'E3' }),
      expense({ id: 'eg4', spent_at: '2026-06-10', amount: 1000, category: 'Eğlence', description: 'E4' }),
    ]
    const result = detectCategoryAnomalies(multi, FROM)
    expect(result[0]!.category).toBe('Eğlence')
    expect(result[1]!.category).toBe('Market')
  })
})

describe('detectRecurringExpenses', () => {
  const subscriptions: CardExpense[] = [
    expense({ id: 's1', spent_at: '2026-03-01', amount: 200, category: 'Dijital', description: 'Netflix' }),
    expense({ id: 's2', spent_at: '2026-04-01', amount: 200, category: 'Dijital', description: 'Netflix' }),
    expense({ id: 's3', spent_at: '2026-05-01', amount: 200, category: 'Dijital', description: 'Netflix' }),
    expense({ id: 's4', spent_at: '2026-06-01', amount: 202, category: 'Dijital', description: 'Netflix' }),
  ]

  it('detects recurring subscription with consistent amount', () => {
    const result = detectRecurringExpenses(subscriptions, FROM)
    expect(result).toHaveLength(1)
    expect(result[0]!.description).toBe('Netflix')
    expect(result[0]!.monthCount).toBe(4)
    expect(result[0]!.amount).toBe(200) // median
  })

  it('ignores installment expenses (installment_count > 1)', () => {
    const installments: CardExpense[] = [
      expense({ id: 'i1', spent_at: '2026-04-01', amount: 500, category: 'Alışveriş', description: 'Mağaza', installment_count: 6 }),
      expense({ id: 'i2', spent_at: '2026-05-01', amount: 500, category: 'Alışveriş', description: 'Mağaza', installment_count: 6 }),
      expense({ id: 'i3', spent_at: '2026-06-01', amount: 500, category: 'Alışveriş', description: 'Mağaza', installment_count: 6 }),
    ]
    expect(detectRecurringExpenses(installments, FROM)).toHaveLength(0)
  })

  it('ignores inconsistent amounts (> 5% variance)', () => {
    const inconsistent: CardExpense[] = [
      expense({ id: 'v1', spent_at: '2026-04-01', amount: 200, category: 'Market', description: 'Market X' }),
      expense({ id: 'v2', spent_at: '2026-05-01', amount: 350, category: 'Market', description: 'Market X' }),
      expense({ id: 'v3', spent_at: '2026-06-01', amount: 180, category: 'Market', description: 'Market X' }),
    ]
    expect(detectRecurringExpenses(inconsistent, FROM)).toHaveLength(0)
  })

  it('ignores items outside the 4-month window', () => {
    const old: CardExpense[] = [
      expense({ id: 'o1', spent_at: '2026-01-01', amount: 100, category: 'Dijital', description: 'Old Sub' }),
      expense({ id: 'o2', spent_at: '2026-02-01', amount: 100, category: 'Dijital', description: 'Old Sub' }),
    ]
    // Both months are older than 4-month cutoff from June 2026
    expect(detectRecurringExpenses(old, FROM)).toHaveLength(0)
  })

  it('is case-insensitive for description matching', () => {
    const mixed: CardExpense[] = [
      expense({ id: 'c1', spent_at: '2026-05-01', amount: 300, category: 'Dijital', description: 'Spotify' }),
      expense({ id: 'c2', spent_at: '2026-06-01', amount: 300, category: 'Dijital', description: 'SPOTIFY' }),
    ]
    const result = detectRecurringExpenses(mixed, FROM)
    expect(result).toHaveLength(1)
  })
})

describe('detectSpendingAnomalies', () => {
  it('returns combined result', () => {
    const result = detectSpendingAnomalies([...categoryExpenses], FROM)
    expect(result).toHaveProperty('anomalies')
    expect(result).toHaveProperty('recurring')
    expect(Array.isArray(result.anomalies)).toBe(true)
    expect(Array.isArray(result.recurring)).toBe(true)
  })
})

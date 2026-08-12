import { describe, expect, it } from 'vitest'
import type { Budget, CardExpense } from '../types/database'
import { buildBudgetUsage } from './budgetAlerts'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const JUNE = new Date(2026, 5, 15)

function budget(overrides: Partial<Budget>): Budget {
  return { ...base, month: '2026-06-01', category: 'Market', limit_amount: 1000, note: null, ...overrides }
}

function expense(overrides: Partial<CardExpense>): CardExpense {
  return {
    ...base,
    card_id: 'c1',
    statement_archive_id: null,
    spent_at: '2026-06-10',
    amount: 0,
    description: 'Harcama',
    category: 'Market',
    installment_count: 1,
    installment_amount: 0,
    status: 'posted',
    posted_at: null,
    note: null,
    ...overrides,
    transaction_fingerprint: overrides.transaction_fingerprint ?? null,
    source: overrides.source ?? null,
  }
}

describe('buildBudgetUsage', () => {
  it('ignores cancelled expenses, other months and computes status thresholds', () => {
    const budgets = [
      budget({ id: 'market', category: 'Market', limit_amount: 1000 }),
      budget({ id: 'eglence', category: 'Eğlence', limit_amount: 500 }),
      budget({ id: 'old', category: 'Ulaşım', limit_amount: 1000, month: '2026-05-01' }),
    ]
    const expenses = [
      expense({ category: 'Market', amount: 600 }),
      expense({ category: 'Market', amount: 500 }),
      expense({ category: 'Market', amount: 9999, status: 'cancelled' }), // ignored
      expense({ category: 'Eğlence', amount: 400 }),
      expense({ category: 'Ulaşım', amount: 800, spent_at: '2026-05-20' }), // wrong month
    ]

    const usage = buildBudgetUsage(budgets, expenses, JUNE)

    expect(usage).toHaveLength(2)
    expect(usage.find((row) => row.budgetId === 'market')).toMatchObject({ spent: 1100, limit: 1000, status: 'over', remaining: 0 })
    expect(usage.find((row) => row.budgetId === 'eglence')).toMatchObject({ spent: 400, status: 'warning', remaining: 100 })
  })

  it('treats a zero limit with any spend as over budget', () => {
    const usage = buildBudgetUsage([budget({ id: 'z', category: 'X', limit_amount: 0 })], [expense({ category: 'X', amount: 50 })], JUNE)
    expect(usage[0]).toMatchObject({ usageRate: 100, status: 'over', remaining: 0 })
  })

  it('keeps usage just under 80% at ok status', () => {
    const usage = buildBudgetUsage([budget({ category: 'X', limit_amount: 1000 })], [expense({ category: 'X', amount: 799 })], JUNE)
    expect(usage[0]).toMatchObject({ status: 'ok' })
  })

  it('returns every monthly budget (including ok ones) so dashboard and analysis agree', () => {
    const budgets = [
      budget({ id: 'market', category: 'Market', limit_amount: 1000 }),
      budget({ id: 'saglik', category: 'Sağlık', limit_amount: 1000 }),
    ]
    const expenses = [expense({ category: 'Market', amount: 1100 }), expense({ category: 'Sağlık', amount: 100 })]

    const usage = buildBudgetUsage(budgets, expenses, JUNE)

    expect(usage).toHaveLength(2)
    expect(usage.find((row) => row.budgetId === 'market')).toMatchObject({ status: 'over', spent: 1100 })
    expect(usage.find((row) => row.budgetId === 'saglik')).toMatchObject({ status: 'ok', spent: 100 })
  })

  it('buckets uncategorised expenses into Diğer for both screens', () => {
    const usage = buildBudgetUsage(
      [budget({ id: 'd', category: 'Diğer', limit_amount: 100 })],
      [expense({ category: undefined, amount: 150 })],
      JUNE,
    )
    expect(usage[0]).toMatchObject({ category: 'Diğer', spent: 150, status: 'over' })
  })
})

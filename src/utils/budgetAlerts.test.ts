import { describe, expect, it } from 'vitest'
import type { Budget, CardExpense } from '../types/database'
import { buildBudgetAlerts } from './budgetAlerts'

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
  }
}

describe('buildBudgetAlerts', () => {
  it('flags over-limit and warning budgets, sorted by usage', () => {
    const budgets = [
      budget({ id: 'market', category: 'Market', limit_amount: 1000 }),
      budget({ id: 'eglence', category: 'Eğlence', limit_amount: 500 }),
      budget({ id: 'saglik', category: 'Sağlık', limit_amount: 1000 }),
      budget({ id: 'old', category: 'Ulaşım', limit_amount: 1000, month: '2026-05-01' }),
    ]
    const expenses = [
      expense({ category: 'Market', amount: 600 }),
      expense({ category: 'Market', amount: 500 }),
      expense({ category: 'Market', amount: 9999, status: 'cancelled' }), // ignored
      expense({ category: 'Eğlence', amount: 400 }),
      expense({ category: 'Sağlık', amount: 100 }), // under budget -> dropped
      expense({ category: 'Ulaşım', amount: 800, spent_at: '2026-05-20' }), // wrong month
    ]

    const alerts = buildBudgetAlerts(budgets, expenses, JUNE)

    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toMatchObject({ budgetId: 'market', spent: 1100, limit: 1000, status: 'over', remaining: 0 })
    expect(alerts[0].usageRate).toBeCloseTo(110) // ratio carries float noise; the UI rounds it
    expect(alerts[1]).toMatchObject({ budgetId: 'eglence', spent: 400, status: 'warning', remaining: 100 })
    expect(alerts[1].usageRate).toBeCloseTo(80)
  })

  it('ignores budgets that belong to another month', () => {
    const alerts = buildBudgetAlerts([budget({ month: '2026-05-01', limit_amount: 1 })], [expense({ amount: 1000 })], JUNE)
    expect(alerts).toHaveLength(0)
  })

  it('treats a zero limit with any spend as over budget', () => {
    const alerts = buildBudgetAlerts([budget({ id: 'z', category: 'X', limit_amount: 0 })], [expense({ category: 'X', amount: 50 })], JUNE)
    expect(alerts[0]).toMatchObject({ usageRate: 100, status: 'over', remaining: 0 })
  })

  it('keeps usage just under 80% out of the alert list', () => {
    const alerts = buildBudgetAlerts([budget({ category: 'X', limit_amount: 1000 })], [expense({ category: 'X', amount: 799 })], JUNE)
    expect(alerts).toHaveLength(0)
  })
})

import type { Budget, CardExpense } from '../types/database'
import { dateInputValue, isDateInMonth, startOfMonth } from './date'

export type BudgetAlertStatus = 'over' | 'warning' | 'ok'

export type BudgetUsage = {
  budgetId: string
  category: string
  spent: number
  limit: number
  usageRate: number
  status: BudgetAlertStatus
  remaining: number
}

export type BudgetAlert = BudgetUsage

/** Uncategorised expenses fall into the last bucket so both the dashboard alert
 *  panel and the analysis progress list agree on where they land. */
const UNCATEGORISED = 'Diğer'

export function activeExpense(expense: CardExpense) {
  return expense.status !== 'cancelled'
}

/**
 * Single source of truth for "kategori bütçesi ne kadar kullanıldı". Returns every
 * budget for the month with its spent amount, usage rate and status. Both
 * {@link buildBudgetAlerts} (dashboard) and the analysis page's budget list read
 * from this so the two screens can never drift apart.
 */
export function buildBudgetUsage(budgets: Budget[], expenses: CardExpense[], month = new Date()): BudgetUsage[] {
  const monthKey = dateInputValue(startOfMonth(month))
  const monthlyBudgets = budgets.filter((budget) => budget.month === monthKey)
  const monthlyExpenses = expenses.filter((expense) => activeExpense(expense) && isDateInMonth(expense.spent_at, month))

  return monthlyBudgets.map((budget) => {
    const spent = monthlyExpenses
      .filter((expense) => (expense.category ?? UNCATEGORISED) === budget.category)
      .reduce((total, expense) => total + expense.amount, 0)
    const usageRate = budget.limit_amount > 0 ? (spent / budget.limit_amount) * 100 : spent > 0 ? 100 : 0
    let status: BudgetAlertStatus = 'ok'

    if (spent > budget.limit_amount + 0.01) status = 'over'
    else if (usageRate >= 80) status = 'warning'

    return {
      budgetId: budget.id,
      category: budget.category,
      spent,
      limit: budget.limit_amount,
      usageRate,
      status,
      remaining: Math.max(0, budget.limit_amount - spent),
    }
  })
}

export function buildBudgetAlerts(budgets: Budget[], expenses: CardExpense[], month = new Date()): BudgetAlert[] {
  return buildBudgetUsage(budgets, expenses, month)
    .filter((alert) => alert.status !== 'ok')
    .sort((a, b) => b.usageRate - a.usageRate)
}

import type { Budget, CardExpense } from '../types/database'
import { dateInputValue, isDateInMonth, startOfMonth } from './date'

export type BudgetAlertStatus = 'over' | 'warning' | 'ok'

export type BudgetAlert = {
  budgetId: string
  category: string
  spent: number
  limit: number
  usageRate: number
  status: BudgetAlertStatus
  remaining: number
}

function activeExpense(expense: CardExpense) {
  return expense.status !== 'cancelled'
}

export function buildBudgetAlerts(budgets: Budget[], expenses: CardExpense[], month = new Date()): BudgetAlert[] {
  const monthKey = dateInputValue(startOfMonth(month))
  const monthlyBudgets = budgets.filter((budget) => budget.month === monthKey)
  const monthlyExpenses = expenses.filter((expense) => activeExpense(expense) && isDateInMonth(expense.spent_at, month))

  return monthlyBudgets
    .map((budget) => {
      const spent = monthlyExpenses
        .filter((expense) => (expense.category ?? 'Diğer') === budget.category)
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
    .filter((alert) => alert.status !== 'ok')
    .sort((a, b) => b.usageRate - a.usageRate)
}

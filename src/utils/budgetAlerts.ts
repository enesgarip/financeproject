/**
 * Kategori bütçesi kullanımı. "Bu ay X kategorisinde bütçenin ne kadarı
 * harcandı?" sorusunun tek kaynağı: analiz sayfasının bütçe listesi ve planlama
 * sayfası buradan okur, böylece ekranlar asla ayrışmaz.
 *
 * Status eşikleri: harcama limiti aştıysa 'over', %80+ ise 'warning', yoksa 'ok'.
 * Kategorisiz harcamalar 'Diğer' kovasına düşer. Karşılaştırmalar money.ts ile.
 */
import type { Budget, CardExpense } from '../types/database'
import { budgetAnchorLabel, resolveBudgetRows } from './budgetAnchor'
import { dateInputValue, isDateInMonth, startOfMonth } from './date'
import { diffTL, exceedsTL, sumTL } from './money'

export type BudgetAlertStatus = 'over' | 'warning' | 'ok'

export type BudgetUsage = {
  budgetId: string
  category: string
  spent: number
  limit: number
  usageRate: number
  status: BudgetAlertStatus
  remaining: number
  /** Çıpalı satırda kural etiketi ("Son 3 ay ort. × 1,5"); manual'de null. */
  anchorLabel: string | null
}

/**
 * Kategorisiz harcamaların düştüğü kova. `category` kolonu NOT NULL olduğu için
 * `??` hiçbir zaman tetiklenmiyordu; gerçek boşluk BOŞ STRING olarak geliyor.
 * Bu yüzden `||` kullanılır — monthlySummary / analysisView / expenseRepeat da
 * aynı deseni kullanır, böylece ekranlar aynı kovadan konuşur.
 */
const UNCATEGORISED = 'Diğer'

export function activeExpense(expense: CardExpense) {
  return expense.status !== 'cancelled'
}

/**
 * Single source of truth for "kategori bütçesi ne kadar kullanıldı". Returns every
 * budget for the month with its spent amount, usage rate and status. The analysis
 * page's budget list and the planning page both read from this so the screens
 * can never drift apart.
 */
export function buildBudgetUsage(
  budgets: Budget[],
  expenses: CardExpense[],
  month = new Date(),
  /** Çıpalı limitlerin çözümü için güncel maaş (salary_pct); yoksa null. */
  salary: number | null = null,
): BudgetUsage[] {
  const monthKey = dateInputValue(startOfMonth(month))
  const monthlyBudgets = resolveBudgetRows(
    budgets.filter((budget) => budget.month === monthKey),
    expenses,
    salary,
  )
  const monthlyExpenses = expenses.filter((expense) => activeExpense(expense) && isDateInMonth(expense.spent_at, month))

  return monthlyBudgets.map((budget) => {
    const spent = monthlyExpenses
      .filter((expense) => (expense.category || UNCATEGORISED) === budget.category)
      .reduce((total, expense) => sumTL([total, expense.amount]), 0)
    const usageRate = budget.limit_amount > 0 ? (spent / budget.limit_amount) * 100 : spent > 0 ? 100 : 0
    let status: BudgetAlertStatus = 'ok'

    if (exceedsTL(spent, budget.limit_amount)) status = 'over'
    else if (usageRate >= 80) status = 'warning'

    return {
      budgetId: budget.id,
      category: budget.category,
      spent,
      limit: budget.limit_amount,
      usageRate,
      status,
      remaining: Math.max(0, diffTL(budget.limit_amount, spent)),
      anchorLabel: budgetAnchorLabel(budget),
    }
  })
}

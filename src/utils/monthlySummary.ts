import type { CardExpense } from '../types/database'
import { sumTL } from './money'

export type CategorySpending = {
  category: string
  amount: number
  percentage: number
}

export type MonthlySummaryResult = {
  currentMonthTotal: number
  previousMonthTotal: number
  changePercent: number | null
  categories: CategorySpending[]
  topCategory: string | null
  activeDays: number
  totalDays: number
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function buildMonthlySummary(
  expenses: CardExpense[],
  now: Date = new Date(),
): MonthlySummaryResult {
  const currentKey = monthKey(now)
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevKey = monthKey(prevDate)

  const posted = expenses.filter((e) => e.status !== 'cancelled')

  const categoryMap = new Map<string, number>()
  let currentMonthTotal = 0
  let previousMonthTotal = 0
  const activeDaySet = new Set<string>()

  for (const e of posted) {
    const eMonth = e.spent_at.slice(0, 7)
    if (eMonth === currentKey) {
      const cat = e.category || 'Diğer'
      categoryMap.set(cat, sumTL([categoryMap.get(cat), e.amount]))
      currentMonthTotal = sumTL([currentMonthTotal, e.amount])
      activeDaySet.add(e.spent_at.slice(0, 10))
    } else if (eMonth === prevKey) {
      previousMonthTotal = sumTL([previousMonthTotal, e.amount])
    }
  }

  const categories: CategorySpending[] = [...categoryMap.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: currentMonthTotal > 0 ? Math.round((amount / currentMonthTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  const changePercent =
    previousMonthTotal > 0
      ? Math.round(((currentMonthTotal - previousMonthTotal) / previousMonthTotal) * 100)
      : null

  const totalDays = now.getDate()

  return {
    currentMonthTotal,
    previousMonthTotal,
    changePercent,
    categories,
    topCategory: categories.length > 0 ? categories[0].category : null,
    activeDays: activeDaySet.size,
    totalDays,
  }
}

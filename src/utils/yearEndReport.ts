import type { CardExpense, NetWorthSnapshot } from '../types/database'
import { roundTL, sumTL } from './money'

export type MonthTotal = { month: string; label: string; amount: number }

export type YearEndReportResult = {
  year: number
  totalSpending: number
  monthlyTotals: MonthTotal[]
  mostExpensiveMonth: MonthTotal | null
  cheapestMonth: MonthTotal | null
  topCategories: { category: string; amount: number; percentage: number }[]
  avgMonthlySpending: number
  netWorthChange: number | null
  netWorthStart: number | null
  netWorthEnd: number | null
}

const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

export function buildYearEndReport(
  expenses: CardExpense[],
  snapshots: NetWorthSnapshot[],
  year?: number,
): YearEndReportResult {
  const targetYear = year ?? new Date().getFullYear()
  const yearPrefix = String(targetYear)

  const posted = expenses.filter(
    (e) => e.status !== 'cancelled' && e.spent_at.startsWith(yearPrefix),
  )

  const monthMap = new Map<string, number>()
  const categoryMap = new Map<string, number>()
  let totalSpending = 0

  for (const e of posted) {
    const m = e.spent_at.slice(5, 7)
    monthMap.set(m, sumTL([monthMap.get(m), e.amount]))
    const cat = e.category || 'Diğer'
    categoryMap.set(cat, sumTL([categoryMap.get(cat), e.amount]))
    totalSpending = sumTL([totalSpending, e.amount])
  }

  const monthlyTotals: MonthTotal[] = []
  for (let i = 0; i < 12; i++) {
    const key = String(i + 1).padStart(2, '0')
    const amount = monthMap.get(key) ?? 0
    monthlyTotals.push({
      month: `${targetYear}-${key}`,
      label: MONTH_NAMES[i],
      amount,
    })
  }

  const activeMonths = monthlyTotals.filter((m) => m.amount > 0)
  const mostExpensiveMonth = activeMonths.length > 0
    ? activeMonths.reduce((max, m) => (m.amount > max.amount ? m : max))
    : null
  const cheapestMonth = activeMonths.length > 0
    ? activeMonths.reduce((min, m) => (m.amount < min.amount ? m : min))
    : null

  const topCategories = [...categoryMap.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalSpending > 0 ? Math.round((amount / totalSpending) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  const avgMonthlySpending = activeMonths.length > 0 ? roundTL(totalSpending / activeMonths.length) : 0

  const yearSnapshots = snapshots
    .filter((s) => s.snapshot_date.startsWith(yearPrefix))
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))

  const netWorthStart = yearSnapshots.length > 0 ? yearSnapshots[0].net_worth : null
  const netWorthEnd = yearSnapshots.length > 0 ? yearSnapshots[yearSnapshots.length - 1].net_worth : null
  const netWorthChange = netWorthStart !== null && netWorthEnd !== null ? roundTL(netWorthEnd - netWorthStart) : null

  return {
    year: targetYear,
    totalSpending,
    monthlyTotals,
    mostExpensiveMonth,
    cheapestMonth,
    topCategories,
    avgMonthlySpending,
    netWorthChange,
    netWorthStart,
    netWorthEnd,
  }
}

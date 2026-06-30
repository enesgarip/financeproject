/**
 * Aylık harcama özeti: bu ayın toplamı, kategori dağılımı, aktif gün sayısı ve
 * geçen aya göre adil yüzde değişimi.
 *
 * "Adil" kısmı kritik: bugün ayın sadece N'inci günü olduğundan, bu ayın
 * kısmi toplamını geçen ayın TAM toplamıyla kıyaslamak ay başında değişimi
 * olduğundan küçük gösterir. Bu yüzden geçen ayın da yalnızca aynı güne kadarki
 * kısmı (previousMonthToDate) ile karşılaştırırız (bkz. monthToDate.ts).
 * İptal edilen harcamalar (status === 'cancelled') hariç tutulur.
 */
import type { CardExpense } from '../types/database'
import { dayOfMonthCutoff, isWithinDayOfMonth } from './monthToDate'
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
  // Fair month-over-month: today is only N days in, so the % change compares
  // this month so far against the previous month *through the same day* — not a
  // full prior month, which would understate the change early in the month.
  const throughDay = dayOfMonthCutoff(now)

  const categoryMap = new Map<string, number>()
  let currentMonthTotal = 0
  let previousMonthTotal = 0
  let previousMonthToDateTotal = 0
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
      if (isWithinDayOfMonth(e.spent_at, throughDay)) {
        previousMonthToDateTotal = sumTL([previousMonthToDateTotal, e.amount])
      }
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
    previousMonthToDateTotal > 0
      ? Math.round(((currentMonthTotal - previousMonthToDateTotal) / previousMonthToDateTotal) * 100)
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

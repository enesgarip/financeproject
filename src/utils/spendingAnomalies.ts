/**
 * Harcama anomalisi tespiti, iki ürün:
 *  - anomalies: bu ay bir kategorinin 3 aylık ortalamanın %40+ üstüne çıktığı
 *    durumlar (eşik ANOMALY_THRESHOLD = 1.4). Ay başında haksız alarm olmasın
 *    diye ay-bugüne kadar penceresiyle karşılaştırılır (bkz. monthToDate.ts).
 *  - recurring: aynı açıklamayla ≥2 ay tutarlı tutarda (±%5) tekrar eden harcamalar.
 * "Rolling average" tanımı spendingStats.ts'ten paylaşılır ki ekranlar ayrışmasın.
 */
import type { CardExpense } from '../types/database'
import { dayOfMonthCutoff, isWithinDayOfMonth } from './monthToDate'
import { sumTL } from './money'
import { averageOverActiveMonths, median } from './spendingStats'

export type CategoryAnomaly = {
  category: string
  currentMonth: number
  threeMonthAvg: number
  /** currentMonth / threeMonthAvg — always >= ANOMALY_THRESHOLD */
  ratio: number
}

export type RecurringExpense = {
  description: string
  category: string
  /** Median amount across recent months */
  amount: number
  monthCount: number
}

export type SpendingAnomaliesResult = {
  /** Categories where this month's spending is 40 %+ above the 3-month average. */
  anomalies: CategoryAnomaly[]
  /** Expenses with the same description and a consistent amount for ≥ 2 recent months. */
  recurring: RecurringExpense[]
}

const ANOMALY_THRESHOLD = 1.4
const AMOUNT_TOLERANCE = 0.05
const RECURRING_MIN_MONTHS = 2

function monthPrefix(dateStr: string): string {
  return dateStr.slice(0, 7)
}

function offsetMonthPrefix(from: Date, offsetMonths: number): string {
  const d = new Date(from)
  d.setDate(1)
  d.setMonth(d.getMonth() + offsetMonths)
  return d.toISOString().slice(0, 7)
}

/**
 * Detect categories where this month's spending is significantly higher than
 * the 3-month rolling average. Only `posted` expenses are counted.
 * Returns anomalies sorted by ratio descending.
 */
export function detectCategoryAnomalies(
  expenses: CardExpense[],
  from: Date = new Date(),
): CategoryAnomaly[] {
  const currentKey = offsetMonthPrefix(from, 0)
  // Fair comparison: the current month is only N days in, so clip every month
  // (current and the prior baseline months) to the same day-of-month window.
  // Otherwise a partial current month always looks low against full prior months.
  const throughDay = dayOfMonthCutoff(from)
  const posted = expenses.filter(
    (e) => e.status === 'posted' && e.category && isWithinDayOfMonth(e.spent_at, throughDay),
  )

  // category → monthKey → total
  const byCategory = new Map<string, Map<string, number>>()
  for (const expense of posted) {
    const key = monthPrefix(expense.spent_at)
    if (!byCategory.has(expense.category)) byCategory.set(expense.category, new Map())
    const monthMap = byCategory.get(expense.category)!
    monthMap.set(key, sumTL([monthMap.get(key), expense.amount]))
  }

  const anomalies: CategoryAnomaly[] = []

  for (const [category, monthMap] of byCategory) {
    const currentMonth = monthMap.get(currentKey) ?? 0
    if (currentMonth === 0) continue

    const prevTotals = [1, 2, 3].map((i) => monthMap.get(offsetMonthPrefix(from, -i)) ?? 0)
    const threeMonthAvg = averageOverActiveMonths(prevTotals)
    if (threeMonthAvg === 0) continue

    const ratio = currentMonth / threeMonthAvg
    if (ratio >= ANOMALY_THRESHOLD) {
      anomalies.push({ category, currentMonth, threeMonthAvg, ratio })
    }
  }

  return anomalies.sort((a, b) => b.ratio - a.ratio)
}

/**
 * Find card expenses that recur with the same description and a consistent
 * amount across ≥ RECURRING_MIN_MONTHS within the last 4 months.
 * Installment items (installment_count > 1) are excluded.
 */
export function detectRecurringExpenses(
  expenses: CardExpense[],
  from: Date = new Date(),
): RecurringExpense[] {
  const currentKey = offsetMonthPrefix(from, 0)
  const cutoffKey = offsetMonthPrefix(from, -4)

  const posted = expenses.filter(
    (e) => e.status === 'posted' && e.installment_count <= 1,
  )

  type Bucket = { months: Set<string>; amounts: number[]; category: string }
  const byDesc = new Map<string, Bucket>()

  for (const expense of posted) {
    const key = expense.description.trim().toLowerCase()
    if (!byDesc.has(key)) byDesc.set(key, { months: new Set(), amounts: [], category: expense.category })
    const bucket = byDesc.get(key)!
    bucket.months.add(monthPrefix(expense.spent_at))
    bucket.amounts.push(expense.amount)
    bucket.category = expense.category
  }

  const result: RecurringExpense[] = []

  for (const [rawDesc, bucket] of byDesc) {
    const recentMonths = [...bucket.months].filter(
      (m) => m >= cutoffKey && m <= currentKey,
    )
    if (recentMonths.length < RECURRING_MIN_MONTHS) continue

    // Check amount consistency: all amounts within tolerance of the median
    const med = median(bucket.amounts)
    if (med === 0) continue
    const consistent = bucket.amounts.every(
      (a) => Math.abs(a - med) / med <= AMOUNT_TOLERANCE,
    )
    if (!consistent) continue

    const desc = rawDesc.charAt(0).toUpperCase() + rawDesc.slice(1)
    result.push({ description: desc, category: bucket.category, amount: med, monthCount: recentMonths.length })
  }

  return result.sort((a, b) => b.monthCount - a.monthCount || b.amount - a.amount)
}

export function detectSpendingAnomalies(
  expenses: CardExpense[],
  from: Date = new Date(),
): SpendingAnomaliesResult {
  return {
    anomalies: detectCategoryAnomalies(expenses, from),
    recurring: detectRecurringExpenses(expenses, from),
  }
}

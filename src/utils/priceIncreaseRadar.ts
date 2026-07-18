/**
 * Zam radarı — detects recurring expenses/bills whose amount has crept up over
 * time (rent, subscriptions, insurance, utilities). Source-agnostic: callers
 * feed normalized {@link PriceObservation}s built from any history (payment
 * `transaction_history` rows grouped by `source_id`, recurring `card_expenses`
 * grouped by description, …). The util only does the math, so it stays pure and
 * easy to test.
 */

import type { CardExpense, Payment, TransactionHistory } from '../types/database'
import { median } from './spendingStats'
import { normalizeSearchText } from './searchText'

export type PriceObservation = {
  /** Stable grouping key (e.g. payment id, normalized card-expense description). */
  key: string
  /** Human label shown in the UI. */
  label: string
  /** Category for context; null when unknown. */
  category: string | null
  /** Amount paid for this occurrence (TRY). */
  amount: number
  /** ISO timestamp or YYYY-MM-DD date of the occurrence. */
  date: string
}

export type PriceTrend = {
  key: string
  label: string
  category: string | null
  /** Representative amount of the earliest tracked month. */
  firstAmount: number
  /** Representative amount of the most recent tracked month. */
  lastAmount: number
  /** Earliest month, YYYY-MM. */
  firstMonth: string
  /** Most recent month, YYYY-MM. */
  lastMonth: string
  /** Whole months between first and last observation (>= 1). */
  monthsSpan: number
  /** lastAmount / firstAmount. */
  changeRatio: number
  /** (changeRatio - 1) * 100 — total percentage increase. */
  changePct: number
  /** Compound annualized increase, ((ratio)^(12/span) - 1) * 100. */
  annualizedPct: number
  /** Distinct months with at least one observation. */
  monthCount: number
}

export type PriceIncreaseOptions = {
  /** Minimum distinct months required to report a trend. */
  minMonths?: number
  /** Minimum whole-month span between first and last observation. */
  minSpanMonths?: number
  /** Minimum total increase (percent) to surface. */
  minChangePct?: number
}

const DEFAULTS = {
  minMonths: 3,
  minSpanMonths: 2,
  minChangePct: 8,
} as const

function monthPrefix(dateStr: string): string {
  return dateStr.slice(0, 7)
}

function monthsBetween(firstMonth: string, lastMonth: string): number {
  const [fy, fm] = firstMonth.split('-').map(Number)
  const [ly, lm] = lastMonth.split('-').map(Number)
  return (ly - fy) * 12 + (lm - fm)
}

/**
 * Find recurring items whose amount has increased meaningfully across the
 * observed history. Each group's monthly amount is the median of that month's
 * observations (robust to one-off spikes); the trend compares the earliest vs
 * the latest tracked month. Returns increases only, sorted by total change desc.
 */
export function detectPriceIncreases(
  observations: PriceObservation[],
  options: PriceIncreaseOptions = {},
): PriceTrend[] {
  const minMonths = options.minMonths ?? DEFAULTS.minMonths
  const minSpanMonths = options.minSpanMonths ?? DEFAULTS.minSpanMonths
  const minChangePct = options.minChangePct ?? DEFAULTS.minChangePct

  type Group = { label: string; category: string | null; byMonth: Map<string, number[]> }
  const groups = new Map<string, Group>()

  for (const obs of observations) {
    if (!Number.isFinite(obs.amount) || obs.amount <= 0) continue
    const month = monthPrefix(obs.date)
    if (!groups.has(obs.key)) {
      groups.set(obs.key, { label: obs.label, category: obs.category, byMonth: new Map() })
    }
    const group = groups.get(obs.key)!
    // Keep the most recent label/category seen for the key.
    group.label = obs.label
    group.category = obs.category
    if (!group.byMonth.has(month)) group.byMonth.set(month, [])
    group.byMonth.get(month)!.push(obs.amount)
  }

  const trends: PriceTrend[] = []

  for (const [key, group] of groups) {
    const months = [...group.byMonth.keys()].sort()
    if (months.length < minMonths) continue

    const firstMonth = months[0]!
    const lastMonth = months[months.length - 1]!
    const monthsSpan = monthsBetween(firstMonth, lastMonth)
    if (monthsSpan < minSpanMonths) continue

    const firstAmount = median(group.byMonth.get(firstMonth)!)
    const lastAmount = median(group.byMonth.get(lastMonth)!)
    if (firstAmount <= 0) continue

    const changeRatio = lastAmount / firstAmount
    const changePct = (changeRatio - 1) * 100
    if (changePct < minChangePct) continue

    const annualizedPct = (Math.pow(changeRatio, 12 / monthsSpan) - 1) * 100

    trends.push({
      key,
      label: group.label,
      category: group.category,
      firstAmount,
      lastAmount,
      firstMonth,
      lastMonth,
      monthsSpan,
      changeRatio,
      changePct,
      annualizedPct,
      monthCount: months.length,
    })
  }

  return trends.sort((a, b) => b.changePct - a.changePct)
}

/** Strip the " odendi" / " ödendi" suffix that pay_payment appends to history titles. */
function cleanPaymentTitle(title: string): string {
  return title.replace(/\s+öden(di|miş)$/iu, '').replace(/\s+odendi$/iu, '').trim() || title
}

/**
 * Build {@link PriceObservation}s from the app's typed rows:
 * - paid recurring bills from `transaction_history` (type='payment'), keyed by
 *   the stable payment `source_id` so the same bill groups across months;
 * - recurring card purchases from `card_expenses` (non-installment, posted),
 *   keyed by normalized description.
 * Categories for payment rows are resolved from the current `payments` list.
 */
export function buildPriceObservations(input: {
  transactionHistory: TransactionHistory[]
  payments: Payment[]
  cardExpenses: CardExpense[]
}): PriceObservation[] {
  const paymentsById = new Map(input.payments.map((p) => [p.id, p]))
  const observations: PriceObservation[] = []

  for (const row of input.transactionHistory) {
    if (row.type !== 'payment' || row.source_table !== 'payments') continue
    if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0) continue
    const payment = row.source_id ? paymentsById.get(row.source_id) : undefined
    observations.push({
      key: row.source_id ? `pay:${row.source_id}` : `paytitle:${normalizeSearchText(cleanPaymentTitle(row.title))}`,
      label: payment?.title ?? cleanPaymentTitle(row.title),
      category: payment?.category ?? null,
      amount: row.amount,
      date: row.occurred_at,
    })
  }

  for (const expense of input.cardExpenses) {
    if (expense.status !== 'posted' || expense.installment_count > 1) continue
    if (!Number.isFinite(expense.amount) || expense.amount <= 0) continue
    observations.push({
      key: `card:${normalizeSearchText(expense.description)}`,
      label: expense.description,
      category: expense.category,
      amount: expense.amount,
      date: expense.spent_at,
    })
  }

  return observations
}

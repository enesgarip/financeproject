/**
 * Abonelik / düzenli gider tespiti. İki kaynaktan:
 *  - Kart harcamaları: aynı açıklamayla son ~6 ayda ≥2 ay tekrar eden VE tutarı
 *    tutarlı (medyandan ±%15 sapma içinde) olanlar otomatik abonelik sayılır.
 *    Medyan kullanılır ki tek seferlik sıçrama ortalamayı bozmasın.
 *  - Aylık tekrarlı bekleyen ödemeler (Payment): doğrudan abonelik kabul edilir.
 * isActive = son 1 ay içinde görülmüş mü. incomeRatio = aylık abonelik / gelir.
 */
import type { CardExpense, Payment } from '../types/database'
import { sumTL } from './money'
import { median } from './spendingStats'

export type SubscriptionItem = {
  id: string
  source: 'recurring_expense' | 'recurring_payment'
  title: string
  category: string
  amount: number
  monthCount: number
  isActive: boolean
}

export type SubscriptionSummaryResult = {
  items: SubscriptionItem[]
  monthlyTotal: number
  incomeRatio: number | null
}

function monthPrefix(dateStr: string): string {
  return dateStr.slice(0, 7)
}

function offsetMonthPrefix(from: Date, offsetMonths: number): string {
  const d = new Date(from)
  d.setDate(1)
  d.setMonth(d.getMonth() + offsetMonths)
  return d.toISOString().slice(0, 7)
}

export function buildSubscriptionSummary(
  expenses: CardExpense[],
  payments: Payment[],
  monthlyIncome: number | null,
  now: Date = new Date(),
): SubscriptionSummaryResult {
  const items: SubscriptionItem[] = []
  const currentKey = offsetMonthPrefix(now, 0)
  const cutoffKey = offsetMonthPrefix(now, -5)

  const posted = expenses.filter(
    (e) => e.status === 'posted' && e.installment_count <= 1,
  )

  type Bucket = { months: Set<string>; amounts: number[]; category: string; latestMonth: string }
  const byDesc = new Map<string, Bucket>()

  for (const expense of posted) {
    const key = expense.description.trim().toLowerCase()
    if (!byDesc.has(key)) byDesc.set(key, { months: new Set(), amounts: [], category: expense.category, latestMonth: '' })
    const bucket = byDesc.get(key)!
    const m = monthPrefix(expense.spent_at)
    bucket.months.add(m)
    bucket.amounts.push(expense.amount)
    bucket.category = expense.category
    if (m > bucket.latestMonth) bucket.latestMonth = m
  }

  const TOLERANCE = 0.15

  for (const [rawDesc, bucket] of byDesc) {
    const recentMonths = [...bucket.months].filter((m) => m >= cutoffKey && m <= currentKey)
    if (recentMonths.length < 2) continue

    const med = median(bucket.amounts)
    if (med === 0) continue
    const consistent = bucket.amounts.every((a) => Math.abs(a - med) / med <= TOLERANCE)
    if (!consistent) continue

    const desc = rawDesc.charAt(0).toUpperCase() + rawDesc.slice(1)
    const isActive = bucket.latestMonth >= offsetMonthPrefix(now, -1)

    items.push({
      id: `expense:${rawDesc}`,
      source: 'recurring_expense',
      title: desc,
      category: bucket.category || 'Diğer',
      amount: med,
      monthCount: recentMonths.length,
      isActive,
    })
  }

  for (const payment of payments) {
    if (payment.recurrence !== 'monthly' || payment.status !== 'bekliyor') continue
    items.push({
      id: `payment:${payment.id}`,
      source: 'recurring_payment',
      title: payment.title,
      category: payment.category ?? 'Diğer',
      amount: payment.amount,
      monthCount: 0,
      isActive: true,
    })
  }

  items.sort((a, b) => b.amount - a.amount)

  const monthlyTotal = sumTL(items.filter((i) => i.isActive).map((i) => i.amount))
  const incomeRatio = monthlyIncome && monthlyIncome > 0 ? Math.round((monthlyTotal / monthlyIncome) * 100) : null

  return { items, monthlyTotal, incomeRatio }
}

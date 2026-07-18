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
import { normalizeSearchText } from './searchText'

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
  return d.toLocaleDateString('sv-SE').slice(0, 7)
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

  type Observation = { month: string; amount: number; category: string; description: string }
  type Bucket = { observations: Observation[] }
  const byDesc = new Map<string, Bucket>()

  // Credit-card funded recurring payments create a matching card_expenses row
  // when posted. The payment itself is already listed below, so exclude that
  // generated expense from automatic subscription discovery.
  const cardFundedPaymentKeys = new Set(
    payments
      .filter((payment) => payment.recurrence === 'monthly' && Boolean(payment.auto_source_card_id))
      .map((payment) => normalizeSearchText(payment.title)),
  )

  for (const expense of posted) {
    const key = normalizeSearchText(expense.description)
    const generatedFromPayment = normalizeSearchText(expense.note).includes('odeme kaydindan olusturuldu')
    if (!key || (generatedFromPayment && cardFundedPaymentKeys.has(key))) continue
    if (!byDesc.has(key)) byDesc.set(key, { observations: [] })
    const bucket = byDesc.get(key)!
    const m = monthPrefix(expense.spent_at)
    bucket.observations.push({ month: m, amount: expense.amount, category: expense.category, description: expense.description.trim() })
  }

  const TOLERANCE = 0.15

  for (const [key, bucket] of byDesc) {
    const recent = bucket.observations.filter((item) => item.month >= cutoffKey && item.month <= currentKey)
    const recentMonths = new Set(recent.map((item) => item.month))
    if (recentMonths.size < 2) continue

    const amounts = recent.map((item) => item.amount)
    const med = median(amounts)
    if (med === 0) continue
    const consistent = amounts.every((a) => Math.abs(a - med) / med <= TOLERANCE)
    if (!consistent) continue

    const latest = [...recent].sort((a, b) => b.month.localeCompare(a.month))[0]!
    const isActive = latest.month >= offsetMonthPrefix(now, -1)

    items.push({
      id: `expense:${key}`,
      source: 'recurring_expense',
      title: latest.description,
      category: latest.category || 'Diğer',
      amount: med,
      monthCount: recentMonths.size,
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

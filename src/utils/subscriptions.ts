/**
 * Abonelik / düzenli gider tespiti. İki kaynaktan:
 *  - Kart harcamaları: aynı açıklamayla son ~6 ayda ≥3 ay tekrar eden VE tutarı
 *    tutarlı (medyandan ±%15 sapma içinde) olanlar otomatik abonelik sayılır.
 *    Medyan kullanılır ki tek seferlik sıçrama ortalamayı bozmasın. 2 ay eşiği
 *    benzin/market gibi tesadüfen tutarlı tekrarları abonelik sanıyordu (ör. OPET);
 *    o yüzden eşik 3 ay.
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
  /** Tekrarın görüldüğü kart (son gözlem); yalnız recurring_expense'te dolu. */
  sourceCardId: string | null
  /** Son gözlemin ay günü — "Planla" dönüşümünde tekrar günü olur. */
  recurrenceDay: number | null
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

  type Observation = { month: string; day: number; cardId: string; amount: number; category: string; description: string }
  type Bucket = { observations: Observation[] }
  const byDesc = new Map<string, Bucket>()

  // Credit-card funded recurring payments create a matching card_expenses row
  // when posted. The payment itself is already listed below, so exclude that
  // generated expense from automatic subscription discovery.
  for (const expense of posted) {
    const key = normalizeSearchText(expense.description)
    const normalizedNote = normalizeSearchText(expense.note)
    const generatedFromPayment = /[oö]deme kayd[ıi]ndan olu[şs]turuldu/.test(normalizedNote)
      || /[oö]deme kayd[ıi]yla sms [uü]zerinden e[şs]le[şs]tirildi/.test(normalizedNote)
    if (!key || generatedFromPayment) continue
    if (!byDesc.has(key)) byDesc.set(key, { observations: [] })
    const bucket = byDesc.get(key)!
    const m = monthPrefix(expense.spent_at)
    bucket.observations.push({
      month: m,
      day: Number(expense.spent_at.slice(8, 10)) || 1,
      cardId: expense.card_id,
      amount: expense.amount,
      category: expense.category,
      description: expense.description.trim(),
    })
  }

  const TOLERANCE = 0.15

  for (const [key, bucket] of byDesc) {
    const recent = bucket.observations.filter((item) => item.month >= cutoffKey && item.month <= currentKey)
    const recentMonths = new Set(recent.map((item) => item.month))
    if (recentMonths.size < 3) continue

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
      sourceCardId: latest.cardId,
      recurrenceDay: latest.day,
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
      sourceCardId: null,
      recurrenceDay: null,
    })
  }

  items.sort((a, b) => b.amount - a.amount)

  const monthlyTotal = sumTL(items.filter((i) => i.isActive).map((i) => i.amount))
  const incomeRatio = monthlyIncome && monthlyIncome > 0 ? Math.round((monthlyTotal / monthlyIncome) * 100) : null

  return { items, monthlyTotal, incomeRatio }
}

// ── Radar → ödeme planı köprüsü (E4) ────────────────────────────────────────
//
// Tespit edilen abonelik yalnız BİLGİYDİ; ödeme planına çevrilince
// obligations/cashFlowForecast görür. Kredi kartına talimatlı desen
// (bank_auto + auto_source_card_id) çift saymayı zaten çözer: nakit çıkışı 0
// sayılır, gerçek çıkış ekstre ödemesinde. Bu yüzden dönüşüm YALNIZ kredi
// kartında sunulur — banka kartı aboneliğine payment eklemek çift sayardı.

/** CardExpense kategorisi → PaymentCategory; birebir karşılığı olmayan 'Diğer'. */
const EXPENSE_TO_PAYMENT_CATEGORY: Record<string, Payment['category']> = {
  Abonelik: 'Dijital üyelik',
  Fatura: 'Fatura',
  Sigorta: 'Sigorta',
  Eğitim: 'Eğitim',
  Sağlık: 'Sağlık',
}

export type SubscriptionPaymentDraft = {
  title: string
  category: Payment['category']
  amount: number
  /** Tahmindir (medyan); paymentEstimate mekanizması sonra gerçekleşenden tazeler. */
  amount_status: 'estimated'
  due_date: string
  status: 'bekliyor'
  payment_method: 'bank_auto'
  auto_source_card_id: string
  recurrence: 'monthly'
  recurrence_day: number
  note: string
}

/**
 * Radar satırından aylık ödeme taslağı. Vade: bu ayın tekrar günü geçtiyse
 * gelecek ay (gün, kısa aya sığmazsa ay sonuna kırpılır).
 */
export function buildSubscriptionPaymentDraft(
  item: SubscriptionItem,
  isCreditCardId: (cardId: string) => boolean,
  today: Date = new Date(),
): SubscriptionPaymentDraft | null {
  if (item.source !== 'recurring_expense') return null
  if (!item.sourceCardId || !item.recurrenceDay) return null
  if (!isCreditCardId(item.sourceCardId)) return null

  const clampDay = (year: number, monthIndex: number, day: number) =>
    new Date(year, monthIndex, Math.min(day, new Date(year, monthIndex + 1, 0).getDate()))
  let due = clampDay(today.getFullYear(), today.getMonth(), item.recurrenceDay)
  if (due < today) due = clampDay(today.getFullYear(), today.getMonth() + 1, item.recurrenceDay)

  return {
    title: item.title,
    category: EXPENSE_TO_PAYMENT_CATEGORY[item.category] ?? 'Diğer',
    amount: item.amount,
    amount_status: 'estimated',
    due_date: due.toLocaleDateString('sv-SE'),
    status: 'bekliyor',
    payment_method: 'bank_auto',
    auto_source_card_id: item.sourceCardId,
    recurrence: 'monthly',
    recurrence_day: item.recurrenceDay,
    note: 'Abonelik radarından eklendi.',
  }
}

/** Aynı başlıklı aylık plan zaten varsa "Planla" yerine rozet gösterilir. */
export function subscriptionAlreadyPlanned(item: SubscriptionItem, payments: Payment[]): boolean {
  const key = normalizeSearchText(item.title)
  if (!key) return false
  return payments.some(
    (payment) => payment.recurrence === 'monthly' && normalizeSearchText(payment.title) === key,
  )
}

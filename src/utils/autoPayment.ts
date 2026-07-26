/**
 * Kredi kartına bağlı otomatik ödemelerin (bank_auto) vade kontrolü.
 * Vadesi gelmiş ödemeleri tespit eder; Supabase görmez (saf).
 */
import type { Card, Payment } from '../types/database'
import { dateInputValue } from './date'

export type AutoPayablePayment = {
  payment: Payment
  card: Card
}

export type AutoPayResult = {
  paymentId: string
  paymentTitle: string
  cardId: string
  cardName: string
  amount: number
  dueDate: string
  category: string
}

export function getAutoPayableDuePayments(
  payments: Payment[],
  cards: Card[],
  today: Date = new Date(),
): AutoPayablePayment[] {
  const todayStr = dateInputValue(today)
  const cardsById = new Map(cards.map((c) => [c.id, c]))

  const result: AutoPayablePayment[] = []
  for (const p of payments) {
    if (p.status !== 'bekliyor' || p.payment_method !== 'bank_auto') continue
    if (!p.auto_source_card_id || p.due_date > todayStr) continue
    const card = cardsById.get(p.auto_source_card_id)
    if (!card || card.card_type !== 'kredi_karti') continue
    result.push({ payment: p, card })
  }
  return result
}

export function toAutoPayResult(payment: Payment, card: Card, paidAmount: number): AutoPayResult {
  return {
    paymentId: payment.id,
    paymentTitle: payment.title,
    cardId: card.id,
    cardName: card.card_name,
    amount: paidAmount,
    dueDate: payment.due_date,
    category: payment.category,
  }
}

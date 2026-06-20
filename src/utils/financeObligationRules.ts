import type { Card, Payment } from '../types/database'
import { isDateInMonth, monthlyOccurrenceDate } from './date'

export function cardMonthlyPaymentAmount(card: Pick<Card, 'statement_debt_amount'>) {
  return card.statement_debt_amount
}

export function paymentOccurrenceInMonth(payment: Payment, month = new Date()) {
  if (payment.status !== 'bekliyor') return null

  if (payment.recurrence === 'monthly') {
    const occurrence = monthlyOccurrenceDate(payment.recurrence_day, month)
    if (!occurrence) return null

    const dueDate = new Date(`${payment.due_date}T00:00:00`)
    const endDate = payment.recurrence_end_date ? new Date(`${payment.recurrence_end_date}T00:00:00`) : null
    if (occurrence < dueDate) return null
    if (endDate && occurrence > endDate) return null
    return occurrence
  }

  return isDateInMonth(payment.due_date, month) ? new Date(`${payment.due_date}T00:00:00`) : null
}

export function paymentUsesCreditCard(payment: Pick<Payment, 'payment_method' | 'auto_source_card_id'>) {
  return payment.payment_method === 'bank_auto' && Boolean(payment.auto_source_card_id)
}

export function paymentCashOutflowAmount(payment: Pick<Payment, 'amount' | 'payment_method' | 'auto_source_card_id'>) {
  return paymentUsesCreditCard(payment) ? 0 : payment.amount
}

/**
 * Ödeme (Payment) ve kart için tek satırlık, saf iş kuralları.
 *
 * Neden ayrı dosya: hem `obligations.ts` (aylık yükümlülük projeksiyonu) hem
 * `financeSummary.ts` (bilanço/nakit akışı) aynı kuralları kullanır; tek yerde
 * tutmazsak iki yer farklı yorumlar ve dashboard ile analiz tutarsızlaşır.
 * Bu yüzden `financeSummary.ts` bu fonksiyonları re-export eder.
 *
 * Kritik kavram: bir kalemin "tutarı" (amount) ile "nakit etkisi"
 * (cashImpact) aynı şey değildir. Kredi kartına yazılan bir ödeme bu ay
 * bankadan para çıkarmaz; o yüzden nakit etkisi 0'dır (borç karta eklenir,
 * gerçek çıkış ekstre ödenince olur). Bkz. `paymentCashOutflowAmount`.
 */
import type { Card, Payment } from '../types/database'
import { isDateInMonth, monthlyOccurrenceDate } from './date'

// Kartın bu ay ödenecek tutarı = yalnızca kesilmiş ekstre borcu.
// Dönem içi harcama (current_period_spending) henüz ekstreye girmediği için
// bu ay vadesi gelmez; o kalem obligations.ts'te ayrı projekte edilir.
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

// Ödeme bir karta talimatlı mı? (otomatik ödeme + kaynak kart seçili).
// Böyleyse para bankadan değil karttan çıkar → bu ayın nakit çıkışı değil.
export function paymentUsesCreditCard(payment: Pick<Payment, 'payment_method' | 'auto_source_card_id'>) {
  return payment.payment_method === 'bank_auto' && Boolean(payment.auto_source_card_id)
}

// Bu ay gerçekten bankadan çıkacak nakit. Karta talimatlıysa 0 (çıkış değil,
// kart borcuna dönüşür; gerçek çıkış o kartın ekstresi ödenince gerçekleşir).
// Nakit akışı/net değer hesapları bunu kullanır; nominal `amount`'u değil.
export function paymentCashOutflowAmount(payment: Pick<Payment, 'amount' | 'payment_method' | 'auto_source_card_id'>) {
  return paymentUsesCreditCard(payment) ? 0 : payment.amount
}
